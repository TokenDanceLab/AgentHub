# Kanna 设计模式深度解析：从 TypeScript 到 Go 的 21 个翻译

> 调研日期：2026-05-23
> 源码仓库：`D:\Code\AgentHub\reference\kanna`（jakemor/kanna v0.41.5）
> 语言：TypeScript (Bun runtime)
> 分析范围：`src/server/` + `src/shared/` 核心模块

---

## 1. AgentCoordinator：三 Map 状态机

### 1.1 TypeScript 原始实现

**文件**：`src/server/agent.ts:682-684`

```typescript
export class AgentCoordinator {
  readonly activeTurns = new Map<string, ActiveTurn>()       // 正在执行的 turn
  readonly drainingStreams = new Map<string, { turn: HarnessTurn }>()  // 流未关闭的已结束 turn
  readonly claudeSessions = new Map<string, ClaudeSessionState>()      // 长期 session 缓存
}
```

**三个 Map 的职责边界**：

| Map | 生命周期 | 何时加入 | 何时移除 |
|-----|---------|---------|---------|
| `activeTurns` | turn 执行期间 | `send()` 调用时 | result 事件或 cancel 完成 |
| `drainingStreams` | result 已到，stream 未关闭 | result 事件触发时 | `stopDraining()` 或新 turn 启动 |
| `claudeSessions` | chat 生命周期 | 首次 `startClaudeSession` | `closeChat()` 或 server 重启 |

**状态机流转**：

```
idle → activeTurns (starting → running → waiting_for_user)
     → drainingStreams (hasFinalResult=true, stream still open)
     → idle (stream closed + queue processed)
```

### 1.2 Go 翻译

```go
type AgentCoordinator struct {
    activeTurns    sync.Map  // map[string]*ActiveTurn
    drainingStreams sync.Map // map[string]*DrainingTurn
    claudeSessions sync.Map  // map[string]*ClaudeSessionState

    store          *EventStore
    onStateChange  func(chatID string, immediate bool)
}

type ActiveTurn struct {
    ChatID          string
    Provider        AgentProvider
    Turn            HarnessTurn
    ClaudePromptSeq *int
    Model           string
    Effort          string
    PlanMode        bool
    Status          KannaStatus       // "starting" | "running" | "waiting_for_user"
    PendingTool     *PendingToolRequest
    HasFinalResult  bool
    CancelRequested bool
}
```

**关键洞察**：三个 Map 的划分避免了单一 Map 中复杂的状态枚举。`drainingStreams` 是最精巧的设计——它允许 UI 在 result 到达后仍显示 `draining` 状态，直到底层 stream 真正关闭。

---

## 2. HarnessTurn：Provider 无关的统一 Turn 抽象

### 2.1 TypeScript 原始实现

**文件**：`src/server/harness-types.ts`

```typescript
export interface HarnessTurn {
  provider: AgentProvider                      // "claude" | "codex"
  close: () => void                            // 关闭底层连接
  stream: AsyncIterable<HarnessEvent>          // 统一事件流
}

export type HarnessEvent =
  | { type: "transcript"; entry: TranscriptEntry }
  | { type: "session_token"; sessionToken: string }

export interface HarnessToolRequest {
  tool: NormalizedToolCall
}
```

**设计要点**：
- `HarnessTurn` 是 Claude 的 `Query` 和 Codex 的 `Turn` 的**共同抽象**
- 所有 provider 特定细节（SDK 消息格式、事件命名、能力差异）在 `createClaudeHarnessStream` / `createCodexHarnessStream` 内部消化
- 对外暴露统一的事件接口：`{ type, entry }` 或 `{ type, sessionToken }`

### 2.2 Go 翻译

```go
type HarnessTurn interface {
    Provider() AgentProvider
    Stream() <-chan HarnessEvent
    Close() error
}

type HarnessEvent struct {
    Type         HarnessEventType  // "transcript" | "session_token"
    Entry        *TranscriptEntry
    SessionToken string
}

type HarnessToolRequest struct {
    Tool NormalizedToolCall
}
```

Go 中 `HarnessTurn` 更适合定义为 **interface** 而非 struct，因为 Claude/Codex 的底层实现完全不同。使用 `<-chan HarnessEvent` 替代 `AsyncIterable<HarnessEvent>`，Go 的 channel 天然支持 async iteration（`for event := range turn.Stream()`）。

---

## 3. TranscriptEntry：14 变体判别联合

### 3.1 TypeScript 原始实现

**文件**：`src/shared/types.ts:903-918`

```typescript
export type TranscriptEntry =
  | UserPromptEntry         // { kind: "user_prompt", content, attachments, steered? }
  | SystemInitEntry         // { kind: "system_init", model, tools, ... }
  | AssistantTextEntry      // { kind: "assistant_text", messageId, content }
  | ToolCallEntry           // { kind: "tool_call", toolId, tool }
  | ToolResultEntry         // { kind: "tool_result", toolId, content, isError? }
  | ResultEntry             // { kind: "result", subtype, isError, durationMs, costUsd }
  | StatusEntry             // { kind: "status", status }
  | CompactBoundaryEntry    // { kind: "compact_boundary" }
  | CompactSummaryEntry     // { kind: "compact_summary", summary }
  | ContextClearedEntry     // { kind: "context_cleared" }
  | ContextWindowUpdatedEntry // { kind: "context_window_updated", usage }
  | InterruptedEntry        // { kind: "interrupted" }
  | AccountInfoEntry        // { kind: "account_info", ... }
  | ThinkingEntry           // { kind: "thinking", thinking, signature }
```

**设计要点**：
- 14 个变体，按 `kind` 字段做 discriminated union
- 每条 entry 带 `_id`（UUID）、`createdAt`（epoch ms）、可选 `hidden`、`debugRaw`
- 前端渲染完全根据 `kind` 做类型分发，对 provider 差异无感知

### 3.2 Go 翻译

Go 没有原生 discriminated union，推荐两种方案：

**方案 A：接口 + 类型断言**
```go
type TranscriptEntry interface {
    Kind() EntryKind
    ID() string
    CreatedAt() time.Time
}

type EntryKind string
const (
    KindUserPrompt         EntryKind = "user_prompt"
    KindSystemInit         EntryKind = "system_init"
    KindAssistantText      EntryKind = "assistant_text"
    KindToolCall           EntryKind = "tool_call"
    // ... 10 more
)

type UserPromptEntry struct {
    BaseEntry
    Content     string
    Attachments []ChatAttachment
    Steered     bool
}

func (e *UserPromptEntry) Kind() EntryKind { return KindUserPrompt }
```

**方案 B：单一 struct + kind 字段**（类似 JSON 反序列化场景）
```go
type TranscriptEntry struct {
    ID        string     `json:"_id"`
    Kind      string     `json:"kind"`
    CreatedAt int64      `json:"createdAt"`
    Content   string     `json:"content,omitempty"`
    ToolID    string     `json:"toolId,omitempty"`
    Tool      json.RawMessage `json:"tool,omitempty"`
    // ... 按需填充
}
```

**推荐**：AgentHub 已使用 Protobuf，可直接用 `oneof` 实现等效的判别联合，比 Go 原生方案更清晰。

---

## 4. writeChain → Go sync.Mutex 翻译

### 4.1 TypeScript 原始实现

**文件**：`src/server/event-store.ts:616-623`

```typescript
private writeChain: Promise<void> = Promise.resolve()

private append<TEvent extends StoreEvent>(filePath: string, event: TEvent) {
  const payload = `${JSON.stringify(event)}\n`
  this.writeChain = this.writeChain.then(async () => {
    await appendFile(filePath, payload, "utf8")
    this.applyEvent(event)   // 写入成功后立即更新内存 state
  })
  return this.writeChain
}
```

**设计精髓**：
- `writeChain` 是一个 Promise 链，每次 `append` 会 `.then()` 到链尾
- Node.js 单线程事件循环中，这天然保证了**串行写入顺序**
- 比 mutex 更轻量：不阻塞事件循环，仅排队 Promise

### 4.2 Go 翻译

Go 是并发模型（goroutine），不能简单复制 Promise 链。有三种等价翻译：

**方案 A：互斥锁（最直接）**
```go
type EventStore struct {
    mu         sync.Mutex
    writeQueue []writeOp
}

func (s *EventStore) Append(filePath string, event StoreEvent) error {
    s.mu.Lock()
    defer s.mu.Unlock()

    payload := jsonMarshal(event) + "\n"
    if err := appendFile(filePath, payload); err != nil {
        return err
    }
    s.applyEvent(event)
    return nil
}
```

**方案 B：串行 channel（保留 Promise 链的语义）**
```go
type EventStore struct {
    writeCh chan writeOp
}

func (s *EventStore) Append(filePath string, event StoreEvent) <-chan error {
    resultCh := make(chan error, 1)
    s.writeCh <- writeOp{filePath, event, resultCh}
    return resultCh
}

func (s *EventStore) writeLoop() {
    for op := range s.writeCh {
        payload := jsonMarshal(op.event) + "\n"
        err := appendFile(op.filePath, payload)
        if err == nil {
            s.applyEvent(op.event)
        }
        op.resultCh <- err
    }
}
```

**推荐方案 A**：Go 中 `sync.Mutex` 是最自然的选择，代码短、性能好、不需要维护后台 goroutine。Kanna 用 Promise 链是因为 Node.js 的单线程模型不允许同步锁阻塞文件 I/O——Go 的 goroutine 模型不存在此限制。

---

## 5. 16ms Debounce 广播 → Go time.AfterFunc 翻译

### 5.1 TypeScript 原始实现

**文件**：`src/server/ws-router.ts:874-897`

```typescript
function scheduleBroadcast() {
  pendingBroadcastAll = true
  pendingBroadcastChatIds.clear()
  if (pendingBroadcastTimer) {
    return  // 已有定时器，不重复设置
  }
  pendingBroadcastTimer = setTimeout(() => {
    pendingBroadcastTimer = null
    const shouldBroadcastAll = pendingBroadcastAll
    const chatIds = new Set(pendingBroadcastChatIds)
    pendingBroadcastAll = false
    pendingBroadcastChatIds.clear()
    if (shouldBroadcastAll) {
      void broadcastSnapshots()    // 全量广播
    } else if (chatIds.size > 0) {
      void broadcastFilteredSnapshots({ chatIds })  // 增量广播
    }
  }, 16)  // ~60fps 帧率
}
```

**设计精髓**：
- 16ms 对应 60fps 屏幕刷新率——即使事件产生速度远高于此，广播频率也受限于渲染能力
- **合并窗口**：16ms 内到达的所有事件被合并在一次广播中，大幅减少 WebSocket 消息数量
- **智能降级**：如果期间有 `scheduleBroadcast`（全量），忽略之前的 `scheduleChatStateBroadcast`（增量）

### 5.2 Go 翻译

```go
type WSBroadcaster struct {
    mu                   sync.Mutex
    pendingBroadcastAll  bool
    pendingChatIDs       map[string]struct{}
    timer                *time.Timer
    onBroadcastAll       func()
    onBroadcastFiltered  func(chatIDs []string)
}

func (b *WSBroadcaster) scheduleBroadcast() {
    b.mu.Lock()
    b.pendingBroadcastAll = true
    b.pendingChatIDs = make(map[string]struct{}) // clear
    if b.timer != nil {
        b.mu.Unlock()
        return  // 已有定时器排队
    }
    b.timer = time.AfterFunc(16*time.Millisecond, func() {
        b.mu.Lock()
        b.timer = nil
        shouldBroadcastAll := b.pendingBroadcastAll
        chatIDs := maps.Keys(b.pendingChatIDs)
        b.pendingBroadcastAll = false
        b.pendingChatIDs = make(map[string]struct{})
        b.mu.Unlock()

        if shouldBroadcastAll {
            b.onBroadcastAll()
        } else if len(chatIDs) > 0 {
            b.onBroadcastFiltered(chatIDs)
        }
    })
    b.mu.Unlock()
}
```

**关键差异**：Go 的 `time.AfterFunc` 行为与 `setTimeout` 相同——只在定时器到期后执行回调。需要用 `Reset()` 来自同一 timer 实现去抖而非创建新 timer。

---

## 6. 2MB Snapshot Compaction

### 6.1 TypeScript 原始实现

**文件**：`src/server/event-store.ts:21,1228-1280`

```typescript
const COMPACTION_THRESHOLD_BYTES = 2 * 1024 * 1024  // 2MB

// 检查是否需要 compact
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

// Compaction 流程
async compact() {
  const snapshot = this.createSnapshot()         // 序列化当前 state 到 SnapshotFile
  await Bun.write(this.snapshotPath, JSON.stringify(snapshot, null, 2))
  await Promise.all([
    Bun.write(this.projectsLogPath, ""),         // 清空所有 JSONL 日志
    Bun.write(this.chatsLogPath, ""),
    Bun.write(this.messagesLogPath, ""),
    Bun.write(this.queuedMessagesLogPath, ""),
    Bun.write(this.turnsLogPath, ""),
  ])
}
```

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

**启动恢复流程**：
```
1. loadSnapshot()     → 加载 snapshot.json 到内存
2. replayLogs()       → 按 timestamp + priority 排序重放所有 JSONL events
3. shouldCompact()    → 日志总量 >= 2MB 则 compact
```

### 6.2 Go 翻译

```go
const compactionThresholdBytes = 2 * 1024 * 1024

type EventStore struct {
    // ...
    snapshotPath         string
    projectsLogPath     string
    chatsLogPath        string
}

func (s *EventStore) shouldCompact() (bool, error) {
    var total int64
    for _, p := range []string{
        s.projectsLogPath, s.chatsLogPath,
        s.messagesLogPath, s.queuedMessagesLogPath, s.turnsLogPath,
    } {
        fi, err := os.Stat(p)
        if err != nil {
            if os.IsNotExist(err) { continue }
            return false, err
        }
        total += fi.Size()
    }
    return total >= compactionThresholdBytes, nil
}

func (s *EventStore) Compact() error {
    snapshot := s.createSnapshot()
    data, err := json.MarshalIndent(snapshot, "", "  ")
    if err != nil { return err }

    // 原子写入 snapshot
    if err := os.WriteFile(s.snapshotPath, data, 0644); err != nil {
        return err
    }

    // 清空所有日志
    for _, p := range []string{
        s.projectsLogPath, s.chatsLogPath,
        s.messagesLogPath, s.queuedMessagesLogPath, s.turnsLogPath,
    } {
        if err := os.Truncate(p, 0); err != nil {
            return err
        }
    }
    return nil
}
```

**关键注意**：Go 中 `os.Truncate` 等价于 Kanna 的 `Bun.write(path, "")`。Compaction 期间需要获取 writeLock（`sync.Mutex`）防止并发写入。

---

## 7. Tool Gating：Promise Pause → Go Channel/Callback

### 7.1 TypeScript 原始实现

**文件**：`src/server/agent.ts:563-616`

```typescript
const canUseTool: CanUseTool = async (toolName, input, options) => {
  // 普通工具：直接放行
  if (toolName !== "AskUserQuestion" && toolName !== "ExitPlanMode") {
    return { behavior: "allow", updatedInput: input }
  }

  // 门控工具：暂停 stream，等待用户响应
  const tool = normalizeToolCall({ toolName, toolId: options.toolUseID, input })
  const result = await args.onToolRequest({ tool })  // ← Promise 暂停点

  // ask_user_question：将用户答案注入 tool input
  if (tool.toolKind === "ask_user_question") {
    return {
      behavior: "allow",
      updatedInput: { ...tool.rawInput, answers: record.answers ?? result }
    }
  }

  // exit_plan_mode：用户确认/拒绝/修改计划
  const confirmed = Boolean(record.confirmed)
  if (confirmed) {
    return { behavior: "allow", updatedInput: { ...tool.rawInput, ...record } }
  }
  return { behavior: "deny", message: `User wants to suggest edits...` }
}
```

**设计精髓**：
- `canUseTool` 返回 Promise——当遇到 gated tool 时，这个 Promise 不会 resolve，直到用户通过 WebSocket 发送 `chat.respondTool` 命令
- 用户的响应通过 `active.pendingTool.resolve(result)` 注入
- SDK 内部的 tool 执行被挂起，整个 agent loop 暂停——CPU 零消耗

### 7.2 Go 翻译

Go 没有原生 Promise，使用 channel 替代：

```go
type PendingToolRequest struct {
    ToolUseID string
    Tool      NormalizedToolCall
    ResultCh  chan ToolGateResult  // 用户响应通过此 channel 传回
}

type ToolGateResult struct {
    Behavior string // "allow" | "deny"
    Result   map[string]interface{}
}

func (c *AgentCoordinator) canUseTool(
    toolName string, input map[string]interface{}, toolUseID string,
) ToolGateResult {
    // 普通工具：直接放行
    if toolName != "AskUserQuestion" && toolName != "ExitPlanMode" {
        return ToolGateResult{Behavior: "allow"}
    }

    // 门控工具：创建 channel，注入 activeTurns，等待用户响应
    resultCh := make(chan ToolGateResult, 1)
    c.activeTurns.get(chatID).PendingTool = &PendingToolRequest{
        ToolUseID: toolUseID,
        Tool:      normalizeToolCall(toolName, toolUseID, input),
        ResultCh:  resultCh,
    }
    // 通知 UI 显示等待状态
    c.emitStateChange(chatID, true)

    result := <-resultCh  // ← 阻塞等待用户响应
    return result
}

// WebSocket 收到 chat.respondTool 时调用
func (c *AgentCoordinator) respondTool(chatID string, result ToolGateResult) {
    active := c.activeTurns.get(chatID)
    if active == nil || active.PendingTool == nil { return }
    active.PendingTool.ResultCh <- result
    active.PendingTool = nil
}
```

**Go 中 channel 的优势**：
- `<-resultCh` 会阻塞当前 goroutine，但不阻塞其他 goroutine——天然适合 Go 的并发模型
- channel 自带超时支持：`select { case result := <-resultCh: ... case <-time.After(30s): ... }`
- 不需要额外的状态标志位，closed channel 会立即返回零值

---

## 8. Steer 模式：Cancel + Restart with System Message Prefix

### 8.1 TypeScript 原始实现

**文件**：`src/server/agent.ts:135-137,1192-1218`

```typescript
const STEERED_MESSAGE_PREFIX = `<system-message>
The user would like to inform you of something while you continue to work.
Acknowledge receipt immediately with a text response, then continue with the
task at hand, incorporating the user's feedback if needed.
</system-message>`

async steer(command: Extract<ClientCommand, { type: "message.steer" }>) {
  // 1. 获取排队中的消息
  const queuedMessage = this.store.getQueuedMessage(command.chatId, command.queuedMessageId)

  // 2. 如果 active turn 存在，取消当前 turn（hideInterrupted 防止 UI 显示中断消息）
  if (this.activeTurns.has(command.chatId)) {
    await this.cancel(command.chatId, { hideInterrupted: true })
  }

  // 3. 用 STEERED_MESSAGE_PREFIX 包裹用户消息，发起新 turn
  await this.dequeueAndStartQueuedMessage(command.chatId, queuedMessage, { steered: true })
}

function buildSteeredMessageContent(content: string) {
  return content.trim().length > 0
    ? `${STEERED_MESSAGE_PREFIX}\n\n${content}`
    : STEERED_MESSAGE_PREFIX
}
```

**设计精髓**：
- Steer 不是注入消息到正在运行的 turn——而是**取消当前 turn + 发起新 turn**
- `<system-message>` 标签让模型知道这是一条内部系统消息，而非普通用户输入
- `hideInterrupted: true` 避免 UI 显示 "Conversation interrupted"，用户体验更平滑

### 8.2 Go 翻译

```go
const steeredMessagePrefix = `<system-message>
The user would like to inform you of something while you continue to work.
Acknowledge receipt immediately with a text response, then continue with the
task at hand, incorporating the user's feedback if needed.
</system-message>`

func (c *AgentCoordinator) Steer(chatID string, queuedMessageID string) error {
    msg := c.store.GetQueuedMessage(chatID, queuedMessageID)
    if msg == nil {
        return fmt.Errorf("queued message not found")
    }

    // 1. 如果有 active turn，取消（隐藏 interrupt 消息）
    if c.hasActiveTurn(chatID) {
        if err := c.cancel(chatID, true); err != nil { // hideInterrupted=true
            return err
        }
    }

    // 2. 构建 steered 消息并启动新 turn
    content := msg.Content
    if len(strings.TrimSpace(content)) > 0 {
        content = steeredMessagePrefix + "\n\n" + content
    } else {
        content = steeredMessagePrefix
    }
    return c.dequeueAndStartTurn(chatID, msg, true) // steered=true
}
```

**Go 实现要点**：
- Cancel 必须是异步的（通过 `context.CancelFunc`），等待底层 session 确认关闭后再启动新 turn
- `hideInterrupted` 通过 TranscriptEntry 的 `Hidden` 字段实现：中断消息写入 JSONL 但标记 hidden，UI 不渲染

---

## 9. Draining Indicator：Result Received ≠ Stream Closed

### 9.1 TypeScript 原始实现

**文件**：`src/server/agent.ts:683,733-738,1292-1303`

```typescript
readonly drainingStreams = new Map<string, { turn: HarnessTurn }>()

// result 事件处理中：
if (event.entry.kind === "result" && active && completedClaudePromptSeq === active.claudePromptSeq) {
  active.hasFinalResult = true
  // 不在这里关闭 stream！tool result 可能还在路上
  this.activeTurns.delete(session.chatId)        // 从 active 移除
  this.drainingStreams.set(session.chatId, { turn: session.session })  // 加入 draining
}

async stopDraining(chatId: string) {
  const draining = this.drainingStreams.get(chatId)
  if (!draining) return
  draining.turn.close()          // 关闭底层 session
  this.drainingStreams.delete(chatId)
}
```

**设计精髓**：
- `hasFinalResult = true`：模型的最终文本已到达
- `stream still open`：可能还有后台工具结果（如正在执行的 shell 命令）等待写入
- UI 显示 draining 状态：用户可以主动 `stopDraining()` 关闭，或等待 stream 自然结束
- 新 turn 发起时自动关闭旧 draining stream

### 9.2 Go 翻译

```go
type DrainingTurn struct {
    Turn HarnessTurn
}

func (c *AgentCoordinator) handleResultEvent(session *ClaudeSessionState, event *HarnessEvent) {
    active := c.getActiveTurn(session.ChatID)
    if active == nil { return }

    if event.Entry.Kind == "result" {
        active.HasFinalResult = true
        c.mu.Lock()
        delete(c.activeTurns, session.ChatID)
        c.drainingStreams[session.ChatID] = &DrainingTurn{Turn: session.Session}
        c.mu.Unlock()
        // UI 立即更新为 "draining" 状态
        c.emitStateChange(session.ChatID, true)
    }
}

func (c *AgentCoordinator) StopDraining(chatID string) error {
    c.mu.Lock()
    draining := c.drainingStreams[chatID]
    delete(c.drainingStreams, chatID)
    c.mu.Unlock()

    if draining != nil {
        return draining.Turn.Close()
    }
    return nil
}
```

**Go 中注意**：`drainingStreams` 的读写需保护。Go 的 `map` 不是并发安全的，需 `sync.RWMutex` 保护或使用 `sync.Map`。

---

## 10. Claude Prompt Sequence Tracking for Steer Safety

### 10.1 TypeScript 原始实现

**文件**：`src/server/agent.ts:88,97-98,1276-1303`

```typescript
interface ClaudeSessionState {
  nextPromptSeq: number            // 下一次 sendPrompt 的序号
  pendingPromptSeqs: number[]      // 正在执行中的 prompt 序号队列
}

interface ActiveTurn {
  claudePromptSeq?: number         // 当前 turn 对应的 prompt 序号
}

// 发送消息时：
session.pendingPromptSeqs.push(session.nextPromptSeq)
active.claudePromptSeq = session.nextPromptSeq
session.nextPromptSeq++

// 收到 result 时验证：
const completedClaudePromptSeq = event.entry.kind === "result"
  ? (session.pendingPromptSeqs.shift() ?? null)
  : null

// 仅当 result 对应的是 "当前 turn 发起的 prompt" 时，才认为 turn 完成
if (event.entry.kind === "result" && active
    && completedClaudePromptSeq === (active.claudePromptSeq ?? null)) {
  active.hasFinalResult = true
  this.activeTurns.delete(session.chatId)
}
```

**设计精髓**：
- Claude 的 SDK session 会复用连接，多个 prompt 可能在同一个 session 中并发或排队
- Steer 操作会取消旧 prompt 并发起新 prompt——必须确保 result 匹配正确的 prompt
- `pendingPromptSeqs` 队列 + `claudePromptSeq` 比较构成了**顺序安全校验**

### 10.2 Go 翻译

```go
type ClaudeSessionState struct {
    ID               string
    ChatID           string
    Session          ClaudeSessionHandle

    mu               sync.Mutex
    nextPromptSeq    int
    pendingPromptSeqs []int   // FIFO 队列
}

func (s *ClaudeSessionState) allocatePromptSeq() int {
    s.mu.Lock()
    defer s.mu.Unlock()
    seq := s.nextPromptSeq
    s.nextPromptSeq++
    return seq
}

func (s *ClaudeSessionState) startPrompt(seq int) {
    s.mu.Lock()
    s.pendingPromptSeqs = append(s.pendingPromptSeqs, seq)
    s.mu.Unlock()
}

func (s *ClaudeSessionState) completePrompt() int {
    s.mu.Lock()
    defer s.mu.Unlock()
    if len(s.pendingPromptSeqs) == 0 {
        return -1 // 无对应 prompt
    }
    seq := s.pendingPromptSeqs[0]
    s.pendingPromptSeqs = s.pendingPromptSeqs[1:]  // dequeue
    return seq
}
```

**Go 中注意**：`pendingPromptSeqs` 需要在多 goroutine 环境中保护（steer 可能从 WebSocket goroutine 触发）。

---

## 11. Session Token 自动提取与复用

### 11.1 TypeScript 原始实现

**文件**：`src/server/agent.ts:443-447,1250-1253`

```typescript
// createClaudeHarnessStream 中监听 session_token 事件
async function* createClaudeHarnessStream(q: Query) {
  for await (const sdkMessage of q) {
    const sessionToken = typeof sdkMessage.session_id === "string"
      ? sdkMessage.session_id : null
    if (sessionToken) {
      yield { type: "session_token", sessionToken }  // 透传给外层
    }
    // ...
  }
}

// AgentCoordinator.runClaudeSession 中接收并持久化
for await (const event of session.session.stream) {
  if (event.type === "session_token" && event.sessionToken) {
    session.sessionToken = event.sessionToken
    await this.store.setSessionToken(session.chatId, event.sessionToken)
    continue
  }
  // ...
}
```

**设计精髓**：
- **自动提取**：不需要用户手动获取/粘贴 session token
- **流内嵌入**：token 作为 stream 中的特殊事件（非 transcript entry），与对话事件同通道
- **下次自动复用**：`startClaudeSession()` 时传入 `sessionToken: chat.sessionToken`，SDK 的 `resume` 参数自动使用

### 11.2 Go 翻译

```go
type HarnessEvent struct {
    Type         EventType
    SessionToken string          // 非空时表示 session_token 事件
    Entry        *TranscriptEntry // 非空时表示 transcript 事件
}

// Stream 消费者：
func (c *AgentCoordinator) runSession(session *ClaudeSessionState) {
    for event := range session.Session.Stream() {
        if event.SessionToken != "" {
            session.SessionToken = event.SessionToken
            c.store.SetSessionToken(session.ChatID, event.SessionToken)
            continue
        }
        // 处理 transcript entry
    }
}
```

**Go 优势**：channel 天然支持多类型消息（通过 struct 字段区分），不需要 TypeScript 的 discriminated union。

---

## 12. Provider Config 3 层规范化

### 12.1 TypeScript 原始实现

**文件**：`src/server/provider-catalog.ts:38-83`

```typescript
// 第 1 层：Provider Catalog（静态定义）
const SERVER_PROVIDERS: ProviderCatalogEntry[] = PROVIDERS.map((provider) =>
  provider.id === "codex" ? { ...provider, defaultModel: "gpt-5.5", models: [...] } : provider
)

// 第 2 层：模型规范化（查 catalog，填充默认值）
export function normalizeServerModel(provider: AgentProvider, model?: string): string {
  const catalog = getServerProviderCatalog(provider)
  const normalizedModel = normalizeProviderModelId(provider, model, catalog.defaultModel)
  if (catalog.models.some((candidate) => candidate.id === normalizedModel)) {
    return normalizedModel
  }
  return catalog.defaultModel
}

// 第 3 层：Option 规范化（reasoning effort, context window, fast mode）
export function normalizeClaudeModelOptions(model, modelOptions?, legacyEffort?): ClaudeModelOptions {
  return {
    reasoningEffort: isClaudeReasoningEffort(modelOptions?.claude?.reasoningEffort)
      ? modelOptions.claude.reasoningEffort
      : isClaudeReasoningEffort(legacyEffort)
        ? legacyEffort
        : DEFAULT_CLAUDE_MODEL_OPTIONS.reasoningEffort,  // "medium"
    contextWindow: normalizeClaudeContextWindow(model, modelOptions?.claude?.contextWindow),
  }
}
```

**设计精髓**：
- **Layer 1**：Provider 能力声明（支持哪些 model、supportPlanMode 等）
- **Layer 2**：模型 ID 规范化（用户输入 "sonnet" → "claude-sonnet-4-20250514"）
- **Layer 3**：Option 规范化（reasoning effort / context window / fast mode 的默认值 + 值域验证）

### 12.2 Go 翻译

```go
type ProviderCatalog struct {
    providers map[string]*ProviderCatalogEntry
}

type ProviderCatalogEntry struct {
    ID             string
    DefaultModel   string
    Models         []ProviderModelOption
    SupportsEffort bool
    SupportsPlanMode bool
}

// Layer 1: 静态 catalog
func NewProviderCatalog() *ProviderCatalog {
    return &ProviderCatalog{
        providers: map[string]*ProviderCatalogEntry{
            "claude": {ID: "claude", DefaultModel: "claude-sonnet-4-20250514", ...},
            "codex":  {ID: "codex", DefaultModel: "gpt-5.5", ...},
        },
    }
}

// Layer 2: 模型规范化
func (c *ProviderCatalog) NormalizeModel(provider string, model string) string {
    entry := c.providers[provider]
    if entry == nil { return model }

    normalized := c.normalizeModelID(provider, model)
    for _, m := range entry.Models {
        if m.ID == normalized { return normalized }
    }
    return entry.DefaultModel // fallback
}

// Layer 3: Option 规范化 (method chain)
func (c *ProviderCatalog) NormalizeClaudeOptions(
    model string, userOpts *ClaudeModelOptions, legacyEffort string,
) *ClaudeModelOptions {
    opts := &ClaudeModelOptions{
        ReasoningEffort: defaultClaudeEffort,
        ContextWindow:   defaultClaudeContextWindow,
    }
    if legacyEffort != "" && isValidClaudeEffort(legacyEffort) {
        opts.ReasoningEffort = legacyEffort
    }
    if userOpts != nil && isValidClaudeEffort(userOpts.ReasoningEffort) {
        opts.ReasoningEffort = userOpts.ReasoningEffort
    }
    opts.ContextWindow = normalizeContextWindow(model, userOpts)
    return opts
}
```

---

## 13. PostToolFollowUp Auto-Continue for Plan Mode

### 13.1 TypeScript 原始实现

**文件**：`src/server/agent.ts:68,900-912`

```typescript
interface ActiveTurn {
  postToolFollowUp: { content: string; planMode: boolean } | null
}

// startTurnForChat 中：
if (chat.planMode && chat.provider !== "codex") {
  active.postToolFollowUp = {
    content: `<system-message>Plan mode is active. The user indicated that they do not want you to execute — only plan and discuss. But after responding to the previous tool confirmation, continue working on the plan.</system-message>`,
    planMode: chat.planMode,
  }
}

// runClaudeSession 中（result 事件后）：
if (active.postToolFollowUp && !active.cancelRequested) {
  await session.session.sendPrompt(active.postToolFollowUp.content)
  // 注入系统消息，让 agent 继续执行计划
}
```

**设计精髓**：
- Plan mode 下，`ExitPlanMode` 的确认（`confirmed: true`）不应让对话终止
- 自动注入一条 `<system-message>` 告诉 agent 继续执行计划
- 通过 `sendPrompt` 注入（非用户消息，是系统消息），不打断当前 session

### 13.2 Go 翻译

```go
const planModeContinueMessage = `<system-message>
Plan mode is active. The user indicated that they do not want you to execute — 
only plan and discuss. But after responding to the previous tool confirmation, 
continue working on the plan.
</system-message>`

func (c *AgentCoordinator) startTurn(args TurnArgs) {
    active := c.createActiveTurn(args)

    if args.PlanMode && args.Provider != "codex" {
        active.PostToolFollowUp = planModeContinueMessage
    }
    // ...
}

func (c *AgentCoordinator) runSession(session *ClaudeSessionState) {
    for event := range session.Session.Stream() {
        // ... 处理事件

        if event.Entry.Kind == "result" {
            active := c.getActiveTurn(session.ChatID)
            if active != nil && active.PostToolFollowUp != "" && !active.CancelRequested {
                session.Session.SendPrompt(active.PostToolFollowUp)
                active.PostToolFollowUp = ""  // 仅触发一次
            }
        }
    }
}
```

---

## 14. HarnessTurn Close 生命周期

### 14.1 TypeScript 原始实现

**文件**：`src/server/agent.ts:618-671`

```typescript
async function startClaudeSession(args): Promise<ClaudeSessionHandle> {
  const promptQueue = new AsyncMessageQueue<SDKUserMessage>()

  const q = query({ prompt: promptQueue, options: { ... } })

  return {
    provider: "claude",
    stream: createClaudeHarnessStream(q),
    close: () => {
      promptQueue.close()  // 1. 关闭输入队列（停止接受新 prompt）
      q.close()            // 2. 关闭 SDK query（关闭底层 WebSocket）
    },
    // ...
  }
}
```

**设计精髓**：
- `close()` 分两步：先关闭输入（停止新消息），再关闭输出（关闭底层连接）
- `AsyncMessageQueue.close()` 会唤醒所有等待中的 `[Symbol.asyncIterator]().next()` 返回 `{ done: true }`
- SDK 的 `q.close()` 关闭与 API 的连接，触发 stream 的 for-await 循环退出

### 14.2 Go 翻译

```go
type ClaudeSessionHandle struct {
    ctx        context.Context
    cancel     context.CancelFunc
    promptCh   chan SDKUserMessage
    stream     chan HarnessEvent
}

func (h *ClaudeSessionHandle) Close() error {
    close(h.promptCh)  // 1. 关闭输入 channel
    h.cancel()          // 2. 取消 context（关闭底层连接）
    return nil
}

func (h *ClaudeSessionHandle) Stream() <-chan HarnessEvent {
    return h.stream
}
```

Go 中 `context.CancelFunc` 比手动管理 Promise 链更优雅。关闭 `promptCh` 让 `select` 循环退出，`cancel()` 终止所有下游操作。

---

## 15. Fork Chat：Transcript 复制 + Session Token 桥接

**文件**：`src/server/event-store.ts:746-788` 和 `src/server/agent.ts:1056-1117`

核心流程：
1. 创建新 Chat（title 加 "Fork: " 前缀）
2. 复制 provider、planMode 设置
3. 设置 `pendingForkSessionToken`（复用源 session）
4. 复制源 chat 的全部 transcript entries 到新 chat 的 `transcripts/<id>.jsonl`
5. 下一次 turn 时，`forkSession: true` 传给 SDK——SDK 自动在新分支上创建 session

**Go 翻译要点**：复制 transcript 文件时使用 `io.Copy` 流式拷贝（而非全量读入内存），避免大对话的 OOM 风险。

---

## 16. AsyncMessageQueue：AsyncIterable → Go Channel

**文件**：`src/server/agent.ts:507-552`

核心实现是将 Promise-based 的 push/wait 模式转为 async iterator。

**Go 翻译**：直接使用 buffered channel (`make(chan T, 256)`) 即可，不需要额外的队列结构。但需注意 `close(ch)` 后，`range ch` 自动退出——与 `AsyncMessageQueue.close()` 唤醒所有 waiter 的效果一致。

---

## 17. Project/Path Idempotency

**文件**：`src/server/event-store.ts:647-670`

```typescript
async openProject(localPath: string, title?: string) {
  const normalized = resolveLocalPath(localPath)
  const existingId = this.state.projectIdsByPath.get(normalized)
  if (existingId) {
    // 已存在 → 返回已有 project（幂等）
    const existing = this.state.projectsById.get(existingId)
    if (existing && !existing.deletedAt) { return existing }
  }
  // 不存在 → 创建新的
  const projectId = crypto.randomUUID()
  await this.append(this.projectsLogPath, {
    v: STORE_VERSION,
    type: "project_opened",
    projectId, localPath: normalized,
    title: title?.trim() || path.basename(normalized) || normalized,
  })
}
```

**Go 翻译要点**：`resolveLocalPath` 等价于 `filepath.Clean(`)` + `filepath.EvalSymlinks(`)`。路径作为 Map key 时使用 `strings.ToLower()`（Windows case-insensitive）。

---

## 18. Sidebar Project Order Persistence

**文件**：`src/server/event-store.ts:22-40` 和 `src/server/ws-router.ts` 相关代码

Sidebar project order 独立于 state，存储在 `sidebar-order.json` 文件中，支持拖拽排序。它不参与 event store 的 JSONL 写入——这是一种**配置数据**与**领域事件**的分离。

**Go 翻译**：AgentHub 的 sidebar order 可单独存为一个 JSON 文件，避免污染 event log。

---

## 19. State Recovery：Snapshot + Replay

**文件**：`src/server/event-store.ts:175-189`

```
1. loadSnapshot() → 加载 snapshot.json
2. replayLogs()   → 按 timestamp 排序重放所有 JSONL 事件
3. shouldCompact() → 日志 >= 2MB 则 compact
```

**Go 翻译**：

```go
func (s *EventStore) Recover() error {
    // 1. 加载 snapshot
    data, err := os.ReadFile(s.snapshotPath)
    if err == nil {
        var snap SnapshotFile
        json.Unmarshal(data, &snap)
        s.state = snap.toState()  // Map → state
    }

    // 2. 按序重放所有 JSONL 日志
    events := s.readAllEventsFromLogs()
    sort.Slice(events, func(i, j int) bool {
        return events[i].Timestamp < events[j].Timestamp
    })
    for _, ev := range events {
        s.applyEvent(ev)
    }

    // 3. 检查是否需要 compact
    if ok, _ := s.shouldCompact(); ok {
        s.Compact()
    }
    return nil
}
```

---

## 20. Transcript Entry Normalization：provider-agnostic 转换

**文件**：`src/server/agent.ts:322-436`

`normalizeClaudeStreamMessage()` 将 Claude Agent SDK 的 8 种 `SDKMessage` 类型映射为 14 种 `TranscriptEntry` 变体。关键映射：

| SDK Message | TranscriptEntry(s) |
|-------------|---------------------|
| `system_init` | `system_init` |
| `assistant` | `assistant_text` + `tool_call`(s) |
| `user` (tool_result) | `tool_result` |
| `user` (compaction) | `compact_summary` |
| `result` | `result` + optional `interrupted` |
| `system/status` | `status` |
| `system/compact_boundary` | `compact_boundary` |
| `system/context_cleared` | `context_cleared` |

**Go 翻译**：AgentHub 的 adapter 层需要等效的 `NormalizeEvent()` 函数，将 provider-specific 事件格式映射为 AgentHub 统一消息类型。

---

## 21. 总结：21 个 TS → Go 翻译速查表

| # | 模式 | TS 实现 | Go 等价 | 关键差异 |
|---|------|---------|---------|---------|
| 1 | AgentCoordinator | 3 个 Map 状态机 | `sync.Map` + `sync.Mutex` | Go 需要显式并发保护 |
| 2 | HarnessTurn | interface + AsyncIterable | interface + `<-chan` | channel 替代 AsyncIterable |
| 3 | TranscriptEntry | 14-variant discriminated union | Protobuf `oneof` 或 interface | 推荐 Protobuf |
| 4 | writeChain | Promise 链 | `sync.Mutex` | Go 不需要异步写串行化 |
| 5 | 16ms debounce | `setTimeout` | `time.AfterFunc` | 语义相同 |
| 6 | 2MB compaction | `Bun.write` | `os.WriteFile` + `os.Truncate` | Go 需要原子性保证 |
| 7 | Tool gating | Promise pending | `chan + select` | channel 更自然 |
| 8 | Steer mode | cancel + restart | `context.CancelFunc` + 新 goroutine | 语义相同 |
| 9 | Draining | activeTurns → drainingStreams | map 迁移 | 需要并发保护 |
| 10 | Prompt seq tracking | 队列 + 序号比较 | 队列 + 序号比较 | 直接翻译 |
| 11 | Session token | stream 事件透传 | channel 消息透传 | channel 天然支持 |
| 12 | Provider normalization | 3 层规范 | 3 层规范 | 直接翻译 |
| 13 | PostToolFollowUp | sendPrompt 注入 | SendPrompt 注入 | 直接翻译 |
| 14 | Close lifecycle | close queue → close SDK | close ch → cancel context | context 更强大 |
| 15 | Fork chat | transcript 复制 + pendingToken | 文件复制 + pendingToken | io.Copy 流式拷贝 |
| 16 | AsyncMessageQueue | Promise + async iterator | buffered channel | channel 更简单 |
| 17 | Project idempotency | Map + resolveLocalPath | Map + filepath.Clean | Windows 需 case-insensitive |
| 18 | Sidebar order | 独立 JSON 文件 | 独立 JSON 文件 | 直接翻译 |
| 19 | Recovery | snapshot + replay | snapshot + replay | 直接翻译 |
| 20 | Entry normalization | switch-case 映射 | switch-case 映射 | 直接翻译 |
| 21 | Signature dedup | JSON.stringify 签名 | `sha256.Sum256` 签名 | Go 推荐 hash 而非全文比较 |

---

## 附录：关键文件索引

| 用途 | 文件路径 |
|------|---------|
| AgentCoordinator | `src/server/agent.ts` |
| EventStore (CQRS 写端) | `src/server/event-store.ts` |
| ReadModels (CQRS 读端) | `src/server/read-models.ts` |
| WebSocket Router | `src/server/ws-router.ts` |
| TranscriptEntry 类型 | `src/shared/types.ts:903-918` |
| NormalizedToolCall 类型 | `src/shared/types.ts:639-654` |
| Tool normalization | `src/shared/tools.ts` |
| Provider catalog | `src/server/provider-catalog.ts` |
| LLM provider 管理 | `src/server/llm-provider.ts` |
| Harness types | `src/server/harness-types.ts` |
| Events 定义 | `src/server/events.ts` |
| Protocol 定义 | `src/shared/protocol.ts` |
