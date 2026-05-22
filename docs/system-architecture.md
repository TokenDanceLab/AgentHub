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

## 2. 组件职责

| 组件 | 目录 | 职责 |
|---|---|---|
| Web / Desktop UI | `app/` | IM 工作台、Thread、Diff、Preview、Approval |
| Hub Server | `hub-server/` | 中心 IM、账号、群聊、多端同步、Edge 中继 |
| Edge Server | `edge-server/` | 本地项目、Thread、Context、Runner 管理、Artifact 索引 |
| Runner | `runner/` | Agent CLI 进程、workspace、日志、Diff、Preview |
| API Contract | `api/` | REST API 和 WebSocket event 契约 |

## 3. 通信方式

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

## 4. 三条数据线

### 控制线

负责命令、调度、状态和审批：

```text
UI -> Edge -> Runner
UI -> Hub -> Edge -> Runner
```

### 事件线

负责实时输出和状态变化：

```text
Runner -> Edge -> UI
Edge -> Hub -> Web/Mobile
```

事件格式见 `api/events.md`。

### 同步线

负责 Edge 和 Hub 的事件同步：

```text
Edge EventStore -> Hub Sync -> other devices
```

P0 只要求本地 EventStore 语义清楚，不要求 Hub 完整实现。

## 5. 权威模型

系统必须区分两类权威：

| 权威 | 含义 |
|---|---|
| Conversation Authority | 谁负责消息主序列 |
| Execution Authority | 谁负责实际执行 AgentRun |

示例：

```text
本地 Thread：Conversation Authority = Edge，Execution Authority = Local Runner
Web 远控本机：Conversation Authority = Hub，Execution Authority = Desktop Edge / Runner
云端执行：Conversation Authority = Hub，Execution Authority = Cloud Edge / Runner
```

## 6. 数据模型主线

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

## 7. 部署阶段

| 阶段 | 拓扑 |
|---|---|
| P0 | Desktop UI -> Local Edge -> Local Runner |
| P1 | Local Edge + 多 Agent Thread |
| P2 | Edge <-> Hub 同步，Web/Mobile 查看和审批 |
| P3 | Hub Relay -> Desktop/Cloud Edge -> Runner |
| P4 | 完整团队 IM 和云端协作 |

## 8. 文档分层

主文档只保留三份：

- `docs/product-requirements.md`
- `docs/system-architecture.md`
- `docs/implementation-guide.md`

深度材料保留在：

- `docs/reference/`
- `docs/research/`
- `docs/archive/`

新增实现前，先看主文档；需要细节时再查 archive/reference。
