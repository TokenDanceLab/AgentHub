# AgentHub 开发快速上手

最后更新：2026-08-16

本文档只保留新人启动本地开发环境需要的最短路径。规则、分支、E2E 证据等级和发布门禁以 `AGENTS.md` 为准。

## 前置条件

| 工具 | 用途 |
|---|---|
| Go 1.26+ | Hub Server / Edge Server |
| Node.js 22+ + corepack | pnpm workspace 和前端构建 |
| PostgreSQL 16+ | Hub 数据库 |
| Redis 7+ | Hub cache/session |
| Git 2.40+ | 分支和 worktree |
| Rust + Tauri CLI；Playwright browsers | 仅 Desktop native/packaging 与 E2E/UI 工作需要 |

## 获取代码

```bash
git clone https://github.com/TokenDanceLab/AgentHub.git && cd AgentHub
git checkout master && git pull --ff-only
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
cd hub-server && go run ./cmd/server-hub
curl http://127.0.0.1:8080/health
```

Edge Server：

```bash
cd edge-server && go run ./cmd/agenthub-edge
curl http://127.0.0.1:3210/v1/health
```

前端依赖在 monorepo 根装一次（推荐）：

```bash
cd app && corepack enable && corepack pnpm install
```

Web：

```bash
cd app/web && corepack pnpm dev
```

Web 监听 `127.0.0.1:5174`。

Desktop renderer：

```bash
cd app/desktop && corepack pnpm dev
```

Desktop renderer 监听 `127.0.0.1:5173`。这只证明 Vite renderer，不证明 Tauri sidecar、sqlite、icon、installer 或 signing。

完整 Tauri 开发模式：

```bash
cd app/desktop && corepack pnpm tauri dev
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

E2E/Visual QA 只证明实际跑过的层级；PR 中写明证据等级（`fixture-unit`/`playwright-ui`/`visual-qa`/`stubbed-hub`/`observed-local`/`approved-real`/`packaged-release`）。

## 常见问题

| 问题 | 检查 |
|---|---|
| Hub 连接数据库失败 | PostgreSQL 是否启动，`.env` 数据库变量是否匹配 |
| Edge 3210 被占用 / Hub WS 连接失败 | 查残留进程后重启；确认 Hub-issued session 与 CORS origin 允许当前前端端口 |
| 只改前端是否需要 Rust | 不需要；只有 Tauri native 或 packaging 工作需要 Rust |
| OIDC 登录报 `redirect_uri not allowed` | `AGENTHUB_TOKENDANCE_ID_REDIRECT_URI`/`ALLOWED_REDIRECT_URIS` 与 TDID 侧 `oauth_clients.redirect_uris` 不同步；重开登录、清浏览器 session 后重试，见 [05-deployment.md](architecture/05-deployment.md) §OIDC 回调契约 |
| 接口 429/503 `rate_limited`/`rate_limit_unavailable` | Redis 故障或超配额；429 带 `Retry-After` 须遵守；503 多为 Redis 中断（认证路径恒 fail-closed），见 [conventions.md](../api/conventions.md) §Errors |
| 启动报 JWT secret 弱被拒 | `change-me-production*`/`dev-secret-change-in-production*` 前缀被 blocklist 拒；换随机 ≥32 字符值 |

## PR 合并规则

- 合入 master 仅用 **Squash and merge**（仓库已强制，合并自动删分支）；一个 PR 一个主题，合入后每主题一个 squash commit，禁止堆碎 commit。提交消息用 Conventional Commits（`type(scope): 摘要`，见 AGENTS.md §6）——git-cliff 按此自动生成 release changelog；合并后删分支与 `.worktrees/<topic>/`。

## 发布 tag SOP

唯一发布入口：本地打 tag → `git push origin <tag>` → release.yml 构建并出 GitHub Release。

1. 前置：master 全绿；`app/desktop/package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 版本一致（校验 `scripts/release/verify-release-gate.py`）。Linux 桌面构建可在发布前手动预检：`gh workflow run checks.yml` 跑 `desktop-linux-build`（`tauri build --no-bundle`，不产出安装包、不需签名密钥）。
2. 版本选择（AGENTS.md §12）：默认升 patch；升 minor 需产品理由；RC 走 `vX.Y.Z-rc.N`。
3. 打 tag：`git tag vX.Y.Z`；commit 须在 master 祖先链、格式 `^v\d+\.\d+\.\d+(-rc\.\d+)?$`（release.yml tag-guard 双重守卫）；`git push origin <tag>` 触发构建发布。
4. 产物与签名：build-desktop（Windows NSIS + portable）恒定；build-desktop-linux（AppImage + deb，GitHub Releases 手动更新，AppImage auto-updater 另记账债）恒定；macOS 桌面已停用（2026-08-11）；build-mobile 由 `RELEASE_MOBILE_ENABLED=true` 门控；无商业证书时设 `RELEASE_UNSIGNED_OK=true`（SmartScreen 提示、updater 自签），有证书后用 `RELEASE_SIGNING_APPROVED=true`。git-cliff 生成中英双语 changelog（`cliff.toml`）+ `SHA256SUMS`，标题 `AgentHub vX.Y.Z`。冻结开关：`verify-release-gate.py` 末尾两条无条件 Blocker 是发布冻结开关，等管理员批准后再发布；不是故障。
5. 发布后核对（run 全绿后）：`gh release view vX.Y.Z --json name,assets --jq '{name, assets: [.assets[].name]}'` 应含 14 个产物：`AgentHub_<ver>_x64-setup.exe` / `_x64-portable.zip` / `_x64-setup.exe.sig`、`AgentHub_<ver>_x86_64.AppImage` / `_amd64.deb`、updater `latest.json`、`agenthub-{edge,hub}-<ver>-{linux,windows,darwin}-amd64`（darwin 含 arm64）、`SHA256SUMS`；描述含安装指引/校验命令/commit 分组，unsigned 发布含 SmartScreen 说明。
6. 失败重发：修复 → push master → `git tag -f vX.Y.Z <sha> && git push origin vX.Y.Z --force`（重推触发新 run，同 concurrency 自动取消旧 run）→ `gh release delete vX.Y.Z --yes --cleanup-tag=false`（softprops 不覆盖已存在 release，tag 保留）→ 等待完成后按步骤 5 核对。已知坑：release 描述超 125,000 字符会被 GitHub 截断（cliff.toml 已 slice(20)，勿改大）；`TAURI_SIGNING_PRIVATE_KEY` 缺失时 `.sig`/`latest.json` 不生成但构建仍成功，核对时注意。
