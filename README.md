# AgentHub

**IM 形态的多 Agent 协作平台** —— 像用飞书/微信一样，拉群组织 Claude Code、Codex、OpenCode 等 AI Agent 协作完成网页、代码和部署。

An IM-native multi-agent collaboration platform. Chat with AI Agents like teammates — @mention them, create group chats, and watch code, diffs, and previews unfold inline.

---

## Architecture

AgentHub 采用 **Hub-Edge-Runner** 架构。

```
Desktop UI ─→ Edge Server ─→ Runner ─→ Claude Code / Codex / OpenCode
                   ⇅
              Hub Server
```

| 组件 | 目录 | 职责 |
|------|------|------|
| **Hub Server** | `services/hub-server/` | 中心 IM Server：用户/登录、好友、群聊、消息路由、多端同步、Edge 注册、远程中继、权限 |
| **Edge Server** | `services/edge-server/` | 边缘控制节点：跑在 Desktop、远程机器或 Cloud 节点上，负责项目、Memory、Context、Runner 管理，可同步到 Hub |
| **Runner** | `services/runner/` | 执行节点：workspace、进程、Agent CLI 适配、Diff、Preview、日志 |
| **Web UI** | `apps/web/` | React 前端，IM 聊天界面 |
| **Desktop** | `apps/desktop/` | Tauri 壳，内置 Web UI + Edge + Runner |
| **Protocol** | `packages/protocol/` | schema-first 共享协议，生成 Edge / Hub / Runner / UI 类型与事件定义 |

关键抽象：

```text
Desktop = UI + Edge Server + Local Runner + CLI Agent
Cloud Node = Headless Edge Server + Cloud Runner + CLI Agent
Hub Server = 中心 IM + 账号 + 同步 + 中继 + 远程控制
```

凡是能跑 Runner 的机器，都视为一个 **Edge Node**：本地电脑、同学电脑、实验室 Linux、云服务器都用同一套 Edge/Runner 模型。

### Product Layers

AgentHub 有三层产品能力：

1. **Desktop Command Center**：本地 Project / Thread / Worktree / Diff / Approval / Preview / AGENTS.md。
2. **IM Collaboration**：单聊、群聊、`@Agent`、Orchestrator、多 Agent review。
3. **Hub Network**：账号、好友、群聊、多端同步、Edge Relay、Cloud Edge、团队 Memory。

P0 的体验核心是 Desktop Command Center，不是完整好友/群聊平台。

### Hub vs Edge

| | Hub Server（中心） | Edge Server（本地） |
|---|---|---|
| 类比 | 飞书/微信后端 | 你电脑上的后台服务 |
| 管 | 人、消息、联系人、群组、多端同步、中继、权限 | 项目、Memory、Context、Runner、Preview、Artifact |
| 部署 | 云端 / 公网服务器 | Desktop 本机 / 远程机器 / Cloud 节点 |
| 离线 | 不可用 | 可独立运行 |

### Topologies

AgentHub 从第一天按完整拓扑设计，但实现可按阶段落地。

| 场景 | 控制路径 | 执行位置 |
|---|---|---|
| Desktop 本地离线 | Desktop UI → Local Edge → Local Runner | 本机 |
| Desktop 本地在线 | Local Edge → Local Runner，Edge ⇄ Hub 同步 | 本机 |
| Desktop 直连远程 Desktop | Local Edge → SSH/Tailscale → Remote Edge → Runner | 远程电脑 |
| Desktop 中继远程 Desktop | Local Edge/Hub → Hub Relay → Remote Edge → Runner | 远程电脑 |
| Desktop 直连 Cloud | Local Edge → SSH/Tailscale → Cloud Edge → Runner | 云服务器 |
| Desktop 中继 Cloud | Hub → Cloud Edge → Runner | 云服务器 |
| Web 中继 Desktop | Web UI → Hub → Desktop Edge → Runner | 用户电脑 |
| Web 中继 Cloud | Web UI → Hub → Cloud Edge → Runner | 云服务器 |

详细架构 → [docs/architecture.md](docs/architecture.md)  
完整拓扑 → [docs/topology.md](docs/topology.md)

### Implementation Plan

AgentHub 从第一天按完整 Hub-Edge-Runner 拓扑设计，但实现按阶段落地。

| Phase | Scope | Goal |
|---|---|---|
| P0 | Desktop UI + Local Edge Server + Local Runner | Local agent command center |
| P1 | Multi-Agent Thread + Orchestrator | Claude Code / Codex / OpenCode 协作 |
| P2 | Edge-Hub sync | Web/Mobile 状态查看和远程审批 |
| P3 | Hub Relay + Cloud Edge | 远程 Desktop/Cloud 执行 |
| P4 | Full IM Collaboration | 好友、群聊、团队 Memory |

P0 不要求 Hub Server 完整可用。Hub API 可以先 stub，Edge 与 Runner 先跑通本地闭环。Hub、Edge、Runner 从 P0 起按 Go 服务实现；TypeScript 只用于 UI 和生成协议类型。

---

## Tech Stack

| 层 | 技术 |
|----|------|
| 前端 | React + TypeScript + Vite + shadcn/ui |
| Hub / Edge / Runner | Go（P0 起即使用 Go，不做 Node 后端原型） |
| 桌面端 | Tauri |
| 移动端 | PWA |
| IM 持久化 | SQLite / PostgreSQL |
| 实时通信 | WebSocket |
| 代码编辑 | Monaco Editor |

---

## Project Structure

```
AgentHub/
├── apps/
│   ├── web/                  # React Web UI
│   ├── desktop/              # Tauri Desktop
│   └── mobile/               # PWA / Capacitor
├── services/
│   ├── hub-server/           # 中心 Hub Server (Go)
│   ├── edge-server/          # Desktop/Cloud Edge Server (Go)
│   └── runner/               # Runner 执行节点 (Go)
├── packages/
│   ├── protocol/             # schema-first 协议：schema + generated TS/Go
│   ├── transport/            # route model / resolver / client interfaces
│   ├── im-core/              # IM 共享逻辑 (Go)
│   ├── agent-core/           # Project / Thread / Turn / Item / AgentRun (Go)
│   ├── workspace-core/       # workspace / worktree / patch metadata (Go)
│   ├── approval-core/        # approval request / decision / policy metadata (Go)
│   ├── sync-core/            # EdgeEvent / Sync / Relay
│   ├── memory-core/          # Memory / Context 共享逻辑 (Go)
│   ├── artifact-core/        # Artifact 共享逻辑 (Go)
│   ├── adapters/             # Claude Code / Codex / OpenCode 适配层 (Go)
│   └── ui-kit/               # UI 组件库 (React)
├── docs/
│   ├── architecture.md       # Hub-Edge-Runner 主架构
│   ├── topology.md           # 完整拓扑和八种连接场景
│   ├── protocol.md           # schema-first 协议边界
│   ├── product-model.md      # Command Center / IM / Hub 产品层
│   ├── data-model.md         # Project / Conversation / Thread / Turn / Item
│   ├── agent-loop.md         # Go Edge → Runner → Agent loop
│   ├── workspace.md          # worktree / patch / apply / discard
│   ├── approvals.md          # command/file/deploy approvals
│   ├── memory.md             # .agenthub / AGENTS.md / Context Builder
│   ├── implementation-plan.md # P0-P4 implementation plan
│   ├── codex-app-reference.md # Codex App ideas adapted to AgentHub
│   ├── authority.md          # Conversation/Execution/Artifact/Memory 权威
│   └── data-plane.md         # Preview/Artifact/Local Fast Path
├── scripts/
├── docker/
└── .agenthub/                # 项目 Memory / Rules
```

---

## Quick Start

```bash
# Hub Server (中心 IM)
cd services/hub-server && go run ./cmd/main.go

# Edge Server (本地)
cd services/edge-server && go run ./cmd/main.go

# Runner
cd services/runner && go run ./cmd/main.go

# Web UI
cd apps/web && pnpm dev
```

---

## References

- [架构文档](docs/architecture.md)
- [拓扑文档](docs/topology.md)
- [产品模型](docs/product-model.md)
- [数据模型](docs/data-model.md)
- [Agent Loop](docs/agent-loop.md)
- [Workspace/Worktree](docs/workspace.md)
- [Approval 机制](docs/approvals.md)
- [Memory/Context](docs/memory.md)
- [实现计划](docs/implementation-plan.md)
- [协议文档](docs/protocol.md)
- [权威模型](docs/authority.md)
- [数据面设计](docs/data-plane.md)
- [开源仓库深度调研](docs/Research/)
