# LobeHub -> AgentHub Source-Level Adoption Map

> Generated: 2026-05-24
> Scope: Line-by-line comparison of LobeHub TypeScript source vs AgentHub Go/React source
> Method: Each LobeHub file was read in full; AgentHub counterparts traced and gaps documented.

---

## Executive Summary

LobeHub implements a **phase-driven agent runtime** with typed instructions, a state machine, cost supervision, human-in-the-loop gates, and context compression -- all living inside `packages/agent-runtime/`. AgentHub currently delegates agent execution to Claude Code's native CLI loop and wraps it with adapter interfaces. The biggest adoption opportunity is bringing LobeHub's **structured decision loop** into AgentHub's Go layer so the Edge Server can intercept, audit, and gate every tool call before the CLI executes it.

**Top 5 highest-ROI adoptions:**
1. Port the `AgentState` state machine to Go (P0, 5d)
2. Implement the phase-driven instruction loop in the Orchestrator (P0, 8d)
3. Add typed `AgentEvent` discriminated union to event bus (P1, 3d)
4. Implement context-compression detection (P1, 4d)
5. Add human-intervention decision pipeline to PermissionHandler (P1, 3d)

---

## Finding 1: Phase-Driven Agent Decision Loop (The "Brain")

### Finding: LobeHub has a structured phase-driven loop; AgentHub relies on Claude Code's opaque internal loop

**LobeHub**: `packages/agent-runtime/src/agents/GeneralChatAgent.ts:431-792` -- The `runner()` method implements a switch-case over 12 execution phases (`init`, `user_input`, `llm_result`, `tool_result`, `tools_batch_result`, `sub_agent_result`, `compression_result`, `human_abort`, `error`, etc.). Each phase returns typed `AgentInstruction` objects that the `AgentRuntime` (Engine) executes.

The core flow is:
```
user_input → call_llm → llm_result → [call_tools_batch + request_human_approve] → tools_batch_result → call_llm → finish
```

**AgentHub gap**: `edge-server\internal\adapters\orchestrator.go:9-103` -- The `OrchestratorAdapter` simply wraps Claude Code with a system prompt. There is no structured phase tracking. The `ParseStream` method merely delegates to NDJSON parsing. Agent decision logic lives entirely inside Claude Code's black box.

**Adopt**: Create a new Go struct `AgentPhaseRunner` in `D:\Code\AgentHub\edge-server\internal\adapters\phase_runner.go` that:
1. Implements a `RunStep(ctx, state, phase) → (instructions, newState)` method mirroring `GeneralChatAgent.runner()`
2. Wraps Claude Code's NDJSON output into phases: when LLM text completes, enter `llm_result` phase; when tool result arrives, enter `tool_result` phase
3. Before dispatching to Claude Code, checks intervention/hooks against parsed instructions
4. Implements `phase` type as a Go `const` block matching LobeHub's phase strings

**Priority**: P0 | **Effort**: 8 days

---

## Finding 2: Typed AgentState with State Machine

### Finding: LobeHub defines a comprehensive serializable `AgentState`; AgentHub has a simplistic `RunState`

**LobeHub**: `packages/agent-runtime/src/types/state.ts:20-147` -- `AgentState` has:
- Status machine: `'idle' | 'running' | 'waiting_for_human' | 'done' | 'error' | 'interrupted'`
- `stepCount` and `maxSteps` for loop bounds
- `forceFinish` flag for graceful termination after max steps
- `interruption` struct with `reason`, `interruptedAt`, `canResume`
- `pendingToolsCalling`, `pendingHumanPrompt`, `pendingHumanSelect` for HIL gates
- `usage` (Usage struct) and `cost` (Cost struct) for telemetry
- `costLimit` with `onExceeded` policy: `'stop' | 'interrupt' | 'continue'`
- `securityBlacklist` and `userInterventionConfig` for per-user approval policies
- `toolManifestMap` and `toolSourceMap` for tool routing

**AgentHub gap**: `app\desktop\src\stores\runStore.ts:6-12` -- `RunState` only has:
- `runId`, `status` (untyped string), `outputText` (string accumulator)
- `toolCalls` (flat array with `callId`, `toolName`, `status`)
- `changedFiles` (flat array)
No state machine transitions, no cost tracking, no interruption/resume support.

**Adopt**: Define a Go struct `AgentState` in `D:\Code\AgentHub\edge-server\internal\adapters\agent_state.go`:
```go
type AgentState struct {
    Status              string            // "idle"|"running"|"waiting_for_human"|"done"|"error"|"interrupted"
    StepCount           int
    MaxSteps            int
    ForceFinish         bool
    Messages            []Message
    Usage               Usage
    Cost                Cost
    CostLimit           *CostLimit
    PendingToolsCalling []ToolPayload
    PendingHumanPrompt  *HumanPrompt
    PendingHumanSelect  *HumanSelect
    Interruption        *Interruption
    SecurityBlacklist   []SecurityRule
    UserInterventionCfg *UserInterventionConfig
    ToolManifestMap     map[string]ToolManifest
    CreatedAt           time.Time
    LastModified        time.Time
}
```
Then thread this through `RunProcessContext` and the Orchestrator.

**Priority**: P0 | **Effort**: 5 days

---

## Finding 3: Instruction Type Union (Serializable Actions)

### Finding: LobeHub's `AgentInstruction` discriminated union maps exactly to Edge Server's missing middleware interception points

**LobeHub**: `packages/agent-runtime/src/types/instruction.ts:369-388` -- `AgentInstruction` is a union of 14 types:
- `call_llm`, `call_tool`, `call_tools_batch`, `resolve_aborted_tools`
- `exec_sub_agent`, `exec_sub_agents`, `exec_client_sub_agent`, `exec_client_sub_agents`
- `request_human_prompt`, `request_human_select`, `request_human_approve`
- `compress_context`, `finish`

Each instruction has a `payload` typed to its specific needs. The `AgentRuntime.step()` method (runtime.ts:79-230) reads instructions from the Agent, normalizes them, and dispatches to registered executors.

**AgentHub gap**: No instruction abstraction exists. All agent behavior is driven by Claude Code's internal reasoning. The `control_protocol.go` handles `can_use_tool` requests reactively but has no proactive instruction model.

**Adopt**: Define a Go interface `AgentInstruction` in `D:\Code\AgentHub\edge-server\internal\adapters\instructions.go`:
```go
type InstructionType string
const (
    InstrCallLLM          InstructionType = "call_llm"
    InstrCallTool         InstructionType = "call_tool"
    InstrCallToolsBatch   InstructionType = "call_tools_batch"
    InstrRequestHumanApprove InstructionType = "request_human_approve"
    InstrCompressContext  InstructionType = "compress_context"
    InstrFinish           InstructionType = "finish"
)

type AgentInstruction struct {
    Type      InstructionType
    Payload   json.RawMessage
    StepLabel string
}
```
The `PhaseRunner` would emit these instructions and the `RuntimeExecutor` would dispatch them to registered handlers (matching LobeHub's executor pattern at runtime.ts:38-49).

**Priority**: P1 | **Effort**: 4 days

---

## Finding 4: Rich AgentEvent Typed Events

### Finding: LobeHub's 14 event types with typed payloads contrast with AgentHub's simple string-keyed events

**LobeHub**: `packages/agent-runtime/src/types/event.ts:116-139` -- Discriminated union of `AgentEvent`:
- `llm_start`, `llm_stream` (per-chunk), `llm_result`
- `tool_pending`, `tool_result`
- `human_approve_required`, `human_prompt_required`, `human_select_required`
- `done` (with FinishReason: completed, user_requested, max_steps_exceeded, cost_limit_exceeded, etc.)
- `error`, `interrupted` (with canResume), `resumed`
- `compression_complete`, `compression_error`

**AgentHub**: `edge-server\internal\adapters\adapter.go:73-102` -- Event types are string constants (`BusEventTextDelta = "run.agent.text_delta"`) with unstructured `payload any`. There are 22 event types defined but no typed payload contracts, forcing consumers to use type assertions.

**Adopt**: Define a typed event union in `D:\Code\AgentHub\edge-server\internal\adapters\event_types.go` as a thin wrapper around the bus:
```go
type TypedEvent struct {
    Type    string
    Payload interface{}  // One of: LLMStartPayload, LLMStreamPayload, ToolResultPayload, etc.
}
```
Add constructor functions (`NewLLMStartEvent`, `NewToolResultEvent`, etc.) that populate properly typed payloads, and update `EventEmitter.Emit` to accept this type.

**Priority**: P1 | **Effort**: 3 days

---

## Finding 5: Human-in-the-Loop (HIL) Gate with Multi-Level Intervention

### Finding: LobeHub's 7-phase intervention check pipeline is far more sophisticated than AgentHub's single permission hook

**LobeHub**: `packages/agent-runtime/src/agents/GeneralChatAgent.ts:125-258` -- `checkInterventionNeeded()` implements 7 phases:
1. Security blacklist (global, always blocks in all modes)
2. Headless mode (auto-execute everything except "always" blocked tools)
3. Per-tool dynamic resolver (async audit functions)
4. Overridable global blocks (policy != 'always')
5. Static "always" policy match
6. Auto-run mode (execute all)
7. Unknown tool guard (manual/allow-list modes require intervention)
8. Manual mode: use tool's own InterventionChecker config
9. Allow-list mode: check tool against user's whitelist

**AgentHub**: `edge-server\internal\adapters\security_hooks.go:36-56` -- `SecurityHook.PreToolUse` only does pattern-based blocking (regex on Bash/WebFetch input). `PermissionRequest` only checks risk level (RiskBlocked → deny, RiskHigh → allow_once, else allow).

**Adopt**: Create `D:\Code\AgentHub\edge-server\internal\adapters\intervention_pipeline.go` implementing the 7-phase check:
```go
type InterventionPipeline struct {
    securityBlacklist []SecurityRule
    globalResolvers   []DynamicResolver
    approvalMode      string        // "manual"|"auto-run"|"headless"|"allow-list"
    allowList         []string
    toolManifests     map[string]ToolManifest
}

func (p *InterventionPipeline) Check(toolCall ToolCall, state *AgentState) ([]ToolCall, []ToolCall) {
    // Returns [needsApproval, executeNow] matching LobeHub's return type
}
```

**Priority**: P1 | **Effort**: 3 days

---

## Finding 6: Context Compression Detection and Management

### Finding: LobeHub auto-detects context exhaustion and inserts compression steps; AgentHub only has basic token counting

**LobeHub**: `packages/agent-runtime/src/agents/GeneralChatAgent.ts:366-401` -- `toLLMCall()` checks `shouldCompress(messages, options)` before every LLM call. When threshold exceeded, it emits `compress_context` instruction instead of `call_llm`. The runtime handles this with a dedicated compression executor. The `findExistingSummary()` method (line 347) retrieves incremental summaries to avoid re-compressing the same content.

`packages/agent-runtime/src/utils/tokenCounter.ts` -- `shouldCompress()` checks against `maxWindowToken` and `thresholdRatio` configurable limits.

**AgentHub gap**: `edge-server\internal\runnerctx\context_budget.go:10-49` -- `ContextBudget` only tracks token consumption and exposes `IsExhausted()`. No compression pipeline, no summary injection, no pre-LLM threshold check.

**Adopt**: 
1. Add `ShouldCompress()` function to `D:\Code\AgentHub\edge-server\internal\runnerctx\context_budget.go` that compares current usage against configurable `ThresholdRatio` (default 0.85) of `MaxTokens`.
2. Create `D:\Code\AgentHub\edge-server\internal\adapters\compression_hook.go` implementing a `PreCompressionHook` that can inject compression instructions before Claude Code receives the full context.
3. Wire into the `PhaseRunner` so that before dispatching `call_llm`, it checks context budget and optionally compresses first.

**Priority**: P1 | **Effort**: 4 days

---

## Finding 7: Usage and Cost Telemetry (Per-Model, Per-Tool)

### Finding: LobeHub tracks granular usage/cost by model and tool; AgentHub has only aggregate session metrics

**LobeHub**: `packages/agent-runtime/src/core/UsageCounter.ts:12-250` -- `UsageCounter` provides:
- `accumulateLLM()`: per-model token counts, cost, API call count, provider/model breakdown via `byModel` array
- `accumulateTool()`: per-tool call count, execution time, errors, optional cost
- Both merge into the same `Usage` and `Cost` structs

`packages/agent-runtime/src/types/state.ts:29-30,135-141` -- `AgentState.usage` and `AgentState.cost` are carried through the full state lifecycle.

**AgentHub gap**: `edge-server\internal\runnerctx\session_metrics.go:7-43` -- `SessionMetrics` only has aggregate `ContextMetrics` (total/input/output tokens) and `CostMetrics` (totalCostUsd, modelLabel). No per-model breakdown, no per-tool breakdown, no call counts.

**Adopt**: Extend `SessionMetrics` in `D:\Code\AgentHub\edge-server\internal\runnerctx\session_metrics.go`:
```go
type UsageMetrics struct {
    LLM struct {
        APICalls     int64
        ProcessingMs int64
        Tokens       TokenCount
    }
    Tools struct {
        TotalCalls int64
        TotalMs    int64
        ByTool     []ToolUsageEntry
    }
    HumanInteraction struct {
        ApprovalRequests int64
        PromptRequests   int64
        SelectRequests   int64
        TotalWaitingMs   int64
    }
}
```
Feed this from `NDJSONStreamParser` (which parses tool_use and tool_result events) and from the permission handler (which counts HIL interactions).

**Priority**: P2 | **Effort**: 3 days

---

## Finding 8: Executor Pattern with Custom Overrides

### Finding: LobeHub's executor priority chain (agent > config > built-in) provides a clean extension model

**LobeHub**: `packages/agent-runtime/src/core/runtime.ts:38-49` -- Executors are built with a priority merge:
```typescript
this.executors = {
  call_llm: this.createCallLLMExecutor(),    // built-in
  call_tool: this.createCallToolExecutor(),  // built-in
  finish: this.createFinishExecutor(),       // built-in
  request_human_approve: ...,
  request_human_prompt: ...,
  request_human_select: ...,
  ...config.executors,   // config-level overrides
  ...(agent.executors as any),  // agent-level overrides (highest priority)
};
```

**AgentHub gap**: `edge-server\internal\adapters\hooks.go:60-122` -- `HookChain` provides middleware chaining but only for lifecycle hooks (PreToolUse, PostToolUse, etc.). There is no "replacement" pattern where a custom executor can entirely replace a built-in behavior.

**Adopt**: Add an `ExecutorRegistry` to `D:\Code\AgentHub\edge-server\internal\adapters\executor_registry.go`:
```go
type Executor func(instruction AgentInstruction, state *AgentState) (*ExecutorResult, error)

type ExecutorRegistry struct {
    builtin  map[InstructionType]Executor
    overrides map[InstructionType]Executor
}

func (r *ExecutorRegistry) Get(t InstructionType) Executor {
    if override, ok := r.overrides[t]; ok {
        return override
    }
    return r.builtin[t]
}
```
Wire this into the `PhaseRunner` so custom executors (e.g., a DB-backed tool executor on the Hub Server) can replace built-in executors without modifying adapter code.

**Priority**: P2 | **Effort**: 2 days

---

## Finding 9: Cost-Limit Enforcement with Configurable Policies

### Finding: LobeHub enforces cost limits with three policies; AgentHub has no cost enforcement

**LobeHub**: `packages/agent-runtime/src/core/runtime.ts:800-860` -- `handleCostLimitExceeded()` handles three policies:
- `'stop'`: Mark state as `done`, emit finish event with `cost_limit_exceeded` reason
- `'interrupt'`: Mark state as `interrupted` with `canResume=true`, store cost context
- `'continue'` (default): Emit warning event, continue execution

Cost checks happen after every LLM call (line 481-483) and after every tool call (line 553-556).

**AgentHub gap**: No equivalent. SessionMetrics tracks cost but never enforces limits.

**Adopt**: Add `CostLimit` struct to `D:\Code\AgentHub\edge-server\internal\runnerctx\session_metrics.go` with fields `MaxTotalCost float64`, `OnExceeded string`, `Currency string`. Check `totalCost > maxTotalCost` in the `PhaseRunner` after each `call_llm` and `call_tool` step. When exceeded, either emit a `done` event (stop), emit an `interrupted` event (interrupt), or log a warning (continue).

**Priority**: P2 | **Effort**: 2 days

---

## Finding 10: SSE Streaming Agent Events to Frontend

### Finding: LobeHub has a dedicated SSE endpoint; AgentHub uses WebSocket

**LobeHub**: `src\app\(backend)\api\agent\stream\route.ts:15-213` -- GET endpoint:
- Query params: `operationId` (required), `lastEventId` (cursor), `includeHistory`
- Sends history replay first (reverse chronological), then subscribes to live events
- 30-second heartbeat keepalive
- Terminates stream on `agent_runtime_end` event
- Uses AbortController for cleanup on client disconnect
- Supports `streamEventManager` that can be backed by InMemory (local) or Redis (production)

**AgentHub gap**: `app\desktop\src\hooks\useEventStream.ts:34-83` -- WebSocket-based event stream with `createEventStream()`. Events are summarized into `LogEntry` structs. No history replay, no cursor-based resumption, no heartbeat.

**Adopt**: 
1. Add an SSE endpoint at `D:\Code\AgentHub\hub-server\internal\api\handlers.go` matching the LobeHub pattern:
   - `GET /v1/stream/{operationId}` with `?lastEventId=N&includeHistory=true`
   - History replay from Bus history
   - Live subscription via channel
   - 30s heartbeat
   - Auto-close on terminal event
2. Create an SSE client hook at `D:\Code\AgentHub\app\desktop\src\hooks\useAgentStream.ts`:
```typescript
function useAgentStream(operationId: string) {
  // returns { events, status, error } from EventSource
}
```

**Priority**: P1 | **Effort**: 4 days

---

## Finding 11: Sub-Agent Dispatch Model

### Finding: LobeHub supports 4 sub-agent dispatch modes; AgentHub only has a system-prompt orchestrator

**LobeHub**: `packages/agent-runtime/src/agents/GeneralChatAgent.ts:558-611` -- Four dispatch types:
- `exec_sub_agent` (server-side, single)
- `exec_sub_agents` (server-side, batch)
- `exec_client_sub_agent` (desktop/local, single)
- `exec_client_sub_agents` (desktop/local, batch)

Each `SubAgentTask` has: `instruction`, `description`, `inheritMessages` (context sharing), `runInClient`, `timeout`.

**AgentHub gap**: `edge-server\internal\adapters\orchestrator.go:70-95` -- `DefaultOrchestratorPrompt()` instructs Claude Code to coordinate sub-agents via natural language in its output. No structured sub-agent spawn, no context inheritance, no client-side dispatch.

**Adopt**: 
1. Add a `SubAgentTask` struct to `D:\Code\AgentHub\edge-server\internal\adapters\instructions.go`
2. Parse Claude Code's NDJSON output for explicit sub-agent dispatch markers (e.g., `task_started` events already exist at adapter.go:85)
3. Create `D:\Code\AgentHub\edge-server\internal\adapters\subagent_dispatcher.go` that intercepts `task_started` events and forks sub-agent runs with configurable context inheritance
4. Add `POST /v1/run/{runId}/subagent` endpoint on the Hub Server for client-dispatched sub-agents

**Priority**: P1 | **Effort**: 5 days

---

## Finding 12: Interruption and Resume

### Finding: LobeHub supports clean interrupt/resume with trackable state; AgentHub has basic SIGINT only

**LobeHub**: `packages/agent-runtime/src/core/runtime.ts:256-342` -- Three methods:
- `interrupt(state, reason, canResume, metadata)`: Sets `status='interrupted'`, stores `interruption` context with `reason`, `interruptedAt`, `canResume`, `interruptedInstruction`
- `resume(state, reason, context)`: Validates `status=='interrupted'` and `canResume`, clears interruption, emits `resumed` event, optionally continues with provided context
- Interruption can happen at any step; the outer loop checks for `interrupted` status and stops

**AgentHub gap**: `edge-server\internal\adapters\control_protocol.go:154-168` -- `WriteInterrupt()` sends an interrupt control request but there is no structured resume path or state tracking.

**Adopt**: 
1. Add `Interrupt(reason string, canResume bool)` and `Resume(reason string)` methods to the `PhaseRunner`
2. Store interruption metadata in `AgentState.Interruption`
3. Expose via `POST /v1/run/{runId}/interrupt` and `POST /v1/run/{runId}/resume` on Hub Server
4. Thread through to `RunProcessContext` so the process executor can handle graceful shutdown vs. kill

**Priority**: P2 | **Effort**: 3 days

---

## Finding 13: JWT Auth Middleware Pattern

### Finding: Both codebases use a Bearer token middleware, but LobeHub supports dual auth (OIDC + session)

**LobeHub**: `src\app\(backend)\middleware\auth\index.ts:61-181` -- `checkAuth()` handles:
- OIDC JWT (for CLI/API clients) via `LOBE_CHAT_OIDC_AUTH_HEADER`
- Better Auth session (for web clients) via `auth.api.getSession()`
- Dev mock mode via `ENABLE_MOCK_DEV_USER`
- Fails with typed `ChatCompletionErrorPayload` for proper error classification
- Injects `serverDB`, `jwtPayload`, `userId` into handler context

**AgentHub**: `hub-server\internal\auth\middleware.go:68-127` -- Basic JWT Bearer validation with:
- Skip paths (exact and prefix)
- HMAC signing method validation
- Context injection via `context.WithValue()`
- Simple error responses

**Adopt**: Extend `D:\Code\AgentHub\hub-server\internal\auth\middleware.go` to support:
1. Dual auth modes (session-based for web, API key / JWT for CLI) -- mirroring LobeHub's OIDC vs session split
2. Configurable dev mock user for local development (matching LobeHub's `ENABLE_MOCK_DEV_USER`)
3. Typed error responses with error codes (matching `ChatErrorType` pattern)
4. Per-endpoint auth skip registration at route definition time rather than constructor time

**Priority**: P1 | **Effort**: 2 days

---

## Finding 14: Tool Manifest and Tool Routing

### Finding: LobeHub routes tool execution between server and client based on `toolSourceMap`

**LobeHub**: `packages/agent-runtime/src/types/state.ts:127-134` -- Three maps for tool routing:
- `toolManifestMap`: Tool metadata (available APIs, human intervention config)
- `toolSourceMap`: `'client' | 'server'` routing decision per tool
- `toolExecutorMap`: `'client' | 'server' | 'auto-detect'` executor routing

**AgentHub gap**: No equivalent. All tools execute in Claude Code's process. No way to route a file-system tool to the Desktop client while routing a database tool to the Hub Server.

**Adopt**: 
1. Define `ToolManifest` struct in `D:\Code\AgentHub\edge-server\internal\adapters\tool_manifest.go`
2. Add `toolSourceMap` to `AgentState` (proposed in Finding 2)
3. In the `PhaseRunner`, before executing `call_tool`, check `toolSourceMap[toolName]`:
   - `"client"` → emit event for Desktop to execute locally, wait for result
   - `"server"` → execute via registered Go handler
   - `"process"` → delegate to Claude Code CLI
4. Register tool manifests on the Hub Server at `POST /v1/tools/register`

**Priority**: P2 | **Effort**: 4 days

---

## Finding 15: Max Steps and Force-Finish Graceful Termination

### Finding: LobeHub gracefully terminates after max steps instead of hard aborting

**LobeHub**: `packages/agent-runtime/src/core/runtime.ts:89-99` -- When `stepCount > maxSteps`:
- First time: sets `forceFinish = true` on state
- Tools are allowed to complete (not interrupted)
- Next LLM call has tools stripped (via `buildStepToolDelta` with `deactivatedToolIds: ['*']`)
- Summary prompt injected to force final text response
- If already in `forceFinish` flow, no additional termination

**AgentHub gap**: No max-steps or force-finish concept. Claude Code runs until it decides to stop or hits its internal token limit.

**Adopt**: Add `MaxSteps` and `ForceFinish` fields to the proposed `AgentState` (Finding 2). In the `PhaseRunner`:
1. Increment step count at each `RunStep()`
2. When `stepCount > maxSteps && !forceFinish`: set `forceFinish = true`, log warning
3. On next `call_llm` instruction: strip tools from the payload before sending to Claude Code, inject a summary prompt (`"You have reached the maximum number of steps. Please summarize your findings and conclude."`)

**Priority**: P2 | **Effort**: 2 days

---

## Finding 16: Zustand Store Architecture for Frontend State

### Finding: LobeHub uses domain-specific Zustand stores; AgentHub has a similar pattern but less granular

**LobeHub**: `src/store/` directory with domain stores:
- `agent/`, `agentGroup/`, `chat/`, `discover/`, `document/`, `file/`, `session/`, `tool/`, `user/`, etc.
- Each domain has `action.ts` (mutations) and `selectors.ts` (derived state)
- Stores subscribe with `subscribeWithSelector` middleware

**AgentHub**: `app\desktop\src\stores\` with stores:
- `runStore.ts` -- single active run
- `threadStore.ts` -- thread list + active thread + search
- `connectionStore.ts` -- online/offline status
- `uiStore.ts` -- UI preferences
- `searchStore.ts` -- search state

**Adopt**: Split `runStore.ts` into:
1. `D:\Code\AgentHub\app\desktop\src\stores\agentStateStore.ts` -- mirrors `AgentState` from Finding 2: status, stepCount, messages, usage, cost, pendingTools
2. `D:\Code\AgentHub\app\desktop\src\stores\toolCallStore.ts` -- per-tool-call state with approval queue (mirrors `pendingToolsCalling`)
3. `D:\Code\AgentHub\app\desktop\src\stores\permissionStore.ts` -- permission requests queue for human-in-the-loop gates

**Priority**: P2 | **Effort**: 3 days

---

## Finding 17: Draining Streams Pattern for Smooth Text Rendering

### Finding: LobeHub batches streaming text; AgentHub already implements this with `useStreamingText`

**LobeHub**: Implicit in the SSE consumer side -- batches `llm_stream` chunks at ~16ms intervals to avoid re-render flooding.

**AgentHub**: `app\desktop\src\hooks\useStreamingText.ts:10-35` -- Already implements `useStreamingText(incoming, isStreaming)` with a 16ms interval and immediate flush on stream end. This matches the LobeHub pattern correctly.

**Adopt**: No gap -- AgentHub's `useStreamingText` hook (credit: `Kanna's drainingStreams pattern`) is already correctly implemented. Keep as-is.

**Priority**: N/A | **Effort**: 0 days

---

## Finding 18: Conversation Flow / Thread Tree Model

### Finding: LobeHub models agent conversations as a tree with branches; AgentHub uses a flat thread list

**LobeHub**: `packages/conversation-flow/src/transformation/ContextTreeBuilder.ts` -- Converts linear message history into a tree structure with:
- `BranchResolver`: Detects and resolves branching points
- `ContextTreeBuilder`: Builds hierarchical tree from flat messages
- Supports "agent councils" (parallel sub-agent conversations) as tree branches

**AgentHub gap**: `app\desktop\src\stores\threadStore.ts:6-38` -- Flat `ThreadInfo[]` list with `selectedThreadId`. No branching, no sub-threads within a conversation, no tree structure.

**Adopt**: 
1. Add `parentThreadId` and `childrenIds` fields to `ThreadInfo` type
2. Add `ThreadTree` state to threadStore that computes the tree from flat list
3. This enables the UI to show sub-agent conversations as child threads of the main conversation

**Priority**: P2 | **Effort**: 3 days

---

## Finding 19: Context Engine Pipeline (Messages Preprocessing)

### Finding: LobeHub runs a multi-step context pipeline before every LLM call

**LobeHub**: `packages/context-engine/src/pipeline.ts` -- The Context Engine runs:
1. `BaseFirstUserContentProvider` -- extracts first user message
2. `BaseSystemRoleProvider` -- injects system role/prompt
3. `BaseEveryUserContentProvider` -- transforms all user messages
4. `MessagesEngine` -- processes message history (truncation, dedup, RAG injection)
5. `SkillEngine` / `SkillResolver` -- activates skills and tools based on step context

**AgentHub gap**: No equivalent pipeline. Claude Code receives raw input and manages its own context internally.

**Adopt**: Create a lightweight context pipeline in `D:\Code\AgentHub\edge-server\internal\adapters\context_pipeline.go` that at minimum:
1. Injects system prompt (currently done ad-hoc in `orchestrator.go:52`)
2. Truncates message history if token budget is approaching exhaustion
3. Injects step context (current tool calls, sub-agent results) into the next prompt
4. This gets applied in the `PhaseRunner` before emitting `call_llm` instructions

**Priority**: P2 | **Effort**: 4 days

---

## Finding 20: Lifecycle Hook System (16 Hooks vs 6 Hooks)

### Finding: LobeHub defines 16 typed lifecycle hooks; AgentHub has 6 generic hooks

**LobeHub**: `packages/agent-runtime/src/types/hooks.ts:12-29` -- 16 `AgentHookType` values:
- `beforeStep`, `afterStep` (per-step bookends)
- `beforeToolCall` (with `mock()` support), `afterToolCall`, `onToolCallError`
- `beforeCallAgent`, `afterCallAgent`, `onCallAgentError` (sub-agent lifecycle)
- `beforeCompact`, `afterCompact`, `onCompactError` (compression lifecycle)
- `beforeHumanIntervention`, `afterHumanIntervention`, `onStopByHumanIntervention` (HIL lifecycle)
- `onComplete`, `onError` (terminal events)

Each hook type has a specific typed event payload (lines 47-275).

**AgentHub**: `edge-server\internal\adapters\hooks.go:39-57` -- 6 hooks:
- `PreToolUse`, `PostToolUse` (tool lifecycle)
- `PermissionRequest` (HIL gate)
- `OnError` (error handling)
- `PrePrompt`, `PostResponse` (prompt/response modification)

Missing: step-level hooks, sub-agent hooks, compression hooks, HIL outcome hooks.

**Adopt**: Extend `AgentHook` interface in `D:\Code\AgentHub\edge-server\internal\adapters\hooks.go`:
```go
type AgentHook interface {
    // Existing 6 hooks...
    // Add:
    BeforeStep(ctx context.Context, state *AgentState) error
    AfterStep(ctx context.Context, stepResult *StepResult) error
    BeforeCallAgent(ctx context.Context, agentID string, instruction string) error
    AfterCallAgent(ctx context.Context, agentID string, result *SubAgentResult) error
    BeforeCompact(ctx context.Context, tokenCount int) error
    AfterCompact(ctx context.Context, summary string, messagesBefore, messagesAfter int) error
    BeforeHumanIntervention(ctx context.Context, pendingTools []PendingTool) error
    AfterHumanIntervention(ctx context.Context, action string, toolCallID string) error
    OnComplete(ctx context.Context, reason string) error
}
```
Wire these into the `PhaseRunner` at the appropriate phases.

**Priority**: P2 | **Effort**: 4 days

---

## Finding 21: Multi-Agent Group Orchestration

### Finding: LobeHub's GroupOrchestrationRuntime implements a Supervisor/Executor pattern for multi-agent collaboration

**LobeHub**: `packages/agent-runtime/src/groupOrchestration/GroupOrchestrationRuntime.ts:26-194` -- The runtime runs a loop:
1. Starts with `ExecutorResult(type='init')`
2. `Supervisor.decide(result, state)` returns next `SupervisorInstruction`
3. Registered `Executor` executes the instruction, returns `ExecutorResult`
4. Repeat until Supervisor returns `type='finish'`

**AgentHub gap**: `edge-server\internal\adapters\orchestrator.go` -- The orchestrator only wraps one Claude Code instance with a system prompt. True multi-agent coordination (parallel sub-agents, aggregation, conflict resolution) is left entirely to Claude Code's natural language reasoning.

**Adopt**: 
1. Create `D:\Code\AgentHub\edge-server\internal\adapters\group_orchestrator.go` implementing the Supervisor/Executor loop
2. The Supervisor is a lightweight Go struct that:
   - Receives results from sub-agents (via event bus)
   - Decides on next instructions (dispatch more agents, aggregate, finish)
   - Tracks which agents are running, their progress
3. The Executors are `AgentAdapter` instances (Claude Code, Codex, OpenCode)
4. This enables true parallel sub-agent dispatch with structured coordination, rather than relying on Claude Code's internal conversation

**Priority**: P2 | **Effort**: 8 days

---

## Finding 22: Tool Validation and Unknown-Tool Guard

### Finding: LobeHub guards against hallucinated tools; AgentHub has no tool validation

**LobeHub**: `packages/agent-runtime/src/agents/GeneralChatAgent.ts:226-232` -- When `approvalMode` is `'manual'` or `'allow-list'`, any tool NOT in `toolManifestMap` is treated as untrusted and requires human intervention:
```typescript
if (!manifest) {
    console.warn(`Unknown tool "${identifier}/${apiName}" not found in toolManifestMap...`);
    toolsNeedingIntervention.push(toolCalling);
    continue;
}
```

Line 533-546: When an LLM produces tool_calls that fail to resolve to known tools, the finish instruction includes a `reasonDetail` with diagnostic info about unresolvable tool_calls.

**AgentHub gap**: No tool manifest concept. Claude Code handles tool validation internally. If Claude Code hallucinates a tool name, it fails with its own error handling.

**Adopt**: When tool manifests are registered (Finding 14), add unknown-tool validation in the `PhaseRunner`:
1. Before dispatching `call_tool` instruction, check `toolManifestMap[toolIdentifier]`
2. If absent and mode is not `'auto-run'`: require human approval for the tool
3. If mode is `'auto-run'`: allow execution but log a warning

**Priority**: P2 | **Effort**: 1 day

---

## Summary Table

| # | Finding | LobeHub Source | AgentHub Gap | Priority | Effort |
|---|---------|---------------|--------------|----------|--------|
| 1 | Phase-driven agent loop | GeneralChatAgent.ts:431-792 | orchestrator.go:9-103 | P0 | 8d |
| 2 | Typed AgentState state machine | state.ts:20-147 | runStore.ts:6-12 | P0 | 5d |
| 3 | AgentInstruction discrim. union | instruction.ts:369-388 | (none) | P1 | 4d |
| 4 | Typed AgentEvent system | event.ts:116-139 | adapter.go:73-102 | P1 | 3d |
| 5 | 7-phase intervention pipeline | GeneralChatAgent.ts:125-258 | security_hooks.go:36-56 | P1 | 3d |
| 6 | Context compression management | GeneralChatAgent.ts:366-401 | context_budget.go:10-49 | P1 | 4d |
| 7 | Per-model/per-tool telemetry | UsageCounter.ts:12-250 | session_metrics.go:7-43 | P2 | 3d |
| 8 | Executor override priority chain | runtime.ts:38-49 | hooks.go:60-122 | P2 | 2d |
| 9 | Cost-limit enforcement (3 policies) | runtime.ts:800-860 | (none) | P2 | 2d |
| 10 | SSE streaming with history replay | stream/route.ts:15-213 | useEventStream.ts:34-83 | P1 | 4d |
| 11 | Sub-agent dispatch (4 modes) | GeneralChatAgent.ts:558-611 | orchestrator.go:70-95 | P1 | 5d |
| 12 | Interrupt/resume with state | runtime.ts:256-342 | control_protocol.go:154-168 | P2 | 3d |
| 13 | Dual-auth JWT middleware | auth/index.ts:61-181 | middleware.go:68-127 | P1 | 2d |
| 14 | Tool manifest & routing | state.ts:127-134 | (none) | P2 | 4d |
| 15 | Force-finish graceful termination | runtime.ts:89-99 | (none) | P2 | 2d |
| 16 | Domain-specific Zustand stores | src/store/* | stores/*.ts | P2 | 3d |
| 17 | Draining streams for text | (SSE consumer) | useStreamingText.ts:10-35 | N/A | 0d |
| 18 | Conversation tree model | ContextTreeBuilder.ts | threadStore.ts:6-38 | P2 | 3d |
| 19 | Context engine pipeline | pipeline.ts | (none) | P2 | 4d |
| 20 | 16 lifecycle hooks vs 6 | hooks.ts:12-29 | hooks.go:39-57 | P2 | 4d |
| 21 | Group orchestration runtime | GroupOrchestrationRuntime.ts:26-194 | orchestrator.go | P2 | 8d |
| 22 | Unknown-tool guard | GeneralChatAgent.ts:226-232 | (none) | P2 | 1d |

**Total estimated effort: ~72 developer-days across P0 (13d), P1 (21d), and P2 (38d) priorities.**

---

## Implementation Roadmap

### Phase 1: Foundation (P0, ~13 days)
1. **AgentState + AgentInstruction** (Findings 2, 3): Define Go structs. Thread through RunProcessContext.
2. **PhaseRunner** (Finding 1): Implement the phase-driven loop wrapping the orchestrator.

### Phase 2: Control Plane (P1, ~21 days)
3. **Typed Events** (Finding 4): Add typed payloads to event bus.
4. **Intervention Pipeline** (Finding 5): Implement 7-phase check before each tool call.
5. **Context Compression** (Finding 6): Add compression detection and instruction injection.
6. **SSE Streaming** (Finding 10): Add SSE endpoint + client hook.
7. **Sub-Agent Dispatch** (Finding 11): Structured sub-agent spawning.
8. **Dual Auth** (Finding 13): Extend JWT middleware.

### Phase 3: Polish (P2, ~38 days)
9-19. Remaining findings as engineering capacity allows.

