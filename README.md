<div align="center">

# AgentHub

## IM 形态的多 Agent 协作平台

像用飞书/微信一样，拉群组织 Claude Code、Codex、OpenCode 等 AI Agent 协作完成网页、代码和部署。

[English](README_EN.md) &nbsp;·&nbsp; [产品需求](docs/product-requirements.md) &nbsp;·&nbsp; [系统架构](docs/system-architecture.md) &nbsp;·&nbsp; [API 契约](api/)

<img src="https://img.shields.io/badge/状态-客户端_M1_收口中-blue?style=flat-square" alt="status">
<img src="https://img.shields.io/badge/go-1.24+-00ADD8?style=flat-square&logo=go" alt="go">
<img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react" alt="react">
<img src="https://img.shields.io/badge/license-Apache--2.0-lightgrey?style=flat-square" alt="license">

</div>

<br>

## 这是什么

AgentHub 把 AI 编程 Agent 变成了 IM 联系人。你可以像在飞书群里 @同事一样，在群聊中 @ClaudeCode 写代码、@Codex 做审查、@Reviewer 提建议——所有交互都在一个聊天线程中完成。

**与现有工具的区别**：大多数 Claude Code GUI 是单人聊天壳。AgentHub 是多 Agent 协作平台——Orchestrator 规划、Claude Code 实现、Reviewer 审查，在同一个群聊中流转。

当前仓库处于 **客户端 M1 收口** 阶段：已经跑通 Local Edge、Mock Run、WebSocket events 和 Desktop EventLog 的本地 mock 链路；完整 P0 还需要补齐 Project / Thread / Item 持久化、真实 Runner adapter、Diff / Artifact、Apply / Discard、Approval 和 Preview。

<br>

## 架构

```
Desktop UI ─→ Edge Server ─→ Runner ─→ Claude Code / Codex / OpenCode
                   ⇅
              Hub Server
```

| 组件 | 目录 | 职责 |
|------|------|------|
| **Hub Server** | `hub-server/` | 中心 IM：用户、联系人、群聊、消息路由、多端同步、Edge 中继 |
| **Edge Server** | `edge-server/` | 本地节点：项目、记忆、上下文、Runner 管理，P2+ 同步到 Hub |
| **Runner** | `runner/` | 执行器：workspace、进程管理、Agent CLI 适配、Diff/预览/日志 |
| **Desktop App** | `app/desktop/` | Tauri 桌面端入口，负责本地工作台体验 |
| **Web App** | `app/web/` | React IM 界面：侧边栏、消息树、Diff 卡片、预览面板 |
| **Shared App** | `app/shared/` | 前端共用组件、状态、API client 和事件 client |

> 任何能运行 Runner 的机器都是 **Edge Node**——你的笔记本、远程服务器、云端 VM。

<br>

## 演示流程

下面是目标体验，不代表当前 M1 已全部完成。当前 M1 只覆盖 mock run 和事件日志展示。

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
| 前端 | React 19 + TypeScript + Vite + shadcn/ui |
| Hub / Edge / Runner | Go 1.24 |
| 桌面端 | Tauri 2 |
| 移动端 | PWA |
| 实时通信 | WebSocket (coder/websocket) |
| 数据库 | SQLite + FTS5 (modernc.org/sqlite) |
| 协议 | REST JSON API + WebSocket typed events |
| 编辑器 | Monaco Editor |

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

### 当前 M1 本地链路

终端 1：启动 Local Edge。

```powershell
cd edge-server
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210
```

终端 2：启动 Desktop Web UI。日常开发优先用 Vite，避免每次都启动 Tauri 壳。

```powershell
cd app/desktop
pnpm install
pnpm dev --port 5199
```

浏览器打开 `http://localhost:5199`，可以看到 Edge online/offline、Mock Runner 和 EventLog。当前 M1 不包含 Project / Thread 工作台、真实 Agent CLI、Diff、Approval 或 Preview。

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
go test ./...

cd ..\runner
go test ./...

cd ..\app\desktop
pnpm test
pnpm build
pnpm test:e2e

cd ..\..
.\scripts\client-smoke.ps1
```

完整 P0 目标仍是 `Desktop UI -> Local Edge -> Local Runner -> Agent CLI`。当前 M1 使用 Mock Run 验证链路；下一步优先推进 M2 的 Edge 本地数据层和 EventStore，Desktop 启动编排可并行补齐，随后再进入真实 Runner adapter、Project / Worktree / Diff。

<br>

## 项目结构

```
AgentHub/
├── docs/                   # 三份主文档 + archive/reference/research
│   ├── product-requirements.md
│   ├── system-architecture.md
│   ├── implementation-guide.md
│   └── reference/          # 69 份调研和工程规格文档，包含 Multica Tier-0 参考
├── app/
│   ├── desktop/            # Tauri 桌面端入口
│   ├── web/                # Web UI
│   └── shared/             # 前端共享组件、状态和 API client
├── hub-server/             # 中心 Hub：账号、IM、群聊、同步、中继
├── edge-server/            # 本地 Edge：项目、上下文、Runner 管理
├── runner/                 # 执行器：Agent CLI、workspace、diff、preview、logs
├── api/                    # REST API 和 WebSocket event 契约
└── scripts/                # 本地 setup、git hooks、reference 同步脚本
```

Docker 配置不再放根级 `docker/`。如果某个模块需要容器化，就在对应模块内放自己的 `Dockerfile`、`compose.yaml` 或部署说明；只有需要一键联调多个模块时，才考虑新增根级 `compose.yaml`。

<br>

## 文档导航

| 文档 | 描述 |
|------|------|
| [产品需求文档](docs/product-requirements.md) | 产品定位、用户、核心体验、阶段目标和比赛交付对应 |
| [系统架构文档](docs/system-architecture.md) | Hub-Edge-Runner、组件职责、通信方式、权威模型 |
| [功能实现文档](docs/implementation-guide.md) | 三人分工、M1-M4 阶段路线、API 更新规则和验收命令 |
| [客户端路线图](docs/client-roadmap.md) | 客户端 M1-M4 阶段、当前分支、下一步任务 |
| [API 契约](api/) | REST API 和 WebSocket typed events 的契约入口 |
| [调研索引](docs/reference/) | 69 份跨仓库深度分析和工程规格，Agent 友好的四层结构 |
| [调研与历史归档](docs/archive/) | 旧版细分架构、协议、memory、workspace 等深度材料 |

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
