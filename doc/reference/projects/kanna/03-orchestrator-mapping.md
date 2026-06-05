# Kanna AgentCoordinator <> AgentHub Orchestrator: 精确到行号的对比分析

> 分析日期：2026-05-21
> Kanna 源码根：`D:\Code\Temp\agent-hub-research\kanna\src/server/`
> AgentHub 设计参考：`design-protocol.md`、`cross-analysis-orchestration.md`、`cross-analysis-adapters.md`

---

## 1. 状态管理对比

### 1.1 Kanna: 双 Map + Draining Map 三态机

**源码定位**：`agent.ts:674-684` + `agent.ts:57-74` + `agent.ts:76-99`

Kanna 的 `AgentCoordinator` 维护三个核心 Map：

```typescript
// agent.ts:682-684
readonly activeTurns = new Map<string, ActiveTurn>()     // chatId → 正在运行的 turn
readonly drainingStreams = new Map<string, { turn: HarnessTurn }>()  // chatId → result 已到但 stream 未关
readonly claudeSessions = new Map<string, ClaudeSessionState>()      // chatId → 可复用的 Claude 长会话
```

**ActiveTurn 结构（agent.ts:57-74）**：一行记录包含一个 chat 当前运行的 22 个字段，包括 provider、model、effort、planMode、status、pendingTool、cancelRequested、hasFinalResult、postToolFollowUp 等。

**ClaudeSessionState 结构（agent.ts:87-99）**：持有 `ClaudeSessionHandle`（包括 stream、interrupt、sendPrompt、setModel、setPermissionMode 方法），以及 `nextPromptSeq` 和 `pendingPromptSeqs` 用于 steer 安全追踪。

**状态转移路径**：

```
                    send() 创建 ActiveTurn, activeTurns.set()
  [idle] ─────────────────────────────────────────────────────► [running]
    │                                                               │
    │  result 事件到达                                              │ cancel()
    │  activeTurns.delete() + drainingStreams.set()                 │ activeTurns.delete()
    ▼                                                               ▼
  [draining] ────────────────────────────────────► [cancelled]
    │  stream 完全结束
    │  drainingStreams.delete() + maybeStartNextQueuedMessage()
    ▼
  [idle]
```

**turn 生命周期关键行**：
- Turn 开始注册：`agent.ts:997` `this.activeTurns.set(args.chatId, active)`
- result 到达后从 activeTurns 移除：`agent.ts:1398` `this.activeTurns.delete(active.chatId)`
- 进入 draining：`agent.ts:1401` `this.drainingStreams.set(active.chatId, { turn: active.turn })`
- stream 完全结束：`agent.ts:1433` `this.drainingStreams.delete(active.chatId)`
- cancel 流程中移除：`agent.ts:1532` `this.activeTurns.delete(chatId)`
- Claude session 生命周期：`agent.ts:1095` set → `agent.ts:1324` finally block delete

**消息队列附加状态**：`event-store.ts` 中的 `queuedMessagesByChatId`（`events.ts` 定义），与 turn 管理形成互补——当 activeTurns 非空时，新消息进 queue（`agent.ts:1144-1153`）；turn 结束后自动 dequeue（`agent.ts:810-818` `maybeStartNextQueuedMessage`）。

### 1.2 AgentHub: Project → Thread → Turn → Run 四层

**源码定位**：`design-protocol.md:142-312`（types.go）

AgentHub 的层级模型：

```
Project (ProjectID)
  └── Conversation (ConversationID)         // IM 群聊壳
        └── Thread (ThreadID)               // 任务分支
              └── Turn (TurnID)             // 一轮执行
                    └── Run (RunID)         // AgentRun 实例
```

**Conversation**（`design-protocol.md:162-174`）：IM 壳，区分 `direct`/`group`，带 `ConversationAuthority` 和可选的 `ExecutionAuthority`。

**Thread**（`design-protocol.md:235-255`）：任务分支，状态包括 `open`/`running`/`blocked`/`done`/`archived`，带 `RootMessageID`（Fork 点）和 `CurrentRunID`。

**Turn**（`design-protocol.md:258-280`）：一轮交互，monotonic `Sequence`，`actorId` 标识 user 还是 agent，状态含 `queued`/`running`/`awaiting_approval`/`done`/`failed`/`cancelled`。

**Run**（`design-protocol.md:546-574`）：底层 AgentRun，关联 `AgentID`、`WorkspaceID`、`CheckpointID`，状态含 `starting`/`running`/`waiting_approval`/`draining`/`done`/`failed`/`cancelled`。

### 1.3 对比分析

| 维度 | Kanna (agent.ts) | AgentHub (design-protocol.md) |
|------|-----------------|-------------------------------|
| **顶层 key** | `chatId` (UUID string) | `ProjectID` + `ConversationID` |
| **并发模型** | 单聊：每个 chat 最多 1 个 active turn | 群聊：一个 conversation 可有多个 thread 并发 |
| **turn 状态** | `ActiveTurn.status` 单一枚举 (agent.ts:66) | Turn.TurnStatus 6 态 (L258+) + Run.RunStatus 7 态 (L563+) |
| **draining 建模** | 独立 `drainingStreams` Map (agent.ts:683) | `RunStatusDraining` 内嵌在 RunStatus 枚举中 (L569) |
| **cancel 建模** | `cancelRequested` + `cancelRecorded` 双 bool (agent.ts:70-71) | `TurnCancelled` + `RunCancelled` 分离的 status 值 |
| **fork 建模** | `pendingForkSessionToken` + CLI 原生 `forkSession` flag | `Thread.RootMessageID` + `ForkMode` 四种 (L1017-1020) |
| **session/token** | `sessionToken` + `pendingForkSessionToken` 存在 chat record | 无直接对应——AgentHub 的 session 由 StartRequest.SessionID 管理 |
| **pending tool** | `pendingTool` 单槽 (agent.ts:67) | `TurnAwaitingApproval` 状态 + `ApprovalRequest` 独立类型 |
| **queued 消息** | EventStore 的 `queuedMessagesByChatId` (event-store.ts) | `TurnQueued` 状态 (L273) — 更语义化 |

### 1.4 结论：直接复用 vs 需改造 vs 不适用

| Kanna 模式 | 对 AgentHub 的适用性 | 标注 |
|-----------|---------------------|------|
| `activeTurns: Map<chatId, ActiveTurn>` 单层 | **需改造** — AgentHub 需要 Thread/Turn/Run 三层而非 chatId 一层，因为群聊场景下一对多并发 | 需改造 |
| `drainingStreams` 独立 Map | **直接复用** — 概念直接映射到 `RunStatusDraining`，但 Kanna 用独立 Map 做二态分离更清晰 | 直接复用 |
| `cancelRequested`/`cancelRecorded` 双 bool 防重入 | **直接复用** — agent.ts:1493-1505 的 cancel 幂等守卫可直接翻译为 Go 的 `sync.Once` 或原子 bool | 直接复用 |
| `pendingTool` 单槽等待 | **需改造** — AgentHub 群聊场景可能有多个 agent 同时等待审批，应升级为 `map[toolCallId]*PendingTool` | 需改造 |
| `maybeStartNextQueuedMessage` 自动 dequeue | **需改造** — Kanna 是单 turn 队列，AgentHub 的 Supervisor 路由需要更复杂的调度决策 | 需改造 |
| Fork 通过 `pendingForkSessionToken` + CLI flag | **需改造** — AgentHub 的 Fork 是 Thread 级别概念，对应 `Thread.RootMessageID` + `ForkMode`，底层由 `AgentAdapter.Resume` 处理 | 需改造 |

**Go 翻译建议（Kanna 三态机 → Go）**：

```go
// Kanna drainingStreams 的概念翻译
type TurnState struct {
    mu       sync.Mutex
    active   map[string]*ActiveTurn   // chatId → turn (Kanna agent.ts:682)
    draining map[string]drainingRef   // chatId → still-open stream (Kanna agent.ts:683)
}

type ActiveTurn struct {
    chatId          TurnID
    provider        string
    stream          <-chan AgentEvent   // Kanna: HarnessTurn.stream (harness-types.ts:15)
    cancelRequested atomic.Bool         // Kanna agent.ts:70-71
    cancelRecorded  atomic.Bool
    hasFinalResult  bool
    pendingTool     *PendingToolRequest // Kanna agent.ts:67
}

// cancel 幂等守卫 → Go (对应 agent.ts:1493-1505)
func (c *AgentCoordinator) Cancel(turnID string) error {
    active := c.getActive(turnID)
    if active == nil {
        return nil
    }
    // Kanna agent.ts:1504: if (active.cancelRequested) return
    if !active.cancelRequested.CompareAndSwap(false, true) {
        return nil // 幂等：已经 cancel 过了
    }
    // ... 执行 cancel 逻辑
    c.deleteActive(turnID)                   // Kanna agent.ts:1532
    active.turn.Close()                      // Kanna agent.ts:1551
    return nil
}
```

---

## 2. 消息队列对比

### 2.1 Kanna: `AsyncMessageQueue<T>` 泛型 async iterable

**源码定位**：`agent.ts:507-552`

```typescript
class AsyncMessageQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []                              // 509
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []  // 510
  private closed = false                                         // 511

  push(value: T) {                                               // 512-524
    if (this.closed) throw new Error("Cannot push to a closed queue")
    const waiter = this.waiters.shift()
    if (waiter) { waiter({ done: false, value }); return }      // 有等待者立即消费
    this.values.push(value)                                      // 否则入队
  }

  close() {                                                      // 526-533
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {                  // 535-551
    return {
      next: async () => {
        if (this.values.length > 0) return { done: false, value: this.values.shift() }
        if (this.closed) return { done: true, value: undefined }
        return await new Promise((resolve) => { this.waiters.push(resolve) })
      },
    }
  }
}
```

**用途分析**（agent.ts:618-651）：Claude Agent SDK 的 `query()` 接受 `AsyncIterable<SDKUserMessage>` 作为 prompt 输入源。`AsyncMessageQueue` 充当"可动态追加的 prompt 源"，在 Claude session 启动后，通过 `session.sendPrompt(content)` 向队列 push 新消息。

**Steer 场景**（agent.ts:1192-1218）：当用户在 agent 运行期间发新消息，Kanna 通过 `message.steer` 命令：
1. cancel 当前 turn（`agent.ts:1206`）
2. 从 queued messages 中 dequeue 并重建 turn（`agent.ts:1218`）

`AsyncMessageQueue` 在这里承载的是 Claude SDK 的 prompt 输入。Codex 路径不使用此队列——Codex 的 `startTurn()` 直接接受 prompt string。

### 2.2 AgentHub: WebSocket Hub + channel select

**设计来源**：`cross-analysis-orchestration.md Section 2.3` + `design-protocol.md Section 3 (sync.go)`

AgentHub 的"消息队列"是多层的：

1. **WebSocket 层**：`EdgeEvent` (sync.go:1282-1313) 经过 WebSocket 从 Edge 推到 Hub
2. **Hub 内部**：通过 Go channel 分发到对应的 Conversation handler
3. **Turn 队列**：`TurnQueued` 状态（design-protocol.md L273）表示等待执行的 turn
4. **Adapter 内部**：`EventStream.C` (`<-chan AgentEvent`) — Go channel 作为事件流载体

这与 Kanna 的 `AsyncMessageQueue` 是不同层级的抽象：
- Kanna 的 `AsyncMessageQueue` 是 **provider SDK 的 prompt 输入端**
- AgentHub 的 channel select 是 **Hub 内部的消息路由**

### 2.3 对比分析

| 维度 | Kanna AsyncMessageQueue | AgentHub Channel/Event Model |
|------|------------------------|------------------------------|
| **语义** | 可追加的 prompt 序列（push-based producer） | 事件分发管道（channel-based fan-out） |
| **消费者** | 单一消费者（Claude SDK query 的 for-await 循环） | 多消费者（WSHub 订阅者、Orchestrator handler） |
| **backpressure** | 无显式 backpressure，push 失败抛异常（line 514） | Go channel 天然支持 buffer limit + select |
| **关闭语义** | close() 唤醒所有 waiter 返回 done（line 526-533） | channel close → range loop 自动退出 |
| **并发安全** | JS 单线程 EventLoop 天然安全 | Go channel 天然并发安全 |
| **集成点** | Claude SDK `query({ prompt: promptQueue })` (agent.ts:620-621) | `AgentAdapter.Start()` 返回 `EventStream.C` channel |

### 2.4 结论：直接复用 vs 需改造 vs 不适用

| 模式 | 对 AgentHub 的适用性 | 标注 |
|------|---------------------|------|
| `AsyncMessageQueue<T>` 类本身 | **直接复用** — 模式通用：当需要将"运行时动态追加的消息"注入到已启动的 stream 中时非常有用 | 直接复用 |
| `promptQueue` 作为 SDK prompt 源 | **需改造** — 仅 Claude Code adapter 适用此模式；Codex 的 `startTurn()` 是一次性 prompt，不需要动态队列 | 需改造 |
| steer 机制（cancel + 重建 turn） | **需改造** — Kanna 的 steer 是通过取消+重建实现的（agent.ts:1206-1218），AgentHub 有专门的 `InteractiveControl.SendSteer` 接口（design-protocol.md:869），更优雅 | 需改造 |
| 单消费者 async iterator | **不适用** — AgentHub 是 Go channel 多消费者模型，不需要 JS 风格的 Symbol.asyncIterator | 不适用 |

**Go 翻译建议（AsyncMessageQueue → Go）**：

```go
// Kanna agent.ts:507-552 的 Go 等价实现
// 用途：Claude Code adapter 中动态追加 prompt 消息

type AsyncMessageQueue[T any] struct {
    mu      sync.Mutex
    values  []T
    waiters []chan itemResult[T]
    closed  bool
}

type itemResult[T any] struct {
    value T
    done  bool
}

func (q *AsyncMessageQueue[T]) Push(value T) error {
    q.mu.Lock()
    defer q.mu.Unlock()

    if q.closed {
        return errors.New("cannot push to a closed queue")
    }

    // Kanna agent.ts:517-520: 有等待者立即交付
    for len(q.waiters) > 0 {
        ch := q.waiters[0]
        q.waiters = q.waiters[1:]
        ch <- itemResult[T]{value: value, done: false}
        return nil
    }

    // Kanna agent.ts:522: 否则入队
    q.values = append(q.values, value)
    return nil
}

func (q *AsyncMessageQueue[T]) Close() {
    q.mu.Lock()
    defer q.mu.Unlock()

    if q.closed {
        return
    }
    q.closed = true

    // Kanna agent.ts:529-532: 唤醒所有等待者
    for _, ch := range q.waiters {
        ch <- itemResult[T]{done: true}
    }
    q.waiters = nil
}

// 返回一个 channel 模拟 async iterator
// 注意：Go 不支持 Symbol.asyncIterator，用 channel 替代
func (q *AsyncMessageQueue[T]) Stream(ctx context.Context) <-chan itemResult[T] {
    out := make(chan itemResult[T], 1)
    go func() {
        defer close(out)
        for {
            q.mu.Lock()
            if len(q.values) > 0 {
                v := q.values[0]
                q.values = q.values[1:]
                q.mu.Unlock()
                select {
                case out <- itemResult[T]{value: v, done: false}:
                case <-ctx.Done():
                    return
                }
                continue
            }
            if q.closed {
                q.mu.Unlock()
                return
            }
            // 无数据，注册等待者
            ch := make(chan itemResult[T], 1)
            q.waiters = append(q.waiters, ch)
            q.mu.Unlock()

            select {
            case result := <-ch:
                if result.done {
                    return
                }
                select {
                case out <- result:
                case <-ctx.Done():
                    return
                }
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

---

## 3. Provider 切换对比

### 3.1 Kanna: `provider-catalog.ts` + Provider 规范化

**源码定位**：`provider-catalog.ts:28-87` + `agent.ts:756-776`

Kanna 的 model 是 **"用户选 Provider，Provider 有不同模型"**：

```
Provider (claude | codex)
  └── Catalog Entry { id, label, defaultModel, models[], supportsPlanMode }
        └── Model Option { id, label, supportsEffort }
              ├── ReasoningEffort (claude: low/medium/high/max, codex: minimal/low/medium/high/xhigh)
              ├── ContextWindow (claude only: 200k/1M)
              └── FastMode (codex only: boolean → serviceTier "fast")
```

**Provider 规范化链路**（agent.ts:756-776）：

```typescript
// agent.ts:756-776
private getProviderSettings(provider: AgentProvider, options: SendMessageOptions) {
  const catalog = getServerProviderCatalog(provider)        // provider-catalog.ts:38
  if (provider === "claude") {
    const model = normalizeServerModel(provider, options.model)          // L46
    const modelOptions = normalizeClaudeModelOptions(model, ...)         // L55
    return { model: resolveClaudeApiModelId(...), effort, planMode }
  }
  // codex 路径
  const modelOptions = normalizeCodexModelOptions(...)                   // L71
  return { model: normalizeServerModel(...), effort, serviceTier, planMode }
}
```

**三层规范化**：
1. `normalizeServerModel`（provider-catalog.ts:46-53）："未指定 → 查 catalog 默认 model"、"model 不在 catalog → fallback 默认"
2. `normalizeClaudeModelOptions`（provider-catalog.ts:55-69）：从 modelOptions、legacyEffort、DEFAULT 三层尝试提取 reasoningEffort 和 contextWindow
3. `resolveClaudeApiModelId`（shared/types）：将 human-readable model name 解析为 API 端点需要的 ID

**Provider 切换触发时机**：
- 发送消息时 `resolveProvider`（agent.ts:751）：优先取消息本身的 provider，其次取 chat 已绑定的 provider，再次取全局默认 provider
- Chat 首次发送消息后绑定 provider（agent.ts:853）`setChatProvider(chatId, provider)`
- Claude Session 复用检测（agent.ts:1066-1096）：当 localPath/effort/forkSession 变化时重建 session，仅 model/planMode 变化时热切换（`setModel`/`setPermissionMode`）

### 3.2 AgentHub: `AgentAdapter` Interface + `AgentConfig`

**设计来源**：`design-protocol.md:778-818`（adapter.go）+ `cross-analysis-adapters.md Section 2.2`

AgentHub 的 model 是 **"每个 Agent 是一个联系人"**：

```
Agent (AgentID — 群聊成员)
  └── AgentConfig
        ├── provider: "claude-code" | "codex" | "opencode"
        ├── modelDefault: "claude-sonnet-4-6"
        ├── models: [available list]
        ├── tools: [built-in]
        ├── mcpTools: [MCP registered]
        ├── subAgents: [allowed children]
        └── sandbox: worktree | process | docker
```

**AgentAdapter Interface**（`design-protocol.md:795-818`）：

```go
type AgentAdapter interface {
    Metadata() AdapterMetadata
    Capabilities() AgentCapabilities       // 能力声明（Streaming、Fork、PermissionHooks...）
    Start(ctx context.Context, req StartRequest) (*AgentSession, error)
    Resume(ctx context.Context, sessionID string) (*AgentSession, error)
    AttachStream(ctx context.Context, sessionID string) (*EventStream, error)
}
```

**StartRequest**（`design-protocol.md:913-968`）包含完整的 per-turn 配置：model、thinking、maxTokens、temperature、workspace dir、allowedTools、MCPConfig、permissionMode、sandbox、forkFrom 等约 30 个字段。

### 3.3 两种模式的根本差异

| 维度 | Kanna (provider-catalog + agent.ts) | AgentHub (AgentAdapter + AgentCapability) |
|------|-------------------------------------|------------------------------------------|
| **抽象层级** | Provider 是第一级：用户选 Claude 还是 Codex | Agent 是第一级：每个 Agent 是独立"人格" |
| **模型选择** | Provider → Model 二级菜单 | Agent → AgentConfig.modelDefault（Agent 自带默认模型） |
| **配置粒化** | 全局 provider defaults + per-chat 临时覆盖 | per-Agent static config + per-Turn StartRequest 覆盖 |
| **多 Provider 并发** | 一个 chat 同时只有一个 provider | 一个群聊可以同时有 Claude Agent 和 Codex Agent |
| **模型热切换** | `session.setModel(model)` runtime 切换（agent.ts:1098-1100） | `AgentAdapter.Capabilities()` 声明是否支持 runtime 切换 |
| **能力发现** | 无——provider catalog 是静态 hardcoded（provider-catalog.ts:21-26） | `AgentCapability` 包含 tools、mcpTools、skills、subAgents |

### 3.4 融合建议

两种模式不是冲突的，而是**不同抽象层级**：

```
AgentHub 高层（群聊视角）：
  Agent1 (Claude, sonnet-4-6, full-stack dev)  -- Kanna 面向用户
  Agent2 (Codex,  gpt-5.5,    code reviewer)   -- 的抽象层级
        │
        │ 每个 Agent 底层通过 StartRequest 启动
        ▼
AgentHub 底层（Provider 视角）：
  Adapter Start(req: StartRequest) → 等价于 Kanna 的 getProviderSettings + startClaudeSession
```

**可融合点**：
1. Kanna 的 `getProviderSettings` (agent.ts:756-776) 可以抽取为 `StartRequest.Builder.Normalize()` 函数
2. Kanna 的 `normalizeClaudeModelOptions`（provider-catalog.ts:55-69）的三层 fallback（modelOptions → legacyEffort → DEFAULT）可直接作为 `StartRequest` 的 normalize 逻辑
3. Kanna 的 `codexServiceTierFromModelOptions`（provider-catalog.ts:85-87）可作为 Codex Adapter 的 `fastMode → serviceTier` 映射
4. Kanna 的 session 复用逻辑（agent.ts:1066-1117）对应 AgentHub 的 `AgentAdapter.Resume` 接口

| Kanna 模式 | 对 AgentHub 的适用性 | 标注 |
|-----------|---------------------|------|
| `getServerProviderCatalog(provider)` 查找 | **需改造** — AgentHub 的 provider 信息在 `AgentCapability` 中（provider + models[]），不需要独立的 catalog 查找 | 需改造 |
| `normalizeClaudeModelOptions` 三层 fallback | **直接复用** — 可以直接融入 `StartRequest.Validate()` 或 `AgentAdapter.Start()` 的 precondition 检查 | 直接复用 |
| `normalizeServerModel` 的 default fallback | **直接复用** — "model 为空或无效 → 取 Agent 注册的 modelDefault" | 直接复用 |
| Claude Session 热切换（setModel/setPermissionMode） | **需改造** — 等价于 `AgentAdapter.Resume` + 嵌入 `InteractiveControl` 接口的 `SetModel`/`SetPermissionMode` 方法 | 需改造 |
| `resolveProvider` 优先级链 | **需改造** — AgentHub 的 Agent 选择由 `DispatchStrategy` 决策，而非简单的 "消息 provider > chat provider > default" | 需改造 |
| Claude vs Codex 双 Provider 分支 | **需改造** — AgentHub 通过 `AgentAdapter` interface 多态实现，而非 if/else 分支 | 需改造 |

---

## 4. WebSocket 广播对比

### 4.1 Kanna: snapshot signature 去重 + 16ms debounce

**源码定位**：`ws-router.ts:773-832`（pushSnapshots）+ `ws-router.ts:874-923`（scheduleBroadcast）+ `ws-router.ts:656-771`（createEnvelope）

**核心机制一：signature-based dedup（ws-router.ts:773-832）**

```typescript
// ws-router.ts:773-832
async function pushSnapshots(ws, options) {
  const snapshotSignatures = ensureSnapshotSignatures(ws)  // L781
  let sentCount = 0, skippedCount = 0
  for (const [id, topic] of ws.data.subscriptions) {       // L784
    if (!shouldIncludeTopic(topic, options?.filter)) continue
    const envelope = createEnvelope(id, topic, options?.cache)  // L789
    const signature = JSON.stringify(envelope.snapshot)       // L793-794
    // Kanna L796-799: 跳过签名未变的 snapshot
    if (snapshotSignatures.get(id) === signature) {
      skippedCount += 1
      continue
    }
    snapshotSignatures.set(id, signature)  // L800
    send(ws, envelope)                     // L812
    sentCount += 1
  }
}
```

**去重原理**：
- 每个 WebSocket 连接维护 `snapshotSignatures: Map<subscriptionId, signatureString>`（ws-router.ts:369-374）
- 每次推送前 `JSON.stringify(envelope.snapshot)` 做签名
- 相同签名 = 数据未变 → 跳过
- 新签名 → 更新缓存 + 发送
- subscribe 时清空该 subscription 的签名（ws-router.ts:1612），强制首次推送

**核心机制二：16ms debounce 批处理（ws-router.ts:874-923）**

```typescript
// ws-router.ts:874-897
function scheduleBroadcast() {
  pendingBroadcastAll = true
  pendingBroadcastChatIds.clear()         // L877: "全广播" 清空 chatIds
  if (pendingBroadcastTimer) return       // L878: debounce — 已有定时器则跳过
  pendingBroadcastTimer = setTimeout(() => {  // L880
    pendingBroadcastTimer = null
    const shouldBroadcastAll = pendingBroadcastAll
    const chatIds = new Set(pendingBroadcastChatIds)
    pendingBroadcastAll = false
    pendingBroadcastChatIds.clear()
    if (shouldBroadcastAll) {
      void broadcastSnapshots()           // 全量广播
      return
    }
    if (chatIds.size > 0) {
      void broadcastFilteredSnapshots({ includeSidebar: true, chatIds })
    }
  }, 16)                                  // 16ms 窗口 (约 60fps)
}

// ws-router.ts:899-923
function scheduleChatStateBroadcast(chatId: string) {
  if (!pendingBroadcastAll) {
    pendingBroadcastChatIds.add(chatId)   // L901: "局部广播" 追加 chatId
  }
  if (pendingBroadcastTimer) return       // L903: 已有定时器则合并
  // ... 同 scheduleBroadcast 的 setTimeout 逻辑
}
```

**广播决策树**：
```
onStateChange 触发
  │
  ├── chatId 指定？
  │   └── scheduleChatStateBroadcast(chatId)
  │         └── 如果已有 pendingBroadcastAll → 不追加 chatId（全量已覆盖）
  │         └── 加入 pendingBroadcastChatIds + 启动 16ms timer
  │
  └── 无 chatId？
      └── scheduleBroadcast()
            └── pendingBroadcastAll = true
            └── 清空 pendingBroadcastChatIds（全量已覆盖）
            └── 启动 16ms timer
```

**Snapshot 计算（ws-router.ts:656-771）**：`createEnvelope` 按 topic 类型分别计算 snapshot：
- `sidebar` → `deriveSidebarData`（L657-668）
- `chat` → `deriveChatSnapshot`（L756-770）
- `local-projects` → `deriveLocalProjectsSnapshot`（L670-683）
- `project-git` → `diffStore.getProjectSnapshot`（L742-754）
- `terminal` → `terminals.getSnapshot`（L730-740）

**立即广播路径**：`broadcastChatStateImmediately`（ws-router.ts:932-934）绕开 debounce，在状态为 "starting" 时立即推送，确保 UI 第一时间反映 turn 启动状态（agent.ts:1002）。

### 4.2 AgentHub: `WSHub.Room.BroadcastExcept()`

**设计来源**：`design-protocol.md Section 3 (sync.go)` + `cross-analysis-orchestration.md Section 2`

AgentHub 的广播模型是基于 **Room（群聊/Conversation 粒度）** 的：

```
WSHub
  └── Room (ConversationID)
        ├── 成员 A (WebSocket conn)
        ├── 成员 B (WebSocket conn)
        └── Agent X (WebSocket conn)
              │
              └── BroadcastExcept(sender, event)  // 除了发送者，全员广播
```

**当前设计 vs Kanna**：

| 维度 | Kanna (ws-router.ts) | AgentHub (WSHub.Room) |
|------|---------------------|----------------------|
| **广播粒度** | 每个订阅独立 topic（sidebar/chat/terminal/...） | 每个 Room 全量广播（Conversation 级别） |
| **去重** | `snapshotSignatures` Map + `JSON.stringify` 签名对比 (L796-799) | 未在现有设计中明确提及 |
| **Debounce** | 16ms `setTimeout` 合并窗口 (L880) | 未在现有设计中明确提及 |
| **过滤** | `SnapshotBroadcastFilter` 精确到 chatIds/projectIds (L137-146) | Room 级别广播，无子 topic 过滤 |
| **全量 vs 增量** | 增量：`pendingBroadcastChatIds` 收集变化 chatId (L900-901) | 全量：Room 内所有成员收到完整 snapshot |
| **缓存** | `SnapshotComputationCache` 复用 sidebar 计算 (L148-154) | 未在现有设计中明确提及 |
| **连接管理** | `sockets: Set<ServerWebSocket>` (L390) | WSHub.Room 成员注册 |

### 4.3 对比分析：Kanna 的去重+debounce 能否借鉴？

**Kanna 的 signature 去重优势**：
1. 客户端多次订阅同一 topic 不会重复收到相同数据
2. `JSON.stringify(envelope.snapshot)` 作为签名简单高效（对 Kanna 的 snapshot 规模足够）
3. subscribe 时清空签名 = 首次必定推送（强制同步）

**Kanna 的 16ms debounce 优势**：
1. 高频 event streaming（每条 assistant_text 都触发 onStateChange）被合并为约 60fps 的推送频率
2. `pendingBroadcastAll` vs `pendingBroadcastChatIds` 的智能合并全量/增量
3. 避免 WebSocket 广播风暴——agent 输出每秒可能产生数十个 event

**AgentHub 直接借鉴的挑战**：
1. AgentHub 是**多设备同步** + 群聊——signature 去重需要考虑多客户端签名一致性
2. AgentHub 的 snapshot 规模远大于 Kanna（群聊多 Agent 响应），`JSON.stringify` 做签名可能成为性能瓶颈
3. AgentHub 的 `SyncBatch`（sync.go:1320-1328）已有 seq-based 增量同步语义，与 Kanna 的 debounce 需要协调

### 4.4 结论：直接复用 vs 需改造 vs 不适用

| Kanna 模式 | 对 AgentHub 的适用性 | 标注 |
|-----------|---------------------|------|
| `snapshotSignatures` Map 去重 | **直接复用** — 每个 Room 成员维护 `lastSeqByTopic` 或 `signatureByTopic` map，避免重复推送 | 直接复用 |
| 16ms debounce `setTimeout` | **直接复用** — Go 中使用 `time.AfterFunc(16*time.Millisecond, ...)` 等价实现 | 直接复用 |
| `pendingBroadcastAll` vs `pendingBroadcastChatIds` 智能合并 | **直接复用** — 概念映射为 `pendingBroadcastAll bool` + `pendingConversationIDs set` | 直接复用 |
| `SnapshotComputationCache` 跨连接复用计算 | **直接复用** — 单次广播循环中对同一 Conversation 的 snapshot 只计算一次 | 直接复用 |
| `shouldIncludeTopic` + `SnapshotBroadcastFilter` | **需改造** — AgentHub 的 topic 粒度是 Conversation 而非 chat/terminal/sidebar 多类型 | 需改造 |
| `broadcastChatStateImmediately` 绕开 debounce | **直接复用** — AgentHub 在 `EdgeRunStatusChanged` 或 status=starting 时绕过 debounce 立即推送 | 直接复用 |
| WebSocket subscription-based 模型 | **需改造** — AgentHub 的 WSHub.Room 模型是 "join room = subscribe all"，不需要显式 subscribe/unsubscribe per topic | 需改造 |

**Go 翻译建议（Kanna 去重+debounce → Go）**：

```go
// Kanna ws-router.ts:773-832 + 874-923 的 Go 等价实现

type WSBroadcaster struct {
    mu           sync.Mutex
    timer        *time.Timer
    broadcastAll bool
    roomIDs      map[string]struct{}   // Kanna pendingBroadcastChatIds (L392)

    // 每个连接的去重状态
    connStates   map[*ws.Conn]*connState
}

type connState struct {
    signatures map[string]string        // Kanna snapshotSignatures (L114)
}

// Kanna ws-router.ts:874-897: scheduleBroadcast → Go
func (b *WSBroadcaster) ScheduleBroadcast() {
    b.mu.Lock()
    b.broadcastAll = true
    b.roomIDs = nil                    // Kanna L877: pendingBroadcastChatIds.clear()
    if b.timer != nil {
        b.mu.Unlock()
        return                         // Kanna L878: debounce
    }
    b.timer = time.AfterFunc(16*time.Millisecond, func() {  // Kanna L880
        b.mu.Lock()
        shouldBroadcastAll := b.broadcastAll
        roomIDs := make(map[string]struct{}, len(b.roomIDs))
        for id := range b.roomIDs {
            roomIDs[id] = struct{}{}
        }
        b.broadcastAll = false
        b.roomIDs = nil                // Kanna L883-885
        b.timer = nil
        b.mu.Unlock()

        if shouldBroadcastAll {
            b.broadcastAllRooms()      // Kanna L887
            return
        }
        if len(roomIDs) > 0 {
            b.broadcastRooms(roomIDs)  // Kanna L891-894
        }
    })
    b.mu.Unlock()
}

// Kanna ws-router.ts:899-923: scheduleChatStateBroadcast → Go
func (b *WSBroadcaster) ScheduleRoomBroadcast(roomID string) {
    b.mu.Lock()
    if !b.broadcastAll {
        if b.roomIDs == nil {
            b.roomIDs = make(map[string]struct{})
        }
        b.roomIDs[roomID] = struct{}{} // Kanna L901
    }
    if b.timer != nil {
        b.mu.Unlock()
        return
    }
    b.timer = time.AfterFunc(16*time.Millisecond, func() {
        // 同上逻辑
    })
    b.mu.Unlock()
}

// Kanna ws-router.ts:773-832: pushSnapshots → Go（去重核心）
func (b *WSBroadcaster) pushSnapshot(conn *ws.Conn, roomID string, snapshot []byte) error {
    cs := b.connStates[conn]

    // Kanna L793-794: compute signature
    sig := hash(snapshot) // 比 JSON.stringify 更高效

    // Kanna L796-799: dedup
    if last := cs.signatures[roomID]; last == sig {
        return nil // skip
    }

    // Kanna L800: update signature
    cs.signatures[roomID] = sig

    // Kanna L812: send
    return conn.Write(snapshot)
}
```

**签名方案选择**：Kanna 用 `JSON.stringify(envelope.snapshot)` 做签名对 Kanna 的 snapshot 规模足够，但 AgentHub 的群聊 snapshot 可能很大。建议用 **hash of canonical JSON**（Go 使用 `sha256.Sum256(json.Marshal(snapshot))` 或更快的 `xxhash`）作为签名，避免全量字符串比较。

---

## 5. Turn/Thread 管理与 Fork/Resume 对比

### 5.1 Kanna: Turn = 一次 provider 调用

**关键行号**：

| 操作 | 代码位置 | 说明 |
|------|---------|------|
| Turn 启动 | agent.ts:820-1052 `startTurnForChat` | 完整 turn 启动流程：关闭 draining → 检查 active → 绑定 provider → 设置 planMode → 追加 user_prompt → 启动 Claude/Codex |
| Claude Turn 启动 | agent.ts:1054-1117 `startClaudeTurn` | Session 复用/重建逻辑，fork 检测 |
| Claude Turn 事件循环 | agent.ts:1247-1335 `runClaudeSession` | For-await stream 循环，处理 session_token、system_init、result、取消等事件 |
| Codex Turn 事件循环 | agent.ts:1360-1484 `runTurn` | 通用 stream 循环，额外处理 draining 状态、postToolFollowUp |
| Cancel | agent.ts:1486-1552 `cancel` | 双 bool 防重入，draining 清理，5s timeout interrupt |
| respondTool | agent.ts:1554-1608 `respondTool` | AskUserQuestion/ExitPlanMode 的用户响应处理，postToolFollowUp 设置 |

**Fork 实现**：

| 操作 | 代码位置 | 说明 |
|------|---------|------|
| Store 端 Fork | event-store.ts:746-788 `forkChat` | 创建新 chat → 复制 provider/planMode → 设 pendingForkSessionToken → 复制 transcript JSONL |
| Agent 端 Fork | agent.ts:1230-1245 `forkChat` | 检查 chat idle → 检查有 session → 调用 store.forkChat |
| Turn 时 Fork 生效 | agent.ts:1054-1117 `startClaudeTurn` | `forkSession: Boolean(chat.pendingForkSessionToken)` 传入 SDK |

### 5.2 AgentHub: Thread = 任务分支，Turn = 一轮执行，Run = 一次 CLI 调用

**一级映射**：

| Kanna 概念 | AgentHub 概念 | 对应位置 |
|-----------|--------------|---------|
| `chatId` | `ConversationID` | design-protocol.md L37-48 |
| `activeTurns[chatId]` | `Turn` + `Run` | design-protocol.md L258-280 + L546-574 |
| `drainingStreams[chatId]` | `RunStatusDraining` | design-protocol.md L569 |
| Kanna 的 Fork（复制 transcript） | AgentHub 的 Fork（`Thread.RootMessageID` + `ForkMode`） | design-protocol.md L241 + L1017-1020 |
| Kanna 的 sessionToken | `StartRequest.SessionID` | design-protocol.md L945 |
| Kanna 的 queued messages | `TurnQueued` 状态 | design-protocol.md L273 |

**AgentHub 多出一层的必要性**：

Kanna 是**单聊单 Agent**，chatId 直接映射到 turn。AgentHub 是**群聊多 Agent**，一个 Conversation 可以同时有多个 Thread（不同任务分支），每个 Thread 有多个 Turn（人类-Agent 交互轮次），每个 Turn 对应一个 Run（底层 CLI 调用）。这多出的一层是群聊场景的必备。

### 5.3 结论：直接复用 vs 需改造 vs 不适用

| Kanna 模式 | 对 AgentHub 的适用性 | 标注 |
|-----------|---------------------|------|
| Fork → 复制 transcript + pendingForkSessionToken | **需改造** — AgentHub 的 Fork 在 Thread 级别，且 ForkMode 有 4 种（design-protocol.md L1600-1607），比 Kanna 的简单复制更复杂 | 需改造 |
| `runTurn` 中 result 到达后立即从 activeTurns 移除 | **直接复用** — AgentHub 的 Run 在 status=done 后可以立即从 active runs 中移除，对应 `agent.ts:1398` | 直接复用 |
| `drainingStreams` 跟踪 stream 关闭 | **直接复用** — 对应 `RunStatusDraining`，概念一致 | 直接复用 |
| `cancel` 双 bool 防重入 | **直接复用** — agent.ts:1493-1505 的幂等守卫模式在 Go 中可用 `sync.Once` | 直接复用 |
| `postToolFollowUp` 工具响应后自动发起新 turn | **需改造** — AgentHub 的审批响应通过 `ApprovalDecision` → `InteractiveControl.SendSteer` 或新的 `Turn`，而非 agent 内部自动重建 | 需改造 |
| `generateTitleInBackground` 异步标题生成 | **直接复用** — Conversation/Room 的标题自动生成可以参考此模式 | 直接复用 |

---

## 6. EventStore 层对比

### 6.1 Kanna: JSONL + Snapshot Compaction

**源码定位**：`event-store.ts` 全篇（1281 行）

**核心设计**：

| 机制 | 代码位置 | 说明 |
|------|---------|------|
| writeChain 串行化 | event-store.ts:616-623 | `this.writeChain = this.writeChain.then(...)` 保证事件顺序 |
| 多日志源 | event-store.ts:163-172 | projects.jsonl / chats.jsonl / messages.jsonl / queued-messages.jsonl / turns.jsonl / transcripts/<id>.jsonl |
| Event replay | event-store.ts:353-374 | 多日志源按 timestamp + priority + sourceIndex + lineIndex 四维排序重放 |
| Snapshot compaction | event-store.ts:1228-1238 | 日志 > 2MB 时 generate snapshot.json + clear all logs |
| Version migration | event-store.ts:222-225 | 版本不匹配自动 reset + 重新开始 |
| 遗留数据迁移 | event-store.ts:1240-1269 | messagesLog → per-chat transcript JSONL 迁移 |
| read-models 分离 | read-models.ts | `deriveSidebarData`、`deriveChatSnapshot`、`deriveLocalProjectsSnapshot` 纯函数 |

**AgentHub 对应**：AgentHub 已采用类似 CQRS + Event Sourcing 模式，但 JSONL 换为 PostgreSQL WAL 或 BoltDB。核心差异是 AgentHub 需要**多设备同步**（EdgeEvent + SyncBatch），而 Kanna 是单机本地存储。

### 6.2 直接复用 vs 需改造 vs 不适用

| Kanna 模式 | 对 AgentHub 的适用性 | 标注 |
|-----------|---------------------|------|
| writeChain Promise 串行 | **需改造** — Go 中可用 channel 或 mutex 实现等价语义 | 需改造 |
| snapshot compaction (2MB 阈值) | **直接复用** — AgentHub 的 event store 应有类似机制，但阈值需根据实际数据量调整 | 直接复用 |
| Event replay 四维排序 | **直接复用** — 多日志源 recovery 时按 timestamp+priority 排序是通用模式 | 直接复用 |
| read-models 纯函数从 state 派生 | **直接复用** — 与 AgentHub 的 CQRS 设计方向一致 | 直接复用 |
| 版本迁移 (v 字段) | **直接复用** — 所有持久化事件必须带版本号，不匹配时执行迁移或 reset | 直接复用 |
| per-chat transcript JSONL | **需改造** — AgentHub 的 transcript 存储在 `Conversation` → `Thread` → `Turn` 层级下，粒度更细 | 需改造 |

---

## 7. 综合评分矩阵

| 维度 | Kanna 实现 | AgentHub 设计 | 差距 | 优先级 |
|------|----------|--------------|------|--------|
| 状态管理 | 双 Map + Draining Map（3 态） | Project→Thread→Turn→Run（4 层） | AgentHub 更完整 | P0 |
| 消息队列 | AsyncMessageQueue（单消费者 async iterable） | Go channel + select（多消费者） | 不同范式，各有优势 | P1 |
| Provider 切换 | Provider 一级，catalog 查找 | Agent 一级，Adapter interface | 抽象层级不同，可融合 | P1 |
| WS 去重 | snapshotSignatures Map + JSON.stringify | 未明确 | Kanna 领先，应采纳 | P0 |
| WS debounce | 16ms setTimeout + 全量/增量合并 | 未明确 | Kanna 领先，应采纳 | P0 |
| WS 缓存 | SnapshotComputationCache 跨连接复用 | 未明确 | Kanna 领先，应采纳 | P1 |
| Turn 管理 | agent.ts 完整实现（1609 行） | 设计阶段，protocol 类型已就绪 | AgentHub 待实现 | P0 |
| Fork | 复制 transcript + forkSession flag | Thread.RootMessageID + ForkMode (4 种) | AgentHub 更完整 | P1 |
| Cancel | 双 bool 防重入 + 5s timeout | TurnCancelled + RunCancelled 状态 | 各有优势 | P0 |
| Event Store | JSONL + Snapshot（单机） | CQRS + 多设备同步 | AgentHub 需求更复杂 | P0 |

---

## 8. 总计：可立即复用的代码模式清单

| # | 模式 | Kanna 来源 | 在 AgentHub 中的落点 | 标注 |
|---|------|-----------|---------------------|------|
| 1 | snapshotSignatures 去重 | ws-router.ts:773-832 | WSBroadcaster.pushSnapshot 每个连接维护签名 Map | **直接复用** |
| 2 | 16ms debounce 广播 | ws-router.ts:874-923 | WSBroadcaster.ScheduleBroadcast + time.AfterFunc | **直接复用** |
| 3 | pendingBroadcastAll + pendingChatIds 智能合并 | ws-router.ts:874-923 | 全量 vs 增量广播的自动选择 | **直接复用** |
| 4 | SnapshotComputationCache 跨连接复用 | ws-router.ts:148-154 | 一次 broadcast 循环中复用一个 Room snapshot | **直接复用** |
| 5 | cancel 双 bool 幂等守卫 | agent.ts:1493-1505 | AgentCoordinator.Cancel 用 sync.Once 或 atomic | **直接复用** |
| 6 | drainingStreams 独立 Map | agent.ts:683 + 1401 | RunStatusDraining + 独立 draining set | **直接复用** |
| 7 | writeChain 串行化 | event-store.ts:616-623 | EventStore 写操作的有序 channel/queue | **需改造** (Go channel 替代) |
| 8 | AsyncMessageQueue<T> 动态 prompt 注入 | agent.ts:507-552 | Claude Code adapter 的 prompt stream | **需改造** (Go channel 替代) |
| 9 | normalizeClaudeModelOptions 三层 fallback | provider-catalog.ts:55-69 | StartRequest.Validate/Normalize | **直接复用** |
| 10 | generateTitleInBackground 异步标题 | agent.ts:1337-1358 | Conversation 首次消息后异步生成标题 | **直接复用** |
