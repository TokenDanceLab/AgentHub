<div align="center">

# AgentHub / AI 工作台

> 让 Claude Code、Codex、OpenCode 在同一 IM 工作台上协作

[![status](https://img.shields.io/badge/v0.3.0-活跃开发-blue?style=flat-square)](https://github.com/TokenDanceLab/AgentHub)
[![go](https://img.shields.io/badge/go-1.25+-00ADD8?style=flat-square&logo=go)](https://go.dev/)
[![react](https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![license](https://img.shields.io/badge/license-Apache--2.0-lightgrey?style=flat-square)](LICENSE)

[English](README_EN.md) &nbsp;·&nbsp; [官网](https://hub.vectorcontrol.tech)

</div>

<br>

<!-- 截图占位：Desktop 主界面 dark theme -->
<p align="center">
  <img src="screenshots/web-app.png" alt="AgentHub 工作台" width="80%">
</p>

---

## 三种 AI Runtime 统一调度 · IM 原生多 Agent 协作 · 团队审批流 · 中英双语 · Glass 拟态设计

<br>

## 核心卖点

| | |
|---|---|
| **三种 Runtime 统一** | 同一界面调度 Claude Code、Codex、OpenCode，不锁定单一模型或工具链 |
| **IM 原生协作** | 像飞书/微信一样拉群、@Agent、审批——不是又一个 IDE 插件 |
| **Hub-Edge 分布式** | 本地执行 + 云端同步 + 多端协作，数据不出本地，协作走云端 |

<br>

## 快速开始（5 步）

```powershell
# 1. 克隆仓库
git clone https://github.com/TokenDanceLab/AgentHub.git
cd AgentHub

# 2. 初始化开发环境
.\scripts\setup.ps1

# 3. 启动 Edge Server（选择一种 Runtime）
cd edge-server
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile claude-code

# 4. 启动 Desktop
cd ..\app\desktop
pnpm install
pnpm dev

# 5. 打开 http://localhost:5173 开始使用
```

> 需要先安装 Go 1.25+、Node.js 20+ 和 pnpm。详见 [架构文档](docs/architecture.md)。

<br>

## 功能对比

| 能力 | AgentHub | Cursor | Windsurf | Claude Code | Codex |
|------|:---:|:---:|:---:|:---:|:---:|
| 多 Agent 协作 | **IM 群聊** | 单人 | 单人 | 实验性 | 单人 |
| 多 Runtime 支持 | **3 种** | 自有 | 自有 | Claude 专用 | OpenAI 专用 |
| 中英双语 | **完整** | 英文 | 英文 | 英文 | 英文 |
| 本地执行 | **Tauri 桌面端** | VS Code 插件 | VS Code 插件 | CLI | CLI |
| 移动端 | **Android 原生** | 无 | 无 | 无 | Web |
| 团队审批流 | **内置** | 无 | 无 | 权限弹窗 | 无 |
| 多端同步 | **Hub 云端** | 无 | 无 | 无 | 无 |
| 设计系统 | **Glass 拟态** | VS Code 主题 | VS Code 主题 | TUI | Web Dashboard |
| MCP 生态 | 规划中 | 完整 | 完整 | 最完整 | 无 |
| 定价 | **开源免费** | $20/月 | $20/月 | API 计费 | $20/月 |

> AgentHub 是 IM 层的创新——不替代任何 Runtime，而是让它们在同一工作台上协作。

<br>

## 架构

```text
Desktop / Mobile / Web
        |
   Edge Server (Go) ── Agent Runtime Adapter ── Claude Code / Codex / OpenCode
        |
   Hub Server (Go) ── PostgreSQL + Redis
```

| 组件 | 职责 |
|------|------|
| **Desktop App**（Tauri） | 本地执行工作台，IM 聊天、Diff 审批、多 Agent 管理 |
| **Web App** | 浏览器工作台，远程查看、审批协作 |
| **Mobile App**（Tauri Android） | 移动端 IM、审批、预览 |
| **Edge Server** | 本地执行节点，Agent CLI 进程管理，EventStore |
| **Hub Server** | 账号、IM 群聊、多端同步、设备路由、审计 |
| **Agent Runtime** | Claude Code / Codex / OpenCode CLI 适配器 |

本地执行不依赖 Hub——Desktop 只连 Local Edge 即可完成项目、线程、Run 全流程。Hub 用于云端 IM、多端同步、远程审批。

<br>

## 产品分层

| 层 | 描述 | 阶段 |
|---|------|:---:|
| **Desktop Command Center** | 本地项目、Thread、Run、Diff、审批、Preview | P0 ✅ |
| **IM Collaboration** | 单聊、群聊、@Agent、多 Agent 审查、进度卡片 | P1 🔧 |
| **Hub Network** | 账号、好友、多端同步、Edge 中继、审计 | P2-P4 📋 |

<br>

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 19 + TypeScript + Vite + CSS Modules + OKLCH tokens |
| Desktop | Tauri 2.5 |
| Mobile | Tauri 2.5（Android） |
| Edge Server | Go 1.25 + WebSocket + Agent Runtime adapters |
| Hub Server | Go 1.25 + Gin + GORM + PostgreSQL + Redis |
| 实时通信 | WebSocket typed events |
| 共享组件 | `@shared/ui` — 通用 UI 组件库 |

<br>

## 项目结构

```text
AgentHub/
├── app/
│   ├── desktop/          # Tauri 桌面端
│   ├── web/              # Web 工作台
│   ├── mobile/           # Mobile 端
│   └── shared/           # 前端共享类型、API client、@shared/ui
├── edge-server/          # Edge 执行节点
├── hub-server/           # Hub 中心服务
├── api/                  # API 契约（OpenAPI + WebSocket events）
├── docs/                 # 文档
│   ├── architecture.md   # 产品定位 + 系统架构 + 实现状态
│   ├── roadmap.md        # 当前主线与任务优先级
│   ├── desktop-web-v4-clean-rebuild-plan.md
│   ├── adr/              # 架构决策记录
│   ├── designs/          # 组件设计文档
│   ├── governance/       # 安全台账、分支治理、文档标准
│   ├── reference/        # 调研与竞品分析
│   ├── operations/       # 运维文档
│   └── archive/          # 历史评审与归档
└── scripts/              # 初始化脚本、git hooks
```

<br>

## 文档导航

| 文档 | 面向 |
|------|------|
| [架构文档](docs/architecture.md) | 产品定位、系统架构、实现状态（首选入口） |
| [路线图](docs/roadmap.md) | 当前主线、阶段任务和验收口径 |
| [v4 重构计划](docs/desktop-web-v4-clean-rebuild-plan.md) | Desktop/Web shared workbench clean rebuild |
| [API 契约](api/) | REST + WebSocket 接口定义 |
| [安全风险台账](docs/governance/security-risk-register.md) | 安全风险登记与追踪 |

<br>

## 鉴权

本地执行无需登录。使用云端 IM、多端同步或远程控制时，通过 TokenDance ID 统一登录。

<br>

---

<p align="center">
  <a href="README_EN.md">English</a> &nbsp;·&nbsp;
  <a href="docs/architecture.md">系统架构</a> &nbsp;·&nbsp;
  <a href="api/">API 契约</a>
</p>
