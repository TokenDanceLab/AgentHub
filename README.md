# AgentHub

**IM 形态的多 Agent 协作平台** —— 像用飞书/微信一样，拉群组织 Claude Code、Codex、OpenCode 等 AI Agent 协作完成网页、代码和部署。

An IM-native multi-agent collaboration platform. Chat with AI Agents like teammates — @mention them, create group chats, and watch code, diffs, and previews unfold inline.

---

## 核心体验 / Core Experience

| 功能 | 说明 |
|------|------|
| **IM 聊天交互** | 单聊、群聊、@Agent、消息流、多会话并行 |
| **Agent 群聊协作** | 多个 Agent 像群成员一样协同工作，Orchestrator 自动拆任务分派 |
| **产物内联** | Diff 卡片、代码块、网页预览、文件附件直接嵌在聊天流 |
| **多 Agent 接入** | 统一适配器层，支持 Claude Code、Codex、OpenCode |
| **多端支持** | Web 主力端 + Tauri 桌面端 + PWA 移动端 |

## 架构 / Architecture

```
ui/ ──→ server/ ──→ agenthubd/ ──→ Claude Code / Codex / OpenCode
```

- **`ui/`** — React 前端，IM 聊天界面
- **`server/`** — 中心 IM Server（Go），用户/联系人/消息/群聊/调度
- **`agenthubd/`** — 本地 Daemon（Go），workspace/进程/Agent 执行/预览

详细 → [docs/architecture.md](docs/architecture.md)

## 技术栈 / Tech Stack

| 层 | 技术 |
|----|------|
| 前端 | React + TypeScript + Vite + shadcn/ui |
| IM Server | Go + WebSocket + SQLite |
| 本地 Daemon | Go + child_process + git |
| 桌面端 | Tauri |
| 移动端 | PWA |
| 代码编辑 | Monaco Editor |

## 快速开始 / Quick Start

```bash
# 启动中心 IM Server
cd server && go run ./cmd/main.go

# 启动本地 Daemon
cd agenthubd && go run ./cmd/main.go

# 启动前端
cd ui && pnpm dev
```

## 目录 / Structure

```
AgentHub/
├── ui/              # React 前端
├── server/           # 中心 IM Server（Go）
├── agenthubd/        # 本地 Daemon（Go）
├── protocol/         # 共享类型定义
├── docs/             # 产品文档 + 调研报告
├── .agenthub/        # 项目 Memory/规则
└── README.md
```

## 参考 / References

- [产品架构文档](docs/architecture.md)
- [开源仓库深度调研](docs/Research/)
