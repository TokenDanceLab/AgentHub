# AgentHub Hub Server

最后更新：2026-10-19

Hub Server 是 AgentHub 的云端控制面：TokenDance ID OIDC → Hub session、Hub-local 授权、IM、多端同步、设备路由、Edge 中继、Profile catalog 和审计。它不直接启动 Agent CLI；实际执行由 Edge Server 完成。完整 Boundaries 表见 [docs/architecture/01-hub-server.md](../docs/architecture/01-hub-server.md)（SSOT）。

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
go test ./... -short            # 复用 Go test cache
go test ./... -short -count=1   # 需要干净结果时
```

涉及性能、goroutine、EventBus、outbox、scheduler、Redis TTL 或历史内存泄漏路径时，不要只跑功能测试；按 [../docs/architecture/05-deployment.md](../docs/architecture/05-deployment.md) §Backend performance and leak evidence（门禁矩阵由 `scripts/verify/verify-backend-perf-leak-gates.py` 执行）选择 behavior gate、microbenchmark、load smoke 或 pprof/leak 证据。

## Source Map

| 主题 | 位置 |
|---|---|
| 入口 / 路由 / handler | `cmd/server-hub/main.go`, `internal/app/`, `internal/router/`, `internal/handler/` |
| 业务 / 数据 / WebSocket | `internal/service/`, `internal/repository/`, `internal/model/`, `internal/ws/` |
| 配置 / 迁移 / 部署 | `internal/config/`, `configs/`, `.env.example`, `migrations/`, `deployments/` |
| REST / WS 契约 | `api/openapi.yaml`, `api/events.md`, `api/conventions.md` |
| 架构 / 身份 / 部署 / 安全 | `docs/architecture/01-hub-server.md`, `docs/architecture/06-auth-identity.md`, `docs/architecture/05-deployment.md`, `SECURITY.md` |

## Auth Boundary

Hub session 是 AgentHub 产品授权边界。TokenDance ID bearer middleware 只是一条兼容身份校验路径，不能替代 Hub refresh token、device proof、WebSocket session 或 Hub-local authorization。

`/client/ws` 只接受 Hub-issued HS256 access token。新增登录、session、device、permission 或 Edge callback 行为时，同步 `api/openapi.yaml`、`api/events.md`、`docs/architecture/06-auth-identity.md` 和相关测试。

access jti 黑名单的 fail-open/fail-closed 行为矩阵（Redis 可达性 × `AGENTHUB_AUTH_FAIL_CLOSED`，补偿控制）由 `internal/middleware/auth_fail_closed_redis_test.go` 按生产接线（`*cache.Client` + 进程内 miniredis，无真实网络）守护。
