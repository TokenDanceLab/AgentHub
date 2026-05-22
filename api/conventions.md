# API Conventions

本文定义 AgentHub REST API 和 WebSocket typed events 的通用规则。模块文档和实现必须遵守这些规则。

## 1. 基本原则

- REST API 负责命令和查询。
- WebSocket typed events 负责实时状态流。
- JSON 字段使用 `camelCase`。
- API path、JSON key、event type 保持英文。
- 文档说明使用中文。
- 所有时间使用 RFC3339 UTC 字符串，例如 `2026-05-22T12:00:00Z`。
- 所有接口版本放在 path 中：`/v1/...`。

## 2. HTTP 方法

| 方法 | 用途 |
|---|---|
| `GET` | 查询资源或列表 |
| `POST` | 创建资源，或执行无法自然表达为 CRUD 的动作 |
| `PATCH` | 局部更新资源 |
| `DELETE` | 删除、解绑或归档资源 |

动作接口使用：

```text
POST /v1/runs/{runId}:cancel
POST /v1/approvals/{approvalId}:decide
POST /v1/artifacts/{artifactId}:apply
```

不使用自定义 HTTP method，例如 `ARCHIVE`。

## 3. ID 命名

ID 是字符串，使用语义前缀。

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

规则：

- ID 不暴露数据库自增主键。
- ID 在创建后不可变。
- 请求参数里使用完整字段名，例如 `projectId`、`threadId`、`runId`。

## 4. 分页

列表接口默认使用 cursor pagination。

Request:

```text
GET /v1/threads?projectId=proj_1&pageSize=50&pageCursor=cursor_abc
```

Response:

```json
{
  "items": [],
  "page": {
    "nextCursor": "cursor_next",
    "hasMore": true
  }
}
```

规则：

- `pageSize` 默认 `50`，最大 `200`。
- `pageCursor` 不要求客户端理解内部结构。
- 不用 offset pagination 作为主方式，避免消息流和事件流错位。

## 5. 错误格式

所有 REST error 使用统一格式：

```json
{
  "error": {
    "code": "runner_offline",
    "message": "Runner 不在线",
    "traceId": "trace_123",
    "details": {}
  }
}
```

常用错误码：

| code | HTTP | 含义 |
|---|---:|---|
| `bad_request` | 400 | 请求字段非法 |
| `unauthorized` | 401 | 未登录或 token 无效 |
| `forbidden` | 403 | 无权限访问 |
| `not_found` | 404 | 资源不存在 |
| `conflict` | 409 | 状态冲突，例如重复 apply |
| `approval_required` | 409 | 操作需要审批 |
| `runner_offline` | 409 | 目标 Runner 不在线 |
| `rate_limited` | 429 | 触发限流 |
| `internal_error` | 500 | 服务内部错误 |

规则：

- `message` 面向人类，可中文。
- `code` 面向程序，必须稳定。
- `traceId` 用于日志追踪。
- `details` 可包含字段级错误，但不要依赖它做主流程判断。

## 6. 权限标记

接口文档用以下权限词：

| 权限 | 含义 |
|---|---|
| `local` | 本地 Edge 离线模式可用 |
| `user` | 登录用户 |
| `project.member` | 项目成员 |
| `project.owner` | 项目所有者 |
| `conversation.member` | 会话成员 |
| `edge.owner` | Edge 所有者 |
| `admin` | Hub 管理员或组织管理员 |

P0 本地模式可以先把权限实现成单用户，但文档中的权限边界仍然保留。

## 7. 阶段和归属

每个接口至少应有：

```text
阶段：P0 / P1 / P2 / P3 / P4
归属：Hub / Edge / Runner
权限：local / user / project.member / ...
事件：会触发哪些 WebSocket event
```

`api/openapi.yaml` 使用扩展字段：

```yaml
x-agenthub-phase: P0
x-agenthub-owner: Edge
```

## 8. 兼容性

- 新增 response 字段是兼容变更。
- 删除字段、改字段类型、改错误码是破坏性变更。
- event `type` 一旦发布，不复用旧名字表达新语义。
- 远期字段可以先用对象占位，但必须说明语义。
