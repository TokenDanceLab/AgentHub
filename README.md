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
| **Protocol** | `packages/protocol/` | Edge / Hub / Runner / UI 共享的类型与事件定义 |

关键抽象：

```text
Desktop = UI + Edge Server + Local Runner + CLI Agent
Cloud Node = Headless Edge Server + Cloud Runner + CLI Agent
Hub Server = 中心 IM + 账号 + 同步 + 中继 + 远程控制
```

凡是能跑 Runner 的机器，都视为一个 **Edge Node**：本地电脑、同学电脑、实验室 Linux、云服务器都用同一套 Edge/Runner 模型。

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

---

## Tech Stack

| 层 | 技术 |
|----|------|
| 前端 | React + TypeScript + Vite + shadcn/ui |
| Hub / Edge / Runner | Go |
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
│   ├── protocol/             # 共享类型与事件定义
│   ├── transport/            # local/ssh/tailscale/hub-relay
│   ├── im-core/              # IM 共享逻辑 (Go)
│   ├── sync-core/            # EdgeEvent / Sync / Relay
│   ├── memory-core/          # Memory / Context 共享逻辑 (Go)
│   ├── artifact-core/        # Artifact 共享逻辑 (Go)
│   ├── adapters/             # Claude Code / Codex / OpenCode 适配层 (Go)
│   └── ui-kit/               # UI 组件库 (React)
├── docs/
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
- [开源仓库深度调研](docs/research/)
