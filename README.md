<div align="center">

# AgentHub

## IM 形态的多 Agent 协作平台

像用飞书/微信一样，拉群组织 Claude Code、Codex、OpenCode 等 AI Agent 协作完成网页、代码和部署。

[English](README_EN.md) &nbsp;·&nbsp; [产品需求](docs/product-requirements.md) &nbsp;·&nbsp; [系统架构](docs/system-architecture.md) &nbsp;·&nbsp; [API 契约](api/) &nbsp;·&nbsp; [官网](https://hub.vectorcontrol.tech)

<img src="https://img.shields.io/badge/状态-P0--P3_完成+M4-blue?style=flat-square" alt="status">
<img src="https://img.shields.io/badge/go-1.25+-00ADD8?style=flat-square&logo=go" alt="go">
<img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react" alt="react">
<img src="https://img.shields.io/badge/license-Apache--2.0-lightgrey?style=flat-square" alt="license">

</div>

<br>

## 这是什么

AgentHub 把 AI 编程 Agent 变成了 IM 联系人。你可以像在飞书群里 @同事一样，在群聊中 @ClaudeCode 写代码、@Codex 做审查、@Reviewer 提建议——所有交互都在一个聊天线程中完成。

**与现有工具的区别**：大多数 Claude Code GUI 是单人聊天壳。AgentHub 是多 Agent 协作平台——Orchestrator 规划、Claude Code 实现、Reviewer 审查，在同一个群聊中流转。

当前已完成：Edge Server 三大 Agent CLI 适配（Claude Code、Codex、OpenCode），Desktop IM 聊天式交互（React 19 + Tauri + TanStack Query + Zustand），Hub Server 三层架构（Gin/GORM/Redis/PostgreSQL，17 组迁移），以及 Edge-Hub 生产部署链路。P0-P3、M3b、M4、M5-M7 已完成；当前状态以 [docs/handoff/STATE.md](docs/handoff/STATE.md) 和 [路线图](docs/roadmap.md) 为准。

<br>

## 架构

```
Desktop UI ─→ Edge Server ─→ AgentAdapter ─→ Claude Code / Codex / OpenCode
                   ⇅
              Hub Server
```

| 组件 | 目录 | 职责 |
|------|------|------|
| **Hub Server** | `hub-server/` | 中心 IM：用户、联系人、群聊、消息路由、多端同步、Edge 中继 |
| **Edge Server** | `edge-server/` | 本地节点：项目、Thread、Run、EventStore、执行生命周期、Agent CLI 适配、P2+ 同步到 Hub |
| **Execution Runtime** | `edge-server/internal/lifecycle/`、`edge-server/internal/adapters/` | 进程管理、取消、权限门控、Claude/Codex/OpenCode 协议解析、Orchestrator 子 Agent 调度 |
| **Desktop App** | `app/desktop/` | Tauri 桌面端入口，负责本地工作台体验 |
| **Web App** | `app/web/` | React IM 界面：侧边栏、消息树、Diff 卡片、预览面板 |
| **Shared App** | `app/shared/` | 前端共用组件、状态、API client 和事件 client |

> 早期设计中曾有独立 `runner/` 目录；当前 Runner 能力已经合并进 Edge Server。任何能运行 Edge Server 和 Agent CLI adapter 的机器都是 **Edge Node**。

<br>

## 演示流程

以下为目标完整体验流（P1 多 Agent 协作阶段）：

```
你：@ClaudeCode 做一个带邮箱和 OAuth 的登录页

Orchestrator: 任务拆成 3 步——脚手架、实现、审查

Claude Code: 已创建 LoginPage.tsx，含表单验证
             [查看 Diff] [应用] [预览]

Reviewer: 缺少 loading 状态。建议补充边界处理。

Claude Code: 已修复。添加了 useFormStatus() 和 error boundary。

Orchestrator: 完成。预览地址 http://localhost:5173
              [部署] [分享] [归档]
```

<br>

## 产品分层

| 层 | 描述 | 阶段 |
|----|------|:---:|
| **Desktop Command Center** | 本地项目、线程、Agent 生命周期、工作树、Diff、审批、预览 | P0 |
| **IM Collaboration** | 单聊、群聊、@Agent、Orchestrator、多 Agent 审查、Agent 进度卡片 | P1 |
| **Hub Network** | 账号、好友、群聊、多端同步、Edge 中继、团队记忆 | P2-P4 |

<br>

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript + Vite + CSS Modules + `@shared/ui` |
| Hub Server | Go 1.25 + Gin + GORM + PostgreSQL + Redis + Hub JWT / TokenDance ID bearer-token middleware |
| Edge Server | Go 1.25 + `net/http` + WebSocket + AgentAdapter |
| 桌面端 | Tauri 2 |
| 移动端 | PWA |
| 实时通信 | WebSocket (coder/websocket) |
| 数据库 | Hub: PostgreSQL + Redis；Edge: 本地 store / file store |
| 协议 | REST JSON API + WebSocket typed events |

<br>

## 快速开始

首次克隆后先做本地开发初始化：

```bash
./scripts/setup.sh
```

Windows PowerShell：

```powershell
.\scripts\setup.ps1
```

需要参考仓库源码时：

```powershell
.\scripts\setup.ps1 -Reference core
```

### 一键启动（推荐）

```powershell
.\scripts\dev-start.ps1          # Windows
```

```bash
./scripts/dev-start.sh           # macOS/Linux
```

启动 Edge Server + Hub Server + Desktop 开发服务器，等待健康检查后打开浏览器。

### 手动启动

终端 1：Edge Server（需要 Claude Code CLI）。

```powershell
cd edge-server
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --claude-code-path claude --agent-default claude-code
```

终端 2：Desktop Web UI。

```powershell
cd app/desktop
pnpm install
pnpm dev --port 5199
```

打开 `http://localhost:5199`，输入 prompt 即可与 Claude Code 实时交互。支持 Markdown 渲染、Tool Call 卡片、Diff 内联、暗/亮主题切换。

### Desktop 应用构建

```powershell
cd app/desktop
pnpm install
pnpm build            # 仅构建前端，无需 Rust 工具链
pnpm tauri dev        # 启动 Tauri 开发窗口（需要 Rust 和 Tauri CLI）
```

> `pnpm build` 只构建前端，不需要 Rust 工具链。`pnpm tauri dev` 需要安装 [Rust](https://rustup.rs) 和 Tauri 系统依赖。

### 当前验证命令

```powershell
git diff --check

cd edge-server
go test ./... -short -count=1

cd ..\hub-server
go test ./... -short -count=1

cd ..\app\desktop
pnpm test
pnpm build
pnpm test:e2e

cd ..\..
.\scripts\client-smoke.ps1
```

完整 P0 链路 `Desktop UI -> Local Edge -> AgentAdapter -> Agent CLI` 已跑通，三大 Agent（Claude Code、OpenCode、Codex）通过统一 adapter 接口接入。

<br>

## 项目结构

```
AgentHub/
├── docs/                   # 主文档、handoff、roadmap、archive/reference
│   ├── product-requirements.md
│   ├── system-architecture.md
│   ├── implementation-guide.md
│   ├── handoff/STATE.md    # 当前状态 SSOT
│   └── reference/          # 69 份调研和工程规格文档，包含 Multica Tier-0 参考
├── app/
│   ├── desktop/            # Tauri 桌面端入口
│   ├── web/                # Web UI
│   └── shared/             # 前端共享组件、状态和 API client
├── hub-server/             # 中心 Hub：账号、IM、群聊、同步、中继
├── edge-server/            # 本地 Edge：项目、上下文、run 生命周期、Agent CLI adapters
├── api/                    # REST API 和 WebSocket event 契约
└── scripts/                # 本地 setup、git hooks、reference 同步脚本
```

Docker 配置不再放根级 `docker/`。如果某个模块需要容器化，就在对应模块内放自己的 `Dockerfile`、`compose.yaml` 或部署说明；只有需要一键联调多个模块时，才考虑新增根级 `compose.yaml`。

<br>

## 文档导航

| 文档 | 描述 |
|------|------|
| [产品需求文档](docs/product-requirements.md) | 产品定位、用户、核心体验、阶段目标和比赛交付对应 |
| [系统架构文档](docs/system-architecture.md) | Desktop-Edge-Hub、执行生命周期、通信方式、权威模型 |
| [功能实现文档](docs/implementation-guide.md) | 三人分工、M1-M4 阶段路线、API 更新规则和验收命令 |
| [客户端路线图](docs/client-roadmap.md) | 客户端 M1-M4 阶段、当前分支、下一步任务 |
| [API 契约](api/) | REST API 和 WebSocket typed events 的契约入口 |
| [调研索引](docs/reference/) | 69 份跨仓库深度分析和工程规格，Agent 友好的四层结构 |
| [调研与历史归档](docs/archive/) | 旧版细分架构、协议、memory、workspace 等深度材料 |

在 `D:\Code\TokenDance` workspace 内做跨系统治理时，先看根级 `../AGENTS.md` 和 `../docs/`。其中 `../docs/system-architecture.md`、`../docs/identity-auth.md`、`../docs/design-system.md` 定义 TokenDance 级别的架构、身份鉴权和设计系统边界；本仓库 `docs/` 只负责 AgentHub 实现细节。

<br>

## TokenDance ID 鉴权边界

AgentHub Hub Server 当前有双 JWT 兼容路径，但完整 TokenDance ID 浏览器登录 callback 尚未最终定稿。跨系统身份规则见 [../docs/identity-auth.md](../docs/identity-auth.md)。

| 项 | 当前实现 |
|----|----------|
| Callback | AgentHub Hub 的 TokenDance ID 浏览器登录 callback 未最终确定；AgentHub Home 的站点 callback 是 `https://hub.vectorcontrol.tech/api/auth/callback` |
| Token exchange | Hub 本地登录/注册仍走 `/client/auth/*`；Hub middleware 可接受 TokenDance ID 签发的 RS256 bearer token |
| Token storage | Hub 本地登录由客户端保存 Hub JWT；TokenDance ID bearer-token 路径不创建 Hub refresh session |
| Refresh | Hub 本地 refresh token 已实现；TokenDance ID refresh flow 尚未作为 Hub 浏览器登录流接入 |
| Logout | Hub 本地 logout 与 TokenDance ID `/logout` 分离 |
| JWKS validation | `hub-server/internal/middleware/auth.go` 先尝试 TokenDance ID RS256/JWKS，再 fallback 到 Hub 本地 HS256；当前 TokenDance ID 路径还缺少显式 issuer/audience 校验，是 P0 hardening 项 |

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
