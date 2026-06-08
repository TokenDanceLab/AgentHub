# WebSocket Events

AgentHub 使用 WebSocket typed events 推送实时状态。REST API 用于发起命令和查询，WebSocket 只负责事件投递。

> **Implementation Status (2026-06-05)**: Edge Server events (run.*, runner.*) are
> the primary event system and are documented in sections 1-6 below. Hub Server
> WebSocket events are documented in [section 7](#7-hub-websocket-events).

## 1. 连接

```text
GET /v1/events?cursor=evt_cursor
```

用途：

- UI 订阅本地 Edge 或 Hub 的实时事件。
- Web/Mobile 通过 Hub 订阅远程 Edge 状态。
- Edge 通过 reverse WebSocket 向 Hub 上报 relay 和 sync 事件。

P0 只需要 `UI -> Edge` 事件流。

## 2. EventEnvelope

所有事件都使用同一个信封：

```json
{
  "version": "v1",
  "id": "evt_01HX...",
  "seq": 42,
  "type": "run.output",
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

字段：

| 字段 | 必填 | 含义 |
|---|:---:|---|
| `version` | 是 | 协议版本，当前固定 `v1` |
| `id` | 是 | 事件 ID，全局唯一 |
| `seq` | 是 | 当前事件流内递增序号 |
| `type` | 是 | 事件类型，例如 `run.output` |
| `scope` | 是 | 事件关联的资源 ID，可为空对象 |
| `traceId` | 否 | 链路追踪 ID |
| `sentAt` | 是 | 发送时间，RFC3339 UTC |
| `payload` | 是 | 事件载荷，结构由 `type` 决定 |

## 3. 序号和重连

- `seq` 在同一 event stream 内单调递增。
- 客户端保存最后处理的 `id` 或 cursor。
- 断线后用 `GET /v1/events?cursor=...` 恢复。
- 服务端无法回放时，发送 `error` 事件并要求客户端重新拉取 REST snapshot。

## 4. 输出流

Runner stdout/stderr 不要一行一帧直接刷给 UI。

建议：

- 每 50ms 或每 8KB 合并一次。
- 使用 `run.output.batch` 承载批量 chunk。
- 每个 chunk 带 `offset`，方便前端去重。

单条输出：

```json
{
  "type": "run.output",
  "payload": {
    "runId": "run_1",
    "stream": "stdout",
    "offset": 0,
    "text": "running tests...\n"
  }
}
```

批量输出：

```json
{
  "type": "run.output.batch",
  "payload": {
    "runId": "run_1",
    "stream": "stdout",
    "chunks": [
      { "offset": 0, "text": "installing...\n" },
      { "offset": 14, "text": "building...\n" }
    ]
  }
}
```

## 5. 事件总表

### IM / Project

| type | 阶段 | 说明 |
|---|---|---|
| `project.created` | P0 | 项目创建或注册 |
| `project.updated` | P0 | 项目元数据更新 (planned) |
| `conversation.created` | P1 | 会话创建 (planned) |
| `conversation.member.added` | P1 | 会话成员加入 (planned) |
| `thread.created` | P0 | Thread 创建 |
| `thread.updated` | P0 | Thread 状态或标题更新 |
| `thread.deleted` | P0 | Thread 删除 |
| `thread.forked` | P1 | Thread 分支创建 (planned) |
| `thread.pin.created` | P0 | Edge 本地 Thread item 置顶，payload 为 `ThreadPin`，scope: `{ threadId, itemId }` |
| `thread.pin.deleted` | P0 | Edge 本地 Thread item 取消置顶，payload: `{ threadId, itemId }`，scope: `{ threadId, itemId }` |
| `message.created` | P0 | 消息创建 |
| `message.delta` | P0 | Agent 消息流式增量 |
| `item.created` | P0 | Thread Item 创建 |
| `item.updated` | P0 | Thread Item 状态更新 (planned) |

### Execution / Runtime

| type | 阶段 | 说明 |
|---|---|---|
| `runner.online` | P0 | Runtime/target compatibility event: legacy Runner 在线 (planned) |
| `runner.offline` | P0 | Runtime/target compatibility event: legacy Runner 离线 (planned) |
| `run.queued` | P0 | AgentRun 已排队 |
| `run.started` | P0 | AgentRun 已启动 |
| `run.output` | P0 | 单条 stdout/stderr 输出 (planned — 当前仅 `run.output.batch` 已实现) |
| `run.output.batch` | P0 | 批量 stdout/stderr 输出 |
| `run.status.changed` | P0 | AgentRun 状态变化 (planned) |
| `run.persistence_error` | P0 | 持久化错误，payload: `{ runId, error }` |
| `approval.requested` | P0 | 请求用户审批 (planned) |
| `approval.decided` | P0 | 用户已审批 (planned) |
| `artifact.created` | P0 | 产物创建 (planned)；当前只读 REST 合同已提供 `GET /v1/artifacts`，事件写入链路后续补齐 |
| `artifact.updated` | P1 | 产物元数据更新 (planned) |
| `preview.ready` | P0 | 预览可用 (planned)；当前只读 REST 合同已提供 `GET /v1/previews`，start/stop 生命周期后续补齐 |
| `preview.stopped` | P1 | 预览停止 (planned) |
| `run.finished` | P0 | AgentRun 正常结束 |
| `run.failed` | P0 | AgentRun 失败 |
| `run.cancelled` | P0 | AgentRun 已取消（已实现） |
| `run.agent.text_delta` | P0 | Agent 流式文本增量（CLI-agnostic） |
| `run.agent.text_block` | P0 | Agent 完整文本块 |
| `run.agent.thinking` | P0 | Agent 思考/推理内容（可折叠显示） |
| `run.agent.tool_call` | P0 | Agent 请求工具调用 |
| `run.agent.tool_result` | P0 | 工具调用执行结果 |
| `run.agent.file_change` | P0 | 文件变更。每个文件一条事件；payload: `{ callId, toolName, path, kind: "created"\|"modified"\|"deleted", action, status, rawKind?, outsideWorkspace?, diff? }`。本机绝对路径必须在进入事件前转为 workspace-relative 或 `<outside-workspace>/<basename>` |
| `run.agent.route_decision` | P1 | Runtime structured output 中解析出的 `CoordinatorRouteDecision`；Desktop bridge 会用 dispatch payload 中的 TeamRun context 自动 POST 到 Hub route decision endpoint |
| `run.agent.session_init` | P0 | Agent 会话初始化（模型、工具列表、权限模式） |
| `run.agent.result` | P0 | Agent 执行结束（成功/失败、token 用量） |
| `run.agent.compact_boundary` | P1 | 上下文压缩边界 |
| `run.agent.api_retry` | P1 | API 重试通知 |
| `run.agent.task_started` | P1 | 子代理任务启动 |
| `run.agent.task_dispatched` | P1 | 子代理任务已派发 |
| `run.agent.task_dispatch_failed` | P1 | 子代理派发失败，payload: `{ taskId, error }` |
| `run.agent.task_progress` | P1 | 子代理任务进度 |
| `run.agent.task_notification` | P1 | 子代理任务完成/失败 |
| `run.agent.sub_agent_status` | P1 | 子代理运行状态更新，payload: `{ agentId, status, taskId?, runId? }` |
| `run.agent.sub_agents_complete` | P1 | 所有子代理执行完毕，payload: `{ parentId, childCount, allComplete }` |
| `run.agent.session_state_changed` | P1 | 会话状态变更（idle/running/requires_action） |
| `run.agent.status_change` | P1 | Agent 适配器状态变更 |
| `run.agent.session_metrics` | P1 | 会话度量信息 |
| `run.agent.context_usage` | P1 | 上下文使用量报告 |
| `run.agent.context_warning` | P1 | 上下文容量警告 |
| `run.agent.context_compaction` | P1 | 上下文压缩通知 |
| `run.agent.hook_started` | P1 | Hook 执行开始 |
| `run.agent.hook_progress` | P1 | Hook 执行输出 |
| `run.agent.hook_response` | P1 | Hook 执行完成 |
| `run.agent.tool_use_summary` | P1 | 批量工具调用摘要 |
| `run.agent.auth_status` | P1 | 认证状态变更 |
| `run.agent.rate_limit` | P1 | 速率限制通知 |
| `run.agent.permission_requested` | P1 | Agent 请求权限审批 |
| `run.agent.permission_decided` | P1 | 权限审批结果 |

### AgentTeam / TeamRun

| type | 阶段 | 说明 |
|---|---|---|
| `team.route.decided` | P1 | Supervisor typed route decision 已接受，payload 为 `CoordinatorRouteDecision` |
| `team.route.rejected` | P1 | Supervisor route decision 被 schema、任务数、活跃 subagent 或重复 route guardrail 拒绝，payload 包含 `decision` 和 `reason` |
| `team.task.created` | P1 | TeamTask 已从 accepted route decision 创建 |
| `team.approval.decided` | P1 | TeamRun approval 人工决策已记录，payload 包含 `approval_id`、`agent_task_id`、`edge_run_id`、`decision`、`decided_by`、`edge_control` |
| `assignment.created` | P1 | TeamAssignment 已创建 |
| `assignment.dispatched` | P1 | TeamAssignment 已派发到目标 Agent，payload 包含 `assignment_id`、`team_task_id` 和 Hub `agent_task_id` |
| `assignment.completed` | P1 | TeamAssignment 完成 |
| `assignment.failed` | P1 | TeamAssignment 失败 |
| `assignment.cancelled` | P1 | TeamAssignment 取消 |

### Hub / Sync / Relay

| type | 阶段 | 说明 |
|---|---|---|
| `device.registered` | P2 | 设备注册 |
| `edge.registered` | P2 | Edge 注册到 Hub |
| `edge.heartbeat` | P2 | Edge 心跳 |
| `edge.online` | P2 | Edge 上线 |
| `edge.offline` | P2 | Edge 离线 |
| `sync.event.uploaded` | P2 | Edge event 已上传 |
| `sync.ack` | P2 | Hub 同步确认 |
| `relay.command.created` | P3 | Hub 创建中继命令 |
| `relay.command.acknowledged` | P3 | Edge 确认中继命令 |
| `cloud.runner.allocated` | P3 | Cloud Runner 已分配 |
| `cloud.runner.released` | P3 | Cloud Runner 已释放 |

### Common

| type | 阶段 | 说明 |
|---|---|---|
| `error` | P0 | 事件流错误，payload 使用统一错误格式 |

## 6. 不是 JSON-RPC

WebSocket 事件不是 JSON-RPC：

- 不使用 `jsonrpc` 字段。
- 不使用 `method` / `params` 包装事件。
- 不用 WebSocket 承载普通查询。

如果未来 Runner 和 sidecar 之间需要 stdio bridge，可以局部使用 JSON-RPC 或 NDJSON，但不作为 AgentHub 主协议。

## 7. Hub WebSocket Events

Hub Server 提供独立的 WebSocket 事件系统，与 Edge Server 的 `EventEnvelope` 格式不同。以下为 Hub WebSocket 事件文档。

### 7.1 连接

```text
ws://host:8080/client/ws?access_token=<hub-issued-access-token>
```

连接流程：

1. 客户端使用 Hub-issued HS256 access token 建立 WebSocket 连接。浏览器客户端通过 `access_token` query 参数传递；能设置请求头的原生客户端也可用 `Authorization: Bearer <token>`。
2. Hub 在 HTTP upgrade 前验证 token；TokenDance ID RS256 bearer token 不能通过 `/client/ws`。
3. 升级成功后服务端发送 `auth.ok`；验证失败时在升级前返回 401，不建立 WebSocket。
4. 认证通过后，客户端可发送 `typing` 事件；服务端推送实时事件。
5. 心跳：服务端定期发送 WebSocket ping，客户端需要回复 pong。连续未回复 pong 将导致断连。

### 7.2 Frame Format (Hub)

Hub 使用扁平帧格式（与 Edge 的 EventEnvelope 不同）：

| 字段 | 类型 | 必填 | 描述 |
|-------|------|:---:|------|
| `type` | string | 是 | 事件类型，使用 dot.notation 格式（如 `message.new`） |
| `seq_id` | number | 否 | 服务端保留字段，用于需要排序/游标的 Hub-emitted frames；未排序事件、认证帧和客户端事件应省略 |
| `payload` | object | 视事件而定 | 事件载荷，结构由 `type` 决定 |

`seq_id` 不是客户端可写字段。当前实现中 `Frame.seq_id` 使用 `omitempty`，所以 `auth.ok`、`auth.fail`、`typing`、device presence 和 agent control/dispatch 默认不带 `seq_id`；消息分页游标仍以 message payload 内的 `seq_id` 为准。

对比 Edge EventEnvelope：

- Hub: 扁平 `{type, seq_id, payload}` — 无 version / id / scope / traceId / sentAt 包裹
- Edge: `{version, id, seq, type, scope, traceId, sentAt, payload}` — 完整信封

### 7.3 Hub 事件类型

#### Auth 事件（Client↔Hub）

| type | 方向 | 说明 |
|------|------|------|
| `auth` | Client→Hub | 历史帧认证，仅用于未挂 `WSAuthMiddleware` 的测试/兼容入口；主路由 `/client/ws` 使用 upgrade 前 token |
| `auth.ok` | Hub→Client | 认证成功，payload: `{ user_id, device_id }` 或 `null` |
| `auth.fail` | Hub→Client | 认证失败，payload: `{ reason }`；主路由通常在 upgrade 前返回 401 |

**auth.ok 示例 — 服务端响应：**

```json
{"type":"auth.ok","payload":{"user_id":"user_01HX...","device_id":"device_01HX..."}}
```

**auth.fail 示例 — 服务端响应：**

```json
{"type":"auth.fail","payload":{"reason":"invalid token"}}
```

#### Typing 事件（Client→Hub）

| type | 方向 | 说明 |
|------|------|------|
| `typing` | Client→Hub | 用户正在输入，payload: `{ session_id }` |

```json
{"type":"typing","payload":{"session_id":"sess_01HX..."}}
```

#### Message 事件（Hub→Client）

| type | 说明 |
|------|------|
| `message.new` | 新消息，payload: `{ message_id, session_id, sender_id, sender_type, content, content_type, seq_id, reply_to_message_id, created_at }` |
| `message.recall` | 消息撤回，payload: `{ message_id, session_id, recalled_by }` |
| `message.pin` | 消息置顶，payload: `{ message_id, session_id, pinned_by }` |
| `message.unpin` | 取消置顶，payload: `{ message_id, session_id }` |
| `message.read` | 消息已读回执，payload: `{ message_id, session_id, read_by, last_read_seq }` |

```json
{"type":"message.new","seq_id":42,"payload":{"message_id":"msg_01HX...","session_id":"sess_01HX...","sender_id":"user_01HX...","sender_type":"user","content":{"text":"Hello"},"content_type":"text","created_at":"2026-05-25T12:00:00Z"}}
```

#### Session 事件（Hub→Client）

| type | 说明 |
|------|------|
| `session.created` | 会话创建 (defined, not yet emitted)，payload: `{ session_id, type, name, owner_id, members[] }` |
| `session.dissolved` | 群解散 (defined, not yet emitted)，payload: `{ session_id }` |
| `session.member_joined` | 成员加入 (defined, not yet emitted)，payload: `{ session_id, member_id, member_type }` |
| `session.member_left` | 成员离开 (defined, not yet emitted)，payload: `{ session_id, member_id }` |
| `session.info_updated` | 会话信息变更 (defined, not yet emitted)，payload: `{ session_id, changes{} }` |

#### Device 事件（Hub→Client）

| type | 说明 |
|------|------|
| `device.online` | 用户在线 presence，payload: `{ user_id }`；这是 user-level presence 广播，不暴露具体 device |
| `device.offline` | 用户离线 presence，payload: `{ user_id }`；这是 user-level presence 广播，不暴露具体 device |
| `device.kicked` | 设备被踢下线，payload: `{ device_id, reason }` |

#### Agent Task 事件（Hub↔Edge）

| type | 方向 | 说明 |
|------|------|------|
| `agent.dispatch` | Hub→Edge | 分发 agent 任务，payload: `{ task_id, agent_instance_id, agent_type, session_id, prompt, trigger_message_id, trigger_user_id, display_name, model_params?, target_id?, team_id?, team_run_id?, team_member_id?, team_member_role? }`；`agent_type` 必须是 Edge Runtime adapter id（如 `claude-code`、`codex`、`opencode`），`prompt` 来自触发消息文本。Web 触发可用 `agent_type` / `agent_instance_id` / `custom_agent_id` 指定 Agent，可用 `target_id` 指定 owner-scoped Execution Target；Hub 会校验 target owner、当前可调度 target type 和绑定 desktop device，把 `target_id` 与 `edge_device_id` 持久化，只向该 device 的 Desktop/Edge WS 下发。TeamRun supervisor dispatch 会携带 team context，Desktop bridge 用它把 `run.agent.route_decision` / result `structuredOutput` 自动绑定到 Hub route decision endpoint。目标 device 离线时进入 target/device 专属队列，等待同一 device reconnect replay，禁止 fallback 到其他在线 desktop；replay 会先读取 Redis payload，只有 Hub DB 任务状态成功标记为 dispatched 后才 ack 删除该 payload，避免 DB 更新失败时丢任务。该切片仍不代表远程/云 target 已完成；Remote/Cloud 还需要 relay/provisioning、设备证明、workspace allowlist 同步和审批证明。 |
| `agent.stream` | Edge→Hub/Hub→Client | typed runtime event，payload: `{ id, task_id, edge_run_id, session_id, agent_instance_id, event_seq, event_type, payload, created_at }`；Hub 仍会为当前聊天 UI 同步投影一条 `message.new`。 |
| `agent.done` | Edge→Hub | agent 任务完成，payload: `{ task_id, result_summary, usage{} }` |
| `agent.failed` | Edge→Hub | agent 任务失败，payload: `{ task_id, error }` |
| `agent.cancel` | Hub→Edge | 取消 agent 任务，payload: `{ task_id }` |
| `agent.control` | Hub→Edge | 设备级控制命令，payload: `{ kind, agent_task_id?, target_id?, edge_device_id, team_id?, team_run_id?, team_task_id?, assignment_id?, member_id?, approval_id?, edge_control? }`。当前 `kind=permission.decide` 用于把 TeamRun approval decision 投递给拥有该 Edge run 的 exact Desktop/Edge；`edge_control` 可直接转为 Edge `POST /v1/permissions/decide` body。目标 device 离线时进入 user/device 专属控制队列，reconnect 只 replay 同一 device，禁止 fallback 到其它 Desktop。 |
| `agent.timeout` | Hub→Edge | 任务超时，payload: `{ task_id }` |

#### Notification 事件（Hub→Client）

| type | 说明 |
|------|------|
| `notification.new` | 新通知，payload: `{ notification_id, type, payload{} }` |

#### Friend 事件（Hub→Client）

| type | 说明 |
|------|------|
| `friend.request` | 收到好友请求，payload: `{ request_id, from_user_id, message }` |
| `friend.accepted` | 好友请求被接受，payload: `{ friendship_id, user_id }` |

### 7.4 代码示例

```json
// 客户端连接主路由
"ws://host:8080/client/ws?access_token=eyJhbGciOiJIUzI1NiIs..."

// 服务端响应认证成功
{"type":"auth.ok","payload":{"user_id":"user_01HX...","device_id":"device_01HX..."}}

// 服务端推送新消息
{"type":"message.new","seq_id":42,"payload":{"message_id":"msg_01HX...","session_id":"sess_01HX...","sender_id":"user_01HX...","sender_type":"user","content":{"text":"Hello"},"content_type":"text","created_at":"2026-05-25T12:00:00Z"}}

// 服务端推送设备上线
{"type":"device.online","payload":{"user_id":"user_01HX..."}}

// Edge 上报 agent 任务完成
{"type":"agent.done","payload":{"task_id":"task_01HX...","result_summary":"Tests passed. 3/3 OK.","usage":{"input_tokens":1234,"output_tokens":567}}}

// Hub 推送 typed runtime event
{"type":"agent.stream","payload":{"id":"evt_01HX...","task_id":"task_01HX...","edge_run_id":"run_01HX...","session_id":"sess_01HX...","agent_instance_id":"agent_01HX...","event_seq":1,"event_type":"run.agent.tool_call","payload":{"callId":"call_1","toolName":"read_file"},"created_at":"2026-05-25T12:00:00Z"}}

// Hub 推送 exact-device permission decision control
{"type":"agent.control","payload":{"kind":"permission.decide","agent_task_id":"task_01HX...","edge_device_id":"device_01HX...","team_id":"team_01HX...","team_run_id":"run_team_01HX...","approval_id":"req_01HX...","edge_control":{"runId":"edge_run_01HX...","requestId":"req_01HX...","decision":"allow","reason":"Known safe command"}}}
```
