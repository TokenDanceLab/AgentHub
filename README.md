<div align="center">

# AgentHub

## IM 形态的多 Agent 协作平台

像用飞书/微信一样，拉群组织 Claude Code、Codex、OpenCode 等 AI Agent 协作完成网页、代码和部署。

[English](README_EN.md) &nbsp;·&nbsp; [产品需求](docs/product-requirements.md) &nbsp;·&nbsp; [系统架构](docs/system-architecture.md) &nbsp;·&nbsp; [API 契约](api/) &nbsp;·&nbsp; [官网](https://hub.vectorcontrol.tech)

<img src="https://img.shields.io/badge/状态-P0--M7_完成-blue?style=flat-square" alt="status">
<img src="https://img.shields.io/badge/go-1.25+-00ADD8?style=flat-square&logo=go" alt="go">
<img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react" alt="react">
<img src="https://img.shields.io/badge/license-Apache--2.0-lightgrey?style=flat-square" alt="license">

</div>

<br>

## 这是什么

AgentHub 把 AI 编程 Agent 变成 IM 联系人。你可以像在群聊里 @同事一样 @ClaudeCode 写代码、@Codex 做审查、@Reviewer 提建议，所有计划、执行、Diff、审批和预览都在同一个聊天线程中流转。

**与现有工具的区别**：多数 Claude Code GUI 是单人聊天壳。AgentHub 的核心是多 Agent 协作和多端控制：Desktop 提供本地执行工作台，Edge Server 连接真实 Agent CLI，Hub Server 提供账号、IM、多端同步和远程中继。

当前已完成：Edge Server 三大 Agent Runtime 适配（Claude Code、Codex、OpenCode）、Desktop IM 工作台（React 19 + Tauri + TanStack Query + Zustand）、Hub Server 三层架构（Gin/GORM/Redis/PostgreSQL，17 组迁移）和 Edge-Hub 部署链路。当前状态以 [docs/handoff/STATE.md](docs/handoff/STATE.md) 和 [docs/roadmap.md](docs/roadmap.md) 为准。

跨产品治理请同步阅读工作区根文档：统一第三方登录见 `../docs/unified-login.md`，AgentHub 飞书/Lark 应用规划见 `../docs/feishu-agenthub-integration.md`，设计 token 收敛见 `../docs/design-token-convergence.md`，产品包装/SEO/i18n 见 `../docs/agent-seo-i18n-packaging.md`。

<br>

## 架构

```text
Desktop UI -> Local Edge Server -> Agent Runtime Adapter -> Claude Code / Codex / OpenCode
                         |
                         v
                    Hub Server
```

| 组件 | 目录 | 职责 |
|---|---|---|
| **Hub Server** | `hub-server/` | 账号、TokenDance ID relying party、IM、联系人/群聊、多端同步、设备路由、Edge 中继和审计 |
| **Edge Server** | `edge-server/` | 本地/远程执行节点：项目、Thread、Run、EventStore、执行生命周期、Agent Runtime adapter、Artifact 索引 |
| **Agent Runtime** | `edge-server/internal/adapters/` | Codex、OpenCode、Claude Code 等 CLI/SDK 适配器；负责命令构造、协议解析、取消和能力声明 |
| **Agent Profile** | Hub profile store / Edge local profile | 用户可管理的 Agent 实体：Runtime + Model/Provider + 配置 + Skill/MCP + 审批策略 + Execution Target |
| **Desktop App** | `app/desktop/` | Tauri 桌面端工作台，本地 Edge 控制、Hub 登录、多端 IM、设置和可视化调试 |
| **Web App** | `app/web/` | 浏览器工作台和页面预览入口，面向远程查看、审批和协作体验 |
| **Shared App** | `app/shared/` | 前端共享类型、API/event client、树/Diff 工具和 `@shared/ui` 组件 |
| **API Contract** | `api/` | REST JSON API 与 WebSocket typed events 契约 |

早期设计中曾有独立 `runner/` 目录；当前执行生命周期已经合并到 Edge Server 的 `internal/lifecycle/`，Runtime 协议适配位于 `internal/adapters/`。文档和 UI 应使用 **Agent Runtime**、**Agent Profile**、**Agent Configuration**、**Execution Target** 四个术语，避免把 Runtime 直接称为用户配置好的 Agent。

<br>

## 核心概念

| 概念 | 含义 | 例子 |
|---|---|---|
| **Agent Runtime** | 能启动并解析某类 Agent CLI/SDK 的适配器。它回答“用什么运行”。 | Claude Code、Codex、OpenCode |
| **Agent Profile** | 用户选择和管理的 Agent 实体。它回答“谁来做事”。 | `Reviewer on Codex/gpt-5.4-high`、`Builder on Claude Code/sonnet` |
| **Agent Configuration** | Profile 的可编辑规则集合。它回答“按什么规则做事”。 | `AGENTS.md`、memory、上下文、聊天记录、工作目录、Skill、MCP、模型参数、审批策略 |
| **Execution Target** | 某次 Run 实际执行的位置。它回答“在哪里执行”。 | Local Edge、Remote Edge over SSH/Tailscale、Cloud Edge、Hub Relay target |

本地执行不依赖 Hub：Desktop 可以只连接 `127.0.0.1:3210` 的 Local Edge 完成项目、Thread、Run 和 Runtime adapter 调度。Hub 只在账号、团队 IM、多端同步、远程查看/审批、设备路由和中继场景进入链路。

<br>

## 产品分层

| 层 | 描述 | 阶段 |
|---|---|:---:|
| **Desktop Command Center** | 本地项目、线程、Agent 生命周期、工作树、Diff、审批、预览 | P0 |
| **IM Collaboration** | 单聊、群聊、@Agent、Orchestrator、多 Agent 审查、Agent 进度卡片 | P1 |
| **Hub Network** | 账号、好友、群聊、多端同步、Edge 中继、团队记忆和审计 | P2-P4 |

<br>

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + CSS Modules + OKLCH tokens + `@shared/ui` |
| Desktop | Tauri 2 |
| Edge Server | Go 1.25 + `net/http` + WebSocket + Agent Runtime adapters |
| Hub Server | Go 1.25 + Gin + GORM + PostgreSQL + Redis + Hub session；TokenDance ID bearer middleware 仅作兼容路径 |
| 实时通信 | WebSocket typed events |
| 数据库 | Hub: PostgreSQL + Redis；Edge: memory/file store |
| 协议 | REST JSON API + WebSocket typed events |

<br>

## 快速开始

首次克隆后先做本地开发初始化：

```powershell
.\scripts\setup.ps1
```

macOS/Linux:

```bash
./scripts/setup.sh
```

### 推荐本地链路

当前真实可用的本地执行链路是手动启动 Edge 和 Desktop。`scripts/dev-start.ps1` / `scripts/dev-start.sh` 仍引用旧 Hub 命令，修复前不要把它当作推荐入口。

终端 1：Edge Server。

```powershell
cd edge-server
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --agent-default claude-code
```

常用 Runtime 切换：

```powershell
go run ./cmd/agenthub-edge --runner-profile claude-code
go run ./cmd/agenthub-edge --runner-profile codex
go run ./cmd/agenthub-edge --runner-profile opencode
```

终端 2：Desktop Web UI。

```powershell
cd app/desktop
pnpm install
pnpm dev --port 5199
```

打开 `http://localhost:5199`。Desktop 默认连接 `http://127.0.0.1:3210` 和 `ws://127.0.0.1:3210/v1/events`。

### Hub 本地开发

Hub 需要 PostgreSQL 16 和 Redis 7。根目录 `docker-compose.yml` 可用于本地联调依赖和 Hub 容器；代码调试时可直接运行：

```powershell
cd hub-server
go run ./cmd/server-hub
```

默认配置来自 `hub-server/configs/config.yaml`：Hub HTTP `localhost:8080`，admin/pprof/metrics `localhost:6060`，Redis 默认 `localhost:6380`。

### Desktop 应用构建和实测

```powershell
cd app/desktop
pnpm build
pnpm tauri dev
```

`pnpm build` 只构建前端，不需要 Rust 工具链；`pnpm tauri dev` 需要 Rust 和 Tauri 系统依赖。Playwright 桌面 Web 预览使用 `http://localhost:5199`：

```powershell
cd app/desktop
pnpm test:e2e
```

注意：`scripts/client-smoke.ps1` 仍包含已删除 `runner/` 目录的历史检查，修复前不要把它作为通过/失败依据。

### 当前验证命令

文档改动至少运行：

```powershell
git diff --check
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
```

后端改动：

```powershell
cd edge-server
go test ./... -short -count=1

cd ..\hub-server
go test ./... -short -count=1
```

前端改动：

```powershell
cd app/desktop
pnpm test
pnpm build
pnpm typecheck

cd ..\web
pnpm typecheck
pnpm build
```

已知限制：`app/shared/src/ui` 的 React 类型解析和跨包虚拟存储会影响部分 shared-ui 测试/typecheck；提交前需要在变更说明中区分“新引入错误”和既有跨包限制。

<br>

## 项目结构

```text
AgentHub/
├── docs/                   # 主文档、handoff、roadmap、archive/reference
│   ├── product-requirements.md
│   ├── system-architecture.md
│   ├── implementation-guide.md
│   ├── handoff/STATE.md    # 当前状态 SSOT
│   └── reference/          # 调研和工程规格文档
├── app/
│   ├── desktop/            # Tauri 桌面端入口
│   ├── web/                # Web 工作台和页面预览
│   └── shared/             # 前端共享组件、状态、类型和 API/event client
├── hub-server/             # 中心 Hub：账号、IM、群聊、同步、中继
├── edge-server/            # Edge 节点：项目、上下文、run 生命周期、Runtime adapters
├── api/                    # REST API 和 WebSocket event 契约
└── scripts/                # 本地 setup、git hooks、联调脚本
```

Docker 和部署文件跟随所属模块放置。根级 compose 只用于跨模块本地联调。

<br>

## 文档导航

| 文档 | 描述 |
|---|---|
| [产品需求文档](docs/product-requirements.md) | 产品定位、用户、核心体验、阶段目标和比赛交付对应 |
| [系统架构文档](docs/system-architecture.md) | Desktop-Edge-Hub、Agent 产品模型、执行生命周期、通信方式和权威边界 |
| [功能实现文档](docs/implementation-guide.md) | 实现顺序、接口更新规则、Adapter 细节和验收命令 |
| [客户端路线图](docs/client-roadmap.md) | Desktop/Edge 客户端方向阶段任务和验收 |
| [API 契约](api/) | REST API 和 WebSocket typed events 的契约入口 |
| [调研索引](docs/reference/) | 跨仓库调研和工程规格 |
| [调研与历史归档](docs/archive/) | 旧版架构、协议、memory、workspace 等历史材料 |

在 `D:\Code\TokenDance` workspace 内做跨系统治理时，先看根级 `../AGENTS.md` 和 `../docs/`。其中 `../docs/system-architecture.md`、`../docs/identity-auth.md`、`../docs/design-system.md` 定义 TokenDance 级别的架构、身份鉴权和设计系统边界；本仓库 `docs/` 只负责 AgentHub 实现细节。

<br>

## TokenDance ID 鉴权边界

TokenDance ID 是跨产品身份入口；Hub session 是 AgentHub 自己的产品会话。最终浏览器/桌面登录必须由 Hub Server 作为 TokenDance ID relying party 完成 OIDC Authorization Code + PKCE 的 code exchange、验证 ID token 的 issuer/audience/JWKS、把 `tokendance_sub` 映射到 Hub user，再签发 Hub 本地 access/refresh session。

| 项 | 当前边界 |
|---|---|
| TokenDance ID | 统一第三方登录和账号主体；产品不直接集成 GitHub/Google/飞书 |
| Hub Server | 拥有 Hub callback、code exchange、Hub user 映射、Hub access/refresh session 和设备证明 |
| Desktop/Web | 打开系统浏览器或 Web 登录入口，保存 Hub session；不保存第三方 provider token |
| 兼容 bearer 路径 | `hub-server/internal/middleware/auth.go` 可验证 TokenDance ID RS256/JWKS bearer token，但它只是兼容路径，不能替代 Hub session |
| 本地执行 | Local Edge + Desktop 执行不依赖 Hub 登录；需要云端 IM、同步、远控或中继时才需要 Hub session |

<br>

## 参考项目

- [Claude Code Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)
- [OpenAI Codex CLI](https://github.com/openai/codex)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Multica](https://github.com/multica-ai/multica)
- [LibreChat](https://github.com/danny-avila/LibreChat)
- [Kanna](https://github.com/jakemor/kanna)
- [CloudCLI](https://github.com/siteboon/claudecodeui)

---

<div align="center">
<a href="README_EN.md">English</a> &nbsp;·&nbsp; <a href="docs/product-requirements.md">产品需求</a> &nbsp;·&nbsp; <a href="docs/system-architecture.md">系统架构</a> &nbsp;·&nbsp; <a href="api/">API 契约</a>
</div>
