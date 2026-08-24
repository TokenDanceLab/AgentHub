# Deployment

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-08-09

本文件只记录仓库内可维护的部署结构和证据边界。Live host、DNS、TLS、secret、机器路径、发布状态和生产回滚记录由 TokenDance server SSOT 维护，不在本仓库复制。

## Current production pointer

- **Live facts（权威）**：私有部署仓 SSOT。本仓库不复制 host 标签、secret 或 IP。
- **In-repo production shape**：`deployments/production/docker-compose.yml`（与 live compose 形状对齐的仓库模板）。
- **构建输入目录**：`hub-server/deployments/` 仅保留镜像构建输入（Dockerfile、docker-entrypoint.sh、README.md），旧区域部署资产已在 #1527 PR2 收口删除。

## 仓库内资产（#1527 inventory）

| 资产 | 用途 | 状态 |
|---|---|---|
| `docker-compose.yml` | 本地开发：PostgreSQL、Redis、Hub Server | local-development shape（#1527 明确不删） |
| `deployments/production/docker-compose.yml` | 当前生产形状 compose 模板 | **权威 in-repo production shape**（唯一） |
| `deployments/production/.env.example` | 权威生产 env 占位模板（含 OIDC 回调/交换端点说明） | 保留 |
| `hub-server/deployments/Dockerfile` | Hub Server 镜像构建输入 | 保留（构建职责） |
| `hub-server/deployments/docker-entrypoint.sh` | 镜像 ENTRYPOINT（Dockerfile COPY 的构建输入） | 保留（构建职责） |
| `hub-server/deployments/README.md` | 构建输入目录说明 | 保留（#1527 PR2 精简） |
| `hub-server/deployments/docker-compose.prod.yml` | 旧独立 PG+Redis 拓扑模板 | **已删除**（#1527 PR2 收口） |
| `hub-server/deployments/docker-compose.us1.yml` | 区域（us1）旧模板 | **已删除**（#1527 PR2 收口） |
| `hub-server/deployments/legacy/`（compose、deploy 脚本、nginx/env 模板） | 区域旧部署资产 | **已删除**（#1527 PR2 收口） |
| `hub-server/deployments/Caddyfile` / `Caddyfile.prod` | 旧 reverse-proxy 模板 | **已删除**（#1527 PR2 收口） |
| `hub-server/deployments/.env.production.example` | 旧生产 env 占位模板 | **已删除**（env 说明迁至 `deployments/production/.env.example`） |
| `hub-server/deployments/deploy.sh` / `deploy-region.sh` | 旧人工运维胶水脚本 | **已删除**（部署指引改指权威 compose，运维由 server SSOT 覆盖） |
| `scripts/dev/devserver.sh` | 远程 dev 服务器测试平台统一入口（sync/start/stop/status/test） | 新增（#1681，拓扑见 09-dev-server-topology.md） |
| `scripts/verify/verify-deployment-shape.py` | 部署形状 SSOT 门禁 | CI 强制（#1527 PR1） |
| `.github/workflows/cd-pr-check.yml` | PR 前置：compose 形状 + Dockerfile + 构建 dry run | 消费权威模板（#1527 PR1） |

遗留清单由 `verify-deployment-shape.py` 关闭：#1527 PR2 后 `hub-server/deployments/` 下出现**任何** compose 文件即 FAIL（该目录只剩构建输入）；`deployments/production/` 下出现第二份手维护 production compose 同样 FAIL——机器证明见 `scripts/verify/tests/verify-deployment-shape.Tests.py`。

## 本地开发

```powershell
docker compose up -d
```

默认端口：

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
| TokenDance ID（外部服务，非本 compose；远程 dev 服务器 start.sh） | 3000 |

默认 compose 绑定开发本机；远程调试必须显式配置网络和防火墙，不能把默认开发密码或 admin 端口暴露出去。

## 部署证据等级

| Claim | 最低证据 |
|---|---|
| Compose 配置形状正确 | `docker compose config` 或 CI compose check |
| OIDC 配置形状正确 | OIDC/session tests + L3 真实 OIDC 流（远程 dev 服务器入口 `scripts/dev/devserver.sh`；WSL 本机 `scripts/e2e/wsl-full-stack-e2e.sh`），当前映射见 `docs/governance/verifier-map.md` 的 OIDC 行；真实 E2E lane（`scripts/e2e/run-real-e2e-lane.sh`，workflow_dispatch `real-e2e-stack`，evidence manifest 六字段合同） |
| Hub/Edge API 行为正确 | 相关 Go handler/service tests + OpenAPI parse |
| Web/Desktop UI 流程正确 | Playwright UI + Visual QA，按证据等级标注 |
| Desktop packaged 行为正确 | Tauri package/sidecar/icon/installer evidence |
| 生产发布正确 | 外部 approved-real 发布 gate + live smoke + rollback evidence |

Stub、fixture、readiness-only 或 dry-run 证据必须保留 `real_tested=false`。

## 生产边界

生产发布不由本仓库 Markdown 单独证明。发布前至少需要：

- 明确审批。
- 镜像 digest、部署命令、rollback 方案和备份状态。
- secret store 注入，不把 secret 写进 repo。
- `/health`、CORS、OIDC callback、WebSocket upgrade 和 admin exposure smoke。
- 若声明 Desktop packaged/release，附 packaged-release gate；Vite renderer 测试不等同于 packaged Desktop。

## 安全配置（Wave7）

生产 compose 模板（`deployments/production/docker-compose.yml`）默认开启两项 fail-closed 开关，二者都依赖 Redis，决定 Redis 故障时的对外行为。本节是这两个开关的仓库内 SSOT；live host 是否启用以 server SSOT 为准。

| 环境变量 | 默认 | 语义 |
|---|---|---|
| `AGENTHUB_AUTH_FAIL_CLOSED` | `false`（dev）；生产模板置 `true` | access-token jti 黑名单检查（Redis-backed）在 Redis 错误时的行为。`true`=fail-closed：拒绝请求，防止已登出（吊销）的 access JWT 在 Redis 中断时复活；`false`=fail-open：放行以保留历史行为，避免 Redis 中断锁死所有用户。 |
| `AGENTHUB_RATE_LIMIT_FAIL_OPEN` | `true`（dev）；生产模板置 `false` | 非认证限流器在 Redis 错误时的行为。`true`=fail-open：放行并写 warn 日志、置响应头 `X-Rate-Limit-Degraded: true`；`false`=fail-closed：返回 503 `rate_limit_unavailable`。**认证路径**（`/client/auth/*`）始终 fail-closed，与本开关无关。 |

Redis 故障时对外暴露的 HTTP 状态/`code`：

- **认证路径**（登录/注册/OIDC 回调等）：始终 503 `rate_limit_unavailable`，且 access-token jti 检查在 `AUTH_FAIL_CLOSED=true` 时也拒绝 → 401。运维侧不应在 Redis 故障窗口强行重放登录，会持续 503。
- **非认证路径**：
  - `RATE_LIMIT_FAIL_OPEN=true`（dev 默认）：请求放行，响应头带 `X-Rate-Limit-Degraded: true`；不会产生 429/503。
  - `RATE_LIMIT_FAIL_OPEN=false`（生产默认）：返回 503 `rate_limit_unavailable`。
- **正常限流命中**（Redis 健康，超出配额）：429 `rate_limited`，响应头带 `Retry-After: 60`（`GlobalRateLimitRetryAfterSeconds`）；WS 连接限流返回 429 `ws_rate_limited`，无 `Retry-After`。

`code` 与 HTTP 状态的完整对照见 [../../api/conventions.md](../../api/conventions.md) §Errors。开关常量定义见 `hub-server/internal/config/constants.go`（`AuthFailClosedDefault`、`RateLimitFailOpenDefault`、`GlobalRateLimitRetryAfterSeconds`），运行时读取见 `hub-server/internal/config/config_env.go`。

## OIDC 回调契约

TokenDance ID（TDID）OIDC 回调有三条浏览器/原生回跳地址，外加一条机器侧入口。三条回调集合必须与 TDID 侧 `oauth_clients.redirect_uris` 同步（live 注册见 server identity STATE.md）。

| 回调 URI | 用途 |
|---|---|
| `https://hub.tokendancelab.com/api/auth/callback` | 首页 SPA 回调页（nginx `/api/auth/` 反代到 `:3001` 静态站） |
| `https://hub.tokendancelab.com/workbench/auth/tokendance/callback` | 工作台 `app/web`（`BASE_URL=/workbench/`） |
| `http://127.0.0.1/callback` | 桌面 Tauri loopback（RFC 8252 端口宽松匹配，用于桌面客户端） |

Hub 侧 code 交换端点固定为 `POST /client/auth/oidc/callback`，桌面/Web/CLI 共用，**不是**浏览器回跳地址。

机器侧 code 交换（hub-server → TDID `/oidc/token`）与 JWKS 拉取（ID token 签名校验）走 **DNS-only 的 OIDC token 机器入口**（公开仓不写该 hostname，域名/解析 SSOT 在 TokenDance 私有治理文档）：

- 公网 `id.tokendancelab.com` 启用了 Bot Fight 挑战，会拦非 JS 客户端（hub-server 是服务端，拿不到 JS 挑战 cookie）。
- 该机器入口仅供服务端使用，**不是**面向浏览器的地址。
- 对应环境变量：`AGENTHUB_TOKENDANCE_ID_TOKEN_URL`、`AGENTHUB_TOKENDANCE_ID_JWKS_URI`（默认值已写进生产 compose 模板）。

回调集合通过 `AGENTHUB_TOKENDANCE_ID_REDIRECT_URI`（单值，必须是集合成员之一）和 `AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS`（逗号分隔白名单）注入；前者是默认回跳，后者是一次性 OIDC 往返里额外接受的回跳。OIDC client 注册与 secret 由 TokenDance ID 管理，禁止写入仓库。

## 必填变量表

下表是生产部署的必填/强校验变量。`docker compose up` 启动顺序与校验点：

1. `redis` 先起，healthcheck 等到 `redis-cli ping` 通过。
2. `hub-server` 起（`depends_on: redis: service_healthy`）。
3. `docker-entrypoint.sh` 先校验 `AGENTHUB_DB_PASSWORD` 与 `AGENTHUB_JWT_SECRET` 非空，空则 exit 1。
4. server 二进制依次：`repository.InitDB` → `repository.RunMigrations`（自动执行 `hub-server/migrations/*.up.sql`）→ `cache.InitRedis` → `app.Run`。迁移在服务接流量前自动跑，无需人工 `migrate up`。

| 变量 | 必填 | 校验点 | 说明 |
|---|---|---|---|
| `PG_PASSWORD`（→ `AGENTHUB_DB_PASSWORD`） | 是 | entrypoint + `config.Validate` | DB 密码。entrypoint 缺失即 exit 1。 |
| `PG_HOST`（→ `AGENTHUB_DB_HOST`） | 是（有默认 `127.0.0.1`） | `config.Validate`（`db.host is required`） | **只写主机，不带端口**。`DBConfig.DSN()` 不拆分 `host:port`，host 带端口会拼成 `host=127.0.0.1:<port> port=5433` 连不上。端口走 `PG_PORT`。 |
| `PG_PORT`（→ `AGENTHUB_DB_PORT`） | 是（有默认 `5433`） | `config.Validate`（1–65535） | 端口独立于 host。 |
| `AGENTHUB_JWT_SECRET` | 是 | entrypoint + `config.Validate`（≥32 字符，且不在弱密钥 blocklist） | JWT 签名密钥。`change-me-production*` / `dev-secret-change-in-production*` 前缀被 `weakSecretPrefixes` 拒绝，即使长度达标。 |
| `AGENTHUB_TOKENDANCE_ID_CLIENT_ID` | 配置 OIDC 即必填 | `config.Validate`（client_id 设了则 issuer_url/client_secret/redirect_uri 都必填） | TDID OIDC client。留空=未启用 OIDC。 |
| `AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET` | 配置 OIDC 即必填 | 同上 | TDID client secret，由 TDID 管理，不入仓库。 |
| `AGENTHUB_TOKENDANCE_ID_REDIRECT_URI` | 配置 OIDC 即必填 | 同上 | 默认 `https://hub.tokendancelab.com/api/auth/callback`，必须是 allowed 集合成员。 |
| `AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS` | 否（有默认三条） | — | 浏览器/原生回跳白名单，逗号分隔。改回调集合时必须与 TDID 侧 `oauth_clients.redirect_uris` 同步。 |
| `AGENTHUB_AUTH_FAIL_CLOSED` | 否（生产建议 `true`） | `AuthFailClosed()` | 见 §安全配置。 |
| `AGENTHUB_RATE_LIMIT_FAIL_OPEN` | 否（生产建议 `false`） | `RateLimitFailOpen()` | 见 §安全配置。 |

迁移自动执行意味着：升级到带新 `.up.sql` 的镜像时，容器一起新迁移。`hub-server/migrations/0062`、`0063` 等使用普通 `CREATE INDEX`/`CREATE UNIQUE INDEX`（非 `CONCURRENTLY`），在已堆积数据的表上会取 `ACCESS EXCLUSIVE` 锁；大表升级应在维护窗口执行（停服 → 跑迁移 → 起服），不要在流量高峰直接 `compose up`。详见 [../../CHANGELOG.md](../../CHANGELOG.md) Unreleased 的升级注意段。

## 相关文档

- [01-hub-server.md](01-hub-server.md) — Hub Server 架构
- [02-edge-server.md](02-edge-server.md) — Edge Server 架构
- [06-auth-identity.md](06-auth-identity.md) — TokenDance ID 和 Hub session
- [../../AGENTS.md](../../AGENTS.md) — 执行 gate 和项目规则
- `scripts/verify/verify-real-e2e-contract.py` — 真实 E2E 证据等级（内嵌规范）
