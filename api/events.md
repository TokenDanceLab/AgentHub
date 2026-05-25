# WebSocket Events

AgentHub 使用 WebSocket typed events 推送实时状态。REST API 用于发起命令和查询，WebSocket 只负责事件投递。

> **Implementation Status (2026-05-24)**: Edge Server events (run.*, runner.*) are
> the primary event system and are documented in sections 1-6 below. Hub Server
> WebSocket events are documented in [section 7](#7-hub-websocket-events) (added 2026-05-25).

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
| `project.updated` | P0 | 项目元数据更新 |
| `conversation.created` | P1 | 会话创建 |
| `conversation.member.added` | P1 | 会话成员加入 |
| `thread.created` | P0 | Thread 创建 |
| `thread.updated` | P0 | Thread 状态或标题更新 |
| `thread.forked` | P1 | Thread 分支创建 |
| `message.created` | P0 | 消息创建 |
| `message.delta` | P0 | Agent 消息流式增量 |
| `item.created` | P0 | Thread Item 创建 |
| `item.updated` | P0 | Thread Item 状态更新 |

### Execution / Runner

| type | 阶段 | 说明 |
|---|---|---|
| `runner.online` | P0 | Runner 在线 |
| `runner.offline` | P0 | Runner 离线 |
| `run.queued` | P0 | AgentRun 已排队 |
| `run.started` | P0 | AgentRun 已启动 |
| `run.output` | P0 | 单条 stdout/stderr 输出 |
| `run.output.batch` | P0 | 批量 stdout/stderr 输出 |
| `run.status.changed` | P0 | AgentRun 状态变化 |
| `approval.requested` | P0 | 请求用户审批 |
| `approval.decided` | P0 | 用户已审批 |
| `artifact.created` | P0 | 产物创建 |
| `artifact.updated` | P1 | 产物元数据更新 |
| `preview.ready` | P0 | 预览可用 |
| `preview.stopped` | P1 | 预览停止 |
| `run.finished` | P0 | AgentRun 正常结束 |
| `run.failed` | P0 | AgentRun 失败 |
| `run.cancelled` | P1 | AgentRun 已取消（已实现，补文档） |
| `run.agent.text_delta` | P0 | Agent 流式文本增量（CLI-agnostic） |
| `run.agent.text_block` | P0 | Agent 完整文本块 |
| `run.agent.thinking` | P0 | Agent 思考/推理内容（可折叠显示） |
| `run.agent.tool_call` | P0 | Agent 请求工具调用 |
| `run.agent.tool_result` | P0 | 工具调用执行结果 |
| `run.agent.file_change` | P0 | 文件变更，payload: `{ path, kind: "created"\|"modified"\|"deleted", diff? }` |
| `run.agent.session_init` | P0 | Agent 会话初始化（模型、工具列表、权限模式） |
| `run.agent.result` | P0 | Agent 执行结束（成功/失败、token 用量） |
| `run.agent.compact_boundary` | P1 | 上下文压缩边界 |
| `run.agent.api_retry` | P1 | API 重试通知 |
| `run.agent.task_started` | P1 | 子代理任务启动 |
| `run.agent.task_progress` | P1 | 子代理任务进度 |
| `run.agent.task_notification` | P1 | 子代理任务完成/失败 |
| `run.agent.session_state_changed` | P1 | 会话状态变更（idle/running/requires_action） |
| `run.agent.hook_started` | P1 | Hook 执行开始 |
| `run.agent.hook_progress` | P1 | Hook 执行输出 |
| `run.agent.hook_response` | P1 | Hook 执行完成 |
| `run.agent.tool_use_summary` | P1 | 批量工具调用摘要 |
| `run.agent.auth_status` | P1 | 认证状态变更 |
| `run.agent.rate_limit` | P1 | 速率限制通知 |
| `run.agent.permission_requested` | P1 | Agent 请求权限审批 |
| `run.agent.permission_decided` | P1 | 权限审批结果 |

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
ws://host:8080/client/ws
```

连接流程：

1. 建立 WebSocket 连接。
2. 客户端必须在第一帧发送 `auth` 事件。
3. 服务端验证 token 后返回 `auth.ok` 或 `auth.fail`。
4. 认证通过后，客户端可发送 `typing` 事件；服务端推送实时事件。
5. 心跳：服务端定期发送 WebSocket ping，客户端需要回复 pong。连续未回复 pong 将导致断连。

### 7.2 Frame Format (Hub)

Hub 使用扁平帧格式（与 Edge 的 EventEnvelope 不同）：

| 字段 | 类型 | 必填 | 描述 |
|-------|------|:---:|------|
| `type` | string | 是 | 事件类型，使用 dot.notation 格式（如 `message.new`） |
| `seq_id` | number | 否 | 当前连接内单调递增序号 |
| `payload` | object | 视事件而定 | 事件载荷，结构由 `type` 决定 |

对比 Edge EventEnvelope：

- Hub: 扁平 `{type, seq_id, payload}` — 无 version / id / scope / traceId / sentAt 包裹
- Edge: `{version, id, seq, type, scope, traceId, sentAt, payload}` — 完整信封

### 7.3 Hub 事件类型

#### Auth 事件（Client↔Hub）

| type | 方向 | 说明 |
|------|------|------|
| `auth` | Client→Hub | 认证请求，payload: `{ access_token }` |
| `auth.ok` | Hub→Client | 认证成功，payload: `{ user_id, device_id }` |
| `auth.fail` | Hub→Client | 认证失败，payload: `{ reason }` |

**auth 示例 — 客户端发送：**

```json
{"type":"auth","payload":{"access_token":"eyJhbGciOiJIUzI1NiIs..."}}
```

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
| `session.created` | 会话创建，payload: `{ session_id, type, name, owner_id, members[] }` |
| `session.dissolved` | 群解散，payload: `{ session_id }` |
| `session.member_joined` | 成员加入，payload: `{ session_id, member_id, member_type }` |
| `session.member_left` | 成员离开，payload: `{ session_id, member_id }` |
| `session.info_updated` | 会话信息变更，payload: `{ session_id, changes{} }` |

#### Device 事件（Hub→Client）

| type | 说明 |
|------|------|
| `device.online` | 设备上线，payload: `{ user_id, device_id, device_type }` |
| `device.offline` | 设备下线，payload: `{ user_id, device_id, device_type }` |
| `device.kicked` | 设备被踢下线，payload: `{ device_id, reason }` |

#### Agent Task 事件（Hub↔Edge）

| type | 方向 | 说明 |
|------|------|------|
| `agent.dispatch` | Hub→Edge | 分发 agent 任务，payload: `{ task_id, agent_instance_id, session_id, prompt, model, trigger_message_id }` |
| `agent.stream` | Edge→Hub | agent 流式输出，payload: `{ task_id, content, content_type }` |
| `agent.done` | Edge→Hub | agent 任务完成，payload: `{ task_id, result_summary, usage{} }` |
| `agent.failed` | Edge→Hub | agent 任务失败，payload: `{ task_id, error }` |
| `agent.cancel` | Hub→Edge | 取消 agent 任务，payload: `{ task_id }` |
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
// 客户端发送认证
{"type":"auth","payload":{"access_token":"eyJhbGciOiJIUzI1NiIs..."}}

// 服务端响应认证成功
{"type":"auth.ok","payload":{"user_id":"user_01HX...","device_id":"device_01HX..."}}

// 服务端推送新消息
{"type":"message.new","seq_id":42,"payload":{"message_id":"msg_01HX...","session_id":"sess_01HX...","sender_id":"user_01HX...","sender_type":"user","content":{"text":"Hello"},"content_type":"text","created_at":"2026-05-25T12:00:00Z"}}

// 服务端推送设备上线
{"type":"device.online","payload":{"user_id":"user_01HX...","device_id":"device_01HX...","device_type":"desktop"}}

// Edge 上报 agent 任务完成
{"type":"agent.done","payload":{"task_id":"task_01HX...","result_summary":"Tests passed. 3/3 OK.","usage":{"input_tokens":1234,"output_tokens":567}}}
```
