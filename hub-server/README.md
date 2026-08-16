# AgentHub Hub Server

最后更新：2026-08-16

Hub Server 是 AgentHub 的云端控制面：账号、IM、联系人/群聊、多端同步、设备路由、Edge 中继、Profile catalog 和审计。它不直接启动 Agent CLI；实际执行由 Edge Server 完成。

旧长版说明见 [../docs/history.md](../docs/history.md)。

## 职责

Hub 是云端控制面：Identity（TokenDance ID OIDC → Hub session）、AuthZ（Hub-local 权限）、IM、Agent routing、Audit。完整 Boundaries 表见 [docs/architecture/01-hub-server.md](../docs/architecture/01-hub-server.md)（SSOT）。

## 运行

开发 compose 从仓库根目录启动：

```powershell
docker compose up -d
```

只跑 Hub 进程：

```powershell
cd hub-server
go run ./cmd/server-hub
```

默认端口：Hub API `8080`，admin/pprof/metrics `6060`，PostgreSQL `5432`，Redis `6379`。

## 测试

```powershell
cd hub-server
go test ./... -short -count=1
```

涉及性能、goroutine、EventBus、outbox、scheduler、Redis TTL 或历史内存泄漏路径时，不要只跑功能测试；按 [../docs/reference/backend-performance-gates.md](../docs/reference/backend-performance-gates.md) 选择 behavior gate、microbenchmark、load smoke 或 pprof/leak 证据。

## Source Map

| 主题 | Owner |
|---|---|
| 入口装配 | `cmd/server-hub/main.go`, `internal/app/` |
| 路由注册 | `internal/router/router.go` |
| HTTP handler | `internal/handler/` |
| 业务事务 | `internal/service/` |
| 数据访问 | `internal/repository/`, `internal/model/` |
| WebSocket | `internal/ws/`, `internal/app/events.go` |
| 配置 | `internal/config/`, `configs/`, `.env.example` |
| 迁移 | `migrations/` |
| 部署资产 | `deployments/` |

## Contract Map

| 契约 | 位置 |
|---|---|
| REST API | `api/openapi.yaml` |
| WebSocket events | `api/events.md` |
| API conventions | `api/conventions.md` |
| Hub 架构 | `docs/architecture/01-hub-server.md` |
| Auth / TokenDance ID | `docs/architecture/06-auth-identity.md` |
| Deployment boundary | `docs/architecture/05-deployment.md` |
| Security risks | `docs/governance/security-risk-register.md` |

## Auth Boundary

Hub session 是 AgentHub 产品授权边界。TokenDance ID bearer middleware 只是一条兼容身份校验路径，不能替代 Hub refresh token、device proof、WebSocket session 或 Hub-local authorization。

`/client/ws` 只接受 Hub-issued HS256 access token。新增登录、session、device、permission 或 Edge callback 行为时，同步 `api/openapi.yaml`、`api/events.md`、`docs/architecture/06-auth-identity.md` 和相关测试。
