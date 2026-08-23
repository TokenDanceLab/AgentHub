# Hub Server

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-08-20

Hub Server（`hub-server/`）是 AgentHub 的云端控制面：TokenDance ID relying party、Hub session、IM、AgentTeam、同步、中继、审计和远程控制面。它不启动本机 Agent Runtime；执行仍由 Edge Server 和 adapter 负责。

## Boundaries

| 主题 | Hub owns | 不拥有 |
|---|---|---|
| Identity | OIDC code exchange，`tokendance_sub` 到 Hub user 映射 | 第三方 provider OAuth app 或 provider token |
| Session | Hub access/refresh session，WebSocket auth，device proof | TokenDance ID token 作为产品 session |
| Authorization | Hub-local membership/resource/action checks | 把身份认证等同授权 |
| IM | Contacts、sessions、messages、attachments、notifications | Local filesystem / raw process |
| Agent routing | Agent Profile、Execution Target、pending task、relay control | CLI process lifecycle |
| Audit | Audit event persistence and admin query | 生产 secret 或 live infra 状态 |

## Source Map

| 方向 | Source |
|---|---|
| App assembly | `hub-server/cmd/server-hub/main.go`, `hub-server/internal/app/` |
| Route registry | `hub-server/internal/router/router.go` |
| HTTP layer | `hub-server/internal/handler/` |
| Auth middleware | `hub-server/internal/middleware/` |
| Business logic | `hub-server/internal/service/`（按领域分子包，见下） |
| Persistence | `hub-server/internal/repository/`, `hub-server/internal/model/` |
| WebSocket frames | `hub-server/internal/ws/frame.go` |
| Event fanout / bus | `hub-server/internal/app/events.go`, `hub-server/internal/bus/` |
| Cache / sequence | `hub-server/internal/cache/`, `hub-server/internal/seqalloc/` |
| Config | `hub-server/internal/config/`, `hub-server/configs/`, `.env.example` |
| Migrations | `hub-server/migrations/` |

## Service 领域子包（#1761）

`internal/service/` 已从平铺大包拆分为按领域归组的子包，`handler -> service -> repository` 单向依赖不变；每个子包内 `Service`/`NewService` 命名，`handler` 侧保留窄接口。新增领域逻辑放入对应子包，不再回平铺包。

| 领域族 | 子包 |
|---|---|
| Identity | `auth`, `oidc` |
| Agent | `agent`, `agentcontrol`, `agentevent`, `agentprofile`, `agentteam` |
| IM / 会话 | `contact`, `session`, `message`, `messagereaction`, `notification`, `im` |
| 执行 / 调度 | `dispatch`, `dispatchsvc`, `executiontarget`, `device`, `relay`, `deliveryoutbox` |
| 资源 / 目录 | `attachment`, `document`, `skill`, `mcpserver`, `providerbinding`, `publicstats`, `usersettings`, `workspace` |
| 审计 | `audit` |

纯包门禁：`deliveryoutbox`（及 `dispatch`/`im`/`agentevent`）在 `scripts/verify/verify-hub-pure-packages.py` 的 PURE_DIRS 中，禁止 import gorm/cache/ws/service 树；其持久化经 `Store` 接口由 service 包的 gorm 实现注入（PURE_FILES 另含 `agentteam/route_helpers.go`）。残留平铺文件（非测试）仅 `delivery_outbox_facade.go`/`delivery_outbox_store.go`/`image_meta.go`，另有 `bench_test.go`/`catalog_ownership_test.go`/`image_meta_test.go` 三个测试文件。`agent` 子包目前仍经 `service.DeliveryOutbox`/`NewDeliveryOutboxStore` 依赖平铺根包 facade（`agent/agent.go`），平铺根包非无依赖残留；后续建议将 facade 迁入子包或改窄接口注入。

## Contract Map

| 契约 | Owner |
|---|---|
| REST path/schema | `api/openapi.yaml` |
| WS frame/event families | `api/events.md` |
| API conventions | `api/conventions.md` |
| Auth/identity | [06-auth-identity.md](06-auth-identity.md) |
| Deployment boundary | [05-deployment.md](05-deployment.md) |
| Security risk status | [../../SECURITY.md](../../SECURITY.md)（SSOT 在 TokenDance 私有治理文档） |

## Auth 中间件链与路由分组

Hub 鉴权区分**身份证明**与**产品会话**：TokenDance ID RS256 JWT 只证明身份（"我是谁"），Hub-issued HS256 JWT 才是产品会话（"我能操作 Hub 资源"）。中间件实现在 `internal/middleware/`，路由注册见 `internal/router/router.go`。

| 中间件 | 作用 | 应用于 |
|---|---|---|
| `AuthMiddleware` | 解析任意 Bearer token（先试 RS256 TokenDance，fallback HS256 Hub），注入 `auth_source` | `/client/*`、`/web/*`、`/edge/*`、`/cloud/*` 受保护路由 |
| `RequireHubSession()` | 拒绝 `auth_source != "hub_local"`，即拒绝 TokenDance bearer 直接操作产品 API | `/client/auth/me`、`/client/contacts`、`/client/sessions`、`/client/messages`、`/client/agent-tasks`、`/client/attachments`、`/client/notifications`、`/client/settings` 等 |
| `WSAuthMiddleware` | 只接受 Hub-issued HS256 session；TokenDance bearer 不能在 WS 升级时通过 | `/client/ws` |
| `RequireAdmin()` | `AGENTHUB_ADMIN_USERS` 逗号分隔白名单；空列表 = fail-closed | `/admin/*`、审计查询 |
| `RequireLocalAuth()` | `RequireHubSession()` 的别名，兼容历史调用点 | 旧路由 |

路由分组（`router.go`）：

```text
/health、/api/public            → 无鉴权
/client/auth/oidc/*、/client/auth/refresh → 仅 rate limit（登录入口）
/client/ws                      → WSAuthMiddleware（只接受 Hub session）
/client/*（me、logout、profile、contacts、sessions、messages、agent-tasks、edge、attachments、notifications、settings）→ AuthMiddleware + RequireHubSession
/edge/*、/cloud/*、/web/*       → AuthMiddleware + RequireHubSession
/admin/*                        → AuthMiddleware + RequireAdmin
```

## Data Flow

```text
Web/Desktop/Mobile
  -> Hub REST/WS
  -> handler
  -> service transaction
  -> repository
  -> PostgreSQL / Redis
  -> event bus
  -> WebSocket fanout / Edge dispatch
```

`agent.stream` events from Edge are persisted as run events and may be projected into chat messages for current clients. Transcript rendering must consume normalized shared blocks, not raw Hub frames.

## Runtime And Team Routing

Hub can enqueue and route `agent.dispatch`, `agent.control`, TeamRun route decisions, approvals and assignment events. Device/target routing must preserve the exact selected target and must not silently fallback to another Desktop/Edge when a target-bound device is offline.

Remote/cloud execution claims require relay/provisioning/device proof/workspace allowlist/approval evidence. A queued or replayed Hub task alone does not prove real model/API execution.

## Verification

| Change | Minimum check |
|---|---|
| Handler/service/repository | `cd hub-server; go test ./... -short -count=1` or narrower focused package |
| REST contract | OpenAPI YAML parse + affected handler tests |
| WS event behavior | Hub WS tests + `api/events.md` sync |
| Auth/session | OIDC/session tests（配置形状门禁已退役 #1653；当前映射见 `docs/governance/verifier-map.md` 的 OIDC 行，真实流验证不是 CI 静态门禁） |
| Performance/leak path | 机器门禁 `scripts/verify/verify-backend-perf-leak-gates.py` plus behavior test for the same path（旧证据分类见 [../archives/reference/backend-performance-gates.md](../archives/reference/backend-performance-gates.md)，已归档） |

## Related

- [02-edge-server.md](02-edge-server.md) — Edge execution owner
- [04-frontend-data-flow.md](04-frontend-data-flow.md) — shared client consumption
- [../api-reference.md](../api-reference.md) — API entry
