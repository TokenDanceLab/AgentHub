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
| **Hub Server** | `services/hub/` | 中心 IM Server：用户/登录、好友、群聊、消息路由、多端同步、Edge 注册、远程中继 |
| **Edge Server** | `services/edge/` | 本地 Server：跑在 Desktop 内，负责本地会话、Memory、Context、Runner 管理，可同步到 Hub |
| **Runner** | `services/runner/` | 执行节点：workspace、进程、Agent CLI 适配、Diff、Preview、日志 |
| **Web UI** | `apps/web/` | React 前端，IM 聊天界面 |
| **Desktop** | `apps/desktop/` | Tauri 壳，内置 Web UI + Edge + Runner |
| **Protocol** | `packages/protocol/` | Edge / Hub / Runner / UI 共享的类型与事件定义 |

### Hub vs Edge

| | Hub Server（中心） | Edge Server（本地） |
|---|---|---|
| 类比 | 飞书/微信后端 | 你电脑上的后台服务 |
| 管 | 人、消息、联系人、群组、多端同步 | 文件、进程、Agent、Preview、项目 Memory |
| 部署 | 云端（P2）或本地（P0） | 永远在用户本机 |
| 离线 | 不可用 | 可独立运行 |

### 四种部署模式

**P0 Desktop 全本地**：UI + Edge + Runner + Hub 全跑在 127.0.0.1

**P1 Desktop + Hub 同步**：Edge 主动连云端 Hub，手机查看任务状态

**P2 移动远程控制**：Mobile UI → Hub → Edge → Runner

**P3 全云端**：Web → Hub → Cloud Runner（Docker）

详细架构 → [docs/architecture.md](docs/architecture.md)

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
│   ├── hub/                  # 中心 IM Server (Go)
│   ├── edge/                 # 本地 Edge Server (Go)
│   └── runner/               # Runner 执行节点 (Go)
├── packages/
│   ├── protocol/             # 共享类型与事件定义
│   ├── im-core/              # IM 共享逻辑 (Go)
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
cd services/hub && go run ./cmd/main.go

# Edge Server (本地)
cd services/edge && go run ./cmd/main.go

# Runner
cd services/runner && go run ./cmd/main.go

# Web UI
cd apps/web && pnpm dev
```

---

## References

- [架构文档](docs/architecture.md)
- [开源仓库深度调研](docs/Research/)
