# Competitive Analysis: Architectural Innovation Patterns for AgentHub

> Last updated: 2026-06-10
> Scope: Cline, Cursor, Windsurf, GitHub Copilot Chat, LobeChat, Aider, Continue.dev, OpenCode
> Constraint: Analysis from architectural knowledge only -- no competitor repo access
> Goal: Extract data-flow, protocol, and orchestration patterns AgentHub can wire at the data layer

---

## 1. Executive Summary -- Top 10 Innovations for AgentHub

| # | Innovation | Origin | AgentHub Gap | Impact | Effort |
|---|-----------|--------|-------------|--------|--------|
| 1 | **Formal Run State Machine** with typed transitions | Cline, Roo-Code | RunState has 5 free-form fields; no state machine | HIGH | LOW |
| 2 | **Tool Execution Loop Detection** (soft/hard thresholds) | Cline | No dedup or loop detection; agents can loop indefinitely | HIGH | LOW |
| 3 | **Hierarchical Planner-Worker Agent Orchestration** | Cursor | Flat peer agents with no task decomposition | HIGH | MEDIUM |
| 4 | **Structured Approval Taxonomy** (9+ ask types) | OpenCode, Cline | Only 2 ControlRequest subtypes (can_use_tool, initialize) | HIGH | MEDIUM |
| 5 | **Streaming Partial Message Protocol** with persistent render | Cline | ChatView conditionally rendered; no partial-message flag | MEDIUM | LOW |
| 6 | **Context Auto-Compaction** with summarization pipeline | Cline, Aider | context_budget.go is a stub; no token tracking or compaction | HIGH | HIGH |
| 7 | **Schema-Versioned Event Protocol** | OpenCode | No version negotiation on WS/NDJSON streams | MEDIUM | LOW |
| 8 | **Plugin Lifecycle Hook System** (19 bidirectional hooks) | OpenCode | No pre/post hooks on tool execution, shell env, or system prompt | HIGH | HIGH |
| 9 | **Cascade Diff Streaming** (incremental myers-diff) | Continue.dev | Pre-computed diffs only; no streaming diff rendering | MEDIUM | MEDIUM |
| 10 | **Agent Decision Loop State Machine** (CHECK_TOOLS -> BATCH -> APPROVAL) | LobeChat | Edge orchestrator forwards only; no decision cycle | HIGH | MEDIUM |

---

## 2. Per-Product Deep Dive

### 2.1 Cline (formerly Claude Coder)

**Architecture**: VS Code extension with a Task-based state machine. Core runs in extension host; UI in WebView via protobuf-typed messages.

**Key Innovation -- TaskState (20+ dimension tracking)**

Cline's `TaskState` tracks streaming flags, content processing state, ask/response handling, file read dedup cache, error counters, loop detection, auto-retry state, focus chain, todo management, abort/cancellation, and auto-context summarization -- all in a single typed object. This enables:
- Fine-grained UI rendering decisions based on streaming phase
- Automatic loop detection before token budget exhaustion
- Retry with backoff on transient failures

**Architecture Insight**: Cline separates the extension host (agent logic) from WebView (rendering) via a typed message bus. The WebView never unmounts -- it persists across view transitions to maintain streaming state. This is a direct counter-pattern to AgentHub's conditional ChatView rendering.

**Remote Control**: Cline executes tools in the extension host process (Node.js). File operations go through VS Code's workspace API. Bash commands go through VS Code's terminal API. Permission model is configurable per-command with auto-approval by path pattern.

**Streaming**: SSE-based partial messages with `partial: true` flag. Each chunk appends to the current message in-place. Tool calls stream their arguments incrementally before the tool executes.

**What AgentHub Has**: RunState (basic), NDJSON parser, WebSocket event pipeline, approval flow (2 types)
**What AgentHub Is Missing**: Multi-dimensional state tracking, loop detection, file-read dedup, persistent render target, partial-message protocol, configurable permission controller

---

### 2.2 Cursor

**Architecture**: AI-first code editor built on VS Code fork. Agent execution happens in cloud VMs (for cloud agents) or local processes (for local agents). The IDE itself is the orchestration surface.

**Key Innovation -- Hierarchical Planner-Worker Orchestration**

Cursor's multi-agent research (2026-01) found that flat peer-to-peer coordination fails at scale due to lock contention and risk aversion. Their successful pattern:
1. **Planner Agent** explores the codebase and creates a task decomposition with dependencies
2. **Worker Agents** execute independent tasks in parallel on separate Git worktrees
3. **Judge Agent** evaluates results each cycle, deciding whether to continue, revise, or stop

This produced 35% autonomous PR completion rates and supported hundreds of concurrent agents running for weeks.

**Architecture Insight**: Cursor 3.0's Agents Window provides a unified view of all agents (local, cloud, SSH, worktree-based). The `/best-of-n` feature runs the same task on multiple models in parallel and selects the best output. Cloud-to-local handoff allows session migration between execution environments.

**Remote Control**: Each agent runs in an isolated Git worktree. File system access is scoped to the worktree. Cloud agents use Docker sandbox VMs. Local agents use the IDE's workspace. Approval model varies by mode: "Agent" mode auto-approves safe operations, "Yolo" mode auto-approves everything.

**Streaming**: Proprietary protocol. Agent responses stream token-by-token. Tool calls show execution progress in real-time with expandable output. Diffs render as the agent writes them.

**What AgentHub Has**: Agent Profile model, Edge-Runner architecture, workspace scoping
**What AgentHub Is Missing**: Planner-Worker decomposition, Judge evaluation loop, parallel agent execution on worktrees, best-of-n model selection, cloud-local handoff

---

### 2.3 Windsurf (Codeium / Cognition)

**Architecture**: AI-powered IDE with Cascade agent system. Acquired by Cognition (Devin). Combines local IDE agent with cloud VM execution (Devin-in-Windsurf).

**Key Innovation -- Flow State Context Tracking + Agent Command Center**

Windsurf's "Flow State" maintains a persistent understanding of what the developer is working on across files, terminals, and browser tabs. The Agent Command Center provides a Kanban-style view of all running agents with status, dependencies, and artifacts.

Key patterns:
- **Cascade Hooks**: Pre/post execution hooks for custom agent behavior
- **Spaces**: Task-grouped agent sessions, PRs, and files -- similar to AgentHub's project sessions but organized by work-stream
- **Wave 13**: Multi-agent parallel execution with Git worktree isolation
- **Memories System**: Cross-session persistent context that survives restart

**Architecture Insight**: Windsurf treats context as a first-class artifact. The "Flow State" is not just conversation history -- it includes active files, terminal state, browser state, and the developer's inferred intent. This context follows the agent across sessions.

**Remote Control**: Local execution via IDE workspace. Cloud execution via Devin's Docker-based sandbox VMs with browser access and computer-use. Permission model respects IDE-level trust settings.

**Streaming**: SSE-based. Cascade agent streams responses with real-time tool execution visualization. Browser agent streams screenshots.

**What AgentHub Has**: Thread/conversation persistence, workspace concept, approval flow
**What AgentHub Is Missing**: Flow-state cross-session context, Kanban agent view, cross-session memory system, browser/computer-use agent integration

---

### 2.4 GitHub Copilot Chat

**Architecture**: In-IDE chat panel + agent mode. Agent mode (2025-2026) allows Copilot to execute multi-step tasks with tool use. Built into VS Code and GitHub.com.

**Key Innovation -- Agent Mode Tool Loop with VS Code Integration**

Copilot's agent mode introduces a tool-use loop within the IDE:
1. User sends request in chat
2. Agent plans a multi-step approach
3. Agent iteratively calls tools (file edit, terminal, search, etc.)
4. Each tool call shows in-line in the chat with expandable output
5. User can approve/reject individual tool calls
6. Agent adapts plan based on tool results

The tight VS Code integration means the agent can:
- Open editors to show changes
- Run terminal commands and capture output
- Access the workspace symbol index for code navigation
- Use GitHub's code search for cross-repo context

**Architecture Insight**: Copilot Chat is evolving toward "VS Code as multi-agent platform" (Microsoft's stated vision). The tool-use loop is the foundation -- each iteration is a discrete step visible to the user. This transparency pattern (show every tool call, every decision) is a key differentiator from "magic" one-shot generation.

**Remote Control**: Scoped to IDE workspace. Terminal access through VS Code's integrated terminal. File access through VS Code's workspace API. Auto-approval for reads, manual approval for writes and executes (configurable).

**Streaming**: SSE-based streaming of chat responses. Tool calls stream their arguments. Progress indicators during execution.

**What AgentHub Has**: Tool call rendering in transcript, approval flow
**What AgentHub Is Missing**: In-editor change visualization, terminal capture integration, workspace symbol index for agent context, inline diff annotation

---

### 2.5 LobeChat

**Architecture**: Open-source chatbot framework (Next.js + Agent Runtime). Supports multi-provider LLM access, plugin system, MCP integration, and multi-agent orchestration.

**Key Innovation -- Agent Decision Loop State Machine**

LobeChat's agent runtime implements a formal decision cycle:

```
IDLE -> CALL_LLM -> CHECK_TOOLS -> [FINISH | CALL_BATCH(auto) | REQUEST_APPROVAL]
  ^                                                                |
  |                    tool_results                                |
  +----------------------------------------------------------------+
```

Critical design decisions:
1. **Tool batching**: When the LLM returns multiple tool calls, safe tools execute in parallel automatically
2. **Approval gate**: Tools requiring approval pause execution and emit a `WAITING(human)` state
3. **Merged results**: All tool results from a batch are merged before the next LLM call, preventing context fragmentation
4. **GraphAgent**: LangGraph-based graph agent for complex multi-step workflows with explicit state transitions

**Architecture Insight**: LobeChat treats the agent runtime as a composable pipeline. `GeneralChatAgent` handles standard chat+tool loops. `GraphAgent` handles complex multi-step workflows. The group orchestration layer coordinates multiple agents in a shared conversation. Each layer has a well-defined interface.

**Plugin/MCP Ecosystem**: LobeChat has a mature plugin marketplace with:
- Tool plugins (web search, code execution, etc.)
- Model provider plugins (OpenAI, Anthropic, Google, etc.)
- MCP server integration via `builtin-tool-*` packages
- Claude Code integration via dedicated builtin tool

**Streaming**: SSE-based streaming with real-time rendering. Plugin results stream back incrementally. Multi-agent messages are tagged with source agent for attribution.

**What AgentHub Has**: Conversation threading, Agent Profile model, edge-server adapter layer
**What AgentHub Is Missing**: Decision loop state machine, tool batching, approval gate with safe/unsafe classification, plugin marketplace, GraphAgent for complex workflows

---

### 2.6 Aider

**Architecture**: Terminal-based AI pair programming tool. Single-process Python application that manages git, file editing, and LLM communication.

**Key Innovation -- Edit Format Negotiation + Repo Map Context**

Aider's most architecturally significant innovations:

1. **Edit Format Factory**: 14+ edit formats (udiff, editblock, wholefile, search_replace, editor_diff, etc.) with automatic selection based on model capability. The `Coder.create()` factory negotiates the best format per model. This is critical because different models have different edit reliability -- GPT-4 may produce reliable search/replace blocks while a smaller model may need whole-file replacement.

2. **Repo Map**: Token-budgeted AST-level summary of the repository structure, sent as part of the system prompt. Not just a file tree -- includes class/function signatures, import relationships, and type annotations. This gives the model structural awareness without sending the entire codebase.

3. **Multi-Strategy Edit Application**: 4-strategy cascade for applying edits:
   - Simple `str.replace()`
   - `git cherry-pick`
   - Google diff-match-patch (DMP)
   - Line-based DMP
   Each tried with 4 preprocessors (strip blanks, relative indent, reverse). This makes edit application robust across model output quality.

4. **Prompt Caching**: Marks messages for Anthropic prompt caching with `cache_control: {type: "ephemeral"}` on system prompt, repo map, and chat files. Reduces input token costs by ~90% on repeated calls.

**Architecture Insight**: Aider's strength is in the "last mile" of agent execution -- making edits reliably and cheaply. The edit format negotiation pattern is particularly relevant for AgentHub because it handles heterogeneous model capabilities within the same system.

**Streaming**: NDJSON streaming from LLM API. Real-time display in terminal. No WebSocket -- direct API streaming.

**What AgentHub Has**: NDJSON parser, basic adapter layer, workdir passing
**What AgentHub Is Missing**: Edit format negotiation, repo map context builder, multi-strategy edit application, prompt caching hints, model alias normalization, slash command system

---

### 2.7 Continue.dev

**Architecture**: Open-source AI code assistant (VS Code + JetBrains extension). Core is a TypeScript library with editor-specific adapters.

**Key Innovation -- Streaming Diff + Recursive Stream Continuation**

Continue's two most relevant architectural patterns:

1. **Streaming Myers-Diff**: A myers-diff-based streaming engine that computes and emits diff lines in real-time as new file content streams in. Supports "old/new/same" line types with indentation-aware matching. This enables showing diffs as the agent writes them, rather than waiting for complete output.

2. **Recursive Stream Continuation**: When generated content reaches the token limit mid-stream, Continue captures the buffer, sends a "continue exactly where you left off" prompt, and recursively merges the continuation. This handles the common failure mode of agents being cut off mid-edit.

3. **Composable Slash Command System**: Pluggable slash commands (cmd, commit, http, review, share, onboard, draftIssue) registered in a single array and resolved by name. Each command implements a typed interface. This extensibility pattern allows community-contributed commands.

**Architecture Insight**: Continue's value is in the streaming pipeline architecture. The recursive continuation pattern is particularly important for AgentHub because long code generation tasks frequently hit token limits, and the current system silently truncates.

**What AgentHub Has**: Basic diff rendering in transcript, slash commands in plan
**What AgentHub Is Missing**: Incremental diff computation, stream continuation on truncation, composable slash command registration, autocomplete pipeline debounce patterns

---

### 2.8 OpenCode

**Architecture**: Terminal AI coding agent (Bun workspace monorepo, TypeScript, Effect runtime, SolidJS UI, Hono HTTP, Drizzle ORM). The most architecturally sophisticated of the analyzed tools.

**Key Innovation -- 19-Lifecycle Bidirectional Plugin Hook System**

OpenCode defines 19 lifecycle hooks using a uniform pattern: `(input, output) => Promise<void>`. Each hook can read input AND modify output bidirectionally. This is the most extensible agent architecture analyzed.

Hook categories:

| Category | Hooks | Pattern |
|----------|-------|---------|
| **Registration** | event, config, tool, auth, provider | Top-level registration; run once at startup |
| **Message Pipeline** | chat.message, chat.params, chat.headers | Modify messages, LLM params, HTTP headers per-request |
| **Execution** | tool.execute.before, tool.execute.after, command.execute.before | Intercept and modify tool/command execution |
| **Permission** | permission.ask | Override permission decisions |
| **Environment** | shell.env | Inject/modify shell environment per-invocation |
| **Context** | experimental.chat.messages.transform, experimental.chat.system.transform, experimental.session.compacting, experimental.compaction.autocontinue | Transform messages, system prompt, and compaction behavior |
| **UI** | experimental.text.complete, tool.definition | Modify rendered text and tool descriptions sent to LLM |

**Additional Key Patterns**:

1. **Transport-Agnostic Client**: `ExtensionClient` accepts a `sendMessage` function, making it work over VS Code postMessage, WebSocket, IPC, or any transport. Same client, different wire.

2. **Schema-Versioned Events**: `system:init` event includes `schemaVersion` and `protocol` identifiers. Clients detect protocol mismatches before processing events.

3. **9-Type Ask Classification**: Classifies user interaction into 9 types: `followup`, `command`, `tool`, `use_mcp_server`, `command_output`, `api_req_failed`, `mistake_limit_reached`, `completion_result`, `resume_task`. Each maps to a specific UI treatment.

4. **WorkspaceAdapter Abstraction**: Pluggable workspace types with `configure`, `create`, `remove`, `target` lifecycle. Enables git worktree, docker volume, or cloud workspace as first-class workspace types.

**Architecture Insight**: OpenCode's hook system is bidirectional -- hooks can both observe AND modify data at every pipeline stage. This is fundamentally different from Cline's fire-and-forget event system. The bidirectional pattern enables:
- Runtime tool parameter modification (strip secrets before logging)
- LLM parameter injection (add custom temperature per model)
- System prompt augmentation (inject project context)
- Permission override (auto-approve specific tools)
- Compaction customization (preserve critical context)

**What AgentHub Has**: AgentAdapter interface, basic adapter registry, PreflightAdapter
**What AgentHub Is Missing**: Bidirectional hook system, transport abstraction, schema versioning, ask type taxonomy, workspace adapter abstraction, plugin registration lifecycle

---

## 3. Innovation Matrix

| Feature / Pattern | Cline | Cursor | Windsurf | Copilot | LobeChat | Aider | Continue | OpenCode | AgentHub |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Run State Machine** | FULL | PARTIAL | PARTIAL | PARTIAL | FULL | BASIC | BASIC | FULL | STUB |
| **Loop Detection** | FULL | NONE | NONE | NONE | NONE | NONE | NONE | PARTIAL | NONE |
| **File Read Dedup** | FULL | NONE | NONE | NONE | NONE | NONE | NONE | NONE | NONE |
| **Partial Message Streaming** | FULL | FULL | FULL | FULL | FULL | PARTIAL | FULL | FULL | NONE |
| **Tool Batching** | NONE | NONE | NONE | NONE | FULL | NONE | NONE | NONE | NONE |
| **Approval Taxonomy** | 3 types | 2 modes | 2 modes | 2 modes | 3 types | NONE | NONE | 9 types | 2 types |
| **Hierarchical Orchestration** | NONE | FULL | PARTIAL | NONE | PARTIAL | NONE | NONE | NONE | NONE |
| **Judge/Review Agent** | NONE | FULL | NONE | NONE | NONE | NONE | NONE | NONE | NONE |
| **Edit Format Negotiation** | NONE | NONE | NONE | NONE | NONE | FULL (14 formats) | NONE | NONE | NONE |
| **Streaming Diff** | NONE | FULL | FULL | FULL | NONE | NONE | FULL | NONE | PRE-COMPUTED |
| **Context Auto-Compaction** | FULL | PARTIAL | FULL (Memories) | PARTIAL | PARTIAL | PARTIAL (cache) | NONE | FULL | STUB |
| **Plugin/Hook System** | NONE | NONE | Cascade Hooks | NONE | Plugin Marketplace | NONE | Slash Commands | FULL (19 hooks) | NONE |
| **Bidirectional Hooks** | NONE | NONE | NONE | NONE | NONE | NONE | NONE | FULL | NONE |
| **Schema Versioning** | PARTIAL (proto) | NONE | NONE | NONE | NONE | NONE | NONE | FULL | NONE |
| **Transport Abstraction** | NONE | NONE | NONE | NONE | NONE | NONE | NONE | FULL | WS-ONLY |
| **Repo Map Context** | NONE | PARTIAL | Flow State | Workspace Index | NONE | FULL | NONE | NONE | --add-dir |
| **Multi-Model Selection** | NONE | best-of-n | Multi-provider | Multi-model | Multi-provider | Multi-model | Multi-provider | Multi-provider | Multi-adapter |
| **MCP Integration** | NONE | SUPPORTED | SUPPORTED | SUPPORTED | builtin-tool-* | NONE | NONE | SUPPORTED | PLANNED |
| **Persistent Cross-Session Memory** | NONE | NONE | Memories | NONE | NONE | NONE | NONE | NONE | NONE |
| **Workspace Adapter** | NONE | Worktrees | Worktrees | Workspace | NONE | Git | NONE | FULL | Workdir |
| **Parallel Agent Execution** | NONE | FULL | Wave 13 | NONE | NONE | NONE | NONE | NONE | NONE |
| **Cloud-Local Handoff** | NONE | FULL | FULL (Devin) | PARTIAL | NONE | NONE | NONE | NONE | Hub-Edge Relay |

---

## 4. AgentHub Recommendations

### Priority 1: Data-Layer Fundamentals (Effort: LOW, Impact: HIGH)

These are self-contained changes that plug into existing Edge server infrastructure with minimal surface area.

#### R1. Formal Run State Machine

**Borrow from**: Cline TaskState + Roo-Code AgentLoopState
**Implement in**: `edge-server/internal/lifecycle/` (new `state_machine.go`)
**What**: Replace free-form RunState string with a typed state machine:

```
IDLE -> STARTING -> RUNNING <-> STREAMING -> WAITING_APPROVAL -> COMPLETING -> COMPLETED
                                                                          -> FAILED
                                                                          -> ABORTED
```

Each transition is typed and logged. UI subscribes to state changes. Invalid transitions are rejected. This is the foundation for everything else.

**Why**: Without a state machine, the UI cannot render agent state correctly, the event pipeline cannot make routing decisions, and error recovery is ad-hoc. Every other innovation depends on knowing the current run state reliably.

---

#### R2. Tool Execution Loop Detection

**Borrow from**: Cline `loop-detection.ts`
**Implement in**: `edge-server/internal/adapters/` (new `loop_detector.go`)
**What**: Track tool call signatures (tool_name + params_hash) per run. When the same signature appears:
- 3 times (soft threshold): Inject a warning message into the event stream
- 5 times (hard threshold): Pause execution and emit a `WAITING_APPROVAL` state with reason "loop_detected"

**Why**: Agents looping on the same tool call (especially file reads) is the most common failure mode. It silently consumes the entire token budget. This is a 100-line guard with outsized reliability impact.

---

#### R3. Schema-Versioned Event Protocol

**Borrow from**: OpenCode `system:init` event
**Implement in**: `edge-server/internal/adapters/parser_ndjson.go` + `api/` event contract
**What**: Add `schemaVersion` and `protocol` fields to the first event in every stream. Client checks version on connect and rejects mismatched protocols with a clear error.

```
{"type":"session_init","schemaVersion":"1.0","protocol":"agenthub-ndjson","runId":"...","capabilities":[...]}
```

**Why**: As AgentHub evolves its event protocol, unversioned streams will silently break older clients. Version negotiation costs nothing now and prevents a painful migration later.

---

#### R4. Streaming Partial Message Flag

**Borrow from**: Cline partial message protocol
**Implement in**: `api/` WebSocket event contract + `app/shared/src/transcript/`
**What**: Add a `partial: boolean` field to text events. When `partial: true`, the UI appends to the current message in-place. When `partial: false` (or absent), the message is finalized. The transcript renderer never unmounts the streaming message block -- it updates it in-place.

**Why**: AgentHub currently renders complete messages only. Streaming text appears character-by-character via `useStreamingText` animation, not from real stream chunks. Real partial-message rendering eliminates the disconnect between stream velocity and UI rendering.

---

### Priority 2: Orchestration Layer (Effort: MEDIUM, Impact: HIGH)

These require new components in the Edge server or Hub server but follow well-understood patterns.

#### R5. Agent Decision Loop (Tool Batching + Approval Gate)

**Borrow from**: LobeChat decision cycle
**Implement in**: `edge-server/internal/lifecycle/` (new `decision_loop.go`)
**What**: After each LLM response, classify tool calls:
1. **Safe tools** (Read, Glob, Grep, WebSearch): Execute in parallel batch
2. **Write tools** (Edit, Write, Bash): Queue for approval
3. **No tools**: Finalize response

Merge all tool results before the next LLM call. This prevents context fragmentation from interleaved tool results.

```
LLM Response -> CHECK_TOOLS -> BATCH(safe) -> MERGE_RESULTS -> [APPROVAL_GATE(dangerous)] -> LLM
```

**Why**: AgentHub currently forwards tool calls one-by-one to the agent runtime. Batching safe tools reduces round-trips and improves agent efficiency. The approval gate provides a clear security boundary.

---

#### R6. Structured Approval Taxonomy (9 Ask Types)

**Borrow from**: OpenCode ask classification
**Implement in**: `api/` control protocol + `app/shared/src/transcript/`
**What**: Expand `ControlRequestInner` from 2 subtypes to 9:

| Type | Trigger | UI Treatment |
|------|---------|-------------|
| `tool_approval` | Dangerous tool execution | Approval card with tool name + args |
| `followup` | Agent needs clarification | Inline question in transcript |
| `completion_result` | Task completed with output | Result card with artifacts |
| `api_error` | API call failed | Error card with retry button |
| `loop_detected` | Loop threshold exceeded | Warning card with continue/abort |
| `context_overflow` | Context budget exceeded | Compaction card |
| `permission_denied` | User rejected action | Informational message |
| `session_resume` | Resuming interrupted session | Resume card |
| `command_output` | Shell command awaiting review | Terminal output card |

**Why**: The current 2-type taxonomy forces all user interactions into "approve tool" or "initialize". Rich classification enables purpose-built UI cards for each interaction type, improving user experience and reducing approval fatigue.

---

#### R7. Hierarchical Planner-Worker Pattern

**Borrow from**: Cursor multi-agent research
**Implement in**: Hub server (orchestration layer)
**What**: Introduce two Agent Profile archetypes:
1. **Planner**: Explores codebase, creates task decomposition, assigns subtasks
2. **Worker**: Executes assigned subtasks in isolated worktrees

The Planner runs first, produces a structured task plan (stored as an artifact), then dispatches Workers. A Judge step evaluates results before merging.

```
User Request -> Planner Agent -> Task Plan Artifact
  -> Worker 1 (worktree A) -> Results A
  -> Worker 2 (worktree B) -> Results B
  -> Judge -> Merged Results -> Response
```

**Why**: Cursor's research proved this is the only pattern that works at scale for multi-agent coding. Flat peer coordination fails. AgentHub's IM group-chat model maps naturally to this: the Planner posts the plan, Workers report in the group chat, and the Judge posts the final verdict.

---

### Priority 3: Extensibility Layer (Effort: HIGH, Impact: HIGH)

These are larger investments that create platform-level extensibility.

#### R8. Bidirectional Plugin Hook System

**Borrow from**: OpenCode 19-hook lifecycle
**Implement in**: `edge-server/internal/hooks/` (new package)
**What**: Define a hook registration and execution pipeline with bidirectional modification:

```go
type HookFunc func(ctx context.Context, input HookInput, output *HookOutput) error

type HookRegistry struct {
    hooks map[HookPoint][]HookFunc
}

// HookPoints:
// OnToolBefore, OnToolAfter, OnMessageTransform, OnSystemPrompt,
// OnPermissionAsk, OnShellEnv, OnCompaction, OnStreamingChunk,
// OnRunStart, OnRunComplete
```

Each hook can read input and modify output. Hooks are registered at startup and executed in order. Errors abort the pipeline.

**Why**: OpenCode's bidirectional hook system is the most extensible agent architecture analyzed. It enables:
- Custom permission logic without modifying core
- Runtime tool parameter modification (strip secrets before logging)
- System prompt injection per-project
- Custom compaction strategies
- Plugin-contributed tools

This is the foundation for a plugin ecosystem.

---

#### R9. Context Auto-Compaction Pipeline

**Borrow from**: Cline ContextManager + Aider prompt caching + OpenCode compaction hooks
**Implement in**: `edge-server/internal/lifecycle/` (new `compaction.go`)
**What**: Three-stage pipeline:
1. **Token Budget Tracking**: Track cumulative input tokens per run. When approaching model limit (e.g., 80% of 200K), trigger compaction.
2. **Summarization**: Use a fast model to summarize the conversation history into a compressed format. Preserve tool call results and file contents as structured evidence. Mark cacheable segments with `cache_control: {type: "ephemeral"}` for Anthropic.
3. **Auto-Continue**: After compaction, check if the agent's task is complete. If not, inject a continuation prompt with the compressed context.

```
Token Tracker (per-message cumulative) -> Threshold Check -> Summarizer (fast model)
  -> Compressed Context -> Auto-Continue Check -> Resume or Complete
```

**Why**: Without compaction, agents silently fail when they exhaust the context window. This is especially critical for multi-agent scenarios where context accumulates across multiple participants. Aider's prompt caching pattern can reduce costs by 90% for repeated contexts.

---

#### R10. Streaming Diff + Stream Continuation

**Borrow from**: Continue.dev streaming myers-diff + recursive stream continuation
**Implement in**: `app/shared/src/transcript/` (diff contract) + `edge-server/internal/adapters/`
**What**:
1. **Incremental Diff**: As tool results stream in, compute diffs incrementally using a myers-diff algorithm. Emit "old/new/same" line classifications in real-time rather than waiting for complete output.
2. **Stream Continuation**: When a stream ends mid-generation (detected by incomplete edit blocks or unclosed code fences), capture the buffer, send a "continue from line N" continuation prompt, and merge the result.

**Why**: Current AgentHub renders diffs only after the complete tool result is available. For long code generation, users see nothing for seconds then a large diff appears. Incremental rendering improves perceived performance and allows early error detection. Stream continuation handles the common failure of agents being cut off mid-edit.

---

### Priority 4: Platform Differentiation (Effort: MEDIUM-HIGH, Impact: MEDIUM)

These are features that differentiate AgentHub from competitors but are not foundational.

#### R11. Transport-Abstraction Layer

**Borrow from**: OpenCode `ExtensionClient` abstraction
**Implement in**: `app/shared/src/platform/` (new transport abstraction)
**What**: Abstract the WebSocket client into a `Transport` interface:

```ts
interface Transport {
  connect(): Promise<void>
  send(event: AgentEvent): void
  onEvent(handler: (event: AgentEvent) => void): () => void
  close(): void
}
```

Provide implementations: `WebSocketTransport`, `MockTransport`, `TauriIPCTransport`, `HTTPTransport`. Platform adapters select the transport at initialization.

**Why**: Currently hardcoded to WebSocket. Tauri IPC would be faster for Desktop. Mock transport enables deterministic testing. HTTP transport supports environments where WebSocket is blocked.

---

#### R12. Agent Profile Archetype System

**Borrow from**: Cursor Planner-Worker-Judge + LobeChat GraphAgent
**Implement in**: Hub server (profile store) + Edge server (adapter selection)
**What**: Define archetype templates that bundle configuration:

| Archetype | Default Tools | Default Approval | Default Model Preference |
|-----------|--------------|-----------------|------------------------|
| Planner | Read, Glob, Grep, WebSearch | Auto-approve all | High-reasoning model |
| Worker | Read, Write, Edit, Bash | Ask for Bash, auto rest | Fast model |
| Reviewer | Read, Glob, Grep | Auto-approve all | High-reasoning model |
| Researcher | WebSearch, WebFetch, Read | Auto-approve all | Long-context model |
| Orchestrator | All (via delegation) | Route to sub-agents | Orchestrator model |

Users can create custom archetypes or use defaults. Archetypes drive default tool access, approval policies, and model selection.

**Why**: AgentHub's current Agent Profile is a flat configuration. Archetypes encode best-practice patterns for different roles. This maps directly to the IM group-chat model: "Add a Planner agent" vs "Add a generic agent".

---

## 5. Implementation Roadmap

### Phase 1: Data-Layer Fixes (1-2 weeks)

| Item | Files | Test Strategy |
|------|-------|---------------|
| R1. Run State Machine | `edge-server/internal/lifecycle/state_machine.go` | Unit: valid/invalid transitions |
| R2. Loop Detection | `edge-server/internal/adapters/loop_detector.go` | Unit: threshold triggers, signature tracking |
| R3. Schema Versioning | `api/` event contract + parser changes | Integration: version mismatch rejection |
| R4. Partial Messages | `api/` + `app/shared/src/transcript/` | Visual: streaming text appears in-place |

### Phase 2: Orchestration (2-4 weeks)

| Item | Files | Test Strategy |
|------|-------|---------------|
| R5. Decision Loop | `edge-server/internal/lifecycle/decision_loop.go` | Unit: batch classification, merge results |
| R6. Approval Taxonomy | `api/` protocol + `app/shared/src/transcript/` | Unit: type routing, UI: card rendering |
| R7. Planner-Worker | Hub server orchestration | Integration: multi-agent plan-execute-judge cycle |

### Phase 3: Extensibility (4-8 weeks)

| Item | Files | Test Strategy |
|------|-------|---------------|
| R8. Plugin Hooks | `edge-server/internal/hooks/` | Unit: hook registration, bidirectional modification |
| R9. Auto-Compaction | `edge-server/internal/lifecycle/compaction.go` | Integration: long run compaction trigger |
| R10. Streaming Diff | `app/shared/src/transcript/` + Edge parser | Visual: incremental diff rendering |

### Phase 4: Differentiation (4-6 weeks)

| Item | Files | Test Strategy |
|------|-------|---------------|
| R11. Transport Abstraction | `app/shared/src/platform/` | Unit: transport swap, mock determinism |
| R12. Agent Archetypes | Hub + Edge profile stores | Integration: archetype-driven tool/model/approval defaults |

---

## 6. Key Architectural Insight: AgentHub's Unique Position

None of the analyzed products combine IM-native UX with local/remote agent execution. The competitive landscape reveals:

1. **IDE-bound tools** (Cursor, Copilot, Windsurf, Cline): Agent execution is tied to the IDE. No cross-tool orchestration. No team collaboration surface.

2. **Chat frameworks** (LobeChat, Continue): Focus on LLM chat, not agent execution. No local file system access. No multi-runtime support.

3. **Terminal tools** (Aider, OpenCode): Powerful execution but single-user. No collaboration. No persistent workspace.

4. **Orchestration platforms** (Thenvoi, SemaClaw, Paperclip): Focus on agent-to-agent coordination but use custom UIs, not IM-native interfaces.

AgentHub's Hub-Edge-Runner architecture uniquely positions it to combine:
- **IM-native collaboration** (from chat frameworks)
- **Local agent execution** (from terminal tools)
- **Multi-runtime support** (from IDE tools)
- **Team orchestration** (from orchestration platforms)

The highest-value innovations to borrow are those that strengthen this unique position: the run state machine (R1) enables reliable multi-agent coordination, the decision loop (R5) enables intelligent tool batching across runtimes, and the plugin hook system (R8) enables community-driven extensibility without forking.

---

*This analysis is based on architectural knowledge of the listed products as of 2026-06-10. No competitor source code was accessed. Cross-referenced with existing AgentHub research in `docs/reference/projects/`. For source-level adoption details, see `docs/reference/projects/ai-coding-tools/01-source-adoption-map.md`.*
