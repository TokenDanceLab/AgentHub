# Codex CLI Audit Report

> **Date**: 2026-05-25
> **Scope**: Comprehensive audit of Codex CLI source code at `reference/codex/` to inform AgentHub Edge Server's Codex adapter roadmap.
> **Current State**: Phase 1 (`codex exec --json` batch mode). Phase 2 target: `codex app-server` streaming JSON-RPC daemon.

---

## Section 1: CLI Command & Flag Map

### 1.1. Top-Level Subcommands

Codex is a multi-tool CLI. The `Subcommand` enum in `cli/src/main.rs` defines 22 commands:

| # | Subcommand | Description | Adapter Relevance |
|---|-----------|-------------|-------------------|
| 1 | `exec` (alias: `e`) | Non-interactive agent run | **CURRENT (Phase 1)** |
| 2 | `review` | Non-interactive code review | MEDIUM -- specialized task |
| 3 | `login` | Manage authentication | LOW -- user-side |
| 4 | `logout` | Remove stored credentials | LOW -- user-side |
| 5 | `mcp` | Manage external MCP servers | LOW -- admin-side |
| 6 | `plugin` | Manage Codex plugins | LOW -- admin-side |
| 7 | `mcp-server` | Run Codex as MCP server (stdio) | MEDIUM -- alternative integration |
| 8 | `app-server` | Run streaming JSON-RPC daemon | **HIGH (Phase 2)** |
| 9 | `remote-control` | Manage app-server with remote control | LOW |
| 10 | `app` (macOS/Windows) | Launch desktop app | NONE |
| 11 | `completion` | Generate shell completions | NONE |
| 12 | `update` | Update Codex | NONE |
| 13 | `doctor` | Diagnose installation | LOW |
| 14 | `sandbox` | Run commands in Codex sandbox | LOW |
| 15 | `debug` | Debugging tools | NONE |
| 16 | `execpolicy` | Execpolicy tooling | LOW -- admin-side |
| 17 | `apply` (alias: `a`) | Apply latest diff to working tree | LOW -- user-side |
| 18 | `resume` | Resume previous interactive session | **HIGH** -- thread continuity |
| 19 | `fork` | Fork a previous interactive session | MEDIUM |
| 20 | `cloud` (alias: `cloud-tasks`) | Browse cloud tasks | LOW -- OpenAI-specific |
| 21 | `features` | Inspect feature flags | NONE |
| 22 | `exec-server` | EXPERIMENTAL: Standalone exec-server | MEDIUM -- alternative |

### 1.2. `codex exec` Flags -- Complete Map

#### Exec-Specific Flags (from `exec/src/cli.rs`)

| Flag | Type | Current Adapter | Priority | Notes |
|------|------|:---:|:---:|-------|
| `PROMPT` (positional) | String | YES | -- | Passed as ctx.Prompt |
| `--json` / `--experimental-json` | bool | YES (always) | -- | Core mechanism |
| `-o` / `--output-last-message FILE` | PathBuf | NO | P1 | Write last message to file |
| `--output-schema FILE` | PathBuf | NO | P1 | JSON Schema for structured output |
| `--strict-config` | bool | NO | P2 | Fail on unknown config keys |
| `--skip-git-repo-check` | bool | NO | P2 | Run outside git repo |
| `--ephemeral` | bool | NO | P1 | No session persistence |
| `--ignore-user-config` | bool | NO | P2 | Skip user config.toml |
| `--ignore-rules` | bool | NO | P2 | Skip execpolicy .rules |
| `--color` | enum(always/never/auto) | NO | -- | UI concern |

#### Shared Flags (from `utils/cli/src/shared_options.rs`)

| Flag | Type | Current Adapter | Priority | Notes |
|------|------|:---:|:---:|-------|
| `-m` / `--model MODEL` | String | YES | -- | Via ResolveModel |
| `-i` / `--image FILE` | PathBuf[] | NO | P1 | Attach images to prompt |
| `-s` / `--sandbox MODE` | read-only/workspace-write/danger-full-access | PARTIAL | **P0** | "default" mapping is invalid |
| `--yolo` / `--dangerously-bypass-approvals-and-sandbox` | bool | YES | -- | Via bypassPermissions |
| `--dangerously-bypass-hook-trust` | bool | NO | P2 | Skip hook trust |
| `-C` / `--cd DIR` | PathBuf | YES | -- | Via ctx.WorkDir |
| `--add-dir DIR` | PathBuf[] | NO | P1 | Additional writable dirs |
| `--oss` | bool | NO | P2 | Open-source provider |
| `--local-provider` | String | NO | P2 | Local model provider |
| `-p` / `--profile NAME` | String | NO | P1 | Config profile |
| `--profile-v2 NAME` | String | NO | P1 | Named permission profile |

### 1.3. `-c key=value` Config Keys

The `-c` flag supports dotted TOML path overrides. Currently our adapter hardcodes only two keys:

| Key | Adapter | Priority |
|-----|:---:|:---:|
| `model` (via `-c model=...`) | YES | -- |
| `model_reasoning_effort` (via `-c model_reasoning_effort=...`) | YES | -- |
| `sandbox_mode` (via `--sandbox` flag, NOT `-c`) | PARTIAL | P0 |
| `reasoning_summary` (auto/concise/detailed/none) | NO | P1 |
| `service_tier` (fast/flex) | NO | P2 |
| `verbosity` (low/medium/high) | NO | P2 |
| `web_search_mode` (disabled/cached/live) | NO | P1 |
| `approvals_reviewer` (user/auto_review) | NO | P2 |
| `personality` (none/friendly/pragmatic) | NO | P2 |
| `base_instructions` | NO | P2 |
| `developer_instructions` | NO | P2 |
| `agent_max_threads` | NO | P2 |
| `agent_max_depth` | NO | P2 |
| `features.use_legacy_landlock` | NO | -- |

**Recommendation**: Add a `GenericConfig` map field to `RunProcessContext` for arbitrary config overrides instead of hardcoding each key.

---

## Section 2: codex exec JSONL Schema

### 2.1. Top-Level Event Types (8 types)

The `--json` flag outputs one JSON object per line discriminated by the `"type"` field. The authoritative schema is in `exec/src/exec_events.rs`.

```
type = "thread.started" | "turn.started" | "turn.completed" | "turn.failed"
     | "item.started" | "item.updated" | "item.completed" | "error"
```

| Event Type | Payload | Adapter Mapping |
|------------|---------|-----------------|
| `thread.started` | `{ thread_id: String }` | `BusEventSessionInit` |
| `turn.started` | `{}` | `BusEventSessionStateChanged(state=busy)` |
| `turn.completed` | `{ usage: { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens } }` | `BusEventResult(success: true, usage)` |
| `turn.failed` | `{ error: { message: String } }` | `BusEventResult(success: false, error)` |
| `item.started` | `{ item: ThreadItem }` | Dispatched by item type |
| `item.updated` | `{ item: ThreadItem }` | Dispatched by item type |
| `item.completed` | `{ item: ThreadItem }` | Dispatched by item type |
| `error` | `{ message: String }` | `BusEventResult(success: false, error)` |

### 2.2. ThreadItemDetails -- 9 Item Types

Every `ThreadItem` has `{ id: String, type: String, ...type_specific_fields }`. The `type` field discriminates via `serde(tag = "type", rename_all = "snake_case")`:

| # | type value | Rust struct | Adapter handled? | Emitted as |
|---|-----------|-------------|:---:|-----|
| 1 | `agent_message` | `{ text: String }` | YES (completed) | `BusEventTextBlock` |
| 2 | `reasoning` | `{ text: String }` | YES (completed) | `BusEventThinking` |
| 3 | `command_execution` | `{ command, aggregated_output, exit_code: Option<i32>, status }` | YES (all phases) | `BusEventToolCall` + `BusEventToolResult` |
| 4 | `file_change` | `{ changes: [{path, kind}], status }` | YES (all phases) | `BusEventFileChange` |
| 5 | `mcp_tool_call` | `{ server, tool, arguments, result?, error?, status }` | YES (all phases) | `BusEventToolCall` + `BusEventToolResult` |
| 6 | `collab_tool_call` | `{ tool, sender_thread_id, receiver_thread_ids, prompt?, agents_states, status }` | YES (start/completed) | `BusEventTaskStarted` + `BusEventTaskNotification` |
| 7 | `web_search` | `{ id, query, action }` | YES (start/completed) | `BusEventToolCall` + `BusEventToolResult` |
| 8 | `todo_list` | `{ items: [{text, completed}] }` | YES (all phases) | `BusEventToolCall(toolName=plan)` |
| 9 | `error` | `{ message: String }` | YES (completed) | `BusEventResult(success: false)` |

### 2.3. Status Enums

| Enum | Values |
|------|--------|
| `CommandExecutionStatus` | `in_progress`, `completed`, `failed`, `declined` |
| `PatchApplyStatus` | `in_progress`, `completed`, `failed` |
| `McpToolCallStatus` | `in_progress`, `completed`, `failed` |
| `CollabToolCallStatus` | `in_progress`, `completed`, `failed` |
| `CollabAgentStatus` | `pending_init`, `running`, `interrupted`, `completed`, `errored`, `shutdown`, `not_found` |
| `CollabTool` | `spawn_agent`, `send_input`, `wait`, `close_agent` |
| `PatchChangeKind` | `add`, `delete`, `update` |

### 2.4. Event Dispatch Matrix -- Current Coverage

| | item.started | item.updated | item.completed |
|---|---|---|---|
| agent_message | NOT dispatched | NOT dispatched | `BusEventTextBlock` |
| reasoning | NOT dispatched | NOT dispatched | `BusEventThinking` |
| command_execution | `BusEventToolCall(started)` | `BusEventToolCall(progress)` | `BusEventToolResult` |
| file_change | `BusEventFileChange` | `BusEventFileChange` | `BusEventFileChange` |
| mcp_tool_call | `BusEventToolCall(started)` | `BusEventToolCall(progress)` | `BusEventToolResult` |
| web_search | `BusEventToolCall(started)` | NOT dispatched | `BusEventToolResult` |
| collab_tool_call | `BusEventTaskStarted` | **MISSING** | `BusEventTaskNotification` |
| todo_list | `BusEventToolCall(plan)` | `BusEventToolCall(plan)` | `BusEventToolCall(plan)` |
| error | NOT dispatched | NOT dispatched | `BusEventResult(error)` |

---

## Section 3: codex app-server Protocol

### 3.1. Architecture

The app-server is a long-running JSON-RPC daemon supporting three transports:

| Transport | URL | Use Case |
|-----------|-----|----------|
| stdio | `stdio://` (default) | Local process integration |
| Unix socket | `unix://PATH` | Local IPC, same host |
| WebSocket | `ws://IP:PORT` | Remote access, network integration |

**Recommended for AgentHub Phase 2**: WebSocket (`ws://`) for remote deployment and connection pooling.

### 3.2. JSON-RPC Variant

The app-server uses a "lite" JSON-RPC without the `"jsonrpc": "2.0"` envelope:

```json
// Request
{ "id": "1", "method": "thread/start", "params": { ... } }
// Response  
{ "id": "1", "result": { ... } }
// Error
{ "error": { "code": -32000, "message": "...", "data": { ... } } }
// Notification (one-way, no id)
{ "method": "item/started", "params": { ... } }
```

### 3.3. Method Summary

The protocol defines 55+ client-to-server request methods, 60+ server-to-client notifications, and 10+ server-to-client requests (approval-style callbacks). See **researcher-3-app-server-protocol.md** for the complete registry.

Key method categories for AgentHub:

**Thread Lifecycle** (8 methods): `thread/start`, `thread/resume`, `thread/fork`, `thread/archive`, `thread/unarchive`, `thread/unsubscribe`, `thread/rollback`, `thread/shellCommand`

**Turn Management** (3 methods): `turn/start`, `turn/steer`, `turn/interrupt` -- essential for IM-style interaction

**Streaming Notifications** (10+ types): Real-time deltas for AgentMessage, Reasoning, Plan, CommandExecution output, FileChange patches

**Approval Callbacks** (4 server requests): `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput`, `item/tool/dynamic/call`

**File System** (9 methods): Full fs/ read/write/create/remove/watch API

### 3.4. exec vs app-server -- Capability Gaps

| Capability | exec (Phase 1) | app-server (Phase 2) |
|------------|:---:|:---:|
| Real-time text streaming | NO (batch) | YES (AgentMessageDelta) |
| Real-time reasoning streaming | NO (batch) | YES (ReasoningTextDelta) |
| Command output streaming | YES (aggregated_output) | YES (CommandExecutionOutputDelta) |
| Multi-turn persistence | Manual (resume subcommand) | YES (first-class threads) |
| Turn steering (mid-turn input) | NO | YES (turn/steer) |
| Turn interruption | NO (kill process) | YES (turn/interrupt) |
| Approval handling | NO (--yolo or crash) | YES (request/response callbacks) |
| Dynamic tool registration | NO | YES (DynamicToolCall) |
| File system API | NO (via shell) | YES (fs/read, fs/write, etc.) |
| Config management | static (CLI args) | YES (config/read, config/write) |
| Remote deployment | NO (local process only) | YES (ws:// transport) |
| Image generation/view | NO | YES (ImageView, ImageGeneration) |
| Plan tracking | NO | YES (Plan item + PlanDelta) |
| Guardian auto-review | NO | YES (GuardianApprovalReview*) |

### 3.5. Phase 2 Integration Design (Sketch)

```
AgentHub Edge Server                    Codex App Server (ws://)
--------------------------              -----------------------------
WebSocket Transport        <--ws://-->   codex app-server --listen ws://0.0.0.0:9800
                                            |
AgentHub Thread  ──maps to──>  Codex Thread
AgentHub Message ──maps to──>  turn/start (UserInput.Text)
AgentHub Mention ──maps to──>  turn/steer (mid-turn injection)
AgentHub Approval<──maps from──  item/*/requestApproval
AgentHub Stream  <──maps from──  item/*/delta (real-time streaming)
```

Key design decisions for Phase 2:
1. **Transport**: WebSocket for network accessibility (alternative: Unix socket for local)
2. **Thread mapping**: One AgentHub thread = one Codex thread. Thread ID stored in AgentHub metadata.
3. **Authentication**: Codex app-server auth mode (API key, OAuth, or AgentIdentity)
4. **Approval routing**: Forward Codex approval requests to AgentHub's IM approval mechanism
5. **Connection pooling**: One WS connection can manage multiple Codex threads

---

## Section 4: Collab/Subagent Model

### 4.1. CollabTool -- 5 Operations

```rust
pub enum CollabTool {
    SpawnAgent,   // Create a new child agent thread
    SendInput,    // Send input to an existing child agent
    ResumeAgent,  // Resume a suspended child agent (app-server only)
    Wait,         // Block until child agents complete
    CloseAgent,   // Terminate a child agent
}
```

### 4.2. CollabAgentStatus -- 7 States

```rust
pub enum CollabAgentStatus {
    PendingInit,   // Created but not started
    Running,       // Actively processing
    Interrupted,   // Suspended by user
    Completed,     // Finished successfully (with optional message)
    Errored,       // Failed with error
    Shutdown,      // Closed/terminated
    NotFound,      // Thread ID not found
}
```

### 4.3. Multi-Agent Configuration Limits

```
DEFAULT_AGENT_MAX_THREADS = 6           // Max concurrent agent threads total
DEFAULT_MULTI_AGENT_V2_MAX_CONCURRENT_PER_SESSION = 4  // Max concurrent per session
DEFAULT_MULTI_AGENT_V2_MAX_WAIT_TIMEOUT_MS = 3,600,000  // 1 hour max wait
DEFAULT_MULTI_AGENT_V2_DEFAULT_WAIT_TIMEOUT_MS = 30,000 // 30 seconds default wait
DEFAULT_AGENT_MAX_DEPTH = 1             // No recursive spawns by default
```

### 4.4. SpawnAgent Lifecycle

```
1. Main agent calls SpawnAgent with prompt, optional model/effort
2. Child thread created: status=PendingInit -> Running
3. item.started(collab_tool_call) emitted with receiver_thread_ids
4. Child processes independently; item.updated emitted on state changes
5. Child completes: status=Completed/Errored
6. item.completed(collab_tool_call) with final agents_states
7. Parent can Wait for completion or CloseAgent to terminate early
```

### 4.5. Bridge to AgentHub IM Model

**Phase 2 Strategy (Transparent Passthrough)**:
- Let Codex manage internal multi-agent coordination
- AgentHub observes collab events as `BusEventTaskStarted`/`BusEventTaskNotification`
- Spawned agents remain invisible to AgentHub participants
- Simple: no breaking changes, leverages existing Codex coordination

**Phase 3 Strategy (AgentHub as Coordinator)**:
- Intercept `SpawnAgent` to create real AgentHub threads
- Each spawned Codex agent = an AgentHub "bot" in the IM group
- Route `SendInput` through AgentHub message bus
- Display collab status in AgentHub UI as participant status
- Complex: requires bidirectional state sync and lifecycle management

### 4.6. Critical Adapter Gap

The adapter does NOT handle `collab_tool_call` item.updated events. This means:
- Agent state transitions (Running -> Interrupted, Running -> Completed) during the task are invisible
- Only final states are visible via item.completed
- Fix: Add `case "collab_tool_call"` to `dispatchItemUpdated` emitting `BusEventTaskNotification`

---

## Section 5: Adapter Gaps -- Ordered by Impact

### P0 -- Critical (Fix Now)

| # | Gap | Impact | Fix |
|---|-----|--------|-----|
| P0-1 | **Invalid sandbox mode "default"** | `--sandbox default` is not a valid Codex value. Causes error or undefined behavior. | Remove sandbox flag when permission mode is "default". Only set `--sandbox` for plan (read-only), acceptEdits/dontAsk (workspace-write), bypassPermissions (danger-full-access). |
| P0-2 | **Missing collab_tool_call item.updated** | Agent state transitions during multi-agent tasks are invisible. Only final states appear. | Add `case "collab_tool_call"` to `dispatchItemUpdated`, emit `BusEventTaskNotification` with partial agents_states. |
| P0-3 | **No `-c` generic passthrough** | Cannot pass any config override beyond model and reasoning_effort. | Add `ConfigOverrides map[string]string` to `RunProcessContext`, iterate in `BuildCommand` to produce `-c key=value` arguments. |

### P1 -- High Priority (Phase 1 Polish)

| # | Gap | Impact | Fix |
|---|-----|--------|-----|
| P1-1 | **No web_search control** | Web search always uses Codex default (cached). Cannot disable or set to live. | Add `WebSearchMode` field. Pass `-c web_search_mode=<mode>` in BuildCommand. |
| P1-2 | **No ephemeral mode** | Every exec writes session to disk. Wastes storage for stateless tasks. | Add `Ephemeral bool` to RunProcessContext. Pass `--ephemeral` flag. |
| P1-3 | **No image support** | Cannot attach images to prompts (useful for vision models). | Add `Images []string` to RunProcessContext. Pass `-i` flags. |
| P1-4 | **No `--output-schema` support** | Cannot request structured JSON output from the model. | Add `OutputSchema string` to RunProcessContext. Pass `--output-schema` flag. |
| P1-5 | **No `--profile-v2` support** | Cannot use named permission profiles (modern sandbox alternative). | Add `ConfigProfile string` to RunProcessContext. Pass `--profile-v2` flag. |
| P1-6 | **No reasoning summary control** | Cannot configure reasoning summary verbosity. | Add `ReasoningSummary string` field. Pass `-c reasoning_summary=<value>`. |
| P1-7 | **No collab_agent_tool_call alias** | App-server uses `CollabAgentToolCall` (camelCase); our code expects `collab_tool_call` (snake_case). Phase 2 prep. | Add alias handling: treat `collab_agent_tool_call` the same as `collab_tool_call`. |

### P2 -- Medium Priority (Phase 2 Readiness)

| # | Gap | Impact | Fix |
|---|-----|--------|-----|
| P2-1 | **No thread resume/persistence** | Cannot resume previous Codex sessions. Loses conversation history. | Add `ResumeSession` support in RunProcessContext. Use `codex exec resume --last` or pass previous thread_id. |
| P2-2 | **No personality/instructions config** | Cannot customize agent personality or inject custom instructions. | Add `Personality`, `BaseInstructions`, `DeveloperInstructions` fields. Pass as `-c` config. |
| P2-3 | **No service tier config** | Cannot choose between fast and flex tiers. | Add `ServiceTier` field. Pass `-c service_tier=<value>`. |
| P2-4 | **No agent_max_threads/depth control** | Cannot limit multi-agent spawning. | Add fields. Pass as `-c agent_max_threads=<n>`. |
| P2-5 | **No app-server adapter exists** | Phase 2 requires new adapter (`codex_app_server.go`) with WebSocket client, JSON-RPC codec, notification dispatch, and approval callback handling. | Design and implement new adapter. See Section 6 recommendations. |
| P2-6 | **No stdin support for exec** | `NeedsStdin()` returns false. Some exec scenarios require stdin for prompts or piped content. | Implement stdin writing for initial prompt piped to exec. |

### P3 -- Nice to Have

| # | Gap | Impact | Fix |
|---|-----|--------|-----|
| P3-1 | **No model provider selection** | Cannot use open-source or local providers (--oss, --local-provider). | Add fields. |
| P3-2 | **No `--add-dir` support** | Cannot specify additional writable directories. | Add field. |
| P3-3 | **No `--skip-git-repo-check`** | Cannot run exec outside git repos. | Add flag. |
| P3-4 | **No `--strict-config` support** | Cannot enforce strict config validation. | Add flag. |

---

## Section 6: Recommended Changes

### 6.1. P0-1: Fix Sandbox Mode "default" (Immediate)

**File**: `internal/adapters/codex.go`, function `BuildCommand`, lines 67-72

**Problem**: The mapper returns `"default"` for the "default" permission mode, but Codex has no `--sandbox default` value. Only `read-only`, `workspace-write`, and `danger-full-access` exist.

**Fix**:
```go
// Current (broken):
if ctx.PermissionMode != "" {
    sandbox := sandboxForPermissionMode(ctx.PermissionMode)
    if sandbox != "" {
        args = append(args, "--sandbox", sandbox)
    }
}

// Fixed:
func sandboxForPermissionMode(mode string) string {
    switch mode {
    case "plan":
        return "read-only"
    case "acceptEdits", "dontAsk":
        return "workspace-write"
    case "bypassPermissions":
        return "danger-full-access"
    default:
        return ""  // "default" maps to "" => no --sandbox flag, let Codex decide
    }
}
```

### 6.2. P0-2: Handle collab_tool_call item.updated

**File**: `internal/adapters/codex.go`, function `dispatchItemUpdated`, line 306-325

**Add after line 319** (`case "mcp_tool_call"`):
```go
case "collab_tool_call":
    a.emitCollabProgress(raw, scope, emitter)
```

**New function**:
```go
func (a *CodexAdapter) emitCollabProgress(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
    var item struct {
        ID                string                     `json:"id"`
        Tool              string                     `json:"tool"`
        SenderThreadID    string                     `json:"sender_thread_id"`
        ReceiverThreadIDs []string                   `json:"receiver_thread_ids"`
        AgentsStates      map[string]json.RawMessage `json:"agents_states"`
        Status            string                     `json:"status"`
    }
    if err := json.Unmarshal(raw, &item); err != nil {
        slog.Debug("codex: emitCollabProgress unmarshal failed", "err", err)
        return
    }
    notification := map[string]any{
        "taskId":  item.ID,
        "tool":    item.Tool,
        "status":  item.Status,
    }
    if len(item.AgentsStates) > 0 {
        states := make(map[string]any, len(item.AgentsStates))
        for threadID, rawState := range item.AgentsStates {
            var state map[string]any
            if json.Unmarshal(rawState, &state) == nil {
                states[threadID] = state
            }
        }
        notification["agentsStates"] = states
    }
    emitter.Emit(BusEventTaskNotification, scope, notification)
}
```

### 6.3. P0-3: Add Generic -c Config Passthrough

**File**: `internal/adapters/codex.go`, function `BuildCommand`

Add to `RunProcessContext` (in `store/types.go` or `adapters/interfaces.go`):
```go
type RunProcessContext struct {
    // ... existing fields ...
    
    // Phase 1.5: Generic config overrides passed as -c key=value
    ConfigOverrides map[string]string `json:"configOverrides,omitempty"`
    
    // Phase 1.5: Enable ephemeral (no disk persistence)
    Ephemeral bool `json:"ephemeral,omitempty"`
    
    // Phase 1.5: Images to attach to prompt
    Images []string `json:"images,omitempty"`
    
    // Phase 1.5: JSON Schema for structured output
    OutputSchema string `json:"outputSchema,omitempty"`
    
    // Phase 1.5: Named config profile (profile v2)
    ConfigProfile string `json:"configProfile,omitempty"`
}
```

In `BuildCommand`:
```go
// Generic config overrides (P0-3)
for key, value := range ctx.ConfigOverrides {
    args = append(args, "-c", key+"="+value)
}

// Ephemeral mode (P1-2)
if ctx.Ephemeral {
    args = append(args, "--ephemeral")
}

// Images (P1-3)
for _, img := range ctx.Images {
    args = append(args, "-i", img)
}

// Structured output schema (P1-4)
if ctx.OutputSchema != "" {
    args = append(args, "--output-schema", ctx.OutputSchema)
}

// Config profile v2 (P1-5)
if ctx.ConfigProfile != "" {
    args = append(args, "--profile-v2", ctx.ConfigProfile)
}
```

### 6.4. P1-1: Add Web Search Control

Add to `RunProcessContext`:
```go
// WebSearchMode: disabled, cached, live
WebSearchMode string `json:"webSearchMode,omitempty"`
```

In `BuildCommand` (via ConfigOverrides):
```go
if ctx.WebSearchMode != "" {
    args = append(args, "-c", "web_search_mode="+ctx.WebSearchMode)
}
```

### 6.5. P2-5: Phase 2 app-server Adapter Design

**New file**: `internal/adapters/codex_app_server.go`

**Key components**:
```go
type CodexAppServerAdapter struct {
    transportURL  string  // ws://localhost:9800
    wsConn        *websocket.Conn
    pendingReqs   map[RequestId]chan JSONRPCResponse
    eventEmitter  EventEmitter
}

// Required methods:
func (a *CodexAppServerAdapter) Metadata() AdapterMetadata
func (a *CodexAppServerAdapter) Capabilities() AgentCapabilities  // Streaming: true
func (a *CodexAppServerAdapter) Connect(ctx context.Context) error
func (a *CodexAppServerAdapter) StartThread(ctx context.Context, params ThreadStartParams) (string, error)
func (a *CodexAppServerAdapter) StartTurn(ctx context.Context, threadID string, input []UserInput) error
func (a *CodexAppServerAdapter) SteerTurn(ctx context.Context, threadID string, input string) error
func (a *CodexAppServerAdapter) InterruptTurn(ctx context.Context, threadID string) error
func (a *CodexAppServerAdapter) HandleApprovalRequest(params CommandExecutionRequestApprovalParams) (Decision, error)
func (a *CodexAppServerAdapter) ReadEventLoop(ctx context.Context) error  // reads notifications, dispatches events
func (a *CodexAppServerAdapter) Close() error
```

### 6.6. Summary: Recommended Implementation Order

```
Phase 1 (Immediate fixes):
  P0-1 ─── Fix sandbox "default" mapping
  P0-2 ─── Handle collab_tool_call item.updated
  P0-3 ─── Add ConfigOverrides passthrough

Phase 1.5 (Week 2):
  P1-1 ─── Web search control
  P1-2 ─── Ephemeral mode
  P1-3 ─── Image support
  P1-4 ─── output-schema support
  P1-5 ─── profile-v2 support
  P1-6 ─── Reasoning summary control
  P1-7 ─── collab_agent_tool_call alias

Phase 2 (Week 3-4):
  P2-5 ─── Design & build CodexAppServerAdapter
  P2-1 ─── Thread resume/persistence
  P2-2 ─── Personality/instructions config
  P2-3 ─── Service tier config
  P2-4 ─── Multi-agent limits
  P2-6 ─── Stdin support for exec

Phase 3 (Future):
  P3-1 ─── OSS/local provider support
  P3-2 ─── --add-dir support
  Collab interception (AgentHub as multi-agent coordinator)
  Guardian auto-review integration
```

---

## Appendix: Source Files Referenced

| File | Lines | Purpose |
|------|-------|---------|
| `codex-rs/exec/src/exec_events.rs` | 318 | JSONL event schema (authoritative) |
| `codex-rs/exec/src/cli.rs` | 312 | Exec CLI flags |
| `codex-rs/cli/src/main.rs` | 3431 | Top-level CLI dispatch |
| `codex-rs/utils/cli/src/shared_options.rs` | 191 | Shared CLI flags |
| `codex-rs/utils/cli/src/config_override.rs` | 226 | `-c key=value` parsing |
| `codex-rs/utils/cli/src/sandbox_mode_cli_arg.rs` | 48 | Sandbox CLI arg type |
| `codex-rs/protocol/src/config_types.rs` | 863 | Config enums (SandboxMode, WebSearchMode, etc.) |
| `codex-rs/core/src/config/mod.rs` | 3000+ | Config struct + defaults |
| `codex-rs/app-server/src/main.rs` | 126 | App-server CLI entry point |
| `codex-rs/app-server-protocol/src/jsonrpc_lite.rs` | 89 | JSON-RPC primitives |
| `codex-rs/app-server-protocol/src/protocol/common.rs` | 3164 | Full RPC method registry |
| `codex-rs/app-server-protocol/src/protocol/v2/shared.rs` | 317 | Approval, sandbox, error types |
| `codex-rs/app-server-protocol/src/protocol/v2/item.rs` | 1448 | ThreadItem + notification types |
| `codex-rs/app-server-protocol/src/protocol/v2/thread.rs` | 1212 | Thread management types |
| `codex-rs/app-server-protocol/src/protocol/v2/turn.rs` | 406 | Turn management types |
| `codex-rs/protocol/src/items.rs` | 636 | Turn-level items (TUI/history) |
| `edge-server/internal/adapters/codex.go` | 633 | Current Codex adapter |

## Appendix: Supporting Researcher Reports

- [Researcher 1: Exec Flags & Config Map](codex/researcher-1-exec-flags-config.md)
- [Researcher 2: Exec JSONL Schema](codex/researcher-2-exec-jsonl-schema.md)
- [Researcher 3: App-Server Protocol](codex/researcher-3-app-server-protocol.md)
- [Researcher 4: Collab/Subagent Deep Dive](codex/researcher-4-collab-subagent.md)
- [Researcher 5: Sandbox, Tools, Trust, Cloud](codex/researcher-5-sandbox-tools-trust.md)
