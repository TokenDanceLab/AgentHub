# Kanna Adoption Map: Multi-Agent Streaming & Orchestrator Patterns

> Analysis date: 2026-05-24
> Reference: `D:\Code\AgentHub\reference\kanna\src\server\`
> Target: `D:\Code\AgentHub\edge-server\internal\adapters\` + `D:\Code\AgentHub\app\desktop\src\`
> Focus: Multi-agent concurrency patterns for AgentHub M3b group-chat support

---

## 1. Agent Coordinator: 3-Map State Machine vs Adapter

### 1.1 Kanna's AgentCoordinator

**Source**: `reference\kanna\src\server\agent.ts:674-684`

Kanna maintains three concurrent Maps to model agent lifecycle:

```typescript
readonly activeTurns = new Map<string, ActiveTurn>()       // line:682
readonly drainingStreams = new Map<string, { turn: HarnessTurn }>() // line:683
readonly claudeSessions = new Map<string, ClaudeSessionState>()     // line:684
```

**State transitions** (`agent.ts:997-1401`):
```
idle -> activeTurns.set()              [agent.ts:997]
     -> (stream events) 
     -> activeTurns.delete()           [agent.ts:1398]
     -> drainingStreams.set()          [agent.ts:1401]
     -> drainingStreams.delete()       [agent.ts:1433]
     -> maybeStartNextQueuedMessage()  [agent.ts:810]
     -> idle
```

**ActiveTurn** (`agent.ts:57-74`) carries 22 fields including: provider, model, effort, planMode, status ("starting"|"running"|"waiting_for_user"), pendingTool, cancelRequested, cancelRecorded, hasFinalResult, postToolFollowUp, claudePromptSeq.

### 1.2 AgentHub's OrchestratorAdapter

**Source**: `edge-server\internal\adapters\orchestrator.go:1-103`

AgentHub's OrchestratorAdapter is a **thin wrapper** over ClaudeCodeAdapter:

```go
type OrchestratorAdapter struct {
    inner        *ClaudeCodeAdapter      // line:18
    systemPrompt string                  // line:19
}
```

It delegates `Metadata()`, `Capabilities()`, `BuildCommand()`, `ParseStream()` to the inner adapter. The only unique behavior is injecting an orchestrator system prompt. **There is NO multi-agent state machine.**

### 1.3 Gap: No Concurrent Turn Tracking

**Kanna** `agent.ts:682` manages parallel chat sessions via `activeTurns: Map<chatId, ActiveTurn>`.

**AgentHub** `orchestrator.go:17-19` has no state tracking. It is a stateless wrapper.

For M3b group-chat, AgentHub needs: `map[agentId]*ActiveRun` tracking in a new `GroupChatCoordinator`.

---

## 2. Multi-Stream Management

### 2.1 Kanna: Single-Stream per Chat

**Source**: `reference\kanna\src\server\agent.ts:1247-1335` (runClaudeSession) and `agent.ts:1360-1484` (runTurn)

Kanna processes **one stream per chat** in a for-await loop:

```typescript
// agent.ts:1249
for await (const event of session.session.stream) {
    if (event.type === "session_token") { /* persist token */ continue; }
    if (!event.entry) continue;
    await this.store.appendMessage(session.chatId, event.entry);
    // ... status transitions
}
```

Each chat = one agent at a time. Concurrent chat support is via separate goroutines (Bun's async concurrency), not multi-agent within one chat.

### 2.2 AgentHub: Currently Single-Stream

**Source**: `edge-server\internal\adapters\adapter.go:37`

```go
ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, 
    emitter EventEmitter, run store.Run) error
```

AgentHub's `ParseStream` reads from a **single stdout reader** — one agent process per run. The `EventEmitter` broadcasts to all listeners, but there's no multiplexing of parallel streams.

### 2.3 What M3b Needs: Per-Agent Stream Aggregation

For group chat, AgentHub needs:
- **N parallel `ParseStream` calls** (one per agent), each in its own goroutine
- **Stream multiplexer** that interleaves events from all active agents
- **Per-agent event tagging** so the frontend can render agent-specific blocks

**Required new Go interface**:

```go
// GroupChatCoordinator manages parallel agent streams for a conversation
type GroupChatCoordinator interface {
    // StartAgents launches all assigned agents for a turn
    StartAgents(ctx context.Context, turnID string, agents []AgentRunConfig) error
    
    // StreamEvents returns a multiplexed channel of tagged events
    StreamEvents(ctx context.Context) <-chan AgentTaggedEvent
    
    // CancelAgent stops a specific agent without affecting others
    CancelAgent(agentID string) error
    
    // CancelAll stops all agents in the group
    CancelAll() error
}

type AgentTaggedEvent struct {
    AgentID   string
    AgentName string
    EventType string
    Payload   interface{}
    Timestamp time.Time
}
```

---

## 3. WebSocket Broadcast: Kanna's Signature Dedup + 16ms Debounce

### 3.1 Kanna Implementation

**Source**: `reference\kanna\src\server\ws-router.ts:773-832` (pushSnapshots) + `ws-router.ts:874-923` (scheduleBroadcast)

**Mechanism 1: Signature dedup** (`ws-router.ts:773-832`):
```typescript
// ws-router.ts:781,793-800
const snapshotSignatures = ensureSnapshotSignatures(ws)
const signature = JSON.stringify(envelope.snapshot)
if (snapshotSignatures.get(id) === signature) {
    skippedCount += 1; continue  // L798: skip if unchanged
}
snapshotSignatures.set(id, signature)  // L800: cache new signature
send(ws, envelope)                     // L812
```

**Mechanism 2: 16ms debounce** (`ws-router.ts:874-923`):
```typescript
// ws-router.ts:878-902
if (pendingBroadcastTimer) return  // debounce guard
pendingBroadcastTimer = setTimeout(() => {
    pendingBroadcastTimer = null
    if (shouldBroadcastAll) {
        void broadcastSnapshots()         // L887: full broadcast
    } else if (chatIds.size > 0) {
        void broadcastFilteredSnapshots() // L891: selective broadcast
    }
}, 16)  // L896: ~60fps
```

**Mechanism 3: immediate broadcast bypass** (`ws-router.ts:932-934`):
```typescript
async function broadcastChatStateImmediately(chatId: string) {
    await broadcastChatAndSidebar(chatId)
}
```

### 3.2 AgentHub Current State

**Source**: `edge-server\internal\adapters\adapter.go:46-48` (EventEmitter)

AgentHub's event system uses a simple `EventEmitter` interface:
```go
type EventEmitter interface {
    Emit(eventType string, scope map[string]any, payload any)
}
```

The `EventEmitter` is a fire-and-forget broadcast — **no dedup, no debounce, no signature tracking**. Every event is pushed immediately.

### 3.3 Gap: No Broadcast Optimization

For M3b group chat with multiple agents streaming simultaneously, the event rate will be N times higher. Without dedup+debounce, WebSocket frames will flood.

**Required Go changes**:

1. **Add signature cache per WebSocket connection**:
```go
type connState struct {
    signatures map[string]string  // subscriptionId -> lastSignature
}
```

2. **Add 16ms debounce timer**:
```go
type broadcastScheduler struct {
    mu             sync.Mutex
    timer          *time.Timer
    broadcastAll   bool
    conversationIDs map[string]struct{}
}
```

3. **Add immediate broadcast bypass for critical state changes** (e.g., turn starting, agent joining).

---

## 4. Transcript Entry Normalization (Provider-Agnostic Events)

### 4.1 Kanna Implementation

**Source**: `reference\kanna\src\server\agent.ts:322-436`

Kanna's `normalizeClaudeStreamMessage()` maps 8+ SDK message types to 14 `TranscriptEntry` variants:

| SDK Message | TranscriptEntry kind |
|-------------|---------------------|
| `system/init` | `system_init` |
| `assistant` with `text` content | `assistant_text` |
| `assistant` with `tool_use` content | `tool_call` |
| `user` with `tool_result` content | `tool_result` |
| `user` with role=`user` string content | `compact_summary` |
| `result/subtype=cancelled` | `interrupted` |
| `result` (normal) | `result` |
| `system/status` | `status` |
| `system/compact_boundary` | `compact_boundary` |
| `system/context_cleared` | `context_cleared` |

### 4.2 AgentHub Current State

**Source**: `edge-server\internal\adapters\adapter.go:72-102` (Bus event types)

AgentHub has predefined bus event types but they map 1:1 to adapter-specific formats:

```go
BusEventTextDelta    = "run.agent.text_delta"
BusEventThinking     = "run.agent.thinking"
BusEventToolCall     = "run.agent.tool_call"
// ... etc
```

The normalization happens in adapter-specific parsers (`parser_ndjson.go`). Each adapter produces its own event format.

### 4.3 Gap: No Unified TranscriptEntry Type

For M3b multi-agent, the frontend needs a unified event format regardless of which agent (Claude, Codex, OpenCode) produced it. Kanna's `TranscriptEntry` discriminated union is the reference.

**Required Go change**: Add a unified `Event` or `TranscriptEntry` type that all adapters normalize into before emitting.

---

## 5. Frontend Multi-Agent UI Requirements

### 5.1 Kanna Frontend

**Source**: `reference\kanna\src\client\app\useKannaState.ts` and related files

Kanna's frontend is single-agent: one chat = one agent's stream. The `ChatPage` renders messages as a linear timeline. Status indicators show "running", "waiting_for_user", "draining".

### 5.2 AgentHub Current State

**Source**: `app\desktop\src\components\ChatView.tsx:297-406`

AgentHub's ChatView renders messages as a flat list with `isStreaming` flag:
```typescript
// ChatView.tsx:321-324
const lastMsg = messages[messages.length - 1];
const lastMsgHasText =
    lastMsg?.role === 'agent' && lastMsg.blocks.some((b) => b.kind === 'text');
```

It knows about a single streaming state. Multiple concurrent agents would need per-agent streaming states.

**Source**: `app\desktop\src\components\RunDetail.tsx:101-241`

RunDetail shows a single agent's tool calls and file changes. It has no concept of multiple agent runs in the same conversation.

### 5.3 Required Frontend Changes for M3b

1. **Per-agent message grouping**: Messages need an `agentId` field. The ChatView must group messages by agent or interleave them with agent name headers.

2. **Multi-stream status**: Replace `isStreaming: boolean` with `streamingAgentIds: Set<string>`.

3. **AgentRun panel**: A new `AgentRunsPanel` component showing all active agent runs in the conversation with individual status, tool calls, and cancel controls.

4. **GroupChatView component**: New component that shows the conversation timeline with multiple agent streams interleaved, each agent's messages visually distinguished (color, icon, name label).

5. **Concrete ChatMessage type change** (`ChatView.types.ts`):
```typescript
interface ChatMessage {
    id: string;
    role: 'user' | 'agent' | 'system';
    agentId?: string;      // ADD: which agent produced this
    agentName?: string;    // ADD: display name
    blocks: MessageBlock[];
    parentId?: string;
    timestamp: string;
}
```

---

## 6. Parallel Agent Dispatch (M3b Core)

### 6.1 Kanna: No Parallel Dispatch

Kanna is single-agent-per-chat. The closest to parallelism is its message queue (`agent.ts:778-808`):
```typescript
private async enqueueMessage(chatId: string, content: string, 
    attachments: ChatAttachment[], options?: SendMessageOptions) {
    const queued = await this.store.enqueueMessage(chatId, { ... })
    this.emitStateChange(chatId)
}
```

Messages are queued sequentially. No parallel agent execution.

### 6.2 AgentHub Orchestrator: Present but Non-Functional

**Source**: `edge-server\internal\adapters\orchestrator.go:25-31`

```go
func NewOrchestratorAdapter(claudePath, model, systemPrompt string, 
    subAgents []string) *OrchestratorAdapter {
    _ = subAgents // reserved for future sub-agent dispatch interception
    return &OrchestratorAdapter{ ... }
}
```

`subAgents` parameter is explicitly ignored (`_ = subAgents`). The orchestrator only wraps a single Claude Code instance and tells it to act like an orchestrator via system prompt. It cannot actually spawn sub-agents.

### 6.3 What M3b Needs

A real `GroupChatCoordinator` that:

1. **Accepts a Turn with multiple agent assignments**
2. **Launches each agent in a separate goroutine** with its own `ParseStream`
3. **Intercepts orchestrator events** to dynamically dispatch sub-agents
4. **Aggregates events** from all streams into a single multiplexed channel
5. **Per-agent cancel control** (stop one agent without stopping others)

**Required Go changes**:

```go
// In new file: edge-server/internal/adapters/group_chat.go

type GroupChatRun struct {
    mu          sync.Mutex
    turnID      string
    agents      map[string]*agentRunState
    emitter     EventEmitter
    cancelFuncs map[string]context.CancelFunc
}

type agentRunState struct {
    agentID   string
    agentName string
    adapter   AgentAdapter
    run       store.Run
    status    AgentRunStatus  // "pending"|"running"|"draining"|"done"|"failed"
}

type AgentRunStatus string
const (
    AgentPending  AgentRunStatus = "pending"
    AgentRunning  AgentRunStatus = "running"
    AgentDraining AgentRunStatus = "draining"
    AgentDone     AgentRunStatus = "done"
    AgentFailed   AgentRunStatus = "failed"
)

func (g *GroupChatRun) StartAgent(ctx context.Context, cfg AgentRunConfig) error {
    g.mu.Lock()
    defer g.mu.Unlock()
    
    state := &agentRunState{
        agentID:   cfg.AgentID,
        agentName: cfg.AgentName,
        adapter:   cfg.Adapter,
        status:    AgentPending,
    }
    g.agents[cfg.AgentID] = state
    
    ctx, cancel := context.WithCancel(ctx)
    g.cancelFuncs[cfg.AgentID] = cancel
    
    go func() {
        defer cancel()
        g.runSingleAgent(ctx, state, cfg)
    }()
    return nil
}
```

---

## 7. Draining Indicator Pattern

### 7.1 Kanna Reference

**Source**: `reference\kanna\src\server\agent.ts:683,1292-1401`

Kanna separates "result received" from "stream closed" using the `drainingStreams` Map:

```typescript
// agent.ts:1397-1401
if (event.entry.kind === "result") {
    active.hasFinalResult = true
    this.activeTurns.delete(active.chatId)          // L1398
    this.drainingStreams.set(active.chatId, { ... }) // L1401
}
```

This allows the UI to show a "draining" state and let users explicitly `stopDraining()` or wait for background tools to finish.

### 7.2 Adoption for AgentHub

For M3b group chat with multiple agents, this pattern is essential: each agent may reach its "result" at different times, and some agents may still be running background tool completions. The frontend needs per-agent draining states.

**Required**: Add `AgentDraining` status and a `stopAgentDraining(agentID)` command to the frontend.

---

## 8. Steer Pattern (Mid-Stream User Input)

### 8.1 Kanna Reference

**Source**: `reference\kanna\src\server\agent.ts:1192-1218` (steer) + `agent.ts:135-137` (STEERED_MESSAGE_PREFIX)

```typescript
async steer(command) {
    if (this.activeTurns.has(command.chatId)) {
        await this.cancel(command.chatId, { hideInterrupted: true })
    }
    await this.dequeueAndStartQueuedMessage(command.chatId, queuedMessage, 
        { steered: true })
}
```

Steer wraps user message in a system message prefix, cancels current turn, and immediately starts a new turn with the steered message. The `hideInterrupted` flag prevents the UI from showing "conversation interrupted" to the user.

### 8.2 Adoption for AgentHub

For M3b, steer needs to be **agent-aware**: the user may want to steer one specific agent while others continue. This requires:
- `steer agent <agentId>` command
- Per-agent steer that cancels & restarts only the target agent
- Steer event type that tags affected agents

---

## 9. Concrete Adoption Cheatsheet

| # | Pattern | Kanna Source | AgentHub Current | Action |
|---|---------|-------------|------------------|--------|
| 1 | 3-Map State Machine | `agent.ts:682-684` | `orchestrator.go:17-19` (no state) | Build `GroupChatCoordinator` with `map[agentId]*AgentRun` |
| 2 | Per-Agent Stream Loop | `agent.ts:1247-1335` | `adapter.go:37` (single ParseStream) | Launch N goroutines, multiplex into one channel |
| 3 | Signature Dedup | `ws-router.ts:773-832` | `adapter.go:46-48` (EventEmitter) | Add per-conn signature cache |
| 4 | 16ms Debounce | `ws-router.ts:874-897` | Not present | Add `broadcastScheduler` with `time.AfterFunc` |
| 5 | Immediate Broadcast | `ws-router.ts:932-934` | Not present | Add `broadcastImmediately()` bypass |
| 6 | TranscriptEntry Normalization | `agent.ts:322-436` | `adapter.go:72-102` (separate bus events) | Unify into "TranscriptEntry" type |
| 7 | Draining Indicator | `agent.ts:683,1397-1401` | Not present | Add `AgentDraining` status + per-agent draining |
| 8 | Steer Pattern | `agent.ts:1192-1218` | Not present | Add `steerAgent(agentID, message)` command |
| 9 | Per-Agent State | `agent.ts:57-74` (ActiveTurn) | Not present | Build `agentRunState` struct (lines 160+ in new file) |
| 10 | Segmented Prompts | `agent.ts:601-602` (AsyncMessageQueue) | Not present | Build `promptQueue` for Claude adapter dynamic input |
| 11 | Prompt Sequence Safety | `agent.ts:88-99,1276-1303` | Not present | Add `pendingPromptSeqs` queue for steer safety |
| 12 | Frontend Multi-Stream | `useKannaState.ts` (single) | `ChatView.tsx:321-324` (single) | Replace `isStreaming` with `streamingAgentIds: Set<string>` |
| 13 | Frontend AgentId on Messages | N/A | `ChatView.types.ts` (no agentId) | Add `agentId`, `agentName` to ChatMessage |
| 14 | AgentRunsPanel | N/A | `RunDetail.tsx` (single agent) | Build group-aware `AgentRunsPanel` |

---

## 10. Priority Roadmap

### P0 (Must implement for M3b group chat MVP)

1. **GroupChatCoordinator** (Go) — parallel agent launch + stream multiplexing
2. **agentId on ChatMessage** (React) — frontend must know which agent produced what
3. **streamingAgentIds** (React) — multi-stream status in ChatView
4. **Per-agent cancel** (Go + React) — cancel one agent without stopping others

### P1 (Core UX polish)

5. **Broadcast dedup + debounce** (Go) — prevent WebSocket flood from N simultaneous streams
6. **AgentRunsPanel** (React) — show all active agents in a side panel
7. **Agent message grouping** (React) — visually distinguish agents in chat timeline
8. **Draining indicator** (Go + React) — per-agent draining states

### P2 (Advanced features)

9. **Steer pattern** (Go + React) — mid-stream user input to specific agents
10. **TranscriptEntry normalization** (Go) — unified event format across adapters
11. **Orchestrator sub-agent dispatch** (Go) — actually spawn sub-agents from orchestrator events
12. **AsyncMessageQueue for Claude** (Go) — dynamic prompt injection during streaming
