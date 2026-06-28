# AgentHub 开发快速上手

最后更新：2026-06-28

本文档只保留新人启动本地开发环境需要的最短路径。规则、分支、E2E 证据等级和发布门禁以 `AGENTS.md`、当前 `docs/progress/MASTER.md`（仅当存在时）、`docs/roadmap.md` 和 `.agents/skills/real-e2e-acceptance/SKILL.md` 为准。

## 前置条件

| 工具 | 用途 |
|---|---|
| Go 1.25+ | Hub Server / Edge Server |
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
git checkout dev/delicious233
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

至少确认：

- `AGENTHUB_DB_HOST`, `AGENTHUB_DB_PORT`, `AGENTHUB_DB_USER`, `AGENTHUB_DB_PASSWORD`
- `AGENTHUB_REDIS_HOST`, `AGENTHUB_REDIS_PORT`
- `HUB_JWT_SECRET` 或项目当前配置使用的 Hub JWT secret 变量，开发环境也使用足够长度的随机值
- TokenDance ID OIDC 变量仅在测试真实登录时配置

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
curl http://127.0.0.1:3210/health
```

Web：

```bash
cd app/web
corepack pnpm install
corepack pnpm dev
```

Web 监听 `127.0.0.1:5174`。

Desktop renderer：

```bash
cd app/desktop
corepack pnpm install
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

常用 OIDC 变量：

```bash
AGENTHUB_TOKENDANCE_ID_CLIENT_ID=<client-id>
AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET=<client-secret>
AGENTHUB_TOKENDANCE_ID_ISSUER=http://127.0.0.1:3000
```

不要把 third-party provider token、TokenDance API key、callback code、session token 或真实日志写入仓库文档。

## 测试速查

后端：

```bash
cd edge-server
go test ./... -short -count=1

cd ../hub-server
go test ./... -short -count=1
```

前端：

```bash
cd app/desktop
corepack pnpm test
corepack pnpm typecheck

cd ../web
corepack.cmd pnpm typecheck
corepack.cmd pnpm exec vite build
```

文档/API：

```bash
pwsh ./scripts/verify/verify-doc-ssot.ps1
pwsh ./scripts/verify/verify-project-skills.ps1
pwsh ./scripts/verify/verify-real-e2e-contract.ps1
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
git diff --check
```

E2E/Visual QA 只证明实际跑过的层级。使用 `.agents/skills/real-e2e-acceptance/SKILL.md` 选择 gate，并在 PR 中写清楚 `fixture-unit`、`playwright-ui`、`visual-qa`、`stubbed-hub`、`observed-local`、`approved-real` 或 `packaged-release`。

## 常见问题

| 问题 | 检查 |
|---|---|
| Hub 连接数据库失败 | PostgreSQL 是否启动，`.env` 数据库变量是否匹配 |
| Edge 3210 被占用 | 查找残留进程后重新启动 |
| Web/desktop 显示 mock 数据 | 未登录或处于 Demo/Fixture 模式是预期行为 |
| Hub WebSocket 连接失败 | 是否使用 Hub-issued session，CORS origin 是否允许当前前端端口 |
| 只改前端是否需要 Rust | 不需要；只有 Tauri native 或 packaging 工作需要 Rust |
