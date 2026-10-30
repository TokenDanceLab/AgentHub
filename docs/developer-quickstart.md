# AgentHub 开发快速上手

最后更新：2026-10-23

新人启动本地开发环境的最短路径如下。规则、分支、E2E 证据等级和发布门禁见 `AGENTS.md`。

## 前置条件

| 工具 | 用途 |
|---|---|
| Go 1.27.3 | Hub Server / Edge Server |
| Node.js 24+ + corepack | pnpm workspace 和前端构建 |
| PostgreSQL 18.6 | Hub 数据库（当前开发／CI默认稳定版本） |
| Redis 7+ | Hub cache/session |
| Git 2.40+；OpenSSL | 分支和 worktree；POSIX shell 生成本地 JWT secret |
| Python 3.10+ + PyYAML | 文档、OpenAPI 与 E2E 合同校验 |
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
复制模板后立即生成随机 JWT secret，并导出到当前 shell（`.env` 只留本机，不提交）：
POSIX shell（需要 `openssl`）：
```bash
cp .env.example .env
secret="$(openssl rand -hex 32)" && sed -i.bak "s/^AGENTHUB_JWT_SECRET=.*/AGENTHUB_JWT_SECRET=$secret/" .env && rm -f .env.bak
set -a; . ./.env; set +a
```
Windows PowerShell：
```powershell
Copy-Item .env.example .env; $b=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $s=([BitConverter]::ToString($b)).Replace('-','').ToLowerInvariant(); $p=(Resolve-Path .env); $c=[IO.File]::ReadAllText($p); [IO.File]::WriteAllText($p,([regex]::Replace($c,'(?m)^AGENTHUB_JWT_SECRET=.*$',"AGENTHUB_JWT_SECRET=$s")),(New-Object Text.UTF8Encoding($false))); $env:AGENTHUB_JWT_SECRET=$s; Remove-Variable b,s,p,c
Get-Content .env | ForEach-Object { if ($_ -match '^([^#=]+)=(.*)$') { Set-Item "env:$($matches[1])" $matches[2] } }
```
至少确认（名称以仓库根 `.env.example` 为准）：

- `AGENTHUB_DB_HOST`, `AGENTHUB_DB_PORT`, `AGENTHUB_DB_USER`, `AGENTHUB_DB_PASSWORD`
- `AGENTHUB_REDIS_HOST`, `AGENTHUB_REDIS_PORT`
- `AGENTHUB_JWT_SECRET`（开发环境也使用足够长度的随机值，至少 32 字符）
- TokenDance Account OIDC 仅在测试真实登录时配置：`AGENTHUB_ACCOUNT_OIDC_ISSUER_URL`、`AGENTHUB_ACCOUNT_OIDC_CLIENT_ID`、`AGENTHUB_ACCOUNT_OIDC_CLIENT_SECRET`、`AGENTHUB_ACCOUNT_OIDC_REDIRECT_URI`、`AGENTHUB_ACCOUNT_OIDC_ALLOWED_REDIRECT_URIS`
- 安全开关/前端入口：`AGENTHUB_AUTH_FAIL_CLOSED`（生产必填且须显式设置，见 [05-deployment.md](architecture/05-deployment.md) §安全配置）、`VITE_EDGE_URL`、`VITE_HUB_URL`（Desktop renderer 指向 Edge/Hub，见 `.env.example` §Desktop）

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

Mobile RN 默认是 fixture/边界验证 lane；本指南的 Desktop/Web 开发流程不包含 Mobile UI/native 深改。

## 登录模式

开发默认可以使用 demo/mock 或 fixture 数据。真实 Hub 登录通过 TokenDance Account 的公开 OIDC endpoint 完成；Hub 只把 Account 的 authorization code、ID token、UserInfo 用于服务端交换，然后签发 Hub session。Account token 不是 Hub bearer，REST/WebSocket 只接受 Hub HS256 token。

真实登录至少有四项配置；需要额外 callback 时再设置白名单：

```bash
AGENTHUB_ACCOUNT_OIDC_ISSUER_URL=https://account.example
AGENTHUB_ACCOUNT_OIDC_CLIENT_ID=<client-id>
AGENTHUB_ACCOUNT_OIDC_CLIENT_SECRET=<client-secret>
AGENTHUB_ACCOUNT_OIDC_REDIRECT_URI=http://127.0.0.1:53682/callback
# 可选：额外精确 callback
AGENTHUB_ACCOUNT_OIDC_ALLOWED_REDIRECT_URIS=http://localhost:5174/workbench/auth/account/callback,http://127.0.0.1:5174/workbench/auth/account/callback
```

Web 当前把 Hub access/refresh token 存在 tab-scoped `sessionStorage`，不是 HttpOnly cookie session。Mobile 默认 fixture-only；真实登录需要显式设置 `EXPO_PUBLIC_AGENTHUB_ACCOUNT_LOGIN_ENABLED=true` 和非空 `EXPO_PUBLIC_ACCOUNT_OIDC_ISSUER`。

## 测试速查

本地入口以根 `Makefile` 为准，均从仓库根执行：

| 层 | 命令 | 真实范围 |
|---|---|---|
| L0 后端 | `make test`（复用 Go test cache）/ `make test-ci`（`-count=1`） | `test-edge` + `test-hub`，均为 `go test -short` |
| L0 前端 | `make fe-test` / `make fe-test-changed` | 单个 Vitest 进程跑全部 project；`--changed` 只跑受 git 变更影响的用例 |
| L1 集成 | `scripts/dev/dev-up.sh --full`（容器启动后返回）后执行 `make test-hub-integration` | 真实 PostgreSQL 18.6 + Redis 7；`-tags integration` |
| L2 fixture | `make test-edge-e2e` / `make e2e-local` | callback mock hub；后者组合 teamrun + OIDC/scenarios smoke |
| 全量本地 | `make test-all` | Edge/Hub 非 `-short` race + L1，需 PostgreSQL + Redis |

本机只跑改动相关的最小集：后端在模块目录执行 `cd hub-server && go test ./internal/<pkg> -short`（Edge 同理），前端 `make fe-test-changed`；`-race`、L1、打包和浏览器 lane 放 L3/CI。

PostgreSQL 默认版本与 Docker 官方镜像固定在根 Compose、CI 和 fixture E2E。PG18 的卷挂载父目录是 `/var/lib/postgresql`，内部 `PGDATA` 带主版本；开发默认使用全新 `agenthub_pg18_data`，不复用或删除旧 `agenthub_pg_data`。已有 PG16 数据需要停写后的可验证 dump/restore 或 `pg_upgrade`，不能只换镜像。迁移前保留旧卷、配置和备份；新库验收与业务切换前可保持旧库服务，切换后不得用旧快照覆盖新写入。此仓默认版本变化不表示任何外部运行数据库已升级；运行事实与部署门禁归运维 STATE。最新稳定版以 [PostgreSQL 官方版本表](https://www.postgresql.org/support/versioning/) 为准。

L3 需要单独准备的全栈环境。`scripts/dev/dev-up.sh` 默认启动 PostgreSQL/Redis 后在前台运行 Hub；`--full` 构建并启动 Hub 容器后返回；两者都不启动 Account、Edge 或 Web。真实 Account L3 需要可达的真实 Account issuer、已注册的 confidential client、真实浏览器 Authorization Code + PKCE、UserInfo 和 Hub session。fixture、stub、自签 Hub JWT 或只验证 OIDC 配置形状的运行只能算较低证据层；在 Account 专用 lane 未产出通过的 manifest 前，该项保持 pending。

文档/API：

```bash
python scripts/verify/verify-doc-ssot.py
python scripts/verify/verify-real-e2e-contract.py
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
git diff --check
```

GitHub Actions 的 Ubuntu/Windows 分层、路径过滤、矩阵并行、缓存和免费额度策略见 [architecture/github-actions-ci-cd-policy.md](architecture/github-actions-ci-cd-policy.md)。普通 PR 按路径运行 Windows 原生 Go/前端合同、Web/Desktop Visual QA shell 和 Web stubbed-hub Playwright；Mobile full、`e2e-smoke`、`real-e2e-stack`、backend perf/leak 和 Linux Tauri no-bundle 只通过 `workflow_dispatch` 按需运行；benchmark 在本地通过 `make bench` 手动执行，也会在 dispatch-only 的 `backend-perf-leak-gates` job 中运行。

E2E/Visual QA 只证明实际跑过的层级；PR 中写明证据等级（9 级枚举见 `scripts/verify/verify-real-e2e-contract.py`）。

## 常见问题

| 问题 | 检查 |
|---|---|
| Hub 连接数据库失败 | PostgreSQL 是否启动，`.env` 数据库变量是否匹配 |
| Edge 3210 被占用 / Hub WS 连接失败 | 查残留进程后重启；确认 Hub-issued session 与 CORS origin 允许当前前端端口 |
| 只改前端是否需要 Rust | 不需要；只有 Tauri native 或 packaging 工作需要 Rust |
| Account 登录报 `redirect_uri not allowed` | `AGENTHUB_ACCOUNT_OIDC_REDIRECT_URI`/`ALLOWED_REDIRECT_URIS` 与 Account client 注册值未精确一致；重开登录、清浏览器 session 后重试，见 [05-deployment.md](architecture/05-deployment.md) §Account OIDC 契约 |
| 接口 429/503 `rate_limited`/`rate_limit_unavailable` | Redis 故障或超配额；429 带 `Retry-After` 须遵守；503 多为 Redis 中断（认证路径恒 fail-closed），见 [conventions.md](../api/conventions.md) §Errors |
| 启动报 JWT secret 弱被拒 | `change-me-production*`/`dev-secret-change-in-production*` 前缀被 blocklist 拒；换随机 ≥32 字符值 |

## PR 合并规则

合入 master 仅用 **Squash and merge**（仓库已强制，合并自动删分支）；一个 PR 一个主题。提交消息用 Conventional Commits，分支与 worktree 纪律见 [AGENTS.md](../AGENTS.md) 的「Git 和 worktree」。

## 发布 tag SOP

唯一发布入口：本地打 tag → `git push origin <tag>` → release.yml 构建并出 GitHub Release。

1. 前置：master 全绿；`app/desktop/package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 版本一致（前两者由 `scripts/release/verify-release-gate.py` 校验，`Cargo.toml`/`Cargo.lock` 断言在 `scripts/release/verify-tauri-package-readiness.py`）。Linux 桌面构建可在发布前手动预检：`gh workflow run checks.yml`（`desktop-linux-build` 是 dispatch-only job，会与其他按需 job 一并运行；核心是 `tauri build --no-bundle`，不产出安装包、不需签名密钥）。
2. 版本选择：默认升 patch；升 minor 需产品理由；RC 走 `vX.Y.Z-rc.N`。
3. 打 tag：`git tag vX.Y.Z`；tag 必须等于 `v` + `app/desktop/package.json` 版本，commit 须在 master 祖先链、格式 `^v\d+\.\d+\.\d+(-rc\.\d+)?$`（release.yml tag-guard 双重守卫）；`git push origin <tag>` 触发构建发布。
4. 产物与签名：build-desktop（Windows NSIS + portable）恒定；build-desktop-linux（AppImage + deb，GitHub Releases 手动更新；AppImage auto-updater 未实现）恒定；macOS 桌面已停用（2026-08-11）；build-mobile 由 `RELEASE_MOBILE_ENABLED=true` 门控；无商业证书时设 `RELEASE_UNSIGNED_OK=true`（SmartScreen 提示、updater 自签），有证书后用 `RELEASE_SIGNING_APPROVED=true`；完成风险复核后，在仓库的 `release` environment 中设置 `RELEASE_RISK_REVIEWED=<release tag>`（必须等于本次发布的 tag，不能只写 `true`）。git-cliff 生成中英双语 changelog（`cliff.toml`）+ `SHA256SUMS`，标题 `AgentHub vX.Y.Z`。签名或审批缺失时 release gate 会列出 blocker 与解除条件。
5. 发布后核对（run 全绿后）：`gh release view vX.Y.Z --json name,assets --jq '{name, assets: [.assets[].name]}'` 应含 14 个产物：`AgentHub_<ver>_x64-setup.exe` / `_x64-portable.zip` / `_x64-setup.exe.sig`、`AgentHub_<ver>_x86_64.AppImage` / `_amd64.deb`、updater `latest.json`、`agenthub-edge-<ver>-{linux,windows,darwin}-amd64`（darwin 含 arm64）、`agenthub-hub-<ver>-linux-amd64` / `-darwin-amd64` / `-darwin-arm64`（无 Windows 版）、`SHA256SUMS`；描述含安装指引/校验命令/commit 分组，unsigned 发布含 SmartScreen 说明。
6. 失败重发：修复 → push master → `git tag -f vX.Y.Z <sha> && git push origin vX.Y.Z --force`（重推触发新 run，同 concurrency 自动取消旧 run）→ 可选 `gh release delete vX.Y.Z --yes --cleanup-tag=false` 清理旧 release（action-gh-release 会更新已存在 release 并覆盖同名 assets，tag 保留）→ 等待完成后按步骤 5 核对。已知坑：release 描述超 125,000 字符会被 GitHub 截断（cliff.toml 已 slice(20)，勿改大）；`TAURI_SIGNING_PRIVATE_KEY` 缺失时 `.sig`/`latest.json` 不生成但构建仍成功，核对时注意。
