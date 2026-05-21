# AgentHub WebSocket Reliability -- 跨仓库深度分析

> 分析日期: 2026-05-21
> 前置: 10-openhands-agent-protocol.md (WS+REST+pending), 02-go-services.md (WSHub), 10-graceful-degradation.md (4层重连), 06-realtime-sync.md (seq LWW)
> 交叉引用: 01-adapters.md (Agent SDK), 03-eventstore-memory.md (JSONL 唯一事实源), 08-error-handling.md (ErrorCode/Retryable)

---

## 1. 摘要

AgentHub 的 WebSocket 可靠性方案综合了四个仓库的最佳实践: OpenHands 的 WS+REST 双通道 + pending queue、Claude Code Viewer 的 JSONL+FTS5 索引、Kanna 的 writeChain 串行化、以及 OpenCode 的 SSE EventBus 模式。最终形成 **seq-based 事件溯源 + WSHub 多房间广播 + 四层自动重连 + 离线队列回放** 的完整方案。

---

## 2. 跨仓库断线检测机制对比

### 2.1 检测策略矩阵

| 仓库/组件 | 机制 | 间隔 | 超时判定 | 误报防护 |
|----------|------|------|---------|---------|
| **OpenHands (前端 WS)** | WebSocket readyState 轮询 | 隐式 (浏览器 API) | `readyState !== OPEN` 即不可用 | REST fallback 透明切换，不阻塞用户 |
| **OpenHands (Agent Server)** | 无显式心跳 | -- | App Server sandbox health check (startup_grace_seconds 15s) | 健康检查端点 `/health` |
| **AgentHub WSHub** | coder/websocket Ping/Pong | 15s | 3 次 Pong 丢失 → close | 内置 Pong handler + `lastPing` 时间戳 |
| **AgentHub Edge-Runner** | Runner → Edge 心跳 | 10s | 3 次丢失 = 30s → unhealthy; 6 次 = 60s → offline | Runner 自主执行 + 本地缓冲结果 |
| **AgentHub Hub-Edge (WAN)** | Edge → Hub 心跳 | 30s (隐式 WS ping) | 3 次丢失 = 90s → mark offline | Edge 本地自治 + sync_outbox 队列 |
| **AgentHub Agent 子进程** | 进程存活监测 | 连续 (os.Process) | 进程退出 → 立即检测 | SIGTERM 信号 → ProcessRegistry.KillAll() |

### 2.2 核心判断: Ping/Pong vs Heartbeat vs Timeout

```
OpenHands 模式（被动检测）:
  优点: 零开销，依赖浏览器原生 WebSocket 状态
  缺点: 无法区分"网络延迟"和"服务端卡死"；无心跳意味着代理/防火墙可能断开空闲连接
  适用: 前端到 Agent Server 的同机房低延迟连接

AgentHub 模式（主动 Ping/Pong + 心跳）:
  WSHub (P0): coder/websocket 内置 Ping/Pong，15s 间隔
    -- 所有 WS 连接共享同一心跳机制，协议层保活
  Edge-Runner (P0): 独立心跳 10s，3 次丢失触发降级
    -- Runner 进程级健康独立于 WS 连接健康
  Hub-Edge (P1): 心跳通过 WAN WS 的 Ping/Pong 实现，90s 超时
    -- WAN 容忍更高延迟，避免因网络抖动误判离线
```

**决策**: AgentHub 采用分层心跳——WS 层用 coder/websocket 内置 Ping/Pong 保活协议层；进程层用心跳间隔独立判断组件健康。两者解耦: WS 断开不等于 Runner 不健康。

---

## 3. 消息可靠投递语义

### 3.1 跨仓库语义对比

| 仓库 | 语义 | 实现方式 | 去重 | 丢失风险点 |
|------|------|---------|------|-----------|
| **OpenHands (WS 路径)** | **at-most-once** | WS send → 无 ACK | 无 | WS 断开瞬间发送的消息 |
| **OpenHands (REST 路径)** | **at-least-once** | PendingMessageService.queue → 自动投递 → 清除 | 服务端去重 (conversation_id, message_id) | 队列满 (max 10) 拒绝新消息 |
| **AgentHub seq-based (Turn 级)** | **exactly-once** | writeChain 串行化 + 全局 seq + Hub 去重 `(edge_id, seq)` | 是 (edge_id, seq) 复合键 | Compaction 窗口期的 in-flight 消息 |
| **AgentHub sync_outbox (Edge-Hub)** | **at-least-once** | Ring buffer (10K) + 重连后 seq 序回放 | Hub 端去重 | outbox 满 (10K) 丢弃最旧 |
| **AgentHub UI 发送** | **at-least-once** | 乐观 UI + 10s 软超时 + 30s 硬超时 + 重试 | Edge 端 dedup | 客户端崩溃/页面关闭 |
| **AgentHub Runner 本地输出** | **at-least-once** | Runner 本地 EventStore 缓冲 + Edge 重连后推送 | Edge 端去重 | Runner 进程崩溃 + WAL 损坏 |

### 3.2 为什么 AgentHub 选择 exactly-once 为主、at-least-once 为辅

```
Exactly-Once 的保障路径 (Turn/Message 级):
  Edge write -> sync_outbox -> (seq 分配) -> Hub writeChain -> append events.jsonl
                                                        └── 去重: (edge_id, seq)
  Hub 单写者 (writeChain buffer=1) 保证 seq 全局单调，天然不会有重复 seq.
  Edge 重发时使用相同 seq, Hub 拒绝重复 seq → 实现 exactly-once 投递.

At-Least-Once 的兜底路径 (轻量事件):
  Runner 本地输出、连接状态变更等高频事件使用 sync_outbox ring buffer.
  Hub 通过 (edge_id, seq) 去重, 重复事件静默丢弃.
  不保证 exactly-once 因为 ring buffer 可能满 → 最旧事件被覆盖.
```

### 3.3 OpenHands pending_messages 模式在 AgentHub 的映射

```
OpenHands:
  WS 断开 → PendingMessageService.queueMessage(convId, {role, content})
  限制: 10 条/conversation
  WS 恢复 → doSendPendingMessages() → 投递 → 清除

AgentHub 等效:
  UI WS 断开 → Edge 端 local queue (sync_outbox)
  限制: 10K 条 (ring buffer)
  WS 恢复 → Syncer.Start() → Push queue in seq order → Hub 去重
  OpenHands 的 "10 条 max" 在 AgentHub 被放大到 10K
  -- 因为 AgentHub 的 sync_outbox 承载的不只是"待发消息", 还包括 Run 状态、Artifact 元数据等
```

---

## 4. 重连后的状态恢复策略

### 4.1 三种恢复模式

```
模式 A: 全量重传 (OpenHands resend_all=true)
  触发: 每次 WS 连接建立
  数据: 所有历史 Event (从 conversation 创建开始)
  优点: 简单, 前端状态一定完整
  缺点: 历史长的 conversation 带宽浪费严重
  适用: 单会话 short-lived agent task

模式 B: 增量追赶 (AgentHub seq cursor)
  触发: SyncRequest{ SinceSeq }
  数据: WHERE seq > since_seq 的事 件批次 (max 500/batch)
  优点: 带宽高效, 连续多 batch 支持
  缺点: 依赖 seq 持久化且不丢
  适用: 长期运行的 Edge-Hub 同步

模式 C: 快照恢复 (AgentHub Compaction + OpenHands COUNT 校验)
  触发: Compacted=true 或 expected_count != actual_count
  数据: snapshot.json.zst (完整状态快照)
  优点: 一次性重建, 不依赖历史事件
  缺点: snapshot 可能较大 (但 zstd 压缩)
  适用: 历史事件已被 compaction 折叠时
```

### 4.2 AgentHub 的组合恢复协议

```
                    ┌─────────────────────┐
    连接建立 ──────>│  期望事件数校验       │
                    │ (OpenHands COUNT)    │
                    └──────┬──────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
          相等 ▼       偏少 ▼       偏多 ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │ 增量追赶  │  │ Compaction│  │ 快照恢复  │
    │ (delta)  │  │ 已发生    │  │ (snapshot)│
    │          │  │ → 快照    │  │           │
    └────┬─────┘  └────┬─────┘  └────┬──────┘
         │             │             │
         └─────────────┼─────────────┘
                       ▼
                ┌──────────┐
                │ 稳定流    │
                │ (正常WS)  │
                └──────────┘
```

### 4.3 跨仓库恢复细节对比

| 维度 | OpenHands | AgentHub Edge-Hub | AgentHub UI-Edge | AgentHub Runner-Edge |
|------|-----------|-------------------|------------------|---------------------|
| **触发方式** | WS connect + resend_all=true | Edge 注册 + last_seq | client.connect + last_event_id | runner.register + recovery:true |
| **数据来源** | Agent Server 事件存储 | Hub sync_events 表 | Edge EventStore | Runner 本地 checkpoint |
| **批量大小** | 一次性全部 | 500/batch | 100/batch | 单次 |
| **去重** | conversation_id + event_id | (edge_id, seq) | event_id | run_id |
| **冲突处理** | 后者覆盖 (LWW) | seq 排序, 都保留 | Edge 为 authority | Runner 汇报, Edge 裁决 |
| **压缩支持** | 无 | Compacted flag + snapshot | snapshot (Edge 生成) | checkpoint restore |

---

## 5. AgentHub WebSocket 可靠性方案 (综合)

### 5.1 四层重连策略 (来源: 10-graceful-degradation.md)

```
Tier 1: UI <-> Edge (localhost WS)
  检测: coder/websocket Ping/Pong 15s
  重连: 500ms, 1s, 2s, 4s, max 10s 指数退避, 无限重试
  恢复: 增量追赶 (EventStore seq cursor)
  降级: 无 WebSocket → 仅 HTTP REST 可用

Tier 2: Edge <-> Hub (WAN reverse WSS)
  检测: coder/websocket Ping/Pong 15s, Hub 侧 90s 超时 mark offline
  重连: 1s, 2s, 4s, 8s, max 30s 指数退避, 无限重试
  恢复: seq cursor + sync_outbox flush (max 10K events)
  降级: Hub 离线 → Edge 完全本地自治 (-- 不退化功能性)

Tier 3: Runner -> Edge (localhost heartbeat)
  检测: 独立心跳 10s, 3 次丢失 mark unhealthy, 6 次 mark offline
  重连: Edge restarts Runner (max 3 attempts, 2s spacing)
  恢复: checkpoint restore + run reconciliation
  降级: Runner 离线 → 新 run 排队, 活跃 run 继续自主执行

Tier 4: Agent 子进程 -> Runner (process monitoring)
  检测: os.Process 存活, SIGTERM 优雅关闭 (5s timeout)
  重连: 新 run 从 checkpoint 恢复 (不恢复进程)
  恢复: Timeli neStore.Load() + workspace validate via git status
  降级: 进程崩溃 → Active run → failed; 用户手动 retry
```

### 5.2 消息可靠性保障层

```
┌────────────────────────────────────────────────────────────┐
│  Layer 1: UI 层 (at-least-once)                            │
│  - 乐观发送: 消息立即展示, 10s 软超时, 30s 硬超时         │
│  - 失败回滚: [Retry] [Edit & Resend] [Delete]             │
│  - WS 断开: 降级到 Edge REST POST /api/messages            │
└──────────────────────────┬─────────────────────────────────┘
                           │ WS / REST
┌──────────────────────────┴─────────────────────────────────┐
│  Layer 2: Edge 层 (at-least-once → Hub)                    │
│  - sync_outbox ring buffer (10K entries)                  │
│  - seq order replay on reconnect                          │
│  - Hub dedup: (edge_id, seq) 拒绝重复                     │
│  - Outbox 满 → 丢弃最旧 (snapshot 可重建)                  │
└──────────────────────────┬─────────────────────────────────┘
                           │ Reverse WSS
┌──────────────────────────┴─────────────────────────────────┐
│  Layer 3: Hub 层 (exactly-once)                            │
│  - writeChain 串行化: Go channel buffer=1                 │
│  - 全局单调 seq, (edge_id, seq) 去重                      │
│  - events.jsonl append-only + FTS5 索引                   │
│  - Compaction: 2MB 阈值, snapshot + Compacted flag        │
└────────────────────────────────────────────────────────────┘
```

### 5.3 WSHub 房间模型与可靠广播

```
WSHub 房间命名约定:
  "conv:{conversationID}" -- 一个对话的所有参与者
  "edge:{edgeID}"         -- Edge 到 Hub 的专用通道
  "user:{userID}"         -- 用户所有设备 (多端通知)

广播模型 (来源: 02-go-services.md Section 5):
  Register(client, roomID)      -- 加入房间
  Broadcast(roomID, msg)        -- 广播给房间内所有客户端
  BroadcastExcept(roomID, msg, excludeID) -- 排除发送者
  SendToClient(roomID, clientID, msg)     -- 定向投递

可靠性细节:
  - SendCh buffer = 64 (客户端写队列)
  - 队列满 → 断开客户端 (背压: 消费者太慢则断开)
  - writePump 15s Ping 保活
  - readPump 读 + 广播 (客户端上行 → 房间内其余客户端)
  - 房间内无客户端 → 自动清理房间
```

### 5.4 离线队列与 replay 协议 (来源: 06-realtime-sync.md)

```
Edge 离线期间:
  1. sync_outbox 累积事件 (ring buffer, 10K)
  2. 本地继续工作 (Edge-local-first)
  3. 重连时:
     a. Edge sends edge.register with last_seq
     b. Hub computes delta: sync_events WHERE cursor > last_seq
     c. Hub sends sync.catchup (500/batch) — 含 Hub 侧新事件
     d. Edge applies catchup, updates cursor
     e. Edge flushes sync_outbox in seq order
     f. Hub deduplicates: INSERT OR IGNORE on (edge_id, seq)
     g. Steady-state: Edge polls / Hub pushes via WS

Compaction 窗口期处理:
  - Edge poll SinceSeq=900, 但 events.jsonl 已被 compaction 清空
  - Hub 返回 Compacted=true + snapshot (含 seq=1000 的完整状态)
  - Edge 丢弃本地事件缓存 → 从 snapshot 重建
  - 下次 poll SinceSeq=1001

语义冲突检测 (Turn 级):
  - Runner 执行 Turn 前: 检查 SinceSeq < LatestSeq
  - 若落后: 先拉 delta → 检测文件冲突 (git diff)
  - 有冲突: 提示用户或自动 merge (git rebase 语义)
```

### 5.5 用户可见的连接状态 (来源: 10-graceful-degradation.md Section 5)

```
连接指示灯 (Sidebar 底部, 常驻):
  Green  + "Local"              -- 本地健康 (P0, 无 Hub 也正常)
  Green  + "Hub connected"      -- Hub 已连接 (P1+)
  Yellow + "Connecting..."      -- 第 N 次重连中
  Yellow + "Hub offline"        -- Hub 不可达, 本地正常
  Red    + "Edge disconnected"  -- 本地 Edge 不可达, UI 无法工作

降级 Banner (上下文相关, 非 Modal):
  - Hub offline: "Cloud sync paused. Local execution unaffected." [Dismiss]
  - Hub offline > 5min: "Messages sync on reconnect." [Dismiss] [Status]
  - Runner unhealthy: "Runner not responding. Active runs may be interrupted." [View Runs]
  - Sync outbox near limit: "9,500/10,000 pending events. Connect soon." [Connect Now]

Run 状态 (降级期间):
  - All healthy → 正常流式
  - Hub offline → 正常 + "Offline" badge
  - Edge reconnecting → "Reconnecting..." spinner, 不可新开 run
  - Runner unhealthy → "Runner unavailable" + last output
  - Runner restarting → "Restarting runner (attempt 2/3)..."
  - Agent crashed → "Agent stopped unexpectedly" + detail
```

---

## 6. 决策汇总

| 决策 | 选择 | 排他的替代方案 | 依据 |
|------|------|--------------|------|
| 断线检测 | 分层 Ping/Pong (WS) + 独立心跳 (进程) | 统一 heartbeat | 协议层和进程层健康不应耦合 |
| WS 心跳间隔 | 15s (coder/websocket 内置) | 30s (WAN 容忍) | 15s 在 localhost 和 WAN 都合理 |
| Runner 心跳间隔 | 10s, 3 次丢失触发 | 5s | 30s 检测窗口够快, 不浪费 CPU |
| 消息投递语义 | exactly-once (Turn 级) + at-least-once (事件级) | 全 exactly-once | 事件级 exactly-once 开销过大; 去重 + seq 已足够 |
| 重连后恢复 | 增量优先, Compacted 时降级为快照 | 始终全量 (OpenHands) | 长期会话增量更高效; snapshot 作为兜底 |
| 离线队列容量 | 10K ring buffer | 10 条 hard limit (OpenHands) | AgentHub 承载事件类型多, 10K 覆盖数小时离线 |
| 去重机制 | (edge_id, seq) 复合键 | event_id UUID | seq 天然在 writeChain 中单调, 无需额外 UUID |
| Compaction 阈值 | 2MB events.jsonl | 无 compaction / 时间触发 | 2MB ~= 5000-10000 事件, 缓冲窗口充足 |
| 死信处理 | Ring buffer overflow → 丢弃最旧 | 拒绝写入 / 背压 | 丢旧不断新 vs 断新保旧 → 前者更符合"当前状态最新"原则 |
| WAN 离线判定 | 3 次 pong 丢失 = 90s | 2 次 = 60s | WAN 抖动常见, 90s 降低误报 |

---

## 7. 参考交叉索引

| 源文档 | 关键贡献 |
|--------|---------|
| `01-learn/deep-dive/10-openhands-agent-protocol.md` | WS+REST fallback, pending_messages queue, resend_all 全量重放 |
| `03-build/backend/02-go-services.md` | WSHub 多房间架构, coder/websocket Ping/Pong, readPump/writePump |
| `03-build/backend/10-graceful-degradation.md` | 4 层重连策略, auto-recovery protocol, 降级 Banner/Toast |
| `02-decide/06-realtime-sync.md` | seq LWW, writeChain 串行化, compaction/snapshot, 离线冲突检测 |
| `03-build/backend/03-eventstore-memory.md` | JSONL 唯一事实源, content_pool 文件层, FTS5 搜索索引 |
| `03-build/backend/08-error-handling.md` | ErrorCode 分类 (ErrEdgeDisconnected, ErrRunnerUnavailable), retry UX |
