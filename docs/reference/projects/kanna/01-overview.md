# Kanna 深度调研报告

> 调研对象：[jakemor/kanna](https://github.com/jakemor/kanna) v0.41.5  
> 调研日期：2026-05-21  
> 调研范围：完整源码 tree（`src/server/`、`src/client/`、`src/shared/`）

---

## 1. 产品设计借鉴

### 1.1 整体定位

Kanna 是一个为 Claude Code 和 Codex CLI 提供 Web UI 的桌面应用。它的核心价值主张是：**用浏览器获得原生级别的 Agent Chat 体验**，同时保持所有数据本地存储。

### 1.2 UI 布局（三栏式）

```
┌──────────────┬───────────────────────┬──────────────┐
│  Sidebar     │  Chat Workspace       │  Right Panel │
│  (project    │  ┌─────────────────┐  │  (Git/Browser│
│   groups +   │  │ Chat Transcript │  │   panel)     │
│   chat list) │  │ (scrollable)    │  │              │
│              │  │                 │  │              │
│              │  ├─────────────────┤  │              │
│              │  │ Terminal Pane   │  │              │
│              │  │ (resizable)     │  │              │
│              │  ├─────────────────┤  │              │
│              │  │ ChatInput Dock  │  │              │
│              │  │ + Provider      │  │              │
│              │  │   controls      │  │              │
│              │  └─────────────────┘  │              │
└──────────────┴───────────────────────┴──────────────┘
```

**关键 UI 组件**（`src/client/components/`）：
- `ChatInput.tsx` — 消息输入框，集成了 provider 切换、模型选择、reasoning effort、plan mode toggle、context window meter、附件上传
- `ChatNavbar.tsx` — 顶部导航：sidebar toggle、terminal toggle、Git panel toggle、external open
- `ChatTranscriptViewport.tsx` — 基于 `@legendapp/list` 的虚拟滚动 transcript
- `TerminalWorkspace.tsx` — 嵌入式 xterm.js 终端，支持 split pane
- `GitPanel.tsx` — 右侧 Git diff/branch/commit 面板
- `BrowserPanel.tsx` — 右侧浏览器面板（local HTTP server 检测）
- `ChatPreferenceControls.tsx` — Provider/Model/Effort/PlanMode 控件条

### 1.3 交互流程

**发送消息的完整链路：**
```
用户键入 → ChatInput (draft persist) → handleSubmit
  → socket.command({type:"chat.send"})
  → WSRouter.handleCommand → agent.send()
  → EventStore.enqueueMessage (JSONL append)
  → AgentCoordinator.startTurnForChat
    → 必要时创建 Chat → 写 user_prompt entry
    → 启动 Claude Session 或 Codex Turn
    → 流式 events → EventStore.appendMessage 每条
    → onStateChange → WSRouter.broadcastSnapshots (debounced 16ms)
    → 所有订阅客户端收到 ChatSnapshot 推送
```

**关键交互细节：**
1. **Draft 持久化**：`chatInputStore` 按 chatId 存储 draft text + attachment drafts，刷新不丢
2. **文件拖放**：页面级 drag-over 检测，`usePageFileDrop` hook，支持拖入任意位置
3. **Provider 切换**：ChatInput 底部 `ChatPreferenceControls` 提供 provider/model/effort/planMode 控件
4. **空状态体验**：打字机动画 `useEmptyStateTyping`（"Build something..." 逐字显示）
5. **消息排队**：当 active turn 存在时，新消息进 queue，turn 结束后自动 dequeue
6. **Steer 模式**：排队中的消息可在 agent 运行中注入（`message.steer`，取消当前 turn + 发起新 turn 带 steered prefix）
7. **Draining 状态**：turn result 到达后 stream 可能仍开着，UI 显示 draining indicator 允许用户 stop
8. **快捷键**：全局 keydown listener 匹配 keybinding actions（toggle terminal, toggle sidebar 等）

### 1.4 Session 管理

- **Chat = 持久会话**：每个 Chat 绑定一个 project，有独立 sessionToken
- **Session Token**：Claude Agent SDK 的 `session_id`，自动从 stream events 中提取并持久化
- **Session 复用**：同 chat 的新 turn 默认复用已有 session，自动检测 model/planMode 变化并调用 `setModel`/`setPermissionMode`
- **Fork**：`agent.forkChat()` → 创建新 Chat，复制 transcript JSONL，设 `pendingForkSessionToken`，下一次 turn 时传 `forkSession: true`
- **Context Clear**：ExitPlanMode 确认时可选 `clearContext`，会设 sessionToken 为 null，下次起新 session

### 1.5 Provider 切换 UX

`ChatPreferenceControls.tsx` 实现了以下控件：
- **Provider 选择器**：Claude / Codex tabs（或 dropdown），带 `providerLocked` 状态（active turn 运行时锁定）
- **Model 选择器**：下拉菜单，按 provider 显示不同 model 列表
- **Claude 专属**：Reasoning Effort (low/medium/high/max) + Context Window (200k/1M)
- **Codex 专属**：Reasoning Effort (minimal/low/medium/high/xhigh) + Fast Mode toggle
- **Plan Mode toggle**：仅 `supportsPlanMode` 的 provider 显示
- **Context Window Meter**：实时显示 token 使用量环形图

### 1.6 对 AgentHub 的设计建议

1. **三栏布局值得借鉴**：Sidebar + Chat + Right Panel 的分栏在桌面端体验极佳
2. **Draft 持久化是刚需**：用户随手切换 chat 不应丢输入内容
3. **消息排队 + Steer 模式**：优雅处理 agent 运行中的用户新消息
4. **Draining indicator**：turn 结束后 stream 可能还有后台任务，用户需要感知和控制
5. **打字机空状态动画**：成本低，体验提升大
6. **Provider 控件条**：放在输入框下方、水平 scroll，紧凑且符合操作习惯
7. **Embedded Terminal + Resizable Panel**：用 `react-resizable-panels` 实现分栏，体验接近 IDE

---

## 2. 系统架构借鉴

### 2.1 整体架构拓扑

```
┌──────────────────────────────────────────────────────┐
│                  Browser (React 19)                   │
│  Zustand Stores ← useKannaState (central hook)       │
│       ↕ WebSocket (JSON protocol v1)                  │
└──────────────────────┬───────────────────────────────┘
                       │ ws://localhost:3210/ws
┌──────────────────────┴───────────────────────────────┐
│                  Bun HTTP/WS Server                   │
│                                                       │
│  ┌──────────────┐   ┌────────────────────────┐       │
│  │  WSRouter    │───│  subscriptions (Map)    │       │
│  │              │   │  snapshotSignatures     │       │
│  │  handleCmd() │   │  scheduleBroadcast(16ms)│       │
│  └──────┬───────┘   └────────────────────────┘       │
│         │                                             │
│  ┌──────┴──────────────────────────────────┐         │
│  │         AgentCoordinator                 │         │
│  │  activeTurns: Map<chatId, ActiveTurn>    │         │
│  │  claudeSessions: Map<chatId, Session>    │         │
│  │  drainingStreams: Map<chatId, Turn>      │         │
│  │                                          │         │
│  │  send() / steer() / cancel() / fork()    │         │
│  │  respondTool() / stopDraining()          │         │
│  └──┬───────────────────┬──────────────────┘         │
│     │                   │                             │
│  ┌──┴────────┐   ┌──────┴──────────────┐            │
│  │ Claude     │   │ CodexAppServer      │            │
│  │ Agent SDK  │   │ (JSON-RPC stdio)    │            │
│  │ (stdio)    │   │                     │            │
│  └──┬────────┘   └──────┬──────────────┘            │
│     │                   │                             │
│  ┌──┴───────────────────┴──────────────────┐         │
│  │           EventStore (CQRS)              │         │
│  │  projects.jsonl  chats.jsonl             │         │
│  │  messages.jsonl  turns.jsonl             │         │
│  │  queued-messages.jsonl                   │         │
│  │  transcripts/<chatId>.jsonl              │         │
│  │  snapshot.json (compacted state)         │         │
│  └─────────────────────────────────────────┘         │
│  ┌──────────────────────────────────────────┐        │
│  │           ReadModels                      │        │
│  │  deriveSidebarData()                      │        │
│  │  deriveChatSnapshot()                     │        │
│  │  deriveLocalProjectsSnapshot()            │        │
│  └──────────────────────────────────────────┘        │
│  ┌──────────────────────────────────────────┐        │
│  │   Other services:                         │        │
│  │   DiffStore, TerminalManager,             │        │
│  │   Discovery, Auth, AppSettings...         │        │
│  └──────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────┘
                       │
              ~/.kanna/data/  (JSONL logs + snapshot)
```

### 2.2 核心模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| **EventStore** | `src/server/event-store.ts` | CQRS 写端：JSONL append-only 日志 + snapshot compaction |
| **ReadModels** | `src/server/read-models.ts` | CQRS 读端：从 `StoreState` 派生 SidebarData、ChatSnapshot、LocalProjectsSnapshot |
| **AgentCoordinator** | `src/server/agent.ts` | 多 provider 协调：turn 生命周期管理、session 复用、tool gating、消息排队 |
| **WSRouter** | `src/server/ws-router.ts` | WebSocket 消息路由：订阅管理、snapshot 广播（16ms debounce）、command dispatch |
| **ProviderCatalog** | `src/server/provider-catalog.ts` | Provider/Model/Effort 规范化与默认值解析 |
| **CodexAppServer** | `src/server/codex-app-server.ts` | Codex CLI 的 JSON-RPC stdio 客户端 |
| **DiffStore** | `src/server/diff-store.ts` | Git diff/branch/commit 状态管理 |
| **Events** | `src/server/events.ts` | 事件类型定义：ProjectEvent、ChatEvent、TurnEvent 等 |
| **Protocol** | `src/shared/protocol.ts` | WS 消息协议：subscribe/unsubscribe/command/ack/error/snapshot |
| **Types** | `src/shared/types.ts` | 全量类型定义：TranscriptEntry 联合类型、ChatSnapshot、Provider catalog 等 |
| **Tools** | `src/shared/tools.ts` | 工具调用规范化和结果 hydration（15+ tool types） |
| **ChatPage** | `src/client/app/ChatPage/index.tsx` | 主聊天页面：layout、terminal、right sidebar 编排 |
| **ChatInput** | `src/client/components/chat-ui/ChatInput.tsx` | 输入框 + provider 控件 + 附件管理 |
| **KannaTranscript** | `src/client/app/KannaTranscript.tsx` | Transcript 渲染：消息类型分发、collapsible tool groups |

### 2.3 数据流

```
1. 用户发送消息
   ChatInput.handleSubmit()
     → socket.command({ type: "chat.send", ... })
       → WSRouter.handleCommand()
         → agent.send(command)
           → EventStore.enqueueMessage() or startTurnForChat()
             → JSONL append (messages.jsonl / transcripts/<id>.jsonl)
           → startClaudeSession() / codexManager.startTurn()
             → for await (event of stream)
               → EventStore.appendMessage(entry)
               → onStateChange → scheduleBroadcast (16ms debounce)
                 → pushSnapshots(all clients)
                   → deriveChatSnapshot() from EventStore.state
                   → WebSocket.send(snapshot JSON)
         → WSRouter returns ack { chatId }
2. 客户端接收 snapshot
   socket.onMessage → update chatSnapshot in useKannaState
     → React re-render transcript + sidebar + context meter
```

### 2.4 状态管理

**服务端（EventStore.state）**：
```typescript
interface StoreState {
  projectsById: Map<string, ProjectRecord>      // 所有项目
  projectIdsByPath: Map<string, string>          // 路径→ID 索引
  chatsById: Map<string, ChatRecord>             // 所有 chat
  queuedMessagesByChatId: Map<string, QueuedChatMessage[]>
}
```
- 纯内存 Map，从 snapshot + JSONL replay 构建
- 所有写入先 append JSONL，再 applyEvent 更新内存

**客户端（Zustand stores）**：
- `chatInputStore` — draft text + attachment drafts
- `chatPreferencesStore` — provider/model/effort/planMode per-chat composer state
- `rightSidebarStore` — right panel visibility + size
- `terminalLayoutStore` — terminal pane layout per-project
- `terminalPreferencesStore` — scrollback, minColumnWidth, editor preset
- `diffCommitStore` — diff render mode, wrap lines
- `appSettingsStore` — theme, sound, analytics
- Central hook `useKannaState` 聚合 WebSocket 状态和所有 store

### 2.5 对 AgentHub 的架构建议

1. **CQRS + Event Sourcing 是 AgentHub 已有模式**，Kanna 的 JSONL + Snapshot 实现简洁可参考
2. **WebSocket 订阅模型**：subscribe/unsubscribe + signature-based dedup 广播，比轮询高效得多
3. **AgentCoordinator 的 turn 管理**：activeTurns/drainingStreams 双 Map 管理是干净的状态机
4. **Provider 规范化层**：provider-catalog.ts 的模式可以复用到 AgentHub 的多 LLM backend 管理
5. **ReadModels 分离**：纯函数从 StoreState 派生视图，不依赖 I/O，易于测试和缓存
6. **16ms debounce 广播**：简单的 `setTimeout` 实现，避免高频事件导致的广播风暴

---

## 3. 可复用代码模式

### 3.1 EventStore JSONL 格式

**文件**：`src/server/event-store.ts`

**JSONL 格式**：每行一个 JSON 对象，`\n` 分隔，append-only。

```jsonl
{"v":2,"type":"project_opened","timestamp":1700000000000,"projectId":"uuid","localPath":"/path/to/project","title":"my-project"}
{"v":2,"type":"chat_created","timestamp":1700000000001,"chatId":"uuid","projectId":"uuid","title":"New Chat"}
```

**关键实现**（`:616-623`）：
```typescript
private append<TEvent extends StoreEvent>(filePath: string, event: TEvent) {
  const payload = `${JSON.stringify(event)}\n`
  this.writeChain = this.writeChain.then(async () => {
    await appendFile(filePath, payload, "utf8")
    this.applyEvent(event)
  })
  return this.writeChain
}
```

**要点**：
- `writeChain: Promise.resolve()` — 串行化所有写入，保证事件顺序
- `appendFile` 原子追加，不会破坏已有数据
- 写入后立即 `applyEvent` 更新内存 state
- Version tag `v: 2` — 版本不匹配时自动 reset storage（`:221-225`）

**Transcript 存储**（`:625-645`）：
- 每 chat 独立 JSONL：`transcripts/<chatId>.jsonl`
- 完整 stream events 序列化（TranscriptEntry union type）
- 有缓存 `cachedTranscript` 避免重复读盘（`:1097-1111`）

### 3.2 Snapshot Compaction 机制

**文件**：`src/server/event-store.ts`

**触发条件**（`:1271-1280`）：
```typescript
private async shouldCompact() {
  const sizes = await Promise.all([
    Bun.file(this.projectsLogPath).size,
    Bun.file(this.chatsLogPath).size,
    Bun.file(this.messagesLogPath).size,
    Bun.file(this.queuedMessagesLogPath).size,
    Bun.file(this.turnsLogPath).size,
  ])
  return sizes.reduce((total, size) => total + size, 0) >= COMPACTION_THRESHOLD_BYTES
}
```

`COMPACTION_THRESHOLD_BYTES = 2 * 1024 * 1024` (2MB)

**Compaction 流程**（`:1228-1238`）：
1. `createSnapshot()` — 序列化当前 state 到 `SnapShotFile`
2. `Bun.write(snapshotPath, JSON)` — 原子写入 snapshot.json
3. 清空所有 JSONL 日志文件

**Snapshot 结构**（`events.ts:33-41`）：
```typescript
interface SnapshotFile {
  v: 2
  generatedAt: number
  projects: ProjectRecord[]
  chats: ChatRecord[]
  sidebarProjectOrder?: string[]
  queuedMessages?: Array<{ chatId: string; entries: QueuedChatMessage[] }>
  messages?: Array<{ chatId: string; entries: TranscriptEntry[] }>  // legacy
}
```

**启动恢复**（`:175-189`）：
1. `loadSnapshot()` → 加载 snapshot.json 到内存
2. `replayLogs()` → 按 timestamp + priority 排序重放 snapshot 之后的所有 JSONL events
3. `shouldCompact()` → 日志超过 2MB 则 compact

### 3.3 Fork/Resume Session 实现

**文件**：`src/server/event-store.ts` + `src/server/agent.ts`

**Fork Chat**（`event-store.ts:746-788`）：
```typescript
async forkChat(sourceChatId: string) {
  const sourceChat = this.requireChat(sourceChatId)
  const sourceSessionToken = sourceChat.sessionToken ?? sourceChat.pendingForkSessionToken
  // 1. 创建新 Chat（title 加 "Fork: " 前缀）
  const chatId = crypto.randomUUID()
  await this.append(this.chatsLogPath, createEvent)
  // 2. 复制 provider、planMode
  await this.setChatProvider(chatId, sourceChat.provider)
  await this.setPlanMode(chatId, sourceChat.planMode)
  // 3. 设 pendingForkSessionToken（复用源 session）
  await this.setPendingForkSessionToken(chatId, sourceSessionToken)
  // 4. 复制 transcript（写入新 chat 的 transcripts/<id>.jsonl）
  const sourceEntries = this.getMessages(sourceChatId)
  if (sourceEntries.length > 0) {
    const payload = sourceEntries.map(JSON.stringify).join("\n")
    await writeFile(transcriptPath, `${payload}\n`, "utf8")
  }
}
```

**Fork Turn 启动**（`agent.ts:1056-1117`）：
```typescript
// startClaudeTurn 中：
turn = await this.startClaudeSessionFn({
  sessionToken: chat.sessionToken ?? chat.pendingForkSessionToken,
  forkSession: Boolean(chat.pendingForkSessionToken),
  // ...
})
// forkSession: true 对应 SDK 的 forkSession 参数，创建分支会话
```

**Resume 机制**：
- sessionToken 从 stream 的 `session_token` event 自动提取（`:443-447`）
- 持久化到 `chat.sessionToken`（`event-store.ts:1033-1044`）
- 下次 turn 自动复用：`sessionToken: chat.sessionToken`（`:933`）

### 3.4 AsyncMessageQueue 模式

**文件**：`src/server/agent.ts:507-552`

```typescript
class AsyncMessageQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(value: T) { /* 有 waiter 则立即 resolve，否则入队 */ }
  close() { /* 唤醒所有 waiter 返回 done */ }
  [Symbol.asyncIterator](): AsyncIterator<T> { /* 标准 async iterator */ }
}
```

**用途**：Claude SDK 接受 `AsyncIterable<SDKUserMessage>` 作为 prompt 输入，这个队列允许在 stream 启动后动态 push 消息（steer 场景）。

### 3.5 Tool 规范化与 Hydration

**文件**：`src/shared/tools.ts` + `src/server/agent.ts`

**normalizeToolCall**（`tools.ts:17-195`）：
- 15+ tool type 的 switch-case 分发
- MCP tool 匹配：`mcp__<server>__<tool>` 正则
- Subagent 检测：`input.subagent_type` 存在即归类为 subagent_task
- 未知 tool → `unknown_tool` with raw payload

**hydrateToolResult**（`tools.ts:272-327`）：
- `ask_user_question` → 解析 answers map
- `exit_plan_mode` → 解析 confirmed/clearContext/message
- `read_file` → 解析 text/image blocks 结构
- 其他 → 透传 parsed JSON

**Tool Gating**（`agent.ts:563-616`）：
```typescript
const canUseTool: CanUseTool = async (toolName, input, options) => {
  if (toolName !== "AskUserQuestion" && toolName !== "ExitPlanMode") {
    return { behavior: "allow", updatedInput: input }
  }
  // AskUserQuestion/ExitPlanMode → 暂停 stream，等待用户响应
  // active.status = "waiting_for_user"
  // 用户通过 chat.respondTool 命令响应
}
```

### 3.6 WebSocket Snapshot 签名去重

**文件**：`src/server/ws-router.ts:773-832`

```typescript
async function pushSnapshots(ws, options) {
  for (const [id, topic] of ws.data.subscriptions) {
    const envelope = createEnvelope(id, topic)
    const signature = JSON.stringify(envelope.snapshot)
    // 跳过签名未变的 snapshot
    if (snapshotSignatures.get(id) === signature) {
      skippedCount += 1
      continue
    }
    snapshotSignatures.set(id, signature)
    send(ws, envelope)
  }
}
```

**16ms 批处理广播**（`:874-923`）：
```typescript
function scheduleBroadcast() {
  pendingBroadcastAll = true
  if (pendingBroadcastTimer) return
  pendingBroadcastTimer = setTimeout(() => {
    // 合并期间所有变更，一次性广播
    void broadcastSnapshots()
  }, 16)
}
```

### 3.7 Transcript 解析流水线

**文件**：`src/server/agent.ts:322-436`

`normalizeClaudeStreamMessage()` 将 Claude Agent SDK 的原始消息转换为统一的 `TranscriptEntry` 联合类型：
- `system/init` → `system_init` entry（含 model, tools, agents, slashCommands, mcpServers）
- `assistant` → `assistant_text` + `tool_call` entries
- `user` → `tool_result` + `compact_summary` entries
- `result` → `result` entry（含 duration, cost, error 标记）
- `system/status` → `status` entry
- 每条 entry 带 `_id`（crypto.randomUUID()）、`createdAt`、`debugRaw`

### 3.8 对 AgentHub 的复用建议

1. **JSONL + Snapshot 模式可直接移植**：实现简单、可验证、支持版本迁移
2. **writeChain 串行化**：比 mutex/lock 更轻量，适合 Bun/Node 单线程环境
3. **Fork 实现思路清晰**：复制 transcript + 设 pendingForkSessionToken + SDK 原生 forkSession
4. **AsyncMessageQueue**：通用 async iterable 队列，可用于任何需要动态 push 的 streaming 场景
5. **Tool normalization 层**：统一 tool name → typed tool call 的转换，便于 UI 差异化渲染
6. **Snapshot 签名去重**：JSON.stringify 做签名 + 16ms debounce，避免不必要的 WebSocket 推送
7. **Event replay + priority sort**：多日志源 replay 的优先级排序算法可直接复用

---

## 4. 对 AgentHub 的具体建议

### 4.1 立即可借鉴

| 优先级 | 内容 | Kanna 来源 | 理由 |
|--------|------|-----------|------|
| P0 | **Transcript JSONL 存储** | `event-store.ts:625-645` `transcripts/<chatId>.jsonl` | 每个 chat 独立 JSONL，append-only，简单可靠 |
| P0 | **Snapshot compaction** | `event-store.ts:1228-1280` | 日志超 2MB 自动 compact 到 snapshot.json，解决日志膨胀 |
| P0 | **Event replay with priority** | `event-store.ts:353-374` | 多日志源按 timestamp + priority 排序重放，保证恢复一致性 |
| P1 | **WebSocket 订阅模型** | `ws-router.ts` 全篇 | subscribe/unsubscribe + signature dedup + 16ms debounce 广播 |
| P1 | **Provider 规范化层** | `provider-catalog.ts` 全篇 | Provider → Model → Effort 的三层解析，default fallback 链 |
| P1 | **AgentCoordinator turn 管理** | `agent.ts:674-1609` | activeTurns/drainingStreams 双 Map + cancel/steer/drain 状态机 |
| P2 | **Draft 持久化** | `chatInputStore.ts` | 按 chatId 存 draft text + attachments，刷新不丢 |
| P2 | **Tool normalization** | `tools.ts:17-195` | 15+ tool types → typed union，UI 可做差异化渲染 |
| P2 | **Fork chat 实现** | `event-store.ts:746-788` + `agent.ts:1056-1117` | 复制 transcript + forkSession flag，让 SDK 处理分支 |

### 4.2 架构层面

1. **CQRS 是正确方向**：AgentHub 的 `event-store` 层已有雏形，Kanna 证明了 JSONL + Snapshot + ReadModels 的可行性
2. **WebSocket 优于 REST**：实时 Agent streaming 场景，WS 的 subscribe/push 模型天然匹配
3. **Provider 抽象有价值**：Claude/Codex 的差异（reasoning effort 命名、plan mode 支持度）通过 catalog 层吸收
4. **Transcript 是核心数据结构**：Unified `TranscriptEntry` union type 让前端渲染完全 provider-agnostic

### 4.3 不建议照搬的部分

1. **Bun 专属 API**：`Bun.file()`、`Bun.write()`、`Bun.spawn()` 等，AgentHub 是 Go + TypeScript，需等价实现
2. **stdio 进程管理**：Kanna 直接 spawn Claude/Codex CLI 子进程，AgentHub 有自己的 Runner 架构
3. **单机本地存储**：AgentHub 需要多设备同步，需在 EventStore 上加 sync 层
4. **React 19 + Zustand**：前端技术栈选择取决于 AgentHub 自身定位，不应强行对齐

### 4.4 最终评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 产品设计 | 9/10 | 功能完整、交互流畅、细节到位（draft persist、空状态动画、快捷键） |
| 系统架构 | 8/10 | CQRS + Event Sourcing 清晰，模块划分合理，但强依赖 Bun 生态 |
| 代码质量 | 8/10 | TypeScript strict，大量 test 文件，错误处理充分，但 agent.ts 偏长（1609行） |
| 可复用性 | 7/10 | 核心模式通用，但实现与 Bun API 耦合，迁移需适配 |
| 对 AgentHub 参考价值 | **9/10** | 同是 Agent Chat UI 产品，架构模式和交互设计高度相关 |
