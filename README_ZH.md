<div align="center">

# AgentHub

## IM 形态的多 Agent 协作平台

像用飞书/微信一样，拉群组织 Claude Code、Codex、OpenCode 等 AI Agent 协作完成网页、代码和部署。

[English](README.md) &nbsp;·&nbsp; [架构文档](docs/architecture.md) &nbsp;·&nbsp; [调研索引](docs/reference/)

<img src="https://img.shields.io/badge/状态-调研中-blue?style=flat-square" alt="status">
<img src="https://img.shields.io/badge/go-1.24+-00ADD8?style=flat-square&logo=go" alt="go">
<img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react" alt="react">
<img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square" alt="license">

</div>

<br>

## 这是什么

AgentHub 把 AI 编程 Agent 变成了 IM 联系人。你可以像在飞书群里 @同事一样，在群聊中 @ClaudeCode 写代码、@Codex 做审查、@Reviewer 提建议——所有交互都在一个聊天线程中完成。

**与现有工具的区别**：大多数 Claude Code GUI 是单人聊天壳。AgentHub 是多 Agent 协作平台——Orchestrator 规划、Claude Code 实现、Reviewer 审查，在同一个群聊中流转。

<br>

## 架构

```
Desktop UI ─→ Edge Server ─→ Runner ─→ Claude Code / Codex / OpenCode
                   ⇅
              Hub Server
```

| 组件 | 目录 | 职责 |
|------|------|------|
| **Hub Server** | `services/hub-server/` | 中心 IM：用户、联系人、群聊、消息路由、多端同步、Edge 中继 |
| **Edge Server** | `services/edge-server/` | 本地节点：项目、记忆、上下文、Runner 管理、同步到 Hub |
| **Runner** | `services/runner/` | 执行器：workspace、进程管理、Agent CLI 适配、Diff/预览/日志 |
| **Web UI** | `apps/web/` | React IM 界面：侧边栏、消息树、Diff 卡片、预览面板 |

> 任何能运行 Runner 的机器都是 **Edge Node**——你的笔记本、远程服务器、云端 VM。

<br>

## 演示流程

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
| **Desktop Command Center** | 本地项目、线程、工作树、Diff、审批、预览 | P0 |
| **IM Collaboration** | 单聊、群聊、@Agent、Orchestrator、多 Agent 审查 | P1 |
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
| 协议 | Protobuf + Buf + Connect-RPC |
| 编辑器 | Monaco Editor |

<br>

## 快速开始

```bash
# Edge Server（本地节点）
cd services/edge-server && go run ./cmd/main.go

# Runner（Agent 执行器）
cd services/runner && go run ./cmd/main.go

# Web UI
cd apps/web && pnpm dev
```

> P0 阶段不需要 Hub Server。Edge + Runner 可离线独立运行。

<br>

## 项目结构

```
AgentHub/
├── apps/                   # React 前端（web、desktop、mobile）
├── services/               # Go 后端（hub-server、edge-server、runner）
├── packages/               # 共享 Go + TS 库
├── proto/                  # Protobuf Schema（唯一协议源）
├── docs/                   # 架构 + 调研文档
│   └── reference/          # 65+ 份调研文档（14 个仓库深度分析）
├── .githooks/              # commit-msg + prepare-commit-msg
└── .agenthub/              # 项目记忆和规则
```

<br>

## 文档导航

| 文档 | 描述 |
|------|------|
| [架构文档](docs/architecture.md) | Hub-Edge-Runner 拓扑、部署模式、同步协议 |
| [调研索引](docs/reference/) | 65 份跨仓库深度分析，Agent 友好的四层结构 |
| [实现路线图](docs/reference/04-plan/01-research-to-implementation.md) | P0 最小系统、优先级矩阵、调研到代码映射 |
| [Protocol Schema](docs/reference/03-build/backend/13-protobuf-schema.md) | 6 个 .proto 文件 + buf.gen.yaml |

<br>

## 参考项目

- [Claude Code Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)
- [OpenAI Codex CLI](https://github.com/openai/codex)
- [OpenCode](https://github.com/anomalyco/opencode)
- [LibreChat](https://github.com/danny-avila/LibreChat)
- [Kanna](https://github.com/jakemor/kanna)
- [CloudCLI](https://github.com/siteboon/claudecodeui)

---

<div align="center">
<a href="README.md">English</a> &nbsp;·&nbsp; <a href="docs/architecture.md">Architecture</a> &nbsp;·&nbsp; <a href="docs/reference/">Research</a>
</div>
