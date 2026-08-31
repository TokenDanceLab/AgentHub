# WebSocket Events

最后更新：2026-07-27

WebSocket 事件合同入口：协议边界、源码 owner、**重复投递/幂等语义**、验收命令。旧长版见 [../docs/history.md](../docs/history.md)。

## Owner

| 层 | 当前 owner | 说明 |
|---|---|---|
| Edge envelope | `app/shared/src/events.ts` | 前端 `EventEnvelope` |
| Edge event bus | `edge-server/internal/events/` | 发布、订阅、背压、gap |
| Runtime event names | `edge-server/internal/orchestration/contracts.go` | `run.agent.*` 常量（adapters 包通过 `contract_aliases.go` 别名重导出） |
| Hub WS frame | `hub-server/internal/ws/frame.go` | `{type, seq_id?, payload?}` + 30 常量 |
| Hub client constants | `app/shared/src/hubEvents.ts` | 与 `frame.go` 1:1 |
| Hub runtime replay | `hub-server/internal/service/agent_edge_callback.go` | `agent.stream` / 聊天投影 |
| Transcript normalization | `app/shared/src/transcript/` | Edge/Hub → 聊天流 |

改事件：先改源码 owner，再同步本文件语义表、`api/openapi.yaml` WS schema、normalizer/tests。

## Delivery Model (shared)

Hub/Edge 实时面均为 **at-least-once**：重连、离线队列、outbox、多端 fanout 可重复投递。

| 机制 | 含义 | 不是什么 |
|---|---|---|
| Hub `seq_id` | 单连接单调投递序号（`PushToConn` stamp）；同连 gap = 丢帧 | 非跨连接幂等键；重连从 1 计 |
| Edge `EventEnvelope.seq` / `id` | stream 单调 `seq` + 事件 `id`；断线用 cursor / 最后 id | 不能回放则 `system.gap`/`error`，客户端 REST snapshot |
| 业务幂等键 | 下表「幂等键 / 重复投递语义」 | apply 必须按业务键，不能只靠 `seq_id` |

> **`seq_id`（Hub WS per-conn）vs `seq`（Edge per-bus）**：Hub `seq_id` 是 `PushToConn` 在单连接上单调递增的投递序号，重连从 1 计、跨连接不可比；Edge `EventEnvelope.seq` 是事件总线上的 stream 单调序号，与持久化 `agent_run_events.event_seq` / `messages.seq_id` 对齐。REST 增量同步接口（`GET .../messages/sync?after_seq=`、`GET .../events?after_seq=`）的 `after_seq` 一律指**持久化表的内部 seq**（`messages.seq_id` 或 `agent_run_events.event_seq`），**不是** WS 帧的 `seq_id`。客户端不得用 WS `seq_id` 作为 REST 游标。

### Hub→Edge `delivery_id` 去重契约（#2101 G2）

Hub 向 Edge 投递任务有两条并行通道：WS `PushToConn(agent.dispatch)` 与 outbox redispatch HTTP POST `/v1/runs`。两者共享同一个 `delivery_id`（UUID，由 Hub dispatch/outbox 生成并附在 payload 顶层 `delivery_id` / `deliveryId`）。Edge **必须**在消费入口（POST `/v1/runs`）按 `delivery_id` 做进程内去重：

- **键**：`delivery_id` 字符串；空值视为遗留载荷，跳过 dedup 直接处理。
- **存储**：进程内 LRU + TTL（参考实现 `edge-server/internal/deliverydedup`，默认 4096 条 / 5 分钟）。不持久化；崩溃后重复投递的最坏后果是幂等重放一次，可接受。
- **语义**：TTL 窗口内同 `delivery_id` → 跳过 run 创建、返回成功（HTTP 202 + `{deduplicated:true}`），附带日志/指标；不同 `delivery_id` 正常处理。
- **责任划分**：Hub 保证同一逻辑投递在所有通道使用相同 `delivery_id`；Edge 保证消费端幂等。任一侧失守都会产生重复 run。

标签：**UPSERT by id**（稳定 id 合并，禁止第二行）；**idempotent on apply**（再应用不变）；**水位 / watermark**（只前进 `max`）；**ephemeral**（可丢可重，不写持久态）；**非幂等**（须自备去重或 REST）。

## Edge EventEnvelope

```json
{
  "version": "v1",
  "id": "evt_01HX...",
  "seq": 42,
  "type": "run.agent.tool_call",
  "scope": {
    "projectId": "proj_1",
    "conversationId": "conv_1",
    "threadId": "thread_1",
    "runId": "run_1",
    "edgeId": "edge_1"
  },
  "traceId": "trace_01HX...",
  "sentAt": "2026-05-22T12:00:00Z",
  "payload": {}
}
```

- `seq` 同 stream 单调；断线用 cursor / 最后事件 ID。`seq <= lastSeq` 丢弃（workbench 水位）；实体按 payload id **UPSERT**。
- 不能回放 → `system.gap` / `error`，客户端 REST snapshot。stdout/stderr 合并为 `run.output.batch`。
- Provider 字段停在 adapter 边界；进 transcript 前脱敏 token、authorization、绝对路径、provider trace body。
- Run lifecycle（`run.started`/`run.finished` 等）payload 仅在 executor 真实解析出工作目录时携带 `workDir`；它是 run 级 diff 审查（#1967）唯一可信 workDir 证据——客户端禁止用当前 composer 目录等猜测值补全，缺失即只读。

## Hub Frame

```json
{"type":"message.new","seq_id":42,"payload":{"message_id":"msg_1"}}
```

- `/client/ws` 仅 Hub-issued HS256 access token；TokenDance ID RS256 不能当 WS session。
- `seq_id` 服务端保留、单连接投递序；**不能**替代下表业务幂等键；客户端不得写入。
- 与 Edge envelope 不同；进 transcript 须经 Hub normalizer。多数 bridge 用 RQ invalidation；直写 store 路径须遵守下表。

## Hub WS 事件：重复投递 / 幂等语义

SSOT：`frame.go` ↔ `hubEvents.ts` ↔ OpenAPI `HubWebSocketFrame.type`（31 个；#1362/#1422 死面禁止写回）。

| type | 方向 | 幂等键 | 重复投递语义 | 备注 |
|---|---|---|---|---|
| `typing` | C→S fanout | 无（ephemeral） | **ephemeral** | 唯一合法 C→S 业务帧；其余 type 丢弃 |
| `auth.ok` | S→C | 连接生命周期 | **idempotent on apply** | upgrade 后 handler 发送；无 `auth`/`auth.fail` 首帧 |
| `message.new` | S→C | `payload.id`（另有 `client_msg_id`） | **UPSERT by id** | 库 `(session_id, client_msg_id)` 唯一 |
| `message.recall` | S→C | `message_id` + `session_id` | **idempotent on apply** | `recalled=true` |
| `message.pin` | S→C | `(session_id, message_id)` | **UPSERT by id** | |
| `message.unpin` | S→C | `(session_id, message_id)` | **idempotent on apply** | |
| `message.reaction_added` | S→C | `(message_id, user_id, reaction)` | **UPSERT by id** | 含 `count` |
| `message.reaction_removed` | S→C | `(message_id, user_id, reaction)` | **idempotent on apply** | |
| `message.read` | S→C | `(session_id, user_id)` | **水位** | `last_read_seq` 只前进；落后退役 |
| `session.created` | S→C | `session_id` | **UPSERT by id** | 可点对点或 `PushToSession` |
| `session.dissolved` | S→C | `session_id` | **idempotent on apply** | 终端 |
| `session.member_joined` | S→C | `(session_id, member_id)` | **UPSERT by id** | |
| `session.member_left` | S→C | `(session_id, member_id)` | **idempotent on apply** | |
| `session.info_updated` | S→C | `session_id` | **UPSERT by id** | 字段合并 |
| `device.online` | S→C | `user_id` | **UPSERT by id** | 仅 `user_id`，无 device 维 |
| `device.offline` | S→C | `user_id` | **UPSERT by id** | |
| `device.kicked` | S→C | `conn_id` / 本端 | **idempotent on apply** | 同端顶号；收帧清会话 |
| `agent.dispatch` | S→C | `task_id`（另见 `delivery_id`） | **UPSERT by id** | Edge 必须按 task 幂等；离线/outbox 可重放 |
| `agent.stream` | S→C | event `id` 或 `(task_id, event_seq)` | **UPSERT** + **水位** | `agent_run_events`；`GET .../events?after_seq=` |
| `agent.done` | S→C | `task_id` | **idempotent on apply** | 终端 |
| `agent.failed` | S→C | `task_id` | **idempotent on apply** | 终端；内部 `agent.timeout` 映射为本 type |
| `agent.cancel` | S→C | `task_id` | **idempotent on apply** | |
| `agent.control` | S→C | `task_id` + 控制意图 | **UPSERT / idempotent** | 可离线重放；Edge 禁重复副作用 |
| `team.run.started` | S→C | `run_id` | **UPSERT by id** | 无 session 时可 `PushToUser` |
| `team.event` | S→C | payload 实体 id / invalidate | **UPSERT** 或 invalidate→REST | 多走 RQ invalidation |
| `team.assignment.done` | S→C | assignment / task id | **UPSERT** / 终端 **idempotent** | bus `team.assignment.completed` → wire |
| `team.assignment.failed` | S→C | assignment / task id | **UPSERT** / 终端 **idempotent** | |
| `team.subagent.stream` | S→C | `(agent_task_id, event_seq)` | **UPSERT** + **水位** | 与 `agent.stream` 同语义，team 域聚合；#1478 Phase A（edge 零改，前端不消费也能观测） |
| `notification.new` | S→C | `notification.id` | **UPSERT by id** | `Notify()` 落库后推 |
| `friend.request` | S→C（声明） | `request_id` / 双方 user | **UPSERT by id** | 常经 `notification.new`；常量保留对齐 OpenAPI |
| `friend.accepted` | S→C | `request_id` / `user_id` | **UPSERT** 或 invalidate | 直接 `PushToUser` |

**WS 增量同步 SPEC（#1412）先修**：replay/snapshot 合并必须按本表业务键 apply；禁止无幂等声明的 blind replay。

## Event Families

| 族 | 代表事件 | Owner / 测试 |
|---|---|---|
| IM / Project | `project.created`, `thread.created`, `message.created`, `item.created`, `thread.pin.created` | `events.ts`, Edge store/API tests |
| Run lifecycle | `run.queued`, `run.checkpoint`, `run.started`, `run.output.batch`, `run.finished`, `run.failed`, `run.cancelled` | Edge lifecycle/API tests |
| Runtime adapter | `run.agent.text_delta`, `run.agent.thinking`, `run.agent.tool_call`, `run.agent.tool_result`, `run.agent.file_change`, `run.agent.permission_requested`, `run.agent.permission_decided`, `run.agent.result` | adapters + transcript tests |
| Artifact / preview | `artifact.created`, `preview.ready`, `preview.stopped` | Edge evidence/preview tests |
| Hub IM | `auth.ok`, `message.new`, `message.recall`, `message.reaction_added`, `session.created`, `device.online` | `frame.go`, Hub WS tests |
| Hub Agent/Team | `agent.dispatch`, `agent.stream`, `agent.done`, `agent.control`, `team.run.started`, `team.event`, `team.subagent.stream` | Hub service/TeamRun tests |
| Edge common | `error`, `system.gap` | Shared parser/reconnect tests |

`event_contract_test.go` 把文档覆盖当源码合同；runtime 清单：

- Output/session: `run.agent.text_delta`, `run.agent.text_block`, `run.agent.thinking`, `run.agent.session_init`, `run.agent.session_state_changed`, `run.agent.status_change`, `run.agent.result`.
- Tool/file/permission: `run.agent.tool_call`, `run.agent.mcp_tool_call`, `run.agent.tool_result`, `run.agent.file_change`, `run.agent.tool_use_summary`, `run.agent.tool_rejected`, `run.agent.permission_requested`, `run.agent.permission_decided`.
- Context/rate/runtime: `run.agent.route_decision`, `run.agent.compact_boundary`, `run.agent.api_retry`, `run.agent.auth_status`, `run.agent.rate_limit`, `run.agent.cli_invocation_plan`, `run.agent.session_metrics`, `run.agent.context_usage`, `run.agent.context_warning`, `run.agent.context_compaction`.
- Task/subagent/hooks: `run.agent.task_started`, `run.agent.task_dispatched`, `run.agent.task_dispatch_failed`, `run.agent.task_progress`, `run.agent.task_notification`, `run.agent.sub_agent_status`, `run.agent.sub_agents_complete`, `run.agent.hook_started`, `run.agent.hook_progress`, `run.agent.hook_response`.
- Approval/surfacing: `run.agent.plan_proposed`, `run.agent.plan_approved`, `run.agent.plan_rejected`, `run.agent.plan_expired`, `run.agent.surfaced_artifact`, `run.agent.surfaced_preview`, `run.agent.surfaced_diff`, `run.agent.surfaced_deploy`.

Edge workbench 默认：`*.created`/`*.updated`/run 态 **UPSERT** + `seq` **水位**；`message.delta`/`run.output(.batch)` 有 id 则 UPSERT，否则水位 + gap 后 REST；`system.gap`/`error` 触发 snapshot，不 UPSERT。

## Removed Hub WS Dead Surface (#1362 / #1422)

曾出现在客户端常量表、hub-server 从未 WS 实现（或仅内部 bus）的类型，**禁止**写回客户端 / `frame.go` / OpenAPI / 上表：

- `sync.request` / `sync.events` — processIncoming 只处理 `typing`；断线补齐 REST `GET /web/agent-tasks/:id/events?after_seq=`。
- `run.agent.plan_*` — 仅 Edge runtime 面（上节 Approval/surfacing），Hub WS 从未推。
- `agent.regenerate` — 仅内部 bus，客户端走 REST regenerate。
- `message.edited` — 内部 bus，无 bus→WS 订阅；编辑走 REST。
- `agent.timeout` — 内部 bus，WS 映射为 `agent.failed`。
- `auth` / `auth.fail` — upgrade 前 `WSAuthMiddleware`；缺认证 context 直接 401，无首帧 token / `auth.fail`。

客户端 SSOT `hubEvents.ts` 必须与 `frame.go` + OpenAPI 1:1；契约测试防漂移。聊天可见新事件先补 shared transcript 测试；禁止 debug/mock/mode 元数据进主气泡。

## Fixture And Real-Evidence Boundary

Adapter fixture 是 no-spend 合同：可证 parser/redaction/replay/transcript，不能证真实登录、CLI/模型执行、生产部署或 packaged Desktop。证据标签由 `scripts/verify/verify-real-e2e-contract.py` 内嵌规范维护；stub 须 `real_tested=false`。

## Verification

```powershell
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
python scripts/verify/verify-real-e2e-contract.py
# shared：HUB_EVENTS ↔ frame.go ↔ events.md（app/shared 下）
# pnpm exec vitest run src/hubEvents.test.ts
```

按触达 owner 与主张补 Go / Vitest / Playwright / Visual QA / perf / packaged-release gates。
