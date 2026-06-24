# AgentHub 开发者贡献指南

> 最后更新：2026-06-17

本文档面向所有贡献者——无论是人类开发者还是 AI Agent——提供从环境搭建到提交 PR 的完整工作流。开始之前，请先阅读 `README.md` 了解项目定位，再阅读 `docs/architecture/`（主索引为 `docs/architecture.md`）了解架构全貌。

## 目录

1. [开发环境搭建](#1-开发环境搭建)
2. [代码规范](#2-代码规范)
3. [项目结构导览](#3-项目结构导览)
4. [开发工作流](#4-开发工作流)
5. [测试指南](#5-测试指南)
6. [常见问题](#6-常见问题)
7. [文档规范](#7-文档规范)

---

## 1. 开发环境搭建

### 1.1 前置条件

| 工具 | 最低版本 | 用途 |
|------|---------|------|
| Go | 1.25+ | Hub Server 和 Edge Server 后端 |
| Node.js | 20+ | 前端构建、测试和开发 |
| corepack | 启用 | pnpm 版本管理（`corepack enable`） |
| PostgreSQL | 16+ | Hub 数据库 |
| Redis | 7+ | Hub 缓存和会话 |
| Git | 2.40+ | 版本控制 |

可选：

| 工具 | 用途 |
|------|------|
| Rust toolchain + Tauri CLI | Desktop 原生打包和 native 能力 |
| Playwright | E2E 测试（`npx playwright install`） |
| Docker Compose | 一键启动 PostgreSQL + Redis |

### 1.2 克隆和初始化

```bash
git clone https://github.com/TokenDanceLab/AgentHub.git
cd AgentHub
git checkout dev/delicious233
git pull --ff-only
```

主开发分支是 `dev/delicious233`，所有功能从这里分出，不直接在 `master` 上开发。

克隆后立即启用本地 Git hooks：

```bash
# Windows
.\scripts\setup.ps1

# Linux/macOS
./scripts/setup.sh
```

Hook 脚本位于 `scripts/git-hooks/`，负责 commit message 格式校验和提交前检查。CI 也会拦截不规范提交，本地 hook 可以更早发现问题。

### 1.3 Docker Compose 启动数据库和缓存

如果本地没有运行 PostgreSQL 和 Redis，用 Docker Compose 一键启动：

```bash
# 启动 PostgreSQL + Redis
docker compose up -d postgres redis

# 一键启动全部服务（含 Hub Server）
./scripts/dev-up.sh
```

服务端口：

| 服务 | 默认端口 | 说明 |
|------|---------|------|
| PostgreSQL | 5432 | 默认绑定 127.0.0.1 |
| Redis | 6379 | 默认绑定 127.0.0.1 |
| Hub Server | 8080 | API 端口 |
| Hub Admin | 6060 | metrics 和管理端口 |

停止服务：

```bash
./scripts/dev-down.sh
```

### 1.4 环境变量配置

```bash
# 从示例文件创建 .env
cp .env.example .env
```

开发环境必须确认以下关键配置：

```bash
# 数据库
AGENTHUB_DB_HOST=localhost
AGENTHUB_DB_PORT=5432
AGENTHUB_DB_USER=agenthub
AGENTHUB_DB_PASSWORD=dev_password
AGENTHUB_DB_NAME=agenthub

# Redis
AGENTHUB_REDIS_HOST=localhost
AGENTHUB_REDIS_PORT=6379

# JWT（开发环境至少 32 字符）
AGENTHUB_JWT_SECRET=dev-secret-change-in-production-min-length-32
```

**安全提醒**：`.env` 已被 `.gitignore` 排除，严禁提交。示例配置仅提供占位值。

---

## 2. 代码规范

### 2.1 Go（Hub Server / Edge Server）

- **格式化**：所有 Go 代码提交前通过 `gofmt`（或 `goimports`）格式化。
- **静态检查**：建议配置 `golangci-lint`，CI 也会运行 lint。
- **错误处理**：使用 `fmt.Errorf("doing X: %w", err)` 进行 error wrapping，保留错误链。不要丢弃 error（`_ = doSomething()`）除非有明确理由。
- **Context**：所有跨函数调用的 I/O 操作必须接受 `context.Context` 作为第一个参数。
- **测试**：新增核心逻辑必须有同包 `*_test.go`。接口边界（handler、service、lifecycle、adapter）优先写测试。涉及权限、路径、命令执行的逻辑必须有失败用例。
- **包结构**：Hub Server 按 `handler -> service -> repository -> model` 分层。Edge Server 按 `api -> lifecycle -> adapters -> store` 分层。

### 2.2 TypeScript（前端 / Mobile）

- **类型安全**：`app/web`、`app/desktop`、`app/mobile-rn` 启用 `exactOptionalPropertyTypes`，`app/shared/` 设为 `false`。禁止使用 `any`，必要时用 `unknown` 并做类型收窄。
- **Lint**：各 app 独立 eslint 配置，提交前运行 `pnpm lint`。
- **格式化**：使用 Prettier 统一格式。
- **共享 UI 包**：通用组件放在 `app/shared/src/ui/`（`@agenthub/shared`），desktop 和 web 从中导入。禁止在 app 内创建重复的本地 UI 副本。
- **样式**：使用 CSS Modules + OKLCH 设计 tokens（`var(--primary)`, `var(--border)` 等）。禁止硬编码颜色值。
- **测试**：新组件必须有测试（`*.test.tsx`）+ Storybook story（`*.stories.tsx`）。
- **类型检查**：提交前在 desktop 和 web 各运行一次 `pnpm typecheck`。

### 2.3 Commit Messages

使用 conventional commits 格式，type/scope 用英文，摘要用中文：

```
type(scope): 中文摘要
```

常用 type：

| type | 含义 |
|------|------|
| `init` | 项目初始化 |
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `refactor` | 结构调整 |
| `chore` | 仓库流程、脚本、依赖 |
| `test` | 测试 |
| `perf` | 性能优化 |
| `ci` | CI/CD 变更 |
| `revert` | 回滚 |

常用 scope：`client`、`edge`、`api`、`docs`、`desktop`、`web`、`mobile`、`hub`。

摘要不超过 50 字。不要写 "added"、"fixed" 等英文动词，用中文。

示例：

```
feat(edge): 新增 Anthropic SDK HTTP 适配器
fix(hub): 修复 user_settings 表缺失导致启动失败
docs(client): 补充 OIDC 登录流程说明
```

### 2.4 分支命名

全小写，使用 `/` 分隔前缀和描述：

```
feat/frontend-shell
feat/backend-health
fix/edge-port-conflict
codex/packaging-release-windows-tauri-20260609
docs/api-conventions
```

- `feat/`：功能开发
- `fix/`：Bug 修复
- `docs/`：文档变更
- `codex/`：Codex App 自动工作分支前缀

---

## 3. 项目结构导览

### 3.1 顶层目录

```
AgentHub/
  AGENTS.md           # 开发规范和流程约束（Agent 和开发者必读）
  STATE.md            # 当前项目状态快照
  README.md           # 对外展示页
  docs/               # 产品文档、架构、路线图、治理
  api/                # REST API 契约（OpenAPI）和 WebSocket 事件定义
  hub-server/         # Hub Server（Go）
  edge-server/        # Edge Server（Go）
  app/                # 前端应用
    shared/           # 共享 UI 包（@agenthub/shared）
    desktop/          # Desktop Tauri 应用
    web/              # Web 浏览器应用
    mobile-rn/        # Mobile React Native 应用
    e2e/              # Playwright E2E 测试
  scripts/            # 开发脚本、验证脚本、Git hooks
  tests/              # 集成测试脚本
  docker-compose.yml  # 本地开发 Docker 编排
  go.work             # Go workspace（Hub + Edge）
```

### 3.2 Hub Server（`hub-server/`）

Hub Server 负责用户认证（TokenDance ID OIDC）、IM 会话管理、Agent Profile 存储、跨设备同步、中继和审计。

```
hub-server/
  cmd/server-hub/     # 入口 main
  internal/
    handler/          # HTTP handler 层
    service/          # 业务逻辑层
    repository/       # 数据访问层
    model/            # 数据模型
    router/           # 路由注册
    middleware/        # 认证、CORS、日志中间件
    ws/               # WebSocket hub
    jwtutil/          # JWT 工具
    config/           # 配置加载
    app/              # 应用初始化
    cache/            # Redis 缓存
    log/              # 结构化日志
    metrics/          # Prometheus 指标
    errcode/          # 错误码定义
  migrations/         # 数据库迁移文件（51 对）
  deployments/        # Docker 部署配置
```

### 3.3 Edge Server（`edge-server/`）

Edge Server 负责本地项目、Thread、Context Builder、Run 生命周期、Agent Runtime 适配和 Artifact 索引。

```
edge-server/
  cmd/agenthub-edge/  # 入口 main
  internal/
    adapters/         # Agent Runtime 适配器（Claude Code、Codex、OpenCode、SDK）
    lifecycle/        # Run 生命周期管理
    api/              # HTTP handler
    httpserver/       # HTTP server 框架
    store/            # SQLite 持久化
    events/           # 事件定义
    runners/          # Runtime/Target health 摘要
    agents/           # Agent 配置管理
    diff/             # Diff 计算和投影
    mcp/              # MCP 集成
    skills/           # Skill 管理
    security/         # 安全相关
    hub/              # Hub 通信客户端
    ccswitch/         # CC-Switch 模型代理配置
    jwtutil/          # JWT 工具
    middleware/        # 中间件
    metrics/          # Prometheus 指标
    runnerctx/        # Runner 上下文
```

### 3.4 前端应用（`app/`）

```
app/
  shared/             # @agenthub/shared — 共享 UI、类型、hooks
    src/
      ui/             # 基础 UI primitives（Button、Modal、MessageBubble 等）
      workbench/      # v4 产品工作台 shell
      transcript/     # 统一消息/事件 block contract 和 renderer
      composer/       # 统一输入区
      inspector/      # 统一证据面板
      platform/       # Desktop/Web platform adapter interface
      i18n/           # 国际化
      types/          # 共享类型定义

  desktop/            # Tauri Desktop 应用
    src/
      platform/       # Tauri + Local Edge adapter
      main.tsx        # Desktop 启动入口
    src-tauri/
      src/host/       # Tauri host capability modules（edge、fs、auth、window、system）

  web/                # Web 浏览器应用
    src/
      platform/       # Hub + browser adapter
      main.tsx        # Web 启动入口

  mobile-rn/          # Expo React Native 移动端
    src/              # RN-safe 业务代码
    app.config.ts     # Expo 配置
    scripts/          # 构建和验证脚本

  e2e/                # Playwright E2E 测试
```

### 3.5 API 契约（`api/`）

```
api/
  openapi.yaml        # REST API OpenAPI 3.0 规范
  events.md           # WebSocket 事件定义
  conventions.md      # API 约定和命名规范
  deprecations.md     # 已废弃 API 记录
```

### 3.6 功能定位速查

| 要找什么 | 去哪里 |
|---------|--------|
| Hub REST endpoint 定义 | `hub-server/internal/handler/` + `api/openapi.yaml` |
| Edge REST endpoint 定义 | `edge-server/internal/api/` |
| Agent Runtime 适配器 | `edge-server/internal/adapters/` |
| Run 生命周期 | `edge-server/internal/lifecycle/` |
| WebSocket 事件 | `api/events.md` + `hub-server/internal/ws/` |
| 数据库迁移 | `hub-server/migrations/` |
| 共享 UI 组件 | `app/shared/src/ui/` |
| 工作台布局 | `app/shared/src/workbench/` |
| 消息/Transcript 合同 | `app/shared/src/transcript/` |
| Platform adapter 接口 | `app/shared/src/platform/` |
| Hub client（前端） | `app/shared/src/hubClient.ts` |
| i18n 翻译文件 | `app/shared/src/i18n/` |
| Tauri native 能力 | `app/desktop/src-tauri/src/host/` |
| Mobile RN 组件 | `app/mobile-rn/src/` |
| 验证脚本 | `scripts/verify-*.ps1` |
| E2E 测试 | `app/e2e/` + `tests/scripts/` |

---

## 4. 开发工作流

### 4.1 Git Worktree 工作流

AgentHub 使用 Git worktree 进行隔离开发。一个 worktree = 一个短分支 = 一个 PR。

**开始新功能前**：

```bash
# 1. 同步最新代码
git checkout dev/delicious233
git pull --ff-only

# 2. 在 .worktrees/ 下创建隔离工作树
git worktree add .worktrees/my-feature -b feat/my-feature

# 3. 进入 worktree 开发
cd .worktrees/my-feature
```

**worktree 规则**：

- 项目级 worktree 固定放在 `.worktrees/`（已写入 `.gitignore`，不提交）。
- 不要多个开发者或 Agent 共用同一 worktree。
- 每个 worktree 必须绑定明确的写入范围。
- worktree 内禁止保存密钥、真实服务器配置、私有日志和本机 Agent 状态。
- 创建前先写任务卡：分支名、worktree、写入范围、依赖、验收命令。

**完成后**：

```bash
# 4. 在 worktree 内提交和测试
cd .worktrees/my-feature
# ... 修改代码 ...
go test ./... -short -count=1      # 后端测试
pnpm test && pnpm typecheck         # 前端测试

# 5. 提交
git add -A && git commit -m "feat(scope): 简短描述"

# 6. 推送并开 PR 到 dev/delicious233
git push origin feat/my-feature

# 7. 合并后清理 worktree
cd ../..
git worktree remove .worktrees/my-feature
git branch -d feat/my-feature
```

### 4.2 创建功能分支

如果不用 worktree，也可以直接创建分支（适合小改动）：

```bash
git checkout dev/delicious233
git pull --ff-only
git checkout -b feat/my-feature
```

已有功能分支继续开发前，先 rebase：

```bash
git fetch origin
git rebase origin/dev/delicious233
```

### 4.3 本地启动服务

#### Hub Server

```bash
cd hub-server
go run ./cmd/server-hub
```

默认监听 `localhost:8080`，admin 端口 `localhost:6060`。首次启动自动运行数据库迁移。

验证：

```bash
curl http://localhost:8080/health
# 期望：{"status":"ok"}
```

#### Edge Server

```bash
cd edge-server
go run ./cmd/agenthub-edge
```

默认监听 `localhost:3210`。启动时自动检测已安装的 CLI 工具（Claude Code、Codex、OpenCode）。

启用 SDK 适配器（可选）：

```bash
go run ./cmd/agenthub-edge --anthropic-sdk-path=anthropic --openai-sdk-path=openai
```

验证：

```bash
curl http://localhost:3210/health
```

#### Web 前端

```bash
cd app/web
corepack install
corepack pnpm install
corepack pnpm dev
```

监听 `localhost:5174`。打开 `http://localhost:5174`。默认 mock 数据模式。

#### Desktop 前端

```bash
cd app/desktop
corepack install
corepack pnpm install
corepack pnpm dev       # 纯前端模式，监听 localhost:5173

# 完整 Tauri 模式（需要 Rust toolchain）
corepack pnpm tauri dev
```

纯前端模式只提供 UI 预览，不含 Local Edge 进程管理、文件系统访问等 native 能力。

#### Mobile

```bash
cd app/mobile-rn
corepack pnpm install
corepack pnpm dev:web   # Web 视觉预览，监听 localhost:5177
```

### 4.4 提交前测试

每次提交前至少运行以下检查：

```bash
# 后端（在 hub-server 或 edge-server 目录下）
go test ./... -short -count=1

# 前端（在对应 app 目录下）
pnpm test
pnpm typecheck
```

PR 合入 `dev/*` 或 `master` 前，必须验证 `go test` + `pnpm test` + `pnpm build` 全部通过。

### 4.5 PR 流程

1. 从最新 `dev/delicious233` 创建功能分支。
2. 完成开发后 rebase 到最新 `dev/delicious233`，解决冲突。
3. 在 GitHub 上创建 PR 到 `dev/delicious233`。
4. PR 标题也用 `type(scope): 中文摘要` 格式。
5. PR 描述中写清楚影响面，尤其是跨方向（前端/后端/客户端）的改动。
6. `master` 禁止直接 push，必须通过 PR。
7. 跨分支协作尽早开 draft PR，让其他人看到进度。

---

## 5. 测试指南

### 5.1 Go 后端测试

```bash
# Edge Server 测试（-short 跳过需要真实 CLI 的集成测试）
cd edge-server
go test ./... -short -count=1

# Hub Server 测试
cd hub-server
go test ./... -short -count=1
```

覆盖率要求：

| 模块 | 最低覆盖率 |
|------|-----------|
| edge-server | 75% |
| hub-server | 40% |

### 5.2 前端测试

```bash
# Web
cd app/web
corepack pnpm test          # 单元测试
corepack pnpm typecheck     # 类型检查

# Desktop
cd app/desktop
corepack pnpm test
corepack pnpm typecheck

# 构建验证（Web）
cd app/web
corepack pnpm exec vite build
```

### 5.3 Mobile 测试

```bash
cd app/mobile-rn
corepack pnpm verify        # typecheck + lint + brand + boundaries + test（全量验证）
```

### 5.4 E2E 测试

#### Playwright 测试

```bash
# 安装浏览器（首次）
npx playwright install

# 运行 E2E 测试（需要 Hub + Edge + Web 都已启动）
cd app/e2e
npx playwright test
```

#### 集成 Smoke 测试

```powershell
# Hub + Edge 全链路 smoke（100+ 断言）
.\tests\scripts\verify-real-api-smoke.ps1 -RepoRoot .

# P0 approved-real 金链路
.\tests\scripts\verify-p0-approved-real-gold-path.ps1 -RepoRoot .

# CI 门禁检查
.\scripts\verify-ci-gates.ps1

# Release gate 检查
.\scripts\verify-release-gate.ps1
```

### 5.5 文档和 API 变更检查

```powershell
git diff --check                                                                  # 无冲突标记
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text()); print('yaml ok')"  # YAML 校验
git status --short --branch                                                       # 确认文件状态
```

### 5.6 验证脚本索引

| 脚本 | 用途 |
|------|------|
| `tests/scripts/verify-real-api-smoke.ps1` | Hub + Edge 全链路 smoke（13 个阶段） |
| `tests/scripts/verify-p0-approved-real-gold-path.ps1` | P0 approved-real 金链路 |
| `scripts/verify-ci-gates.ps1` | CI 门禁检查 |
| `scripts/verify-release-gate.ps1` | Release gate 检查 |
| `scripts/verify-v4-old-ui-active-paths.ps1` | 旧 UI 活跃路径回归扫描 |
| `scripts/verify-tauri-package-readiness.ps1` | Tauri 包就绪检查 |
| `scripts/verify-tauri-installer-smoke.ps1` | Tauri 安装器 smoke |

---

## 6. 常见问题

### Q: Hub Server 启动报 "connection refused" 连接数据库

确认 PostgreSQL 已启动且 `.env` 中的数据库连接信息正确：

```bash
psql -h localhost -U agenthub -d agenthub
```

如果使用 Docker Compose，确认容器健康：

```bash
docker compose ps
```

### Q: 端口冲突

| 端口 | 服务 | 处理 |
|------|------|------|
| 8080 | Hub Server | 检查残留 Hub 进程或调整 `AGENTHUB_SERVER_PORT` |
| 3210 | Edge Server | 检查残留 Edge 进程 |
| 5173 | Desktop 前端 | Desktop 专用，Web/Mobile 不得占用 |
| 5174 | Web 前端 | Web 专用，Desktop/Mobile 不得占用 |
| 5177 | Mobile Web 预览 | Mobile RN 专用 |
| 3000 | TokenDance ID | OIDC 登录依赖此端口 |

Windows 检查端口占用：

```bash
netstat -ano | findstr 8080
```

Linux/macOS：

```bash
lsof -i :8080
```

### Q: 数据库迁移问题

Hub Server 首次启动会自动运行 `hub-server/migrations/` 下的迁移文件。如果手动运行迁移：

```bash
cd hub-server
goose -dir migrations postgres "user=agenthub password=dev_password dbname=agenthub sslmode=disable" up
```

如果 `user_settings` 表缺失（迁移 0049）：

```bash
goose -dir migrations postgres "user=agenthub password=dev_password dbname=agenthub sslmode=disable" up
```

### Q: 前端 `pnpm install` 报错

确认 corepack 已启用且 pnpm 版本正确：

```bash
corepack enable
corepack install
```

确保使用 `corepack pnpm` 而非系统 `pnpm`。

### Q: 前端页面显示 mock 数据而非真实数据

这是正常行为。在 TokenDance ID 登录未配置时，前端默认使用 mock/demo 模式。配置 `AGENTHUB_TOKENDANCE_ID_CLIENT_ID` 等 OIDC 环境变量后重启 Hub Server，登录后即切换到真实数据模式。

### Q: Token / Auth 问题

开发环境下，认证通过 TokenDance ID OIDC 完成。在 `.env` 中配置 OIDC 参数后启动 Hub Server，前端会自动跳转登录流程获取 JWT。如果 OIDC 未配置，E2E smoke 脚本可以直接签发测试 token：

```powershell
.\tests\scripts\verify-real-api-smoke.ps1 -RepoRoot .
```

### Q: Edge 适配器注册问题

Edge Server 启动时自动检测已安装的 CLI 工具。CLI 未安装时对应 adapter 报告 `not-found`，不影响 Edge 启动。

SDK 适配器需要通过标志启用：

```bash
go run ./cmd/agenthub-edge --anthropic-sdk-path=anthropic --openai-sdk-path=openai
```

SDK 适配器需要对应环境变量（`ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY`）才能标记为 `Available=true`。

### Q: WebSocket 连接失败

WebSocket 需要 auth token 才能连接。确保：

1. 已通过登录获取有效 JWT。
2. 前端的 Hub WS 客户端配置了正确的 token 注入方式。
3. Hub Server 允许 WebSocket 的 CORS 来源（`.env` 中 `AGENTHUB_CORS_ORIGINS`）。

### Q: Desktop 构建需要 Rust 但我只想改前端

纯前端修改不需要 Rust。运行 `corepack pnpm dev` 即可在浏览器预览 Desktop UI。只有涉及 Tauri native 能力（文件系统、托盘、Edge 进程管理）时才需要 Rust toolchain。

### Q: `user_settings` 表缺失

如果 Hub 启动报 `user_settings` 表不存在，手动运行迁移：

```bash
cd hub-server
goose -dir migrations postgres "user=agenthub password=dev_password dbname=agenthub sslmode=disable" up
```

迁移 0049 包含 `user_settings` 表创建。

---

## 7. 文档规范

### 7.1 何时更新哪个文档

| 文档 | 更新时机 | 内容定位 |
|------|---------|---------|
| `STATE.md` | 每次重要里程碑或基线变更 | 当前事实快照：分支状态、已合入能力、release gate、不声明完成项 |
| `docs/roadmap.md` | 调整目标或优先级时 | 持续开发目标、当前进展、验证和下一步 |
| `docs/architecture/` | 架构决策变更时 | 架构边界、分层、通信方式、数据流模式、验收门禁 |
| `AGENTS.md` | 开发流程或规范变更时 | 开发规范、分工、Git 规则、安全规则 |
| `README.md` | 新增面向外部的能力说明时 | 对外展示页，给新读者快速了解项目 |
| `docs/developer-quickstart.md` | 环境搭建流程变更时 | 快速上手步骤 |
| `api/openapi.yaml` | REST API 接口变更时 | API 契约 |
| `api/events.md` | WebSocket 事件变更时 | 事件定义 |
| `docs/governance/` | 分支治理或发布流程变更时 | 治理规则 |

### 7.2 文档维护规则

1. **过时即删**：不再使用的文档直接删除（git 历史保留追溯能力）。
2. **代码变更同步文档**：重构接口、改错误码格式、改目录结构后，必须同步更新 `api/conventions.md`、`docs/architecture/`、`docs/roadmap.md` 中对应章节。
3. **行号引用禁令**：文档不引用源码行号（行号随重构失效）。改用函数名、类型名或"XX 文件中"等稳定锚点。
4. **阶段名一致性**：文档中使用当前 Phase 命名（Phase 1-7），不使用旧命名（Phase A/B/C/D、M1/M3a/P0-1/Phase 0/Phase 1）。
5. **时间戳快照删除**：文件名含日期的快照文档完成任务后直接删除，不留在活跃目录。
6. **不新增根级文档**：新增长期说明先考虑合并进主文档（`docs/architecture/`、`docs/roadmap.md`），不要随手新增根级文档。
7. **详细调研放 `docs/reference/`**：第三方调研和源码分析放 `docs/reference/`，不混入主文档。

### 7.3 语言规范

- AgentHub 自有文档中文优先。
- `README_EN.md` 是唯一常规英文入口。
- 文档、issue、PR 正文中文为主；代码标识、路径、API 字段、命令保留英文。
- 不使用未解释缩写。第一次出现时写白话解释。

### 7.4 安全和隐私

文档中禁止出现：

- 真实服务器 IP、内网地址、数据库连接串。
- API key、token、私钥、证书。
- 生产账号、个人路径、个人服务器信息。
- 服务器主机名。

需要示例配置时只提交 `.env.example`，值用占位符。

---

## 附录：快速参考

### 提交纪律

- **小步提交**：每个逻辑改动完成后立即 commit。
- **commit 即 push**：`git commit` 后直接 `git push`，让 CI 尽快运行。
- **每日收尾**：结束工作前 `git status --short` 确认无遗留改动。
- **PR 优先**：跨分支协作尽早开 PR，让其他人看到进度和方向。

### subagent 质量红线

以下情况视为交付不合格，必须退回重做：

1. 提交包含未解决的合并冲突标记。
2. 通过降低覆盖率阈值或放宽 lint 规则来让 CI 变绿。
3. 提交标记为 `feat` 但实际只有脚手架或占位符。
4. 提交前未运行对应模块的测试和 typecheck。
5. 一个 PR 包含不相关的文件变更且未说明关联。
6. 声称"已完成"但截图是 mock 数据、空壳页面或无法交互的静态 UI。

### 三人分工

| 方向 | 负责范围 | 主要目录 |
|------|---------|---------|
| 前端 | Web 工作台、IM 交互、Diff/Preview/Approval 面板 | `app/web/`、`app/shared/` |
| 后端 | Hub Server、Edge-Hub 通信、账号/同步/中继 | `hub-server/`、`edge-server/`、`api/` |
| 客户端（Desktop） | Tauri、Local Edge、Agent Runtime 进程 | `app/desktop/`、`edge-server/` |
| 客户端（Mobile） | Expo/React Native 移动端 | `app/mobile-rn/` |
