# AgentHub 开发快速上手

> 最后更新：2026-06-10

本文档帮助新开发者快速启动 AgentHub 全栈开发环境。

## 1. 前置条件

| 工具 | 最低版本 | 用途 |
|------|---------|------|
| Go | 1.25.0 | Hub Server 和 Edge Server |
| Node.js | 20+ | 前端构建和开发 |
| corepack | 启用 | pnpm 版本管理（`corepack enable`） |
| PostgreSQL | 16+ | Hub 数据库 |
| Redis | 7+ | Hub 缓存和会话 |
| Git | 2.40+ | 版本控制 |

可选：

| 工具 | 用途 |
|------|------|
| Rust toolchain + Tauri CLI | Desktop 打包和 native 能力 |
| Playwright | E2E 测试（`npx playwright install`） |
| Docker Compose | 一键启动 PostgreSQL + Redis |

## 2. 获取代码

```bash
git clone https://github.com/TokenDanceLab/AgentHub.git
cd AgentHub
git checkout dev/delicious233
git pull --ff-only
```

工作分支从 `dev/delicious233` 开始，不直接在 `master` 上开发。

## 3. 配置环境

```bash
# 从示例文件创建 .env
cp .env.example .env

# 编辑 .env，确认以下关键配置：
# - AGENTHUB_DB_HOST / AGENTHUB_DB_PORT / AGENTHUB_DB_USER / AGENTHUB_DB_PASSWORD
# - AGENTHUB_REDIS_HOST / AGENTHUB_REDIS_PORT
# - AGENTHUB_JWT_SECRET（开发环境至少 32 字符）
```

如果使用 Docker Compose 启动 PostgreSQL 和 Redis：

```bash
docker compose up -d postgres redis
```

## 4. 启动 Hub Server

```bash
cd hub-server
go run ./cmd/server-hub
```

Hub Server 默认监听 `127.0.0.1:8080`，admin 端口 `127.0.0.1:6060`。

验证启动成功：

```bash
curl http://127.0.0.1:8080/health
# 期望：{"status":"ok"}
```

首次启动会自动运行数据库迁移（`hub-server/migrations/` 下的 51 对迁移文件，共 102 文件）。

## 5. 启动 Edge Server

```bash
cd edge-server
go run ./cmd/agenthub-edge
```

Edge Server 默认监听 `127.0.0.1:3210`。

验证启动成功：

```bash
curl http://127.0.0.1:3210/health
# 期望：{"status":"ok","..."}
```

### CLI 适配器

Edge Server 启动时会自动检测已安装的 CLI 工具：

- Claude Code：`claude --output-format stream-json`
- Codex：`codex exec --json`（需要 `OPENAI_API_KEY`）
- OpenCode：`opencode run --format json`

CLI 未安装时对应 adapter 报告 `not-found`，不影响 Edge 启动。

### SDK 适配器

通过标志启用 SDK HTTP 适配器（不需要安装 SDK 包）：

```bash
go run ./cmd/agenthub-edge --anthropic-sdk-path=anthropic --openai-sdk-path=openai
```

SDK 适配器需要对应的环境变量（`ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY`）才能标记为 `Available=true`。

## 6. 启动 Web 前端

```bash
cd app/web
corepack install
corepack pnpm install
corepack pnpm dev
```

Web 前端监听 `127.0.0.1:5174`。

打开浏览器访问 `http://127.0.0.1:5174`。默认使用 mock 数据模式。

## 7. 启动 Desktop 前端

```bash
cd app/desktop
corepack install
corepack pnpm install
corepack pnpm dev
```

Desktop 前端监听 `127.0.0.1:5173`。

注意：完整的 Desktop 体验需要 Tauri 运行时。纯前端开发模式只提供 UI 预览，不含 Local Edge 进程管理、文件系统访问等 native 能力。

```bash
# 完整 Tauri 开发模式（需要 Rust toolchain）
cd app/desktop
corepack pnpm tauri dev
```

## 8. 创建测试用户并获取 JWT

当 TokenDance ID OIDC 未配置时（开发环境常见情况），可以通过以下方式获取测试 JWT。

### 方式一：配置 TokenDance ID OIDC（推荐）

1. 确保 TokenDance ID 服务已启动并可达（默认端口 3000）。
2. 在 `.env` 中配置 OIDC 参数：
   ```bash
   AGENTHUB_TOKENDANCE_ID_CLIENT_ID=<your-client-id>
   AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET=<your-client-secret>
   AGENTHUB_TOKENDANCE_ID_ISSUER=http://127.0.0.1:3000
   ```
3. 启动 Hub Server 后，访问 Web 前端 `http://127.0.0.1:5174`，点击登录按钮完成 OIDC 流程。
4. 前端会自动获取并存储 JWT token。

### 方式二：通过 E2E 测试脚本自动创建

E2E smoke 脚本会自动签发测试 token：

```powershell
# 需要 Hub 和 Edge 都已启动
.\tests\scripts\verify-real-api-smoke.ps1 -RepoRoot .
```

### 使用 Token

获取到 JWT 后，在 API 请求中携带：

```bash
curl http://127.0.0.1:8080/client/auth/me \
  -H "Authorization: Bearer <your-jwt-token>"
```

前端会自动从登录流程获取并存储 token。

## 9. 运行测试

### Go 后端测试

```bash
# Edge Server 测试（跳过需要真实 CLI 的集成测试）
cd edge-server
go test ./... -short -count=1

# Hub Server 测试
cd hub-server
go test ./... -short -count=1
```

### 前端测试

```bash
# Web 测试
cd app/web
corepack pnpm test
corepack pnpm typecheck

# Desktop 测试
cd app/desktop
corepack pnpm test
corepack pnpm typecheck
```

### E2E 测试

```bash
# 安装 Playwright 浏览器
npx playwright install

# 运行 E2E 测试（需要 Hub + Edge + Web 都已启动）
cd app/e2e
npx playwright test

# 或使用完整 smoke 脚本
.\tests\scripts\verify-real-api-smoke.ps1 -RepoRoot .
```

### 集成验证脚本

| 脚本 | 用途 |
|------|------|
| `tests/scripts/verify-real-api-smoke.ps1` | Hub + Edge 全链路 smoke（100+ 断言） |
| `tests/scripts/verify-p0-approved-real-gold-path.ps1` | P0 approved-real 金链路 |
| `scripts/verify-ci-gates.ps1` | CI 门禁检查 |
| `scripts/verify-release-gate.ps1` | Release gate 检查 |

## 10. 常见问题

### Q: Hub Server 启动报 "connection refused" 连接数据库

确认 PostgreSQL 已启动且 `.env` 中的数据库连接信息正确：

```bash
psql -h 127.0.0.1 -U agenthub -d agenthub
```

### Q: Edge Server 启动报端口 3210 被占用

检查是否有残留进程：

```bash
# Windows
netstat -ano | findstr 3210
# Linux/macOS
lsof -i :3210
```

### Q: Web 前端 `pnpm install` 报错

确认 corepack 已启用且 pnpm 版本正确：

```bash
corepack enable
corepack install
```

### Q: 前端页面显示 mock 数据而非真实数据

这是正常行为。在 TokenDance ID 登录未配置时，前端默认使用 mock/demo 模式。配置 `AGENTHUB_TOKENDANCE_ID_CLIENT_ID` 等 OIDC 环境变量后重启 Hub Server，登录后即切换到真实数据模式。

### Q: Hub WebSocket 连接失败

WebSocket 需要 auth token 才能连接。确保：

1. 已通过登录获取有效 JWT
2. 前端的 Hub WS 客户端配置了正确的 token 注入方式
3. Hub Server 允许 WebSocket 的 CORS 来源（`.env` 中 `AGENTHUB_CORS_ORIGINS`）

### Q: `user_settings` 表缺失

如果 Hub 启动报 `user_settings` 表不存在，手动运行迁移：

```bash
cd hub-server
goose -dir migrations postgres "user=agenthub password=dev_password dbname=agenthub sslmode=disable" up
```

迁移 0049 包含 `user_settings` 表创建。

### Q: Desktop 构建需要 Rust 但我只想改前端

纯前端修改不需要 Rust。运行 `corepack pnpm dev` 即可在浏览器预览 Desktop UI。只有涉及 Tauri native 能力（文件系统、托盘、Edge 进程管理）时才需要 Rust toolchain。

## 11. 开发工作流速查

```bash
# 1. 同步最新代码
git checkout dev/delicious233 && git pull --ff-only

# 2. 创建功能分支（在 .worktrees/ 下）
git worktree add .worktrees/my-feature -b feat/my-feature

# 3. 开发和测试
# ... 修改代码 ...
go test ./... -short -count=1      # 后端
corepack pnpm test && corepack pnpm typecheck  # 前端

# 4. 提交
git add -A && git commit -m "feat(scope): 简短描述"

# 5. 推送并开 PR
git push origin feat/my-feature
# 然后在 GitHub 上创建 PR 到 dev/delicious233

# 6. 合并后清理
git worktree remove .worktrees/my-feature
git branch -d feat/my-feature
```
