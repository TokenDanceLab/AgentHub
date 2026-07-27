# WebSocket Events

最后更新：2026-07-27

本文件是 WebSocket 事件合同入口，只保留协议边界、源码 owner、**重复投递/幂等语义**和验收命令。旧长版事件说明见 [../docs/history.md](../docs/history.md)。

## Owner

| 层 | 当前 owner | 说明 |
|---|---|---|
| Edge envelope | `app/shared/src/events.ts` | 前端消费的 `EventEnvelope` 类型 |
| Edge event bus | `edge-server/internal/events/` | Edge 事件发布、订阅、背压和 gap |
| Runtime event names | `edge-server/internal/adapters/adapter.go` | `run.agent.*` adapter 事件常量 |
| Hub WS frame | `hub-server/internal/ws/frame.go` | Hub `{type, seq_id?, payload?}` 帧和 30 个事件常量 |
| Hub client constants | `app/shared/src/hubEvents.ts` | 与 `frame.go` 1:1 的客户端常量表 |
| Hub runtime replay | `hub-server/internal/service/agent_edge_callback.go` | `agent.stream` 和聊天消息投影 |
| Transcript normalization | `app/shared/src/transcript/` | Edge/Hub event 到聊天流的归一化 |

新增或改名事件时，先改对应源码 owner，再同步本文件的事件族摘要、**重复投递语义**表、`api/openapi.yaml` 的 WS schema 引用、相关 normalizer/tests。

## Delivery Model (shared)

Hub 与 Edge 的实时面都是 **at-least-once** 投递假设：重连、离线队列、outbox redispatch、多端 fanout 都可能让客户端看到同一逻辑事件多次。

| 机制 | 含义 | 不是什么 |
|---|---|---|
| Hub `seq_id` | 单连接单调递增的**投递序号**（`PushToConn` 在 `sendMu` 内 stamp）；同连 gap = 丢帧信号 | 不是跨连接业务幂等键；重连后从 1 重新计数 |
| Edge `EventEnvelope.seq` / `id` | stream 内单调 `seq` + 事件 `id`；断线用 cursor / 最后处理 id | 服务端不能回放时发 `system.gap` / `error`，客户端 REST snapshot |
| 业务幂等键 | 见下表「幂等键 / 重复投递语义」 | 客户端必须以业务键 apply，不能只靠 `seq_id` |

重复投递语义词汇（本文件统一用语）：

| 标签 | 客户端应如何 apply |
|---|---|
| **UPSERT by id** | 以稳定业务 id 合并/覆盖；重复帧不得产生第二行实体 |
| **idempotent on apply** | 再应用结果不变（终端态、布尔标志、删除后空操作） |
| **水位 / watermark** | 只前进不回退（`max(local, remote)`）；落后水位直接退役 |
| **ephemeral** | 瞬态提示，可丢可重；重复最多造成多余 UI 闪烁，不得写持久状态 |
| **非幂等** | 必须注明副作用；当前表中若出现，客户端需自备去重或走 REST 权威态 |

## Edge EventEnvelope

Edge 和 shared transcript 使用统一 envelope：

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

规则：

- `seq` 在同一 stream 内单调递增；断线恢复用 cursor 或最后处理事件 ID。
- 客户端 apply 时：`seq <= lastSeq` 直接丢弃（shared `workbenchStateApplyEvent` 水位退役）；实体类事件按 payload id **UPSERT**。
- 服务端不能回放时发送 `system.gap` 或 `error`，客户端重新拉 REST snapshot。
- Runner stdout/stderr 应合并成 `run.output.batch`，不要逐行刷 UI。
- Provider-specific 字段停留在 adapter 边界；进入 transcript 前必须脱敏 token、authorization header、绝对路径和 provider trace body。

## Hub Frame

Hub `/client/ws` 使用扁平 frame：

```json
{"type":"message.new","seq_id":42,"payload":{"message_id":"msg_1"}}
```

规则：

- `/client/ws` 只接受 Hub-issued HS256 access token，TokenDance ID RS256 bearer 不能成为 Hub WebSocket session。
- `seq_id` 是服务端保留排序/游标字段，客户端不得写入；它只保证**单连接**投递序，**不能**替代下表业务幂等键。
- Hub frame 与 Edge `EventEnvelope` 不同；需要进入 shared transcript 时，先经 Hub runtime/message normalizer 转成 transcript blocks。
- 多数 Web/Desktop bridge 当前用 React Query invalidation 吸收重复帧（再拉 REST 权威态）；直接写 store 的路径（消息、task bridge、notification、agent activity）必须遵守下表。

## Hub WS 事件：重复投递 / 幂等语义

SSOT 常量：`hub-server/internal/ws/frame.go` ↔ `app/shared/src/hubEvents.ts` ↔ OpenAPI `HubWebSocketFrame.type`（30 个；#1362/#1422 已删死面，禁止写回）。

| type | 方向 | 幂等键 | 重复投递语义 | 备注 |
|---|---|---|---|---|
| `typing` | C→S fanout | 无（ephemeral） | **ephemeral** — 重复可忽略；不得落库 | 唯一合法 client→server 业务帧；processIncoming default 丢弃其他 type |
| `auth.ok` | S→C | 连接生命周期 | **idempotent on apply** — 握手 ack；已认证会话再收一次无副作用 | upgrade 后由 handler 发送；无 `auth` / `auth.fail` 首帧 |
| `message.new` | S→C | `payload.id`（发送侧另有 `client_msg_id`） | **UPSERT by id** | Hub 存库 `(session_id, client_msg_id)` 唯一；agent 投影同样走 client_msg_id 去重 |
| `message.recall` | S→C | `message_id` + `session_id` | **idempotent on apply**（`recalled=true`） | |
| `message.pin` | S→C | `(session_id, message_id)` | **UPSERT by id** | |
| `message.unpin` | S→C | `(session_id, message_id)` | **idempotent on apply** | |
| `message.reaction_added` | S→C | `(message_id, user_id, reaction)` | **UPSERT by id**（含 `count`） | |
| `message.reaction_removed` | S→C | `(message_id, user_id, reaction)` | **idempotent on apply** | |
| `message.read` | S→C | `(session_id, user_id)` | **水位** — `last_read_seq` 只前进 `max(local, remote)` | 落后水位直接退役 |
| `session.created` | S→C | `session_id` | **UPSERT by id** | 可按 `members[]` 点对点推，或 `PushToSession` |
| `session.dissolved` | S→C | `session_id` | **idempotent on apply**（终端） | |
| `session.member_joined` | S→C | `(session_id, member_id)` | **UPSERT by id** | |
| `session.member_left` | S→C | `(session_id, member_id)` | **idempotent on apply** | |
| `session.info_updated` | S→C | `session_id` | **UPSERT by id**（字段合并） | |
| `device.online` | S→C | `user_id` | **UPSERT by id**（最新 presence 覆盖） | payload 仅 `user_id`，无 device 维 |
| `device.offline` | S→C | `user_id` | **UPSERT by id** | |
| `device.kicked` | S→C | `conn_id` / 本端会话 | **idempotent on apply** — 断线后重复 no-op | 同端顶号；收帧后应清会话 |
| `agent.dispatch` | S→C | `task_id`（投递协调另见 `delivery_id`） | **UPSERT by id**；Edge **必须**按 task 幂等接受 | 离线队列 + outbox 可能重放；`ShouldReplayOfflinePayload` 防双发 |
| `agent.stream` | S→C | run event `id` 或 `(task_id, event_seq)` | **UPSERT by id** + **水位** `after_seq` / `event_seq` | 持久化 `agent_run_events`；断线补齐 `GET .../events?after_seq=`；stream→message 用 `client_msg_id` |
| `agent.done` | S→C | `task_id` | **idempotent on apply**（终端） | |
| `agent.failed` | S→C | `task_id` | **idempotent on apply**（终端） | 内部 bus `agent.timeout` **映射**为本 type，无独立 wire |
| `agent.cancel` | S→C | `task_id` | **idempotent on apply** | |
| `agent.control` | S→C | control 载荷身份（`task_id` + 控制意图字段） | **UPSERT / idempotent on apply** | 可进 pending control 离线重放；Edge 不得重复执行副作用 |
| `team.run.started` | S→C | `run_id`（payload） | **UPSERT by id** | 无 `session_id` 时可 `PushToUser` |
| `team.event` | S→C | payload 内事件/实体 id；缺省则视为 invalidate 信号 | **UPSERT by id** 或 **idempotent on apply**（invalidate→REST） | 客户端当前多走 RQ invalidation |
| `team.assignment.done` | S→C | assignment / task id（payload） | **UPSERT by id** / 终端 **idempotent on apply** | bus 名 `team.assignment.completed` → wire `team.assignment.done` |
| `team.assignment.failed` | S→C | assignment / task id | **UPSERT by id** / 终端 **idempotent on apply** | |
| `notification.new` | S→C | `notification.id` | **UPSERT by id** | `Notify()` 落库后推送 |
| `friend.request` | S→C（声明） | `request_id` / 双方 user id | **UPSERT by id** | 当前 bus 路径常经 `notification.new` 落地；常量保留与 OpenAPI 对齐，禁止发明第二套 type |
| `friend.accepted` | S→C | `request_id` / `user_id` | **UPSERT by id** 或 invalidate contacts | 直接 `PushToUser` |

**WS 增量同步 SPEC（#1412）先修**：任何 replay/snapshot 合并必须先按本表业务键 apply；禁止「无幂等声明的 blind replay」。

## Event Families

| 族 | 代表事件 | Owner / 测试 |
|---|---|---|
| IM / Project | `project.created`, `thread.created`, `message.created`, `item.created`, `thread.pin.created` | `app/shared/src/events.ts`, Edge store/API tests |
| Run lifecycle | `run.queued`, `run.started`, `run.output.batch`, `run.finished`, `run.failed`, `run.cancelled` | Edge lifecycle/API tests |
| Runtime adapter | `run.agent.text_delta`, `run.agent.thinking`, `run.agent.tool_call`, `run.agent.tool_result`, `run.agent.file_change`, `run.agent.permission_requested`, `run.agent.permission_decided`, `run.agent.result` | `edge-server/internal/adapters/*`, `app/shared/src/transcript/*` tests |
| Artifact / preview | `artifact.created`, `preview.ready`, `preview.stopped` | Edge evidence store and preview tests |
| Hub IM | `auth.ok`, `message.new`, `message.recall`, `message.reaction_added`, `session.created`, `device.online` | `hub-server/internal/ws/frame.go`, Hub WS tests |
| Hub Agent/Team | `agent.dispatch`, `agent.stream`, `agent.done`, `agent.control`, `team.run.started`, `team.event` | Hub service/tests and TeamRun tests |
| Edge common | `error`, `system.gap` | Shared parser and reconnect tests |

Runtime adapter coverage is kept as a compact inventory because `edge-server/internal/adapters/event_contract_test.go` treats documentation coverage as part of the source contract:

- Output/session: `run.agent.text_delta`, `run.agent.text_block`, `run.agent.thinking`, `run.agent.session_init`, `run.agent.session_state_changed`, `run.agent.status_change`, `run.agent.result`.
- Tool/file/permission: `run.agent.tool_call`, `run.agent.mcp_tool_call`, `run.agent.tool_result`, `run.agent.file_change`, `run.agent.tool_use_summary`, `run.agent.tool_rejected`, `run.agent.permission_requested`, `run.agent.permission_decided`.
- Context/rate/runtime: `run.agent.route_decision`, `run.agent.compact_boundary`, `run.agent.api_retry`, `run.agent.auth_status`, `run.agent.rate_limit`, `run.agent.cli_invocation_plan`, `run.agent.session_metrics`, `run.agent.context_usage`, `run.agent.context_warning`, `run.agent.context_compaction`.
- Task/subagent/hooks: `run.agent.task_started`, `run.agent.task_dispatched`, `run.agent.task_dispatch_failed`, `run.agent.task_progress`, `run.agent.task_notification`, `run.agent.sub_agent_status`, `run.agent.sub_agents_complete`, `run.agent.hook_started`, `run.agent.hook_progress`, `run.agent.hook_response`.
- Approval/surfacing extensions: `run.agent.plan_proposed`, `run.agent.plan_approved`, `run.agent.plan_rejected`, `run.agent.plan_expired`, `run.agent.surfaced_artifact`, `run.agent.surfaced_preview`, `run.agent.surfaced_diff`, `run.agent.surfaced_deploy`.

Edge runtime 事件默认语义（workbench apply 已实现）：

| 类别 | 重复投递语义 |
|---|---|
| `*.created` / `*.updated` / run 状态 | **UPSERT by** project/thread/item/run id；`seq` **水位** |
| `message.delta` / `run.output(.batch)` | 有稳定 id 则 UPSERT 合并；否则依赖 `seq` 水位，gap 后 REST 重建 |
| `system.gap` / `error` | 非实体；触发 snapshot，不 UPSERT |

## Removed Hub WS Dead Surface (#1362 / #1422)

以下事件类型曾出现在客户端 Hub WS 常量表中，但 hub-server 从未在 WS 面实现（或仅内部 bus），已删除，**禁止**在客户端、`frame.go`、OpenAPI enum 或本表重新引入：

- `sync.request` / `sync.events` — 服务端 processIncoming 只处理 `typing`，sync 帧落 default 丢弃；断线补齐走 REST replay（`GET /web/agent-tasks/:id/events?after_seq=`）。
- `run.agent.plan_proposed` / `run.agent.plan_approved` / `run.agent.plan_rejected` / `run.agent.plan_expired` — 仅存在于 Edge runtime adapter 事件面（上节 Approval/surfacing extensions），Hub WS 从未推送。
- `agent.regenerate` — hub-server 只发内部 bus（`internal/service/dispatch/events.go`），无 WS 转发订阅；客户端实际走 REST regenerate。
- `message.edited` — 仍是消息服务内部 bus 事件，但 bus→WS 桥（`internal/app/events.go`）无订阅；编辑调用响应与后续 snapshot 读取走 REST，当前没有实时编辑广播。
- `agent.timeout` — 仍是调度超时内部 bus 事件，但 WS 桥将其映射为真实 wire 事件 `agent.failed`；OpenAPI 不再伪造独立 WS 类型。
- `auth` / `auth.fail` — 正式路由在 HTTP upgrade 前由 `WSAuthMiddleware` 完成认证；handler 对缺少认证 context 的路由误配直接返回 401，不再接受可绕过 blacklist/Hub-session gate 的首帧 token，也不会在升级后发送 `auth.fail`。

客户端常量 SSOT 为 `app/shared/src/hubEvents.ts`，必须与 `frame.go` 及 OpenAPI `HubWebSocketFrame.type` 1:1；shared/Go 契约测试阻止再次漂移。

When a new event must be visible in chat, add or update a shared transcript test before changing UI rendering. Do not put debug, mock, or mode metadata into the main transcript bubbles.

## Fixture And Real-Evidence Boundary

Adapter fixture mappings are no-spend contracts. They may prove parser shape, redaction, replay shape, or transcript normalization, but they do not prove real login, real CLI/model/API execution, production deploy, or packaged Desktop behavior.

Use `.agents/skills/real-e2e-acceptance/SKILL.md` for evidence labels. Stub/fixture/readiness reports must say `real_tested=false`; approved-real paths require explicit approval and no silent fallback.

## Verification

Minimum checks after event contract changes:

```powershell
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
pwsh ./scripts/verify/verify-real-e2e-contract.ps1
# shared：HUB_EVENTS ↔ frame.go ↔ events.md 覆盖
# （在 app/shared）pnpm exec vitest run src/hubEvents.test.ts
```

Add focused Go, shared Vitest, Desktop/Web Playwright, Visual QA, performance/leak, or packaged-release gates based on the touched owner paths and the claim being made.
