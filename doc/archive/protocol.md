> 📦 已归档

# AgentHub 协议

日期：2026-05-22

## 原则

AgentHub 当前主协议采用 **REST JSON API + WebSocket typed events**。

```text
api/openapi.yaml       = REST API 契约
api/events.schema.json = WebSocket event 契约
docs/protocol.md       = 人读说明：接口、事件、错误、版本和兼容规则
```

REST API 负责命令和查询，WebSocket 负责实时事件流。Go 服务和 TypeScript 前端都按 `api/` 下的契约实现。Protobuf、Connect-RPC、JSON-RPC 可以作为未来升级或局部 bridge 方案，但不是 M0 主链路的强制依赖。

## 协议面

| 面 | 方向 | 用途 |
|---|---|---|
| UI <-> Edge | REST JSON API + WebSocket EventStream | Desktop 本地会话、本地 run、本地 artifact |
| UI <-> Hub | REST JSON API + WebSocket EventStream | Web/Mobile 云端会话、远程控制、设备状态 |
| Edge <-> Hub | REST sync API + reverse WebSocket relay | 注册、同步、中继、远程命令 |
| Edge <-> Runner | local REST API + typed event stream | 启动 run、取消、流式事件、读取 artifact |

## REST API

P0/P1 先覆盖这些接口：

```text
GET    /v1/projects
POST   /v1/projects
GET    /v1/threads
POST   /v1/threads
GET    /v1/threads/{threadId}
POST   /v1/runs
POST   /v1/runs/{runId}:cancel
POST   /v1/approvals/{approvalId}:decide
GET    /v1/artifacts/{artifactId}
GET    /v1/events
```

`GET /v1/events` 只负责建立 WebSocket 连接、鉴权和恢复参数；具体 event payload 由 `api/events.schema.json` 定义。

## WebSocket Event

实时事件统一使用 event envelope：

```json
{
  "version": "v1",
  "id": "evt_123",
  "seq": 42,
  "type": "run.output",
  "traceId": "trace_abc",
  "sentAt": "2026-05-22T12:00:00Z",
  "payload": {
    "runId": "run_1",
    "stream": "stdout",
    "text": "running tests..."
  }
}
```

核心事件：

```text
message.created
message.delta
run.started
run.output
run.status.changed
approval.requested
artifact.created
preview.ready
run.finished
error
```

## 错误格式

REST API 错误统一返回：

```json
{
  "error": {
    "code": "approval_required",
    "message": "需要审批后才能执行该命令",
    "traceId": "trace_abc",
    "details": {}
  }
}
```

WebSocket 错误使用 `type=error` 的 event envelope，payload 复用同一套 error object。

## 类型规则

核心 ID 类型保持字符串：

```ts
type ProjectId = string
type ConversationId = string
type ThreadId = string
type TurnId = string
type RunId = string
type ArtifactId = string
```

核心模型包括：

```text
Project
Conversation
Thread
Turn
AgentRun
Item
Artifact
ApprovalRequest
ApprovalDecision
EdgeEvent
```

模型归属见 [module-boundaries.md](module-boundaries.md)。

## 版本和兼容

- URL 使用 `/v1/` 前缀。
- Event envelope 使用 `version: "v1"`。
- `id` 用于事件唯一标识。
- `seq` 用于同一 stream 内的顺序、回放和去重。
- `traceId` 用于串联 UI、Hub、Edge、Runner 的一次请求。
- 新增字段必须向后兼容；删除或改语义需要升版本。

## JSON-RPC 的位置

JSON-RPC 不作为 UI、Hub、Edge、Runner 主协议。它可以局部用于：

```text
Go Runner <-> Python/Node sidecar
Go Runner <-> Claude SDK bridge
stdio bridge start/cancel/shutdown
```

这些 bridge 事件进入 AgentHub 后，必须转换成标准 typed events。

## P0 范围

P0 只需要：

- UI <-> Edge 的 REST API。
- UI <-> Edge 的 WebSocket event stream。
- Edge <-> Runner 的 `run.start`、`run.output`、`artifact.created`、`run.finished`。
- 本地 Artifact 引用。
- Hub 注册和 relay 类型的占位定义。

Hub relay、生成客户端和完整 OpenAPI 自动化可以在本地循环稳定后加入。
