# Subscribe-with-Snapshot：WS 增量同步提案

> **状态: PROPOSAL（待管理员批准，非 active SPEC）**
> 提案日期：2026-07-27
> 追踪 Issue：[#1411](https://github.com/TokenDanceLab/AgentHub/issues/1411)
> 前置阅读: Codeg 参考实现（原始调研文件已随 2026-08 本机清理删除，见 git 历史）
> 替代对象：`sync.request` / `sync.events` 死协议面（已由 chore/ws-dead-surface 删除并合入 master）

---

## 1. 动机

### 1.1 痛点

AgentHub 当前 WS 层缺乏断线增量恢复能力：

- **无服务端事件缓存**：所有事件推送即忘，无 ring buffer，无 seq 索引。
- **断线恢复靠 REST 全量**：`runEventReplay.ts` 调用 `GET /web/agent-tasks/:id/events?after_seq=<N>`，RTT 高、全量扫描 DB。
- **`sync.request` 协议面已死**：`hubEvents.ts` 中 `SYNC_REQUEST`/`SYNC_EVENTS` 常量仅在前端有声明和路由，hub-server 无任何实现。该死面已由另一 agent 删除（chore/ws-dead-surface 已合入 master）。
- **seq_id 仅 per-conn**（PR #1378）：重连即重置，可检测丢帧但无法跨连接恢复。

### 1.2 目标

| 维度 | 现状 | 目标 |
|------|------|------|
| 断线恢复 | REST `after_seq` 全量 DB 查 | WS 内 attach: `since_seq` -> snapshot/replay/event 三帧型 |
| 事件缓存 | 无 | 有界 ring buffer，每 stream 独立 |
| seq 语义 | per-conn 单调（#1378） | 新增 per-stream 会话层 seq（持久 or 常驻），per-conn seq 保留为传输层 |
| 可观测 | 丢帧/连接计数 | 9 计数器自观测（对标 Codeg） |
| 死协议面 | `sync.request`/`sync.events` | 彻底移除，由本协议替代 |

---

## 2. 设计八问

### Q1. 订阅粒度

**选择：per-session 订阅。**

| 选项 | 理由 |
|------|------|
| per-user 全量流 | 对多会话 IM 形态不经济；用户可能加入 50+ 会话，只关注当前打开的几个。断线重连回放所有会话事件不可行。 |
| **per-session 订阅（选择）** | 1. AgentHub 的 `PushToSession` 已是主导分发路径（`app/events.go` 33 个订阅中 ~90% 走 session fanout）；per-user 仅 friend/device 通知场景。2. 前端 `webHubRealtime.ts` 按 active task 跟踪 `lastEventSeq`，本质是 per-task（task 绑 session）。3. 一条 WS 连接可多路复用多个 session 订阅（对标 Codeg `subscription_id` 设计）。 |
| per-task 订阅 | 太细；IM 消息、会话元数据等非 task 事件也需要增量。 |

结论：**一条 WS 支持多个 `subscription_id`（per-session + per-task 混合粒度），用 `subscription_id` 区分 stream。**

### Q2. seq 语义迁移

**选择：双 seq 并存 —— per-conn seq（传输层，PR #1378 保留）+ per-stream seq（会话层，本次新增）。**

```
┌─────────────────────────────────────────────┐
│ 传输层 seq (per-conn)                       │
│ · 每连接单调递增                            │
│ · PushToConn 时 seq.Add(1)                  │
│ · 用途：客户端检测丢帧（gap 检测）          │
│ · 重连即重置                                │
├─────────────────────────────────────────────┤
│ 会话层 seq (per-stream)  ← 本次新增        │
│ · 每个 session 的事件流独立单调递增         │
│ · emit 时在临界区内分配，入 ring buffer      │
│ · 用途：attach 时 since_seq 游标恢复        │
│ · Hub 重启后丢失（内存 ring）→ 退化 snapshot │
└─────────────────────────────────────────────┘
```

- per-session 的 `stream_seq` 存在 DB `sessions` 表的已有 `next_seq` 列重用，或新增 `event_seq` 列。消息 seq 已有 DB 级 CAS（`UPDATE sessions SET next_seq = next_seq + 1 ... RETURNING`），IM 事件可直接复用。
- Agent task 事件已有 `event_seq`（`agent_run_events.event_seq`，per-task 的 MAX+1 事务分配）。WS stream seq 可与此对齐，emit 时写入 DB + ring buffer 同临界区。
- **不替换 per-conn seq**：per-conn seq 是传输层概念，用于端到端丢帧检测；per-stream seq 是会话层概念，用于跨连接恢复。两者正交。

### Q3. Ring buffer 归属与参数

**选择：独立 `EventLog` 组件，放在 `hub-server/internal/ws/eventlog.go`，不在 Manager 内。**

```
EventLog struct {
    mu       sync.RWMutex
    streams  map[string]*StreamBuffer  // key: session_id or task_id
}

StreamBuffer struct {
    ring     []EventEnvelope            // 环形缓冲
    head     int                        // 写入位置
    count    int                        // 已占用条目数（≤ cap）
    seq      int64                      // 下一个分配的 seq
    bytes    int64                      // 当前占用字节数
}
```

**参数取值：**

| 参数 | Codeg 值 | AgentHub 取值 | 理由 |
|------|----------|---------------|------|
| `RING_MAX_COUNT` | 128 | **256** | IM 事件频度高于 ACP 单会话事件（消息/已读/反应/在线）；设为 256 覆盖约 10 分钟高速 IM burst |
| `RING_MAX_BYTES` | 128 KiB | **512 KiB** | 单条消息 payload 可达 4 KB（含 reaction/pin），256 条即 1 MiB 理论峰值；512 KiB 折中 |
| `EVENT_MAX_BYTES` | 64 KiB | **256 KiB** | `agent.stream` payload 可达 ~32 KB（含 code blocks）；`agent.done` 含 usage + result_summary 可达 48 KB；256 KiB 覆盖且留余量 |
| `BROADCAST_CAPACITY` | 4096 (per-conn) | **256**（复用现有 `WSSendBufferSize`） | 已存在 |
| `REPLAY_BATCH_THRESHOLD` | 32 | **64** | IM 事件体积小，64 条批 replay 对客户端开销可忽略 |

**Superseded 压缩：** 适用。

- `message.edited` 同 message_id → 旧 envelope 剥 payload 保 seq 槽位。
- `message.reaction_added/removed` → 若同消息有多个反应变化，中间态可压缩。
- `agent.stream` 连续 text_delta → 不压缩（每帧 1-2 KB，压缩增益小且破坏前端增量渲染）。
- 压缩实现：`ring[slot] = EventEnvelope{Seq: seq, Type: "", Superseded: true}` 保留槽位。

### Q4. Attach 协议帧

**选择：复用现有 `Frame` 结构，新增 `type` 值 + `since_seq` 字段，不建新子协议。**

```json
// 客户端 → 服务端：attach 请求
{"type": "subscribe.attach", "payload": {
  "subscription_id": "sess_<uuid>",
  "since_seq": 42
}}

// 服务端 → 客户端：snapshot 帧
{"type": "subscribe.snapshot", "seq_id": 1, "payload": {
  "subscription_id": "sess_<uuid>",
  "stream_seq": 58,
  "snapshot": { /* 全量会话状态（复用 REST 快照结构）*/ }
}}

// 服务端 → 客户端：replay 帧（≤ REPLAY_BATCH_THRESHOLD 条）
{"type": "subscribe.replay", "seq_id": 2, "payload": {
  "subscription_id": "sess_<uuid>",
  "events": [{ "seq": 43, "type": "message.new", "payload": {...} }, ...],
  "high_water_seq": 58
}}

// 服务端 → 客户端：event 帧（续流，沿用现有 type，追加 stream_seq）
{"type": "message.new", "seq_id": 3, "stream_seq": 59, "payload": {...}}

// 服务端 → 客户端：detached 帧（客户端应重 attach）
{"type": "subscribe.detached", "payload": {
  "subscription_id": "sess_<uuid>",
  "reason": "lagged"
}}

// 客户端 → 服务端：detach 请求
{"type": "subscribe.detach", "payload": {
  "subscription_id": "sess_<uuid>"
}}
```

**Snapshot 内容来源：** 复用现有 REST snapshot 端点结构，WS 内联返回 —— 不新增数据结构。

- IM 会话：复用 `GET /web/sessions/:id` 的 `SessionFull` response（消息列表 + pin + reaction + 成员）。
- Agent task：复用 `GET /web/agent-tasks/:id` + `GET /web/agent-tasks/:id/events` 聚合结果。
- 实现上：`handleAttach` 调用现有 service 方法构造 snapshot，在同一读锁内完成。

**向后兼容：**
- 新增 `type` 值以 `subscribe.` 前缀区别于现有事件，老客户端不认识即忽略（`processIncoming` 的 `default` 分支静默丢弃）。
- 现有 `{type, seq_id, payload}` 帧结构不变，`stream_seq` 为可选字段。
- 老客户端发 `sync.request` → 服务端不响应（无实现），由本协议替代。

### Q5. 恢复矩阵

| 场景 | 行为 | 降级路径 |
|------|------|----------|
| **前端页面刷新** | WS 断开 → 新 WS → attach `since_seq=null` → 服务端返回冷 snapshot | 无 |
| **WS 断线重连（< 30s）** | 前端保存 `lastAppliedSeq` → 重连 → attach `since_seq=lastAppliedSeq` → 服务端判断：ring 命中 + gap ≤ 64 → **replay**；否则 → **snapshot** | snapshot fallback |
| **Hub 重启（内存 ring 丢失）** | 所有 stream buffer 清空 → 客户端 attach `since_seq=N` → 游标越界 → **snapshot**（from DB） | 无（DB 持久化 snapshot 数据） |
| **客户端长时间断线（ring 已滚出）** | `since_seq < ring[head].seq` → 游标越界 → **snapshot** | 无 |
| **REST 兜底** | 保留 `GET ...?after_seq=N` 端点作为**最终兜底**（用于极长时间离线、多步恢复失败） | WS 协议是第一路径，REST 是第二路径 |

**与 REST recovery 的关系：** 保留为最终兜底，不退役。WS 协议是第一恢复路径（低延迟、增量），REST 是第二路径（可靠性、跨版本兼容）。

### Q6. 竞态与锁

**对标 Codeg「同一写锁内 gate→apply→seq++→ring push」模式，映射到 AgentHub 结构：**

```
emit (manager.go: PushToSession)
  │
  ├─ 1. EventLog.mu.Lock()
  │     ├─ seq = stream.seq + 1
  │     ├─ stream.seq = seq
  │     ├─ ring[head] = EventEnvelope{seq, type, payload}
  │     ├─ stream.head = (head+1) % cap
  │     ├─ stream.count = min(count+1, cap)
  │     └─ apply Superseded 压缩逻辑
  │  ← EventLog.mu.Unlock()
  │
  ├─ 2. Fanout to connections (现有 PushToSession 逻辑，per-conn seq 在此分配)
  │
  └─ 3. Per-attach forwarder 从 stream broadcast channel 消费，写入 WS

attach (handler/ws.go: handleAttach)
  │
  ├─ 1. EventLog.mu.RLock()
  │     ├─ since_seq==None → cold snapshot
  │     ├─ since_seq < ring[first].seq → snapshot (越界)
  │     ├─ ring 命中 && gap ≤ REPLAY_BATCH_THRESHOLD → replay
  │     ├─ 其余 → snapshot
  │     └─ subscribe(stream) ← 在同一读锁内完成注册
  │  ← EventLog.mu.RUnlock()
  │
  └─ 2. 发送 snapshot/replay 帧
```

**关键竞态防护：**
- `subscribe()` 与 snapshot 决策在同一读锁内完成 → attach 与 emit 无竞态（emit 需要写锁，被读锁阻塞）。
- Per-attach forwarder 使用 epoch 模式防「重 attach 后旧 forwarder 的 Detach 信号误删新订阅」（对标 Codeg `ws_attach.rs:202-217`）。
- `EventEnvelope` payload 使用 `json.RawMessage`（bytes 共享，低拷贝）。

**`emit_with_state_gated` 的 gate 函数：** AgentHub 目前不需要 gate 谓词。Codeg gate 用于 feedback 与 turn_in_flight 原子检查；AgentHub 的 IM 事件无需否决。Reserve 接口供未来团队审批/协调场景使用。

### Q7. 可观测

对标 Codeg 9 计数器，映射到 `hub-server/internal/metrics/metrics.go`：

| # | Codeg 计数器 | AgentHub Metric Name | 类型 | 用途 |
|---|-------------|---------------------|------|------|
| 1 | `emitted_count` | `ws_stream_emitted_total` | Counter(label: stream) | 每 stream 发出事件总数 |
| 2 | `lagged_count` | `ws_stream_lagged_total` | Counter(label: stream) | 慢消费者 detached 次数 |
| 3 | `ring_buffer_evict_count` | `ws_ring_evict_total` | Counter(label: stream) | ring 满时淘汰事件数 |
| 4 | `replay_count` | `ws_replay_total` | Counter | replay 批次次数 |
| 5 | `replay_event_total` | `ws_replay_event_total` | Counter | replay 总事件数（avg batch size = #5/#4） |
| 6 | `snapshot_fallback_count` | `ws_snapshot_fallback_total` | Counter | replay 降级为 snapshot 次数（高→buffer 该调大） |
| 7 | `snapshot_cold_count` | `ws_snapshot_cold_total` | Counter | since_seq 为空导致的冷 attach 次数 |
| 8 | `forwarder_lagged_count` | `ws_forwarder_lagged_total` | Counter | per-attach forwarder 因 lagged 退出次数 |
| 9 | `worker_queue_full_count` | `ws_outbound_full_total` | Counter | 与现有 `WSDroppedFrames` 合并（EventLog 消费端背压） |

现有 metric：`WSDroppedFrames`（保留，归入 #9 语义）、`WSConnections`（保留）、`WSRateLimitedMsgs`（保留）、`WSKickedConns`（保留）。

暴露端点：`GET /api/debug/event_metrics`（对标 Codeg，返回瞬时快照）。

### Q8. 分阶段 PR 计划

每阶段可独立合并、可独立回退、CI 可验证。

#### 后端阶段

| Phase | PR | 内容 | 规模 | 前置 | CI 验证 |
|-------|----|------|------|------|---------|
| **B1** | EventLog 组件 | `eventlog.go`：Ring buffer、seq 分配、superseded 压缩、`range_after(since_seq)` 查询、9 个 counters；不接任何发射端 | M | 无 | `go test ./internal/ws/...` |
| **B2** | Attach 协议帧 | `frame.go` 新增 `subscribe.attach/snapshot/replay/detach/detached` 类型；`handler/ws.go` 新增 `handleAttach/handleDetach` + epoch 防护；不接 push 端 | M | B1 | `go test ./internal/handler/...` |
| **B3** | emit 接 EventLog | `manager.go` `PushToSession` 路径接入 EventLog（emit→ring push→fanout 三步）；`app/events.go` 33 个订阅无需改动（PushToSession 内部透明接入） | M | B1 | `go test ./internal/ws/... ./internal/app/... -short` |
| **B4** | Snapshot 构造 | 复用 service 层已有方法构造 `subscribe.snapshot` payload；IM 走 `SessionService`，task 走 `AgentService` | L | B2 | `go test ./internal/handler/... -short` |
| **B5** | Debug metrics 端点 | `GET /api/debug/event_metrics` 暴露 9 计数器瞬时值 | S | B1 | `go test ./internal/handler/... -short` |
| **B6** | 移除 sync.request 死面 | 清理 `hubEvents.ts` 中 `SYNC_REQUEST`/`SYNC_EVENTS` 常量及所有引用（已由 chore/ws-dead-surface 完成，合并前验证 master 无残留） | S | B2 | `corepack pnpm typecheck && corepack pnpm test` |

#### 前端阶段

| Phase | PR | 内容 | 规模 | 前置 | CI 验证 |
|-------|----|------|------|------|---------|
| **F1** | hubWS attach API | `hubWS.ts` 新增 `attach(subscription_id, since_seq?)` / `detach(subscription_id)` / `onSnapshot` / `onReplay`；移除 `sendSync` | M | B2 | `corepack pnpm test -- --run` |
| **F2** | 恢复逻辑切换 | `runEventReplay.ts` 重写：WS attach replay 为首选，REST `after_seq` 为 fallback；`webHubRealtime.ts` 重连后走 attach 而非 `sync.request` + REST | M | F1, B3 | Playwright: reconnect gap fill |
| **F3** | Desktop attach | `useHubEventStream.ts` 接入 attach/detach；与 Web 共享 hubClient 路径（`SYNC_REQUEST`/`SYNC_EVENTS` 路由已随 chore/ws-dead-surface 移除） | M | F2 | Desktop `pnpm test && pnpm typecheck` |
| **F4** | Mobile attach | `hubClient.ts` 接入 attach/detach（`SYNC_REQUEST` 客户端类型与 `hubEvents.ts` 死常量已随 chore/ws-dead-surface 移除） | S | F2 | Mobile `pnpm typecheck` |

#### 总规模估计

| 层 | Phases | 总估计 |
|----|--------|--------|
| 后端 | B1-B6 (6 PRs) | ~1,500-2,000 LOC Go + ~300 LOC tests |
| 前端 | F1-F4 (4 PRs) | ~400-600 LOC TS + ~150 LOC tests |
| **合计** | **10 PRs** | **~2,500 LOC** |

---

## 3. 帧格式示例

### Attach（冷启动）

```
Client → Server:
{"type":"subscribe.attach","payload":{"subscription_id":"sess_abc","since_seq":null}}

Server → Client:
{"type":"subscribe.snapshot","seq_id":1,"payload":{
  "subscription_id":"sess_abc",
  "stream_seq":58,
  "snapshot":{
    "session":{"id":"sess_abc","title":"...","members":[...]},
    "messages":[...],
    "pins":[...]
  }
}}
```

### Attach（断线重连，ring 命中）

```
Client → Server:
{"type":"subscribe.attach","payload":{"subscription_id":"sess_abc","since_seq":47}}

Server → Client (gap=11 ≤ 64 → replay):
{"type":"subscribe.replay","seq_id":2,"payload":{
  "subscription_id":"sess_abc",
  "events":[
    {"seq":48,"type":"message.new","payload":{...}},
    {"seq":49,"type":"message.reaction_added","payload":{...}},
    ...
    {"seq":58,"type":"message.new","payload":{...}}
  ],
  "high_water_seq":58
}}
```

### Attach（ring 溢出，降级）

```
Client → Server:
{"type":"subscribe.attach","payload":{"subscription_id":"sess_abc","since_seq":5}}

Server → Client (since_seq < ring[first].seq → snapshot):
{"type":"subscribe.snapshot","seq_id":3,"payload":{
  "subscription_id":"sess_abc",
  "stream_seq":58,
  "snapshot":{...}
}}
```

### Event（续流）

```
Server → Client:
{"type":"message.new","seq_id":4,"stream_seq":59,"payload":{"message_id":"msg_xyz","content":"hello"}}
```

### Lagged → Detach → Re-attach

```
Server → Client:
{"type":"subscribe.detached","payload":{"subscription_id":"sess_abc","reason":"lagged"}}

Client → Server:
{"type":"subscribe.attach","payload":{"subscription_id":"sess_abc","since_seq":59}}
```

---

## 4. 参数表

| 参数 | 默认值 | 所在文件 | 说明 |
|------|--------|----------|------|
| `RING_MAX_COUNT` | 256 | `ws/eventlog.go` | 每 stream ring buffer 条目上限 |
| `RING_MAX_BYTES` | 524288 (512 KiB) | `ws/eventlog.go` | 每 stream ring buffer 字节上限 |
| `EVENT_MAX_BYTES` | 262144 (256 KiB) | `ws/eventlog.go` | 单事件拒收阈值 |
| `REPLAY_BATCH_THRESHOLD` | 64 | `ws/eventlog.go` | replay 批次大小上限 |
| `OUTBOUND_CAPACITY` | 256 | 复用 `config.WSSendBufferSize` | per-attach forwarder 出站缓冲 |
| `PER_CONN_MAX_SUBSCRIPTIONS` | 16 | `config/constants.go`（新增） | 单连接最大 attach 数 |

---

## 5. 行为表

| 状态/事件 | 现有行为 | 新行为 | 触发条件 |
|-----------|---------|--------|---------|
| 页面首次加载 | WS 连接 → `auth.ok` → 等待事件 | 同 + 可选 `subscribe.attach(subscription_id)` | 前端决定 attach 时机 |
| WS 断线（< 30s） | 指数退避重连 → `sync.request`(dead) + REST `after_seq` | 重连 → `subscribe.attach(since_seq=lastAppliedSeq)` → replay/snapshot | `lastAppliedSeq` 非空 |
| WS 断线（长期） | REST 全量 fetch | `subscribe.attach(since_seq=<stale>)` → ring 溢出 → snapshot | `since_seq < ring_first_seq` |
| Hub 重启 | 无感知（无缓存） | 全量 snapshot（内存 ring 空，DB 数据仍在） | 任意 attach |
| ring buffer 满 | 不存在 | 头事件被覆盖；Superseded 压缩减小压力 | `count == RING_MAX_COUNT` |
| 单事件超限 | 不检查（通过 PushToConn 硬塞） | 拒收该事件 + 清空整环 → 下次 attach 强制 snapshot | `event_size > EVENT_MAX_BYTES` |
| 慢消费者 | buffer 满 → drop + 采样日志 | forwarder lagged → `subscribe.detached` → 客户端重 attach | broadcast channel 满 |
| 多重 attach | 不存在 | epoch 匹配防旧 forwarder 误删新订阅 | 同一 subscription_id 重复 attach |

---

## 6. 与 sync.request 死面删除的衔接

当前 `sync.request` / `sync.events` 的状态：

| 位置 | 内容 | 状态 |
|------|------|------|
| `app/shared/src/hubEvents.ts` | `SYNC_REQUEST` / `SYNC_EVENTS` 常量 | 已删除（chore/ws-dead-surface 已合入 master） |
| `app/web/src/api/hubWS.ts` | `sendSync()` 方法 | 已删除（同上） |
| `app/mobile-rn/src/api/hubClient.ts` | `sync.request` 联合类型 | 已删除（同上） |
| `hub-server` | **无任何实现** | 从未实现 |

衔接：
1. chore/ws-dead-surface 已删除前端死面并合入 master，前端已无 `sync.request` 消费。
2. 本 SPEC 的 B2（attach 帧）在服务端提供新协议 → 前端重建恢复逻辑时直接调 `subscribe.attach`。
3. 时间上可并行：死面删除已完成，不影响本 SPEC 的任何阶段（因为死面本就无服务端实现）。

---

## 7. 未覆盖项（明确 out of scope）

- **持久化 ring buffer 到硬盘**：Hub 重启后 ring 丢失是可接受的降级（snapshot fallback），不引入 WAL/RocksDB。
- **Edge ↔ Hub 增量同步**：本 SPEC 仅覆盖 Hub ↔ 前端 WS。Edge-Hub 链路的增量同步（workspace_state 等价物）是独立议题。
- **事件溯源投影**：本 SPEC 不改变 AgentHub 的事件持久化模型（DB 存储），ring buffer 是纯内存缓存层。
- **Gateway 层转发优化**：Gateway 透传 WS 帧的 buffering 策略不在本范围。
