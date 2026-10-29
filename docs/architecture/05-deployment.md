# Deployment

> 子文档 | 主索引：[architecture.md](../architecture.md)
> 最后更新：2026-10-23

本文件记录仓库内可维护的部署结构和证据边界；实际运行环境由部署方提供。

## Current production pointer

- **In-repo production shape**：`deployments/production/docker-compose.yml`。
- **构建输入目录**：`hub-server/deployments/` 只保留 Dockerfile、entrypoint 和 README。

## 仓库内资产

| 资产 | 用途 |
|---|---|
| `docker-compose.yml` | 本地开发：PostgreSQL、Redis、Hub Server |
| `deployments/production/docker-compose.yml` | 生产形状 compose 模板（唯一 in-repo 模板） |
| `deployments/production/.env.example` | 生产 env 占位模板 |
| `hub-server/deployments/{Dockerfile,docker-entrypoint.sh,README.md}` | Hub 镜像构建输入 |
| `scripts/dev/devserver.sh` | 维护者远程测试环境入口（sync/start/stop/status/test/integration；在远端启动依赖容器、Hub 和 Edge） |
| `scripts/verify/verify-deployment-shape.py` | 部署形状 SSOT 门禁 |
| `.github/workflows/cd-pr-check.yml` | PR 前置：compose 形状 SSOT + `docker compose config` 插值 + 镜像构建 dry run |

`verify-deployment-shape.py` fail-closed：`hub-server/deployments/` 下出现任何 compose 文件，或 `deployments/production/` 出现第二份手维护 compose，即 FAIL。

## 本地开发

```powershell
docker compose up -d
```

| 服务 | 端口 |
|---|---:|
| Hub API | 8080 |
| Hub admin / pprof / metrics | 6060 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| Desktop/Tauri Vite | 5173 |
| Web Vite | 5174 |
| Mobile RN Expo Web | 5177 |
| Local Edge | 3210 |

默认 compose 绑定开发本机；远程调试必须显式配置网络和防火墙，不能把默认开发密码或 admin 端口暴露出去。

TokenDance Account 是外部 OIDC provider。Hub 只通过配置的公开 issuer 发现 authorization、token、UserInfo 和 JWKS endpoint，不在本地启动、也不读取 Account 内部管理服务或数据库。

## 部署证据等级

| Claim | 最低证据 |
|---|---|
| Compose 配置形状正确 | `docker compose config` 或 CI compose check |
| Account OIDC 配置形状正确 | OIDC/session unit、fixture 和 config tests；只能证明解析、拒绝和接线 |
| 真实 Account 登录 | 真实 Account issuer + 浏览器 Authorization Code + PKCE + UserInfo + Hub session；fixture/stubbed Hub 不算 L3 |
| Hub/Edge API 行为正确 | 相关 Go handler/service tests + OpenAPI parse |
| Web/Desktop UI 流程正确 | Playwright UI + Visual QA，按证据等级标注 |
| Desktop packaged 行为正确 | Tauri package/sidecar/icon/installer evidence |
| 生产发布正确 | 运维方发布 gate + live smoke + rollback evidence |

Stub、fixture、readiness-only 或 dry-run 证据必须保留 `real_tested=false`。

## Backend performance and leak evidence

`scripts/verify/verify-backend-perf-leak-gates.py` 是行为门禁与短微基准的 CI 执行者：

```bash
python ./scripts/verify/verify-backend-perf-leak-gates.py --Benchtime 100ms
```

| 证据类 | 证明 | 不证明 |
|---|---|---|
| Behavior gate | 并发、取消、TTL、重试、背压行为 | 延迟基线、容量、goroutine/进程泄漏 |
| Microbenchmark | 本地 CPU/alloc 回归信号 | 生产容量、长时间稳定性 |
| Load smoke | 单端点可达性、延迟、错误率 | WS fanout、Agent dispatch、DB 争用、泄漏 |
| Pprof/leak evidence | 压力下特定路径的 goroutine/heap/进程变化 | 未配套行为测试时的功能正确性 |

`scripts/smoke/load-test.sh` 只覆盖单 HTTP 端点（默认 `/health`）的可达性、延迟分位、吞吐和非 2xx 率；OIDC、WS fanout、消息顺序、dispatch 并发、进程泄漏和生产容量需要各自的 evidence。性能结论必须绑定实际运行的命令。

## 生产边界

发布前需要：镜像 digest、部署命令、rollback 方案和备份状态；secret 通过 secret store 注入；Account OIDC 配置完整；`/health`、CORS、OIDC callback、WebSocket upgrade 和 admin exposure smoke；声明 Desktop packaged/release 时附 packaged-release gate。

## 安全配置

生产 compose 模板默认开启两项 fail-closed 开关，二者都依赖 Redis，决定 Redis 故障时的对外行为。本节是仓库内 SSOT；实际部署是否启用以部署环境为准。

| 环境变量 | 默认 | 语义 |
|---|---|---|
| `AGENTHUB_AUTH_FAIL_CLOSED` | Go 默认 `false`；dev 与生产 compose 均为 `true`；生产守卫要求显式设置 | access-token jti 黑名单检查在 Redis 错误时的行为。`true`=拒绝请求，防止已吊销的 JWT 在 Redis 中断时复活；`false`=放行以保留历史行为。 |
| `AGENTHUB_RATE_LIMIT_FAIL_OPEN` | Go 默认 `true`；dev 与生产 compose 均为 `false` | 非认证限流器在 Redis 错误时的行为。`true`=放行并写 warn + `X-Rate-Limit-Degraded: true`；`false`=503 `rate_limit_unavailable`。**认证路径**（`/client/auth/*`）始终 fail-closed。 |

Redis 故障时对外行为：认证路径始终 503 `rate_limit_unavailable`，且 `AUTH_FAIL_CLOSED=true` 时 jti 检查拒绝 → 401；非认证路径按开关返回放行或 503；正常限流命中返回 429 `rate_limited` + `Retry-After`（全局限流固定 60，路径级为 key 剩余 TTL），WS 连接限流返回 429 `ws_rate_limited`。`code` 与 HTTP 状态完整对照见 [../../api/conventions.md](../../api/conventions.md) §Errors；开关常量见 `hub-server/internal/config/constants.go`。

## Account OIDC 契约

Hub 是 TokenDance Account 的 confidential OIDC client，只消费 issuer discovery 文档声明的公开 endpoint。Hub 不配置或调用 Account 管理 API、内部服务地址或数据库；authorization、token、UserInfo 和 JWKS endpoint 必须与配置 issuer 同源。

浏览器/客户端的 Account 回跳地址必须与 Account client 注册值精确一致：

| 回调 URI | 用途 |
|---|---|
| `http://127.0.0.1:53682/callback` | Desktop Tauri 固定 loopback callback |
| `http://localhost:5174/workbench/auth/account/callback` | Web 本地开发（默认 `/workbench/` base） |
| `http://127.0.0.1:5174/workbench/auth/account/callback` | Web 本地开发（默认 base，IPv4） |
| `http://localhost:5174/auth/account/callback` | Web 本地开发（`VITE_BASE_PATH=/`） |
| `http://127.0.0.1:5174/auth/account/callback` | Web 本地开发（根 base，IPv4） |
| `https://<hub-host>/workbench/auth/account/callback` | 生产 Web |

Desktop/native 的机器侧入口是 `POST /client/auth/oidc/authorize` 和 `POST /client/auth/oidc/callback`；Web 使用 `/client/auth/browser/authorize`、`/callback` 和 `/session`。浏览器回跳地址不是 Hub code-exchange handler；旧的 GET callback 不属于当前契约。

Web 与 API 必须联合启用浏览器会话：配置精确 public origin、登录 callback 和固定的 `/client/auth/browser/logout/account/callback`，代理保留 Host 并直接转发 `/client/auth/*`。Account client 还须登记 `/client/auth/oidc/backchannel-logout`，不需要浏览器 token endpoint CORS。更换 client 时保留所有仍支持的 native callback，旧 client 或未绑定 client 的 Hub 会话需要重新登录；稳定 `(issuer, subject)` 与产品数据不变。

0079 是附加迁移，但撤销世代是持久安全事实。激活后不能用不检查 generation/client 的旧 API 作为安全回滚，不可用全库恢复覆盖新数据。恢复期间保留新 API 的撤销校验、schema 和浏览器 bearer 拒绝边界；Web 必要时只显示维护状态，不回退到浏览器 token 存储，Desktop 仍按 native 合同重新登录。正常恢复优先修复并前滚。生产镜像切换前要验证这条恢复路径，详见 [06-auth-identity.md](06-auth-identity.md)。

`AGENTHUB_ACCOUNT_OIDC_REDIRECT_URI` 提供主 callback，`AGENTHUB_ACCOUNT_OIDC_ALLOWED_REDIRECT_URIS` 只列额外精确候选。token 和 JWKS endpoint 由 discovery 解析，不提供旧 provider 的 token URL、JWKS URI 或 issuer 启动步骤。

## 必填变量表

启动顺序：`redis` healthcheck 通过 → `hub-server` 启动 → `docker-entrypoint.sh` 校验 `AGENTHUB_DB_PASSWORD` 与 `AGENTHUB_JWT_SECRET` 非空 → `config.Load`/`config.Validate` → `InitDB` → `RunMigrations`（自动执行 `hub-server/migrations/*.up.sql`）→ `InitRedis` → `app.Run`。`AGENTHUB_ENV=production` 时缺少完整 Account OIDC client 配置会在迁移前直接失败。

| 变量 | 必填 | 校验点 | 说明 |
|---|---|---|---|
| `PG_PASSWORD`（→ `AGENTHUB_DB_PASSWORD`） | 是 | `docker-entrypoint.sh` | DB 密码；容器路径缺失即 exit 1（`config.Validate` 不校验密码）。 |
| `PG_HOST`（→ `AGENTHUB_DB_HOST`） | 是（默认 `127.0.0.1`） | `config.Validate` | **只写主机，不带端口**；端口走 `PG_PORT`。 |
| `PG_PORT`（→ `AGENTHUB_DB_PORT`） | 是（默认 `5433`） | `config.Validate`（1–65535） | 独立于 host。 |
| `AGENTHUB_JWT_SECRET` | 是 | entrypoint + `config.Validate`（≥32 字符且不在弱密钥 blocklist） | `change-me-production*` / `dev-secret-change-in-production*` 前缀被拒绝。 |
| `AGENTHUB_ACCOUNT_OIDC_ISSUER_URL` | production 是；非 production 可由整组 OIDC 留空关闭 | `config.Validate` | Account 公开 issuer；必须是无凭据、query、fragment 的绝对 URL，非 loopback 使用 HTTPS。 |
| `AGENTHUB_ACCOUNT_OIDC_CLIENT_ID` | production 是 | 同上 | confidential AgentHub OIDC client ID。 |
| `AGENTHUB_ACCOUNT_OIDC_CLIENT_SECRET` | production 是 | 同上 | 仅在 Hub 服务端 token exchange 使用；至少 32 字符且拒绝占位值。 |
| `AGENTHUB_ACCOUNT_OIDC_REDIRECT_URI` | production 是 | 同上 | 主 callback；必须与 Account client 注册值精确一致。 |
| `AGENTHUB_ACCOUNT_OIDC_ALLOWED_REDIRECT_URIS` | 否 | handler + config validation | 逗号分隔的额外精确 callback；只加真实客户端需要的地址。 |
| `AGENTHUB_BROWSER_SESSION_ORIGIN` | Web cookie lane 是 | config validation | 精确公共 HTTPS origin；未设置时不注册 browser-session 路由。 |
| `AGENTHUB_BROWSER_SESSION_REDIRECT_URI` | Web cookie lane 是 | config validation | 同源登录 callback，必须在 Account/Hub allowlist 中。 |
| `AGENTHUB_BROWSER_SESSION_POST_LOGOUT_REDIRECT_URI` | Web cookie lane 是 | config validation | 固定同源 `/client/auth/browser/logout/account/callback`，在 Account 注册。 |
| `AGENTHUB_BROWSER_SESSION_SECURE` / `_TTL` | 默认 `true` / `12h` | config validation | 生产不能关闭 Secure；绝对 TTL 大于零且不超过 24h，无滑动续期。 |
| `AGENTHUB_AUTH_FAIL_CLOSED` | 生产必填（显式设置）；dev compose 默认 `true` | `validateProdGuard` 拒绝未设置的生产启动；`AuthFailClosed()` 决定 Redis 故障时的 jti 检查行为 | 见 §安全配置。 |
| `AGENTHUB_RATE_LIMIT_FAIL_OPEN` | 否（生产建议 `false`） | `RateLimitFailOpen()` | 见 §安全配置。 |

迁移自动执行意味着升级镜像会一起跑新迁移。`0062`、`0063` 使用普通 `CREATE INDEX` / `CREATE UNIQUE INDEX`（非 `CONCURRENTLY`），在已堆积数据的表上会取 `SHARE` 锁阻塞写入但允许读取；大表升级应在维护窗口执行。详见 [../../CHANGELOG.md](../../CHANGELOG.md) v0.6.1 节的升级注意段。

## 配置面索引

必填/强校验变量见上表；以下变量有行为影响。

| 变量 | 服务 | 默认 | 语义 |
|---|---|---|---|
| `AGENTHUB_PPROF_USER` / `PASS`、`AGENTHUB_CORS_ORIGINS`、`AGENTHUB_ADMIN_USERS` | hub | 空 | debug 门禁（未配=404）、CORS 白名单覆盖、管理端点用户白名单。CORS 只接受精确 HTTP(S) origin，禁止 `*`、凭据、路径、query 和 fragment；production 只接受公网 HTTPS，保留 `https://tauri.localhost` 给 Tauri 自定义协议 |
| `AGENTHUB_AGENT_TEAM_*`（9 字段） | hub | 见 `config_agent_team.go` | delegation depth、subagents、route repeats、budget、compete、human review |
| `AGENTHUB_EGRESS_*` | hub | 见 `config.yaml` | allow CIDRs/hostnames/plain HTTP/timeout（见 08-outbound-http.md）。Edge 没有独立 allowlist：出站目标是部署方配置的 Hub URL 与用户配置的模型 baseURL，统一受 edgehttp/SDK 的 timeout、redirect、TLS 合同约束 |
| `AGENTHUB_UPLOAD_*` / `AGENTHUB_S3_*`（+裸 `S3_*` legacy） | hub | 见 config | 上传目录/大小/MIME；对象存储后端 |
| `AGENTHUB_ACCOUNT_OIDC_HTTP_TIMEOUT` / `_MAX_RESPONSE_BODY_BYTES` | hub | `10s` / `64 KiB` | Account discovery、token、UserInfo、JWKS 的统一超时与 fail-closed 响应体上限 |
| `AGENTHUB_MAX_CLOUD_EDGE_DEVICES` | hub | `50` | 每用户 `cloud_edge` 设备上限；超限新 `device_id` 返回 403 `device_limit_exceeded`；`<=0` 关闭上限 |
| `AGENTHUB_EVIDENCE_GATE_ENABLED`、`AGENTHUB_FAULT_ESCALATION_ENABLED`、`AGENTHUB_ESCALATION_TIMEOUT` | edge | `true` / 见 config | Edge 证据门禁与故障升级 |
| `AGENTHUB_EVENT_WORKERS`、`AGENTHUB_DELIVERY_JOURNAL_DB` | edge | `4` / 空（关闭） | 事件总线 worker 数、durable journal 开关 |
| `AGENTHUB_DEPLOY_HOST` / `_PATH`、`AGENTHUB_PAGES_DOMAIN` | edge | `HOST`/`PATH` 默认空；`PAGES_DOMAIN` 默认 `example.agenthub.dev` | Pages 部署目标；`HOST`/`PATH` 为空时部署接口返回未配置（服务启动不强制校验） |
| `AGENTHUB_EDGE_SHUTDOWN_TIMEOUT` | edge | `10s` | 优雅停机总预算 |
| `AGENTHUB_HUB_MCP_SYNC_URL` / `_INTERVAL` | edge | URL 空（关闭）/ `5m` | Hub MCP 配置同步 |

生产 compose 模板默认 `PG_SSLMODE=require` 并注入 `AGENTHUB_ENV=production`；`config.Validate` 在 production guard 下拒绝 `db.sslmode=disable`。升级已有部署前确认宿主 PostgreSQL 接受 TLS；本地/测试环境应显式使用非 production 的 `AGENTHUB_ENV` 或调整 `PG_SSLMODE`。

## 迁移回滚约定

GitHub Release 的 `agenthub-hub-*` 二进制把 migrations embed 在二进制内，配置可完全来自 `AGENTHUB_*` 环境变量（缺少 `configs/config.yaml` 也合法）；运行时只需 PostgreSQL/Redis 连接。容器镜像仍是推荐部署形态。

- **Down 语义**：`DROP TABLE` / `DROP COLUMN` 等于数据丢失，down 不保留被删数据；回滚前必须 `pg_dump` 完整备份。
- **外键与占位行**：部分 down 重建 FK（如 0016 的 `fk_workspaces_device`），要求被引用表存在对应行；`ON CONFLICT DO NOTHING` 不抑制 NOT NULL 违规。
- **dirty 状态**：down 中途失败会置 `schema_migrations.dirty=true`，阻断后续迁移。恢复：修复根因 → `UPDATE schema_migrations SET dirty=false` → 重试 down 或 force 到安全版本。
- **早期迁移禁止重跑**：0001–0068 多数 up 非幂等；dirty 无法修补时从备份恢复，不要手动重跑早期 up。0069+ 使用幂等语法（`IF NOT EXISTS`、`DO $$ ... END $$`），但不对历史迁移追溯改造。
- **操作清单**：`pg_dump -Fc` → 确认 `version/dirty` → 阅读目标 `.down.sql` 的 FK/NOT NULL 依赖 → 预置占位行 → 维护窗口执行 down → 验证版本与 `dirty=false` → 应用层冒烟。

## 相关文档

- [01-hub-server.md](01-hub-server.md) — Hub Server 架构
- [02-edge-server.md](02-edge-server.md) — Edge Server 架构
- [06-auth-identity.md](06-auth-identity.md) — Account OIDC、身份绑定和 Hub session
- [../../AGENTS.md](../../AGENTS.md) — 执行 gate 和项目规则
- `scripts/verify/verify-real-e2e-contract.py` — 真实 E2E 证据等级（内嵌规范）
