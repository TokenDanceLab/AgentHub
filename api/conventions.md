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

所有 REST 错误使用统一 envelope（Edge Server 和 Hub Server 完全相同）：

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

- `code` 使用 `snake_case`（全小写+下划线），面向程序，必须稳定。
- `message` 英文，人类可读描述，不含内部路径、密钥或主机名。
- `traceId` 每次错误自动生成（`trace_` 前缀 + 6 位递增序号），可通过 `X-Request-ID` 串联请求链路。
- 成功响应沿用现有格式不变：Hub 返回 `{"code":"OK","data":{...}}`，Edge 返回裸 JSON 对象或数组。
- 实现位于共享模块 `pkg/errcode`（`github.com/agenthub/pkg/errcode`），Edge 和 Hub 各自 `internal/errcode/codes.go` 做 type-alias re-export + 域代码定义。
- 前端解析：`app/shared/src/errors.ts` 的 `parseError()` 已统一处理 `body.error.code` / `body.error.message` / `body.error.traceId`。

### 错误码表

#### 通用码（pkg/errcode/codes.go）

Edge 和 Hub 共享，不可各自重定义：

| code | HTTP | 含义 |
|---|---:|---|
| `internal_error` | 500 | 未知服务端错误 |
| `bad_request` | 400 | 请求参数无效 |
| `not_found` | 404 | 资源不存在 |
| `method_not_allowed` | 405 | HTTP 方法不支持 |
| `request_timeout` | 504 | 请求超时 |
| `not_implemented` | 501 | 端点未实现 |
| `too_many_requests` | 429 | 触发限流 |
| `unauthorized` | 401 | 需要认证 |
| `forbidden` | 403 | 权限不足 |
| `invalid_token` | 401 | Token 无效 |
| `token_expired` | 401 | Token 已过期 |
| `invalid_json` | 400 | JSON 解析失败 |
| `validation_error` | 400 | 字段校验失败 |
| `content_required` | 400 | 内容字段缺失 |
| `payload_too_large` | 413 | 请求体过大 |
| `conflict` | 409 | 资源冲突 |
| `already_exists` | 409 | 资源已存在 |

#### Edge 域码（edge-server/internal/errcode/codes.go）

| code | HTTP | 含义 |
|---|---:|---|
| `workspace_not_allowed` | 403 | 工作目录不在白名单 |
| `invalid_permission_mode` | 400 | 权限模式参数无效 |
| `invalid_decision` | 400 | 审批决策值非法 |
| `executor_unavailable` | 503 | 无 Agent Runtime 执行器 |
| `executor_start_failed` | 500 | Run 启动失败 |
| `too_many_concurrent_runs` | 429 | 并发 Run 数达上限 |
| `active_run_exists` | 409 | Thread 已有活跃 Run |
| `invalid_agent_id` | 400 | Agent 适配器未知 |
| `agent_registry_not_configured` | 404 | Agent 注册表未配置 |
| `agent_instance_not_found` | 404 | Agent 实例未找到 |
| `permission_request_not_found` | 404 | 权限请求不存在 |
| `run_id_required` | 400 | runId 缺失 |
| `request_id_required` | 400 | requestId 缺失 |
| `not_configured` | 503 | 资源未配置 |

#### Hub 域码（hub-server/internal/errcode/codes.go）

Hub 域码完整列表见 `hub-server/internal/errcode/codes.go`。域码遵循 `{domain}_{entity}_{event}` 三段式命名，如 `msg_not_found`、`session_not_member`、`agent_task_timeout`。

### Hub 成功响应格式（现状）

Hub 成功响应使用 `{"code":"OK","data":{...}}` 格式（注：与错误 envelope 不同，没有外层 `error` wrapper）。Edge 成功响应返回裸 JSON 对象或数组。统一成功响应格式的工作留待后续阶段。

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
归属：Hub / Edge（Runtime adapter 属于 Edge；Runner 只保留为兼容命名）
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
