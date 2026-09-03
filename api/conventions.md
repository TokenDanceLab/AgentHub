# API Conventions

最后更新：2026-08-09

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
| `PUT` | 整体替换或覆盖更新资源 |
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

响应包含 `items` 和 `page.nextCursor` / `page.hasMore`。`pageSize` 默认 `50`，最大 `200`。不要把 offset pagination 作为主方式，避免消息流和事件流错位。**超过上限的 `pageSize` 是「夹取」而不是「报错」**（ADR-031 / #2243）：请求值大于该端点自己声明、且被查询层实际执行的上限（通用列表 `MaxListPageSize = 200`、消息/通知族 `MaxMessagePageLimit = 100`、run/team-event 与文档族 `MaxPageLimit = 500`）时，服务端返回**上限条数** + HTTP 200 + 照常的 `page.nextCursor` / `page.hasMore`，余下部分跟着游标继续取；limit/offset 形态的端点（如通知列表）则继续推进 `offset`。它**不会**回落到默认值（那会把页二次缩短），也**不会**返回 400 —— 被夹短的页是可续取的，不是数据丢失，把它变成硬失败对调用方零收益。夹取由 `hub-server/internal/config/paging.go` 的 `ClampPageSize` 单点执行，所有 handler 侧列表都走它；实测口径见 #2243（13 个 handler 回传游标，另两个 clamp 端点是 limit/offset 形态）。

### 三种列表响应形状

实际 wire 形状因归属和资源而异，客户端必须按下列三种形状解析，不要假设统一 `{items, page}`：

| 形状 | 归属 | 资源示例 | wire |
|---|---|---|---|
| 裸数组（Hub） | Hub | `sessions`、`threads`、`messages`、`teams`、`runs` | `{"code":"ok","data":[...]}` |
| `{items, page:{hasMore:false}}`（Edge） | Edge | Edge 所有列表（runs、agents、plans、permission requests 等） | `{"items":[...],"page":{"hasMore":false}}` |
| `{items, page:{nextCursor, hasMore}}`（Hub cursor） | Hub | `workspaces`、`agent_profiles`、`audit`、`skills`、`execution_targets`、`mcp_servers`、`market`、`provider_bindings` | `{"items":[...],"page":{"nextCursor":"...","hasMore":true}}` |

形状选择依据：

- **Hub 裸数组**用于"父资源内自然有界"的子集合（例如某 project 下的 threads、某 thread 下的 messages）。这些列表没有跨页游动的需求，Hub 直接以 `data` 数组返回，不裹 `items`/`page`。
- **Edge 无 cursor**：Edge 当前列表均一次性返回，`page.hasMore` 恒为 `false` 且没有 `nextCursor` 字段。保留 `page` 对象是为了未来扩展时不破坏形状。
- **Hub cursor** 用于跨项目、跨时间的全局列表（audit、workspaces、market 等），按 `pageCursor` 翻页，`page.nextCursor` 为空字符串或 `hasMore=false` 表示末页。

客户端解析入口应按"先判 Hub envelope（`code==="ok"` 取 `data`），再按 `items`/`page` 解 Edge/Hub cursor 形状"的顺序处理。

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
- Hub 成功 envelope 的 wire 值是 **小写** `ok`：`{"code":"ok","data":{...}}`（`hub-server/internal/errcode.OK.Code`，经 `handler.OK` 写出）。这不是 HTTP 状态文案，也不是 Edge 成功形状——Edge 成功响应返回裸 JSON 对象或数组。OpenAPI 中 Hub success 的 `code` enum 与此对齐为 `ok`；历史上部分文档/fixture 写过 `"OK"`。共享客户端对成功码大小写不敏感（`isHubSuccessCode`）仅作解析容错，**不是**双 wire 契约。统一 Hub/Edge 成功响应格式属于后续兼容性任务。
- 前端解析入口是 `app/shared/src/errors.ts` 的 `parseError()`；Hub envelope 解包见 `app/shared/src/hub/hubClientEnvelope.ts`。

### HTTP 状态码与语义

下表列出需要客户端特殊处理的 HTTP 状态码及对应 `code`。未列出的状态码按 envelope 内 `code` 处理。

| HTTP | `code` | 语义与客户端行为 |
|---|---|---|
| 429 | `rate_limited` | 全局/按路径限流触发。响应头一定带 `Retry-After`（秒，整数），客户端必须遵守后再重试，不要立即退避风暴。WS 连接速率限制返回 `ws_rate_limited`（同样 429，无 `Retry-After`）。**注意**：限流 code 已规范化为 snake_case `rate_limited`；历史 fixture 里出现的 `RATE_LIMITED`/`too_many_requests` 不再是 production wire 值。 |
| 410 | `session_dissolved` / `agent_task_cancelled` / `agent_task_timeout` | 资源曾存在但已进入终态，不可恢复。区别于 404 `not_found`：410 表示"曾经存在、现已终结"，客户端应停止重试并清理本地缓存/乐观状态，不要把它当瞬时错误重放。 |
| 413 | `payload_too_large` / `attach_too_large` | 请求体超过配置上限。通用 `payload_too_large` 由共享 errcode 定义；Hub 附件域码 `attach_too_large` 用于上传场景。客户端应缩小体积后重试，不要原样重发。 |
| 415 | `attach_type_not_allowed` | Hub 附件上传的文件类型不在允许清单。客户端应转换格式或换资源，不要重发同一文件。 |

#### 限流与 Redis 故障

限流中间件（`hub-server/internal/middleware/global_rate_limit.go`、`rate_limit.go`、`ws_rate_limit.go`）依赖 Redis。Redis 故障时的行为由配置决定：

- **认证路径**（`/client/auth/*`）一律 fail-closed：返回 503 `rate_limit_unavailable`，绝不放行。
- **非认证路径**：默认 fail-open，放行并写 warn 日志、置响应头 `X-Rate-Limit-Degraded: true`；若显式配置 `AGENTHUB_RATE_LIMIT_FAIL_OPEN=false`，则 fail-closed 返回 503 `rate_limit_unavailable`。

客户端遇到 503 `rate_limit_unavailable` 时应区分：认证路径下不要无限重试（会一直 503）；非认证路径下若带 `X-Rate-Limit-Degraded` 表示限流已降级放行，可继续业务请求。

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

两个取值域是**闭合**的（ADR-030 / #2258）。`x-agenthub-owner ∈ {Hub, Edge}`：早期的 `Runner` 已退役 —— `edge-server/internal/runners/` 只剩 `registry.go`，而 workspace 的 handler/service/repository/model 全在 `hub-server`、以 `/web/projects*` 暴露，照 `Runner` 找实现的人会在 Edge 找不到 workspace 逻辑进而新起第二套实现（正是「禁止在另一层再分叉实现」要防的事）；workspace 的**元数据与列举归 Hub**，将来若真需要 Edge 侧文件内容端点，届时那个端点自己标 `owner: Edge`，不要预建。`x-agenthub-phase ∈ {P0, P1, P2, P3, P4}` **只适用于 `/v1/**` 设计面**：reality-face（`/client`、`/web`、`/edge`）由 `x-agenthub-status` 治理、不带 phase，`/health`、`/api`、`/cloud` 属 ops/非设计面同样不带。端点级 `x-agenthub-status ∈ {implemented, planned}`，schema 级另允许 `contract-draft`。

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

## seq 字段对照表（Hub `seq_id` vs Edge `seq`）

两个字段名字相近、语义完全不同。**切勿混用**。服务端出处见下方「源码锚点」。

| 维度 | Hub `seq_id` | Edge `seq` |
|---|---|---|
| 所属协议 | Hub `/client/ws` Frame（`{type, seq_id?, payload?}`） | Edge EventEnvelope（`{version, id, seq, type, scope, ...}`） |
| 作用域 | **单连接**（per-connection） | **单 Bus / 持久 stream**（per-bus，跨连接稳定） |
| 生成点 | `Manager.PushToConn` → `c.seq.Add(1)`（`hub-server/internal/ws/fanout.go:91`） | `Bus.Publish` → `atomic.AddInt64(&b.seq, 1)`（`edge-server/internal/events/bus.go:159`） |
| 重连行为 | **重置**：新连接从 1 重新计数；旧连接的 seq_id 在新连接上无意义 | **延续**：单调递增不随客户端断线重置；客户端持 cursor 续读（`Bus.Subscribe(cursor)` bus.go:335） |
| 客户端合法用法 | 仅用于**同连接内**丢帧检测（收到 seq_id < 上次 → gap） | 用作 replay cursor、去重水位（`seq <= lastSeq` 丢弃）、gap 检测 |
| 禁止用法 | ❌ 当跨连接幂等键 / 持久 cursor / 业务去重键；❌ 写入请求帧 | ❌ 当 per-conn 丢帧计数器；❌ 假定重连会重置 |
| 业务幂等键 | 由具体 frame type 决定（见下表「幂等键」列），**不是 seq_id** | 由 `EventEnvelope.id` + payload 业务 id 决定，**不是 seq** |
| 源码锚点 | `hub-server/internal/ws/frame.go:7-14`（定义）+ `fanout.go:91`（stamp） | `edge-server/internal/events/types.go:28-38`（定义）+ `bus.go:159`（stamp） |

> ⚠️ **给未来维护者的警戒**：在 hubWS / eventClient / hubEvents 任一处看到 `seq` 或 `seq_id` 时，先确认是哪一侧的字段。把 Hub `seq_id` 当 cursor 续读、或把 Edge `seq` 当 per-conn 丢帧计数，都会导致静默丢事件或重复 apply。#2101 G5。
>
> 📌 **hubWS.ts 注记**：本节只覆盖 eventClient.ts / hubEvents.ts 的客户端警戒注释；hubWS.ts 的 gap 检测与 seq_id 处理已在 #2117 落地，对应 JSDoc 可后续补齐。
