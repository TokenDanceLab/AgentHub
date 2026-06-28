# API Conventions

最后更新：2026-06-27

本文定义 AgentHub REST API 和 WebSocket typed events 的通用规则。完整路径/schema 以 `api/openapi.yaml` 为准；事件合同入口见 `api/events.md`；错误码源头见 `pkg/errcode`、`edge-server/internal/errcode/` 和 `hub-server/internal/errcode/`。

## Principles

- REST API 负责命令和查询。
- WebSocket typed events 负责实时状态流。
- JSON 字段使用 `camelCase`。
- API path、JSON key、event type 保持英文；文档说明使用中文。
- 时间使用 RFC3339 UTC，例如 `2026-05-22T12:00:00Z`。
- API version 放在 path 中：`/v1/...`。
- 新增 API 时先更新契约，再补实现和测试；实现先行必须在 PR 中标注 contract gap。

## HTTP

| 方法 | 用途 |
|---|---|
| `GET` | 查询资源或列表 |
| `POST` | 创建资源，或执行无法自然表达为 CRUD 的动作 |
| `PATCH` | 局部更新资源 |
| `DELETE` | 删除、解绑或归档资源 |

动作接口使用冒号后缀：

```text
POST /v1/runs/{runId}:cancel
POST /v1/approvals/{approvalId}:decide
POST /v1/artifacts/{artifactId}:apply
```

不使用自定义 HTTP method。

## IDs

ID 是字符串，使用语义前缀，不暴露数据库自增主键，创建后不可变。

| 资源 | 示例 |
|---|---|
| Project | `proj_01HX...` |
| Conversation | `conv_01HX...` |
| Thread | `thread_01HX...` |
| Item | `item_01HX...` |
| Run | `run_01HX...` |
| Artifact | `artifact_01HX...` |
| Approval | `approval_01HX...` |
| Runner | `runner_local` |
| Edge | `edge_01HX...` |
| Event | `evt_01HX...` |
| Trace | `trace_01HX...` |

请求参数使用完整字段名，例如 `projectId`、`threadId`、`runId`。

## Pagination

列表接口默认使用 cursor pagination：

```text
GET /v1/threads?projectId=proj_1&pageSize=50&pageCursor=cursor_abc
```

响应包含 `items` 和 `page.nextCursor` / `page.hasMore`。`pageSize` 默认 `50`，最大 `200`。不要把 offset pagination 作为主方式，避免消息流和事件流错位。

## Errors

REST 错误使用统一 envelope：

```json
{
  "error": {
    "code": "not_found",
    "message": "resource not found",
    "traceId": "trace_000001"
  }
}
```

规则：

- `code` 使用稳定 `snake_case`。
- `message` 使用英文，不含内部路径、密钥、主机名或用户数据。
- `traceId` 可通过 `X-Request-ID` 串联请求链路。
- 共享错误码定义在 `pkg/errcode/codes.go`；Edge/Hub 域码分别由各自 `internal/errcode/codes.go` 扩展。
- Hub 当前成功响应仍是 `{"code":"OK","data":{...}}`；Edge 成功响应返回裸 JSON 对象或数组。统一成功响应格式属于后续兼容性任务。
- 前端解析入口是 `app/shared/src/errors.ts` 的 `parseError()`。

## Permissions

接口文档使用这些权限词：

| 权限 | 含义 |
|---|---|
| `local` | 本地 Edge 离线模式可用 |
| `user` | 登录用户 |
| `project.member` / `project.owner` | 项目成员 / 所有者 |
| `conversation.member` | 会话成员 |
| `edge.owner` | Edge 所有者 |
| `admin` | Hub 管理员或组织管理员 |

P0 本地模式可以先实现为单用户，但文档中的权限边界必须保留。

## OpenAPI Metadata

每个接口至少标注：

```text
阶段：P0 / P1 / P2 / P3 / P4
归属：Hub / Edge
权限：local / user / project.member / ...
事件：会触发哪些 WebSocket event
```

`api/openapi.yaml` 使用扩展字段：

```yaml
x-agenthub-phase: P0
x-agenthub-owner: Edge
```

Hub 额外扩展必须与 middleware 对齐：`x-agenthub-role: admin` 对应 `RequireAdmin()`；`x-agenthub-device-type` 对应 `DeviceTypeCheck(...)`。

## Compatibility

- 新增 response 字段通常是兼容变更。
- 删除字段、改字段类型、改错误码是破坏性变更。
- Event `type` 一旦发布，不复用旧名字表达新语义。
- 远期字段可先用对象占位，但必须说明语义和 owner。
