# AgentHub 开发快速上手

最后更新：2026-08-09

本文档只保留新人启动本地开发环境需要的最短路径。规则、分支、E2E 证据等级和发布门禁以 `AGENTS.md` 为准。

## 前置条件

| 工具 | 用途 |
|---|---|
| Go 1.26+ | Hub Server / Edge Server |
| Node.js 20+ + corepack | pnpm workspace 和前端构建 |
| PostgreSQL 16+ | Hub 数据库 |
| Redis 7+ | Hub cache/session |
| Git 2.40+ | 分支和 worktree |
| Rust + Tauri CLI | 仅 Desktop native/packaging 工作需要 |
| Playwright browsers | 仅 E2E/UI 工作需要 |

## 获取代码

```bash
git clone https://github.com/TokenDanceLab/AgentHub.git
cd AgentHub
git checkout master
git pull --ff-only
```

新工作优先用 `.worktrees/`：

```bash
git worktree add .worktrees/my-topic -b feat/my-topic
```

## 环境配置

```bash
cp .env.example .env
```

至少确认（名称以仓库根 `.env.example` 为准）：

- `AGENTHUB_DB_HOST`, `AGENTHUB_DB_PORT`, `AGENTHUB_DB_USER`, `AGENTHUB_DB_PASSWORD`
- `AGENTHUB_REDIS_HOST`, `AGENTHUB_REDIS_PORT`
- `AGENTHUB_JWT_SECRET`（开发环境也使用足够长度的随机值，至少 32 字符）
- TokenDance ID OIDC 仅在测试真实登录时配置：`AGENTHUB_TOKENDANCE_ID_ISSUER_URL`、`AGENTHUB_TOKENDANCE_ID_CLIENT_ID`、`AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET`、`AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS`
- 安全开关/前端入口：`AGENTHUB_AUTH_FAIL_CLOSED`（生产建议 `true`，见 [05-deployment.md](architecture/05-deployment.md) §安全配置）、`VITE_EDGE_URL`、`VITE_HUB_URL`（Desktop renderer 指向 Edge/Hub，见 `.env.example` §Desktop）

本地依赖可以用 Docker Compose：

```bash
docker compose up -d postgres redis
```

## 启动服务

Hub Server：

```bash
cd hub-server
go run ./cmd/server-hub
curl http://127.0.0.1:8080/health
```

Edge Server：

```bash
cd edge-server
go run ./cmd/agenthub-edge
curl http://127.0.0.1:3210/v1/health
```

前端依赖在 monorepo 根装一次（推荐）：

```bash
cd app
corepack enable
corepack pnpm install
```

Web：

```bash
cd app/web
corepack pnpm dev
```

Web 监听 `127.0.0.1:5174`。

Desktop renderer：

```bash
cd app/desktop
corepack pnpm dev
```

Desktop renderer 监听 `127.0.0.1:5173`。这只证明 Vite renderer，不证明 Tauri sidecar、sqlite、icon、installer 或 signing。

完整 Tauri 开发模式：

```bash
cd app/desktop
corepack pnpm tauri dev
```

Mobile RN 当前只保持 required gate 边界清楚；不要在 Desktop/Web 任务里顺手做 Mobile UI/native 深改。

## 登录模式

开发默认可以使用 demo/mock 或 fixture 数据。真实 Hub 登录必须走 TokenDance ID OIDC，并按 real E2E 证据等级说明是否真的跑了浏览器授权码流、Hub session、Desktop/Web token storage 和 WebSocket reconnect。

常用 OIDC 变量（与 `.env.example` 一致）：

```bash
AGENTHUB_TOKENDANCE_ID_CLIENT_ID=<client-id>
AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET=<client-secret>
AGENTHUB_TOKENDANCE_ID_ISSUER_URL=http://127.0.0.1:3000
```

不要把 third-party provider token、TokenDance API key、callback code、session token 或真实日志写入仓库文档。

## 测试速查

后端：

```bash
cd edge-server; go test ./... -short -count=1
cd ../hub-server; go test ./... -short -count=1
```

前端：

```bash
cd app/desktop; corepack pnpm test; corepack pnpm typecheck
cd ../web; corepack.cmd pnpm typecheck; corepack.cmd pnpm exec vite build
```

文档/API：

```bash
python scripts/verify/verify-doc-ssot.py
python scripts/verify/verify-project-skills.py
python scripts/verify/verify-real-e2e-contract.py
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
git diff --check
```

E2E/Visual QA 只证明实际跑过的层级。按 `scripts/verify/verify-real-e2e-contract.py` 的证据等级选择 gate，并在 PR 中写清楚 `fixture-unit`、`playwright-ui`、`visual-qa`、`stubbed-hub`、`observed-local`、`approved-real` 或 `packaged-release`。

## 常见问题

| 问题 | 检查 |
|---|---|
| Hub 连接数据库失败 | PostgreSQL 是否启动，`.env` 数据库变量是否匹配 |
| Edge 3210 被占用 | 查找残留进程后重新启动 |
| Hub WebSocket 连接失败 | 是否使用 Hub-issued session，CORS origin 是否允许当前前端端口 |
| 只改前端是否需要 Rust | 不需要；只有 Tauri native 或 packaging 工作需要 Rust |
| OIDC 登录报 `redirect_uri not allowed` | `AGENTHUB_TOKENDANCE_ID_REDIRECT_URI`/`ALLOWED_REDIRECT_URIS` 与 TDID 侧 `oauth_clients.redirect_uris` 不同步；重开登录、清浏览器 session 后重试，见 [05-deployment.md](architecture/05-deployment.md) §OIDC 回调契约 |
| 接口 429/503 `rate_limited`/`rate_limit_unavailable` | Redis 故障或超配额；429 带 `Retry-After` 须遵守；503 多为 Redis 中断（认证路径恒 fail-closed），见 [conventions.md](../api/conventions.md) §Errors |
| 启动报 JWT secret 弱被拒 | `change-me-production*`/`dev-secret-change-in-production*` 前缀被 blocklist 拒；换随机 ≥32 字符值 |

## 发布 tag SOP

唯一发布入口：本地打 tag → `git push origin <tag>` → `.github/workflows/release.yml` 触发构建并出 GitHub Release。旁路入口 cd-desktop.yml 与 `scripts/release/release.ps1` 已于 2026-08-02 删除。

1. 前置：master 全绿；版本号与 `app/desktop/package.json`、`app/desktop/src-tauri/tauri.conf.json`、`app/desktop/src-tauri/Cargo.toml` 一致（校验见 `scripts/release/verify-release-gate.py`）。
2. 版本选择（规则见 AGENTS.md §12）：常规发布默认升 patch；升 minor 需产品级理由；RC 走 `vX.Y.Z-rc.N`。
3. 打 tag：`git tag vX.Y.Z`（正式）或 `vX.Y.Z-rc.N`（候选）；commit 必须在 master 祖先链上，格式须匹配 `^v\d+\.\d+\.\d+(-rc\.\d+)?$`（release.yml tag-guard 双重守卫）；`git push origin <tag>` 后 release.yml 构建出包并发布。
4. 产物门控：build-desktop（Windows NSIS + portable）恒定；macOS 桌面已停用（2026-08-11，无 Apple 开发者账号/公证）；build-mobile（Android APK）由 `RELEASE_MOBILE_ENABLED=true` 门控。签名策略：无商业证书时设 `RELEASE_UNSIGNED_OK=true` 发布 unsigned Windows 包（SmartScreen 提示、updater 自签正常）；有证书后用 `RELEASE_SIGNING_APPROVED=true`。Release 内容：git-cliff 自动生成中英双语 changelog（`cliff.toml`，breaking 高亮）与 `SHA256SUMS`，标题 `AgentHub vX.Y.Z`。

冻结开关：`scripts/release/verify-release-gate.py` 末尾两条无条件 Blocker（signing/notarization 审批）是发布冻结开关，等管理员批准后再发布；不是常规门禁，不得按"永远红"误判为故障。
