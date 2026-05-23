# AgentHub 系统架构文档

## 1. 总体架构

AgentHub 采用 Hub-Edge-Runner 架构。

```text
Desktop UI -> Edge Server -> Runner -> Claude Code / Codex / OpenCode
                   ⇅
              Hub Server
```

核心原则：

- Desktop 是一个 Edge Node，不只是客户端。
- 所有能运行 Runner 的机器都视为 Edge Node。
- Runner 只负责执行，不负责 IM。
- Hub 负责账号、IM、多端同步、中继和权限。
- UI 只负责交互，不直接控制 Agent CLI。

## 2. 当前 M3 本地拓扑

当前仓库已跑通真实 Agent CLI 集成链路：

```text
Desktop Web UI
  -> Local Edge Server
  -> AgentAdapter (Claude Code / Codex / OpenCode)
  -> NDJSON Parse -> WebSocket events
  -> Desktop EventLog
```

M1 的 Mock Run 已被真实 CLI adapter 取代。Edge 通过 AgentAdapter 直接调用 Claude Code、Codex 和 OpenCode 的原生协议。

完整 P0 的本地拓扑是：

```text
Desktop App
  ├─ Desktop UI
  ├─ Local Edge Server
  ├─ Local Runner
  └─ Agent CLI
       ├─ Claude Code
       ├─ Codex
       └─ OpenCode
```

P0 边界：

- Hub Server 不是 P0 运行依赖。
- Web/Mobile 不是 P0 执行入口。
- Desktop UI 默认只连接本机 Local Edge。
- Edge 才能启动 Runner，UI 不直接启动 Agent CLI。
- Runner 只在授权 workspace 或 worktree 内执行。

## 3. 组件职责

| 组件 | 目录 | 职责 |
|---|---|---|
| Web / Desktop UI | `app/` | IM 工作台、Thread、Diff、Preview、Approval |
| Hub Server | `hub-server/` | 中心 IM、账号、群聊、多端同步、Edge 中继 |
| Edge Server | `edge-server/` | 本地项目、Thread、Context、Runner 管理、Artifact 索引 |
| Runner | `runner/` | Agent CLI 进程、workspace、日志、Diff、Preview |
| API Contract | `api/` | REST API 和 WebSocket event 契约 |

## 4. 通信方式

当前主协议是：

```text
REST JSON API + WebSocket typed events
```

| 通信 | 方式 | 用途 |
|---|---|---|
| UI -> Edge | REST JSON | 查询项目、创建 Thread、启动 Run、审批 |
| Edge -> UI | WebSocket typed events | 消息增量、run output、artifact、preview、审批请求 |
| Edge -> Runner | 本地 REST / event stream | 启动执行、取消执行、读取产物 |
| Runner -> Edge | typed events | 日志、状态、Diff、Artifact、Preview |
| Edge -> Hub | REST sync + reverse WebSocket | 同步、注册、中继、远程控制 |
| Web/Mobile -> Hub | REST JSON + WebSocket | 云端会话、远程查看、远程审批 |

Protobuf、Connect-RPC、JSON-RPC 不是当前主线；只作为未来可选或局部 bridge 方案。

安全边界：

- WebSocket 只投递事件，不承载普通查询或命令。
- UI 不能绕过 Edge 直接访问远程 Runner。
- Runner 不默认读取用户全盘、本机密钥、浏览器数据或系统配置。
- 日志和事件不应包含 token、cookie、私钥、真实服务器隐私。

## 5. 三条数据线

### 控制线

负责命令、调度、状态和审批：

```text
UI -> Edge -> AgentAdapter -> Agent CLI
UI -> Hub -> Edge -> AgentAdapter -> Agent CLI
```

### 事件线

负责实时输出和状态变化：

```text
Agent CLI -> Edge EventStore -> Edge WebSocket Bus -> UI
Edge EventStore -> Hub Sync -> Web/Mobile
```

当前 `edge-server/internal/events/bus.go` 是内存投递组件：负责 seq、短历史 replay 和 WebSocket fanout。它不是完整持久 EventStore。M2 需要把 EventStore 落到 Edge 本地存储。

### 同步线

负责 Edge 和 Hub 的事件同步：

```text
Edge EventStore -> Hub Sync -> other devices
```

P0 只要求本地 EventStore 语义清楚，不要求 Hub 完整实现。

## 6. EventStore 和恢复语义

P0/M2 的 EventStore 语义：

1. Edge 先把事件持久化到 EventStore，再投递到 WebSocket。
2. `seq` 是单个 Edge EventStore 内的单调递增序号。
3. UI 断线重连时带上 `cursor`，Edge replay `seq > cursor` 的事件。
4. 如果 cursor 太旧、历史被清理或 Edge 无法 replay，UI 拉 REST snapshot 重建状态。
5. Edge 重启后，Project、Thread、Run、Item、Artifact 的关键状态必须能从本地 store 恢复。

最小恢复路径：

| 场景 | 恢复方式 |
|---|---|
| WebSocket 断线 | UI 用最后的 `seq` 作为 cursor 重连 |
| cursor 过期 | UI 拉 Project/Thread/Run/Item REST snapshot |
| Edge 重启 | Edge 从本地 store 恢复 snapshot，再继续分配 seq |
| Agent CLI 崩溃 | Edge 将 Run 标为 failed，并记录 error Item |
| 慢订阅者丢事件 | WebSocket Bus 可丢短实时事件，UI 通过 snapshot 校正 |

## 7. 权威模型

系统必须区分多类权威：

| 权威 | 含义 |
|---|---|
| Conversation Authority | 谁负责消息主序列 |
| Execution Authority | 谁负责实际执行 AgentRun |
| Artifact Authority | 谁负责产物索引、读取和应用 |
| Memory Authority | 谁负责项目规则、摘要和上下文 |

示例：

```text
本地 Thread：Conversation Authority = Edge，Execution Authority = AgentAdapter / Agent CLI
Web 远控本机：Conversation Authority = Hub，Execution Authority = Desktop Edge / AgentAdapter
云端执行：Conversation Authority = Hub，Execution Authority = Cloud Edge / AgentAdapter
```

### P0 数据权威表

| 数据 | P0 写入方 | P0 存储位置 | 未来同步关系 |
|---|---|---|---|
| Project | Edge | Edge 本地 store | Hub 可同步元数据 |
| Conversation | Edge | Edge 本地 store | Hub 可成为云端主序列 |
| Thread | Edge | Edge 本地 store | Hub 同步摘要和状态 |
| Turn / AgentRun | Edge | Edge 本地 store | Hub 同步状态镜像 |
| Item | Edge | Edge EventStore / item store | Hub 同步消息和摘要 |
| Artifact | Agent CLI 生成，Edge 索引 | workspace + Edge artifact index | Hub 同步 metadata，可按需缓存内容 |
| Approval | Edge 生成，UI 决策 | Edge 本地 store | Hub 可远程审批 |
| Preview | Agent CLI 启动，Edge 路由 | Edge preview registry | Hub 可代理远程访问 |
| Memory | Edge Context Builder | `.agenthub/` + Edge 本地 store | Hub 可同步团队 memory |

## 8. 数据模型主线

```text
Project
  -> Conversation
    -> Thread
      -> Turn / AgentRun
        -> Item
          -> Artifact / Approval / Preview
```

解释：

- Conversation 是 IM 外壳。
- Thread 是任务分支。
- Turn / AgentRun 是一次执行。
- Item 是过程事件或消息。
- Artifact 是可审查产物，例如 Diff、文件、预览地址。

REST snapshot 至少应能按 Project、Thread、Run、Item、Artifact 重建 UI 状态。WebSocket event 负责增量，REST snapshot 负责校正和恢复。

## 9. 部署阶段

| 阶段 | 拓扑 |
|---|---|
| M1 | Desktop UI -> Local Edge -> Mock Run -> WebSocket events |
| P0 | Desktop UI -> Local Edge -> Local Runner -> Agent CLI |
| P1 | Local Edge + 多 Agent Thread |
| P2 | Edge <-> Hub 同步，Web/Mobile 查看和审批 |
| P3 | Hub Relay -> Desktop/Cloud Edge -> Runner |
| P4 | 完整团队 IM 和云端协作 |

## 10. 文档分层

主文档只保留三份：

- `docs/product-requirements.md`
- `docs/system-architecture.md`
- `docs/implementation-guide.md`

深度材料保留在：

- `docs/reference/`
- `docs/archive/`

`docs/research/` 若保留，只作为旧研究草稿或未整理材料，不作为常规阅读入口。新增实现前，先看主文档；需要细节时再查 `docs/reference/`，历史方案再查 `docs/archive/`。
