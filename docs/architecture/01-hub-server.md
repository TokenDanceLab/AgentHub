# Hub Server

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-06-27

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
| Business logic | `hub-server/internal/service/` |
| Persistence | `hub-server/internal/repository/`, `hub-server/internal/model/` |
| WebSocket frames | `hub-server/internal/ws/frame.go` |
| Event fanout | `hub-server/internal/app/events.go` |
| Config | `hub-server/internal/config/`, `hub-server/configs/`, `.env.example` |
| Migrations | `hub-server/migrations/` |

## Contract Map

| 契约 | Owner |
|---|---|
| REST path/schema | `api/openapi.yaml` |
| WS frame/event families | `api/events.md` |
| API conventions | `api/conventions.md` |
| Auth/identity | [06-auth-identity.md](06-auth-identity.md) |
| Deployment boundary | [05-deployment.md](05-deployment.md) |
| Security risk status | [../governance/security-risk-register.md](../governance/security-risk-register.md) |

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
| Auth/session | OIDC/session tests + `scripts/verify-oidc-readiness.ps1` if config shape changed |
| Performance/leak path | [../../scripts/load-test-scenarios.md](../../scripts/load-test-scenarios.md) plus behavior test for the same path |

## Related

- [02-edge-server.md](02-edge-server.md) — Edge execution owner
- [04-frontend-data-flow.md](04-frontend-data-flow.md) — shared client consumption
- [../api-reference.md](../api-reference.md) — API entry
