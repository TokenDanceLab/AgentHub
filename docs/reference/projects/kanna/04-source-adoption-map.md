# Kanna `->` AgentHub 源码级采纳映射

> 生成日期: 2026-05-24 | 基准: Kanna v0.41.5 `<>` AgentHub `dev/delicious233`

---

## 1. 流式 / WebSocket 架构

### 1.1 主题化订阅 `<>` 全频道广播

**Kanna** `reference/kanna/src/shared/protocol.ts:44-52` — `SubscriptionTopic` 支持 8 种细粒度话题类型:
`sidebar`, `local-projects`, `update`, `keybindings`, `app-settings`, `chat`, `project-git`, `terminal`。

**AgentHub** `edge-server/internal/events/bus.go:49-85` — `Bus.Publish()` 对**所有订阅者**扇出，无话题过滤。
WebSocket 客户端收到全部事件后自行筛选，在大量聊天/项目时造成带宽浪费。

**变更**: 在 `EventEnvelope` 中引入 `Topic string` 字段，在 `Subscribe()` 时记录 `subscriber.topic`，
在 `Publish()` 时只路由到匹配的订阅者。

**优先级**: **P1** — 架构正确性。当前 N 个聊天 = N 倍无过滤广播。

---

### 1.2 快照签名去重 `<>` 全量推送

**Kanna** `reference/kanna/src/server/ws-router.ts:789-801` — `pushSnapshots()` 对每个订阅维护
`snapshotSignatures` Map。每次推送前对比 JSON 签名，相同则跳过，避免不必要重绘。

**AgentHub** `edge-server/internal/api/handlers.go:488-505` — WebSocket 循环无条件推送每一条
`EventEnvelope`，无论客户端是否已拥有相同状态。

**变更**: 在 `events.Bus` 或 API handler 层引入 `lastSentSeq` 追踪，或为 REST/WS 客户端暴露
`If-None-Match` 风格的摘要校验。服务器端按会话维护 `topicSignature` Map。

**优先级**: **P1** — 高频事件流（`text_delta`）时会放大走样。与 1.1 配合解决。

---

### 1.3 延迟广播批处理 (16ms debounce)

**Kanna** `reference/kanna/src/server/ws-router.ts:874-896` — `scheduleBroadcast()` 和
`scheduleChatStateBroadcast()` 将所有状态变更聚合到 16ms 定时器，同一帧内的多次变更合并为一次
`broadcastSnapshots()` 或 `broadcastFilteredSnapshots()`。

**AgentHub** `edge-server/internal/events/bus.go:76-83` — 每次 `Publish()` 立即扇出到所有
订阅者 channel，无任何合并。

**变更**: 在 Bus 层添加可选的批处理模式：累积 16ms 窗口内的事件，合并 scope 相同的相邻事件后再扇出。

**优先级**: **P2** — 性能优化。高速工具调用链（每工具 3-5 事件）会在当前架构中造成背压。

---

### 1.4 客户端 WebSocket 抽象

**Kanna** `reference/kanna/src/client/app/socket.ts:37-404` — `KannaSocket` 类封装:
- 自动重连（指数退避 750ms-5s）
- 心跳 (15s ping) + 超时检测 (4s timeout, 25s 陈旧连接)
- 可见性变化时暂停/恢复心跳
- `subscribe()`/`command()`/`onStatus()` API
- 离线消息排队重放

**AgentHub** — 无客户端 WebSocket 抽象。`app/desktop` 使用直接 `fetch()` + `EventSource` 调用
（`@/api/edgeClient`），不具备断线重连或心跳。

**变更**: 将 `KannaSocket` 移植到 AgentHub 的 `app/desktop/src/api/socket.ts`，适配
AgentHub 的 `EventEnvelope` 协议。保留重连、排队、心跳。

**优先级**: **P0** — 桌面端连接可靠性。无自动重连用户必须手动刷新。

---

## 2. Agent 编排 (AgentCoordinator)

### 2.1 主动 Turn 管理 `<>` 无状态执行

**Kanna** `reference/kanna/src/server/agent.ts:674-693` — `AgentCoordinator` 维护:
- `activeTurns: Map<string, ActiveTurn>` — 当前正在执行的 turn
- `drainingStreams: Map<string, { turn: HarnessTurn }>` — 结果已到达但流未关闭的 turn
- `claudeSessions: Map<string, ClaudeSessionState>` — 跨 turn 复用的长生命周期会话

**AgentHub** — 无等效协调器。`lifecycle.ProcessExecutor` 启动/取消进程但不跟踪 turn 状态。
UI 通过轮询 store 来推测状态。

**变更**: 实现 `edge-server/internal/agents/coordinator.go`，参考 Kanna 的 `AgentCoordinator`:
- `activeRuns` Map 跟踪当前执行
- `drainingRuns` 处理结果已到达但后台任务仍在运行的场景
- run 状态机: `queued -> starting -> running -> waiting_for_user -> draining -> idle`

**优先级**: **P0** — AgentHub 缺少多 agent 并发执行的核心抽象。

---

### 2.2 消息队列 (enqueue/steer/dequeue)

**Kanna** `reference/kanna/src/server/agent.ts:1119-1228` — 当 turn 活跃时，新消息通过
`enqueueMessage()` 进入队列。turn 结束时通过 `maybeStartNextQueuedMessage()` 自动出队。
`steer()` 取消当前 turn 并立即启动指定排队消息。

**AgentHub** — 无消息队列。POST `/v1/runs` 直接启动执行；如果已有 run 在运行，行为未定义。

**变更**: 在 `coordinator.go` 中实现队列:
- `EnqueueMessage(runID, message)` 
- `DequeueAndStart(runID, queuedMessageID)`
- `SteerMessage(runID, queuedMessageID)` — 取消当前 + 立即启动目标

**优先级**: **P1** — 用户核心工作流: 在 agent 思考时继续发送指令。

---

### 2.3 Session 跨 Turn 复用

**Kanna** `reference/kanna/src/server/agent.ts:1054-1117` — `startClaudeTurn()` 检查
`this.claudeSessions.get(chatId)`。如果 session 存在且参数（cwd/model/effort）匹配，则复用；
否则关闭旧 session 并创建新的。session 通过 `runClaudeSession()` 在后台持续流式传输，
跨多个 turn 维持上下文。

**AgentHub** `edge-server/internal/adapters/claude_code.go:103-110` — `BuildCommand()` 支持
`--resume <sessionID>` 和 `--continue`，但 session 生命周期由 CLI 管理，Edge 不跟踪。

**变更**: 在 adapter 层之上添加 session 缓存。`ClaudeSessionManager` 维护 session map，
在 run 启动时检查复用。与 2.1 的 coordinator 集成。

**优先级**: **P1** — 跨 turn 上下文保持。无 session 复用时每个 turn 都是冷启动。

---

### 2.4 Fork 会话支持

**Kanna** `reference/kanna/src/server/agent.ts:1230-1245` — `forkChat()`: 新建 chat，
通过 `store.forkChat()` 设置 `pendingForkSessionToken`，在下次 `startTurnForChat()` 时
传递 `forkSession: true` 到 CLI SDK 创建分支。

**AgentHub** `edge-server/internal/api/handlers.go:313` — `PostRuns` 接受 `Fork bool` 字段，
`ClaudeCodeAdapter.BuildCommand()` 支持 `--fork-session` 标志。但缺少 Kanna 的 fork chat 语义
（创建新线程 + 分支会话 token）。

**变更**: 扩展 `POST /v1/runs` 为 "fork thread, then run" 复合操作。

**优先级**: **P2** — 当前 CLI 标志已实现，UI 工作流缺失。

---

## 3. Agent Provider 适配器

### 3.1 统一 Adapter 接口 `==` 设计一致

**Kanna** `reference/kanna/src/server/agent.ts:1-16` — `AgentCoordinator` 内部处理
Claude SDK (`query()`) 和 Codex AppServer (`codex-app-server.ts`) 两种后端。两者通过
`HarnessTurn` 接口统一: `{ stream, interrupt, close, getAccountInfo? }`。

**AgentHub** `edge-server/internal/adapters/adapter.go:23-43` — `AgentAdapter` 接口:
`BuildCommand()` / `ParseStream()` / `NeedsStdin()`。设计目标是分离 CLI 调用和事件解析。

**分析**: 两者设计目标不同。Kanna 是**嵌入式 SDK**（进程内调用），AgentHub 是**CLI 子进程**。
AgentHub 的接口设计适合其多 CLI 架构，但缺少 Kanna 的 turn 级控制（interrupt/close 是 CLI 进程的
信号，而非细粒度 turn 控制）。

**变更**: 无需改动 adapter 接口。在 2.1 的 coordinator 层补充 turn 控制语义。

**优先级**: **P2** — 架构差异是故意的（子进程 vs SDK），不是缺陷。

---

### 3.2 Codex: AppServer JSON-RPC `<>` Batch Exec

**Kanna** `reference/kanna/src/server/codex-app-server.ts:736-1475` — 完整的 `codex app-server`
JSON-RPC 实现:
- `startSession()` `->` initialize `->` thread/start|resume|fork
- `startTurn()` `->` turn/start `->` 实时 item/started + item/completed 通知
- 工具调用: AskUserQuestion, ExitPlanMode, update_plan, 动态工具, MCP, fileChange, commandExecution
- `handleTurnCompleted()` `->` 结果提取 + plan mode 特殊处理

**AgentHub** `edge-server/internal/adapters/codex.go:44-80` — Phase 1: `codex exec` 批处理模式。
非流式，单轮，无 plan mode。

**变更**: Phase 2 实现: 在 `CodexAdapter` 中添加 `CodexAppServer` 模式，
复用 Kanna 的 `codex-app-server-protocol.ts` 类型定义（移植到 Go struct）。
完整 JSON-RPC 生命周期: session `->` thread `->` turn `->` items `->` completion。

**优先级**: **P1** — Codex 流式体验 + plan mode 是用户期望的核心功能。

---

### 3.3 权限门控 (Permission Gating)

**Kanna** `reference/kanna/src/server/agent.ts:563-616` — `canUseTool()` 拦截
`AskUserQuestion` 和 `ExitPlanMode`，将控制权交给 `onToolRequest()`，后者设置
`active.pendingTool`、状态变为 `waiting_for_user`、等待 `respondTool()` 调用。

**AgentHub** `edge-server/internal/api/handlers.go:545-576` — `POST /v1/permissions/decide`
接收桌面端决策后发布 `run.agent.permission_decided` 事件。
`edge-server/internal/adapters/control_protocol.go` — 通过 stdin 向 CLI 发送控制消息。

**分析**: 架构路径不同但等价。Kanna 是 SDK 内回调，AgentHub 是 HTTP+stdin 两跳。
Kanna 的优势是 `respondTool()` 的单次往返更简洁；AgentHub 解耦了权限决策和 CLI 控制。

**变更**: 无需结构性改动。P2: 添加超时保护（`pendingTool` 超时自动 deny）。

**优先级**: **P2** — 功能等价，Kanna 的优雅性可在后续重构中借鉴。

---

## 4. 多 Agent UI 组件

### 4.1 集中式状态管理 (useKannaState)

**Kanna** `reference/kanna/src/client/app/useKannaState.ts:726-2095` — 单一 1370 行 hook
管理所有应用状态: sidebar, chat, diffs, settings, keybindings, 乐观用户提示, 历史分页,
UI 更新重载。通过 WebSocket 订阅自动同步。

**AgentHub** — 无等效集中管理。状态分散在多个 zustand store (`useThreadStore`,
`useRunnerStore` 等) 和组件本地状态中。数据获取通过 `fetch()` + `EventSource`。

**变更**: 创建 `app/desktop/src/hooks/useAgentHubState.ts`，集中管理:
- WebSocket 连接状态 + 自动重连
- 线程列表 + 实时更新订阅
- 活动 run 状态 + 流式事件处理
- Agent 列表 + 能力标签
- 乐观 UI 更新

**优先级**: **P0** — 桌面端应用状态一致性的基础。当前分散存储导致跨组件数据不一致。

---

### 4.2 流式文本渲染

**Kanna** `reference/kanna/src/client/components/messages/TextMessage.tsx` — 逐字流式
渲染 Markdown，配合 `DrainingIndicator.tsx` 显示后台任务进行中。

**AgentHub** `app/desktop/src/components/ChatView.tsx:61-64` — `StreamingTextBlock` 使用
`useStreamingText` hook 实现逐字渲染。功能等价。

**分析**: 功能等价。AgentHub 额外有 `cursor` 动画和 `typingDots` 指示器。

**变更**: 无需改动。

**优先级**: N/A — 已实现。

---

### 4.3 Draining Indicator `<>` 缺失

**Kanna** `reference/kanna/src/client/components/messages/DrainingIndicator.tsx` —
当 `runtime.isDraining === true` 时显示 "agent 已完成响应但仍在使用工具" 的指示器。
对应服务端的 `drainingStreams` Map。

**AgentHub** — 无 draining 概念。run 完成后流立即关闭，无"结果完成但工具仍在运行"的中间状态。

**变更**: 在 coordinator (2.1) 实现后，添加 draining 状态:
- 服务端: run 结果已到达时从 `activeRuns` 移到 `drainingRuns`
- UI: `isDraining` 标志 + `DrainingIndicator` 组件 + `StopDraining` 按钮

**优先级**: **P1** — 依赖 2.1 的 coordinator。用户体验关键: 用户需要知道 agent 是否"真的完成"。

---

### 4.4 消息树 `<>` 侧栏聊天列表

**Kanna** `reference/kanna/src/client/app/KannaSidebar.tsx` + `sidebar/ChatRow.tsx` —
层次化侧栏: 项目组 `->` 聊天行。支持折叠/展开项目组、预览聊天 vs 旧聊天、归档分区、
未读指示器、状态图标（idle/running/waiting/draining）。

**AgentHub** `app/desktop/src/components/ThreadPanel.tsx` — 扁平线程列表 + 搜索 + 内联
重命名/删除。无项目分组、无层次结构、无状态指示器。

**变更**: 扩展 `ThreadPanel` 为分层次结构:
- 按项目分组线程
- 线程状态指示器 (idle/running/waiting/draining)
- 线程内 run 计数
- 归档功能

**优先级**: **P2** — UI 润色。当前扁平列表对 5-10 线程可接受，超过 20 需要分组。

---

### 4.5 Agent 列表 `<`

**Kanna** — Kanna 不显示 agent 列表。agent 选择嵌入在聊天偏好控件中
(`ChatPreferenceControls.tsx`)。

**AgentHub** `app/desktop/src/components/AgentList.tsx` — 专用 agent 侧栏，含搜索、
能力标签着色、在线状态指示器。

**分析**: AgentHub 超前于 Kanna。AgentHub 的多 agent 架构需要专门的 agent 侧栏，这是
AgentHub 的核心差异化优势。

**变更**: 保持现状。Kanna 无需向后移植此功能。

**优先级**: N/A — AgentHub 独有优势。

---

## 5. 汇总: P0/P1/P2 优先级矩阵

| # | 条目 | Kanna 源文件:行 | AgentHub 目标 | 优先级 |
|---|------|----------------|---------------|--------|
| 1 | 客户端 WebSocket 抽象 | `socket.ts:37-404` | `app/desktop/src/api/socket.ts` (新建) | **P0** |
| 2 | Agent 协调器 | `agent.ts:674-693` | `edge-server/internal/agents/coordinator.go` (新建) | **P0** |
| 3 | 集中式状态管理 | `useKannaState.ts:726-2095` | `app/desktop/src/hooks/useAgentHubState.ts` (新建) | **P0** |
| 4 | 主题化订阅 | `protocol.ts:44-52` + `ws-router.ts:586-617` | `events/bus.go` 添加 topic 过滤 | **P1** |
| 5 | 快照签名去重 | `ws-router.ts:789-801` | `events/bus.go` 或 handler 层 | **P1** |
| 6 | 消息队列 | `agent.ts:1119-1228` | `coordinator.go` (需 P0#2 先完成) | **P1** |
| 7 | Session 跨 Turn 复用 | `agent.ts:1054-1117` | `adapters/` 之上添加 session manager | **P1** |
| 8 | Codex AppServer 流式 | `codex-app-server.ts:736-1475` | `adapters/codex.go` Phase 2 | **P1** |
| 9 | Draining 状态 + UI | `agent.ts:1398-1402` + `DrainingIndicator.tsx` | coordinator + UI 组件 | **P1** |
| 10 | 广播批处理 | `ws-router.ts:874-896` | `events/bus.go` 可选批处理模式 | **P2** |
| 11 | Fork Chat 复合操作 | `agent.ts:1230-1245` | `handlers.go` PostRuns 扩展 | **P2** |
| 12 | 权限门控超时 | `agent.ts:563-616` | `control_protocol.go` | **P2** |
| 13 | 层次化线程侧栏 | `sidebar/ChatRow.tsx` | `ThreadPanel.tsx` 扩展 | **P2** |

## 6. 实施顺序建议

**第一阶段 (P0)**: 三项基础设施 — `KannaSocket` client, `AgentCoordinator` server,
`useAgentHubState` hook。这三者互相依赖，应并行或紧密衔接。

**第二阶段 (P1)**: 基于 P0 基础设施构建 — 主题化订阅、快照去重、消息队列、session 复用、
Codex 流式、draining 状态。这些是用户体验差异的直接来源。

**第三阶段 (P2)**: 润色 — 广播批处理、fork 工作流、权限超时、层次化侧栏。
