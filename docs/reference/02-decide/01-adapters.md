# Cross-Analysis: Unified Agent Adapter Interface

> Generated: 2026-05-21
> Sources: claude-code-sdk.md, codex-cli.md, kanna.md, opencode.md
> AgentHub context: architecture.md, data-model.md, authority.md

## 1. Four-Way Comparison Table

### 1.1 Startup & Process Model

| Dimension | Claude Code SDK | Codex CLI | OpenCode | Kanna (wrapper) |
|---|---|---|---|---|
| **Binary** | `claude` (Node.js/bun) | `codex` (Rust) | `opencode` (Bun) | Bun HTTP server wrapping CC/Codex |
| **Non-interactive** | `-p "prompt" --output-format stream-json --verbose` | `codex exec "prompt"` (text-only output) | HTTP REST: `POST /session` + SSE stream | Internal call: agent.send() |
| **Stream protocol** | NDJSON (public, ~13 msg types) | Internal ResponseEvent/TurnItem (not publicly consumable) | SSE: LLMEvent 16-type tagged union | Unified TranscriptEntry (server-side normalization) |
| **Embedded mode** | QueryEngine as library (TS import) | Rollout trace replay (read-only history) | OpenCode Client SDK (HTTP + SSE) | N/A (wrapper itself) |
| **Configuration** | `.mcp.json` + `settings.json` (JSON) | `config.toml` + CLI `-c key=value` | `opencode.toml` | Per-chat provider/model/effort settings |
| **Language** | TypeScript | Rust | TypeScript (Effect runtime) | TypeScript |

### 1.2 Stream Output Format

| Dimension | Claude Code | Codex | OpenCode | Kanna |
|---|---|---|---|---|
| **Transport** | stdout NDJSON (one JSON object per line) | TUI-internal event pipeline (no public stream) | HTTP SSE (Server-Sent Events) | WebSocket JSON snapshots (16ms debounced) |
| **Top-level message types** | `system_init`, `assistant`, `user` (tool_result), `stream_event`, `result`, `tool_use_summary` | `OutputItemAdded`, `OutputTextDelta`, `Completed`, `ReasoningTextDelta` | `StepStart`, `TextStart/Delta/End`, `ToolInputStart/Delta/End`, `ToolCall`, `StepFinish`, `Finish` | `TranscriptEntry` union: `system_init`, `assistant_text`, `tool_call`, `tool_result`, `result`, `status` |
| **Tool call encoding** | `assistant` message with `content: [{type:"tool_use",...}]` block | `ResponseItem::FunctionCall` → dispatched to tool handler | `ToolCall` event with codec-based validation | `tool_call` TranscriptEntry with normalized fields |
| **Thinking/Reasoning** | `thinking` content block inside `assistant` message | `ReasoningTextDelta` stream event | `ReasoningStart/Delta/End` stream events | Stored in transcript, stripped from streamlined output |
| **Completion signal** | `result` message (`subtype: "success"`, `is_error: bool`, exit code `0|1`) | `Completed { response_id, token_usage, end_turn }` | `Finish` event with stop reason | `result` entry in transcript |
| **External consumability** | Yes (public protocol) | No (internal only) | Yes (SSE + SDK) | Yes (WebSocket protocol) |

### 1.3 Permission & Approval Model

| Dimension | Claude Code | Codex | OpenCode | Kanna |
|---|---|---|---|---|
| **Mode system** | 6 modes: `default`, `acceptEdits`, `bypassPermissions`, `plan`, `auto`, `dontAsk` | Sandbox modes: `Disabled`, `Managed` (file_system + network) | Agent-level rulesets: allow/deny per-tool with GLOB patterns | Delegates to underlying agent + adds tool-specific gating |
| **Rule granularity** | Per-tool + optional content match: `"Bash(git *)"` | Per-path FileSystemAccessMode: `ReadOnly`/`ReadWrite` | Per-agent tool allow/deny lists with `*` wildcard | Tool-level: only gates `AskUserQuestion` and `ExitPlanMode` |
| **Rule sources** | 9 sources with priority: user, project, local, enterprise, managed, cliArg, command, session, hooks | config.toml static config | Agent Info + user TOML override | Static config, no multi-source priority |
| **Hook integration** | `PreToolUse`, `PostToolUse`, `PermissionRequest`, `PermissionDenied` (28 hooks total) | `run_permission_request_hooks()` in ToolOrchestrator | `permission.ask` plugin hook | N/A (delegates) |
| **Sandbox** | Bash-only sandbox (CLI flag) | OS-level: macOS Seatbelt, Linux Landlock, Windows Restricted Token + WFP | None | Delegates to underlying |
| **Guardian/Reviewer** | None | Guardian system for high-risk shell commands + `ApprovalsReviewer` role | None (uses ruleset + hook) | N/A |
| **Escalation** | Denial tracking with threshold fallback | Sandbox escalation on failure: permissive → strict retry | None | N/A |

### 1.4 Session / Conversation Management

| Dimension | Claude Code | Codex | OpenCode | Kanna |
|---|---|---|---|---|
| **Session identifier** | `session_id` (UUID string) | `SessionId` (shared) + `ThreadId` (per agent) UUID pair | `SessionID` branded string `"ses_..."` + parent_id tree | `chatId` (UUID) + sessionToken (from SDK) |
| **Session reuse** | `resumeSession(sessionId)` | `codex resume --last` (picker) + rollout recovery | SQLite-backed, explicit fork/abort/summarize API | Auto: reuse sessionToken, detect model/planMode changes |
| **Fork** | `forkSession()` SDK function: creates branched session from existing | `Fork` with `FullHistory` or `LastNTurns(n)` modes | Fork with `parent_id` reference in SQLite | Copy transcript JSONL + set `pendingForkSessionToken` + native `forkSession` flag |
| **Persistence** | JSONL `~/.claude/sessions/<id>.jsonl` | Rollout files in `$CODEX_HOME/state/` + thread-store DB | SQLite (`SessionTable` + `PartTable` via Drizzle ORM) | JSONL `transcripts/<chatId>.jsonl` + snapshot.json compaction |
| **Multi-agent tree** | Subagent via AgentTool (forkSubagent), flat hierarchy | Agent tree: `AgentPath` (/root/child/grandchild), `AgentRegistry` for tracking | Parent-child session tree via `parent_id` | N/A (wraps single-agent sessions) |
| **Context compaction** | `compact_boundary` system message | `ContextCompaction` TurnItem | `experimental.session.compacting` + `experimental.compaction.autocontinue` hooks | Inherits from underlying agent |
| **Message queue** | N/A (single-turn API call) | SQ/EQ pattern (Submission Queue / Event Queue) | N/A | `queuedMessagesByChatId` Map + Steer mode (mid-turn message injection) |

---

## 2. AgentHub Unified Adapter Interface (Go)

### 2.1 Design Principles

1. **Provider-agnostic**: The interface must abstract over subprocess (CC/Codex) and HTTP (OpenCode) transport equally.
2. **Common core + extensions**: Every adapter implements the base interface; agent-specific features are behind capability flags and optional extension interfaces.
3. **Event-driven stream**: All adapters produce a unified `AgentEvent` stream, regardless of internal event encoding.
4. **Turn-level lifecycle**: The adapter owns the full lifecycle of a single turn (start -> stream -> result/failure -> drain).
5. **Permission bridge**: AgentHub's approval system intercepts tool calls before they execute, whether by hook (CC), sandbox rule (Codex), or callback (Kanna/OpenCode).

### 2.2 Core Interface

```go
package adapters

import (
    "context"
    "io"
)

// ============================================================================
// Core Adapter Interface
// ============================================================================

// AgentAdapter is the unified interface for all Agent CLI backends.
// Each implementation (ClaudeCodeAdapter, CodexAdapter, OpenCodeAdapter)
// must satisfy this interface.
type AgentAdapter interface {
    // Metadata returns static information about this adapter instance.
    Metadata() AdapterMetadata

    // Capabilities returns the feature set this adapter supports.
    Capabilities() AgentCapabilities

    // Start launches an agent session for a new turn.
    // The adapter is responsible for process/connection lifecycle.
    Start(ctx context.Context, req StartRequest) (*AgentSession, error)

    // Resume reconnects to an existing agent session.
    Resume(ctx context.Context, sessionID string) (*AgentSession, error)

    // AttachStream attaches as a consumer of the event stream.
    // Only one stream consumer per session is allowed.
    AttachStream(ctx context.Context, sessionID string) (*EventStream, error)
}

// ============================================================================
// Extension Interfaces (optional, capability-gated)
// ============================================================================

// SessionManager provides session-level operations beyond start/resume.
// Adapters that do not support fork/persistence may omit this.
type SessionManager interface {
    ForkSession(ctx context.Context, req ForkRequest) (*AgentSession, error)
    ListSessions(ctx context.Context, pagination Pagination) ([]SessionInfo, error)
    GetSessionInfo(ctx context.Context, sessionID string) (*SessionInfo, error)
    GetMessages(ctx context.Context, sessionID string) ([]AgentEvent, error)
}

// PermissionBroker allows AgentHub to intercept and decide tool execution
// before it happens. Adapters that support this can pause the stream, consult
// AgentHub's approval engine, and then proceed or deny.
type PermissionBroker interface {
    // SetPermissionCallback registers a hook that the adapter calls before
    // executing any tool. The callback returns an ApprovalDecision.
    SetPermissionCallback(sessionID string, cb PermissionCallback)

    // ResolvePermission is called by the adapter when a tool execution requires
    // user/admin approval. May block until a decision is made.
    ResolvePermission(ctx context.Context, req ToolPermissionRequest) (*PermissionDecision, error)
}

// InteractiveControl provides mid-turn control: cancel, steer, inject.
type InteractiveControl interface {
    // Cancel terminates the current turn gracefully.
    Cancel(ctx context.Context, sessionID string) error

    // SendSteer injects a follow-up message into a running turn,
    // typically canceling the current action and re-prompting.
    SendSteer(ctx context.Context, sessionID string, msg SteerMessage) error

    // Drain blocks until the session's background tasks (e.g., compaction,
    // post-processing) complete after the result event.
    Drain(ctx context.Context, sessionID string) error
}

// ============================================================================
// Lifecycle Types
// ============================================================================

// AdapterMetadata identifies the adapter and its version.
type AdapterMetadata struct {
    Name      string       // "claude-code", "codex", "opencode"
    Version   string       // Adapter implementation version
    AgentVersion string    // Underlying CLI binary version (from --version)
}

// AgentCapabilities declares which features this adapter supports.
type AgentCapabilities struct {
    Streaming        bool   // Supports real-time event streaming
    SessionPersist   bool   // Sessions survive process restart
    Fork             bool   // Supports session forking
    MultiAgent       bool   // Supports sub-agent spawning (tree)
    PermissionHooks  bool   // Supports PreToolUse-style permission callbacks
    Sandbox          bool   // Supports OS-level sandboxing
    ThinkingVisible  bool   // Thinking/reasoning content is exposed in stream
    MCPIntegration   bool   // Supports MCP tool registration
    StreamingToolExec bool  // Tools can execute during API streaming (not after)
    Compaction       bool   // Supports automatic context compaction
    ResumeLast       bool   // Supports --resume-last or equivalent
    Steer            bool   // Supports mid-turn message injection (steer)
}

// AgentStatus tracks the current state of a session.
type AgentStatus string

const (
    StatusIdle            AgentStatus = "idle"
    StatusStarting        AgentStatus = "starting"
    StatusRunning         AgentStatus = "running"
    StatusWaitingApproval AgentStatus = "waiting_approval"
    StatusDraining        AgentStatus = "draining"
    StatusDone            AgentStatus = "done"
    StatusFailed          AgentStatus = "failed"
    StatusCancelled       AgentStatus = "cancelled"
)

// ============================================================================
// Request / Response Types
// ============================================================================

// StartRequest carries all parameters needed to begin an agent turn.
type StartRequest struct {
    // User prompt
    Prompt    string
    SystemPrompt string // Optional system prompt override or append

    // Model configuration
    Model       string      // Model ID (e.g., "claude-sonnet-4-6")
    Thinking    *ThinkingConfig
    MaxTokens   int
    Temperature *float64

    // Workspace
    WorkingDir  string
    AllowedDirs []string    // Additional allowed directories

    // Tool configuration
    AllowedTools []string   // Whitelist (empty = all built-in)
    DeniedTools  []string   // Blacklist
    MCPConfig    *MCPConfig // MCP server configuration

    // Permission & safety
    PermissionMode string   // "default", "bypassPermissions", "plan", etc.
    MaxTurns       int      // API round limit
    MaxBudgetUSD   float64  // API cost cap
    Sandbox        *SandboxConfig

    // Session continuity
    SessionID     string    // Resume target (empty = new session)
    ForkFrom      string    // Fork source session ID
    ForkHistory   *ForkMode // How much history to carry

    // Output control
    IncludeThinking      bool // Include thinking/reasoning in stream
    IncludePartialEvents bool // Include partial deltas (text_delta, etc.)

    // Provider-specific extras (opaque to AgentHub core)
    ProviderExtras map[string]any
}

// ThinkingConfig mirrors the CC/Codex/OpenCode thinking parameters.
type ThinkingConfig struct {
    Type   string  // "disabled", "adaptive", "enabled"
    Budget *int    // Token budget (when Type=enabled)
}

// MCPConfig describes MCP servers to connect.
type MCPConfig struct {
    Servers []MCPServerDef
}

type MCPServerDef struct {
    Name      string
    Transport string            // "stdio", "sse", "http", "ws"
    Command   string            // stdio: executable
    Args      []string          // stdio: arguments
    Env       map[string]string // stdio: environment
    URL       string            // sse/http/ws: server URL
    Headers   map[string]string // sse/http/ws: request headers
    Timeout   int               // connection timeout (seconds)
}

// SandboxConfig describes sandbox restrictions.
type SandboxConfig struct {
    Enabled  bool
    FileSystem *FSSandboxConfig
    Network    *NetSandboxConfig
}

type FSSandboxConfig struct {
    ReadPaths  []string
    WritePaths []string
    DenyPaths  []string
}

type NetSandboxConfig struct {
    AllowedHosts []string
    DeniedHosts  []string
    AllowLocal   bool
}

// ForkMode defines how much conversation history to carry on fork.
type ForkMode struct {
    Mode     string // "full", "last_n_turns"
    NumTurns int    // Only used when Mode="last_n_turns"
}

// ============================================================================
// Session & Event Types
// ============================================================================

// AgentSession represents a running agent session.
type AgentSession struct {
    ID        string       // Adapter-specific session identifier
    Status    AgentStatus
    StartRequest StartRequest // The original request (for resume/reconnect)

    // Usage accumulates across the session.
    Usage *UsageInfo

    // Provider info populated after system_init.
    ProviderInfo *ProviderInfo

    // Events is the stream of agent events. Closed when the session terminates.
    // Populated after AttachStream is called.
    Events *EventStream
}

// EventStream wraps a channel of AgentEvents with lifecycle controls.
type EventStream struct {
    C      <-chan AgentEvent
    Cancel context.CancelFunc // Cancels the underlying agent process/turn
    Err    error              // Set on stream closure if terminated abnormally
}

// ============================================================================
// Unified Agent Event Model
// ============================================================================

// AgentEvent is the unified event type. Every adapter normalizes its native
// events into this structure. The Type field drives dispatch; Payload is
// a type-specific struct.
type AgentEvent struct {
    // Sequence
    Seq       int    // Monotonic sequence number within this session
    SessionID string
    Timestamp int64  // Unix milliseconds

    // Classification
    Type AgentEventType

    // Payload (type-specific, see below)
    Payload any

    // Debug
    Raw      []byte // Original provider event (for debugging) — optional
}

type AgentEventType string

const (
    // --- Lifecycle ---
    EventSystemInit        AgentEventType = "system_init"        // Session initialized: tools, model, permissions
    EventResult            AgentEventType = "result"             // Turn completed (success/error)
    EventSystem            AgentEventType = "system"             // Generic system notification (compaction, retry, status change)

    // --- Content ---
    EventAssistantText     AgentEventType = "assistant_text"     // Text content delta or block from the model
    EventReasoning         AgentEventType = "reasoning"          // Thinking/reasoning content (visible when enabled)
    EventUserReplay        AgentEventType = "user_replay"        // User message echoed back (isReplay)

    // --- Tool Execution ---
    EventToolCall          AgentEventType = "tool_call"          // Agent requests tool execution
    EventToolResult        AgentEventType = "tool_result"        // Tool execution result
    EventToolProgress      AgentEventType = "tool_progress"      // Tool execution progress update
    EventToolUseSummary    AgentEventType = "tool_use_summary"   // Batch tool call summary

    // --- Control ---
    EventStreamEvent       AgentEventType = "stream_event"       // Raw streaming delta (partial events)
    EventApprovalRequest   AgentEventType = "approval_request"   // Agent requests permission approval
    EventApprovalDecision  AgentEventType = "approval_decision"  // Permission decision rendered
    EventStatusChange      AgentEventType = "status_change"      // Session status transition
)

// ============================================================================
// Event Payload Structs
// ============================================================================

// SystemInitPayload carries session initialization data.
type SystemInitPayload struct {
    Model           string
    Tools           []ToolDef
    Commands        []CommandDef    // Slash commands
    Agents          []SubAgentDef   // Sub-agent definitions
    MCPServers      []MCPServerInfo
    PermissionMode  string
    SessionID       string
}

// AssistantTextPayload carries text content from the model.
type AssistantTextPayload struct {
    Content   string          // Text content (may be partial if streaming)
    Phase     TextPhase       // "delta" or "block_end"
    MessageID string          // Unique message identifier within turn
}

type TextPhase string
const (
    TextPhaseDelta    TextPhase = "delta"     // Streaming partial
    TextPhaseBlockEnd TextPhase = "block_end" // Complete text block
)

// ReasoningPayload carries thinking/reasoning content.
type ReasoningPayload struct {
    Content       string
    Phase         TextPhase
    BudgetUsed    int    // Tokens used so far
    BudgetTotal   int    // Token budget for reasoning
}

// ToolCallPayload carries a tool invocation request.
type ToolCallPayload struct {
    ToolCallID string
    ToolName   string         // e.g., "Bash", "Read", "mcp__github__search_repos"
    ToolInput  map[string]any // Tool arguments
    Status     ToolCallStatus
}

type ToolCallStatus string
const (
    ToolCallPending   ToolCallStatus = "pending"
    ToolCallRunning   ToolCallStatus = "running"
    ToolCallCompleted ToolCallStatus = "completed"
    ToolCallFailed    ToolCallStatus = "failed"
    ToolCallDenied    ToolCallStatus = "denied"
)

// ToolResultPayload carries the result of a tool execution.
type ToolResultPayload struct {
    ToolCallID string
    ToolName   string
    Content    string          // Rendered result content
    IsError    bool
    ExitCode   *int            // Shell exit codes only
    RawOutput  []byte          // Unformatted stdout+stderr
}

// ResultPayload carries the final turn result.
type ResultPayload struct {
    Subtype   ResultSubtype
    IsError   bool
    Content   string        // Final text result
    DurationMs int64
    DurationAPIMs int64
    NumTurns  int
    StopReason string       // "end_turn", "max_tokens", "tool_use", etc.
    Cost      *CostInfo
    Usage     *UsageInfo
    Errors    []string
}

type ResultSubtype string
const (
    ResultSuccess                    ResultSubtype = "success"
    ResultErrorExecution             ResultSubtype = "error_during_execution"
    ResultErrorMaxTurns              ResultSubtype = "error_max_turns"
    ResultErrorMaxBudget             ResultSubtype = "error_max_budget_usd"
    ResultErrorMaxStructuredOutput   ResultSubtype = "error_max_structured_output_retries"
)

// ApprovalRequestPayload is emitted when the agent asks for tool execution permission.
type ApprovalRequestPayload struct {
    ToolCallID string
    ToolName   string
    ToolInput  map[string]any
    Context    string // Human-readable description of what the tool will do
}

// ApprovalDecisionPayload is the response to an approval request.
type ApprovalDecisionPayload struct {
    ToolCallID   string
    Decision     string       // "allow", "deny", "ask_user"
    UpdatedInput map[string]any // Modified input (e.g., path rewriting)
    Message      string       // Explanation for user
}

// StatusChangePayload carries session status transitions.
type StatusChangePayload struct {
    From   AgentStatus
    To     AgentStatus
    Reason string // e.g., "compaction_triggered", "permission_mode_changed"
}

// ============================================================================
// Shared Types
// ============================================================================

type ToolDef struct {
    Name        string
    Description string
    Parameters  map[string]any // JSON Schema for tool parameters
    IsReadOnly  bool
    IsDestructive bool
    IsMcp       bool
    MCPServer   string
}

type CommandDef struct {
    Name        string
    Description string
    Aliases     []string
}

type SubAgentDef struct {
    Name         string
    Description  string
    SystemPrompt string
    Tools        []string
    Mode         string
}

type MCPServerInfo struct {
    Name      string
    Transport string
    Status    string
    ToolCount int
}

type CostInfo struct {
    TotalUSD     float64
    PerModelCost map[string]float64
}

type UsageInfo struct {
    InputTokens          int64
    OutputTokens         int64
    CacheReadTokens      int64
    CacheCreationTokens  int64
    ReasoningTokens      int64
}

type ProviderInfo struct {
    Provider    string
    Model       string
    ModelsAvailable []string
}

// ============================================================================
// Permission Callback Types
// ============================================================================

// ToolPermissionRequest is sent by the adapter to AgentHub's approval engine
// before a tool executes.
type ToolPermissionRequest struct {
    SessionID  string
    TurnID     string
    ToolCallID string
    ToolName   string
    ToolInput  map[string]any
    IsReadOnly bool
    IsDestructive bool
    Context    string
}

// PermissionDecision is the response from AgentHub's approval engine.
type PermissionDecision struct {
    Behavior     string          // "allow", "deny", "ask_user"
    UpdatedInput map[string]any  // Modified input (if Behavior="allow" with changes)
    Reason       string          // Explanation for user
}

// PermissionCallback is the function signature adapters call to check permissions.
type PermissionCallback func(req ToolPermissionRequest) (*PermissionDecision, error)

// ============================================================================
// Session Info & Fork Types
// ============================================================================

type ForkRequest struct {
    SourceSessionID string
    ForkMode        ForkMode
    Title           string
}

type SessionInfo struct {
    ID          string
    Title       string
    Project     string
    CreatedAt   int64
    UpdatedAt   int64
    MessageCount int
    Model       string
}

type Pagination struct {
    Cursor string // Opaque cursor for next page
    Limit  int    // Max results per page
}

// SteerMessage injects a user message into a running turn.
type SteerMessage struct {
    Content     string
    ReplaceLast bool // If true, replace the last user message rather than append
}

// ============================================================================
// Adapter Configuration
// ============================================================================

// AdapterConfig holds all provider-specific configuration that the adapter
// needs but AgentHub does not interpret.
type AdapterConfig struct {
    // Binary path
    BinaryPath string

    // Environment
    Env map[string]string

    // Config file paths
    SettingsPath string // CC: settings.json
    ConfigPath   string // Codex: config.toml
    MCPConfigPath string // MCP config file (CC: .mcp.json)

    // API keys / authentication
    APIKey       string
    APIKeyEnvVar string // Env var name that holds the key

    // Home directories
    DataDir string // ~/.claude, $CODEX_HOME, etc.

    // Streaming
    StreamTimeoutMs int // Max wait for next stream event

    // Provider extras (passthrough)
    Extras map[string]any
}
```

### 2.3 Interface Coverage Map

| Adapter Feature | Used by CC | Used by Codex | Used by OpenCode | Used by Kanna | In Core Interface |
|---|---|---|---|---|---|
| `Start()` | query()/prompt() | codex exec / TUI | POST /session | agent.send() | Yes |
| `Resume()` | resumeSession() | codex resume | session resume | sessionToken reuse | Yes |
| `AttachStream()` | NDJSON consumer | RolloutItem replay | SSE consumer | TranscriptEntry push | Yes |
| `ForkSession()` | forkSession() | fork + agent tree | Fork via SQLite | Copy JSONL + fork flag | Extension: `SessionManager` |
| `ListSessions()` | listSessions() | list from state DB | Query SQLite | chatsById Map | Extension: `SessionManager` |
| `Cancel()` | AbortController | Shutdown Op | Abort session | agent.cancel() | Extension: `InteractiveControl` |
| `SendSteer()` | prependUserMessage() | Op::Interrupt + re-prompt | N/A | message.steer | Extension: `InteractiveControl` |
| Permission callback | canUseTool() hook + PreToolUse hooks | run_permission_request_hooks | permission.ask hook | Tool gating callback | Extension: `PermissionBroker` |
| MCP integration | MCP tools merged | MCP name-spaced tools | MCP → AI SDK Tool convert | Built into session | Via `StartRequest.MCPConfig` |
| Thinking config | thinkingConfig | reasoning effort | Per-agent temperature/topP | Per-chat controls | `StartRequest.Thinking` |
| Compaction | auto + manual compact_boundary | ContextCompaction TurnItem | session.compacting hook | Inherited | Capability flag only |

---

## 3. Per-Agent Special Handling & Workarounds

### 3.1 Claude Code Adapter

**Subprocess mode (recommended for AgentHub P0):**

```go
// Spawn claude as child process
cmd := exec.CommandContext(ctx, binaryPath,
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--max-turns", strconv.Itoa(maxTurns),
    "--permission-mode", permissionMode,
    "--model", model,
    // "--allowed-tools", "Bash,Read,Write,Edit,Glob,Grep",  // optional whitelist
)
cmd.Stdin = stdinPipe   // For control protocol (can_use_tool responses)
cmd.Stdout = stdoutPipe  // NDJSON stream
cmd.Stderr = &stderrBuf  // Non-JSON fallback + [stdout-guard] lines
```

**Workaround 1 -- stdout guard interference**: In `stream-json` mode, CC installs a `streamJsonStdoutGuard` that redirects ALL non-JSON stdout to stderr with a `[stdout-guard]` prefix. The adapter MUST parse only stdout as NDJSON and collect stderr separately for logging.

**Workaround 2 -- exit code interpretation**: Exit code is NOT sufficient to determine success. Must check `result.is_error` in the last NDJSON line. Exit code 0 may still carry errors in `result.errors[]`.

**Workaround 3 -- verbose flag is mandatory for full events**: Without `--verbose`, only the `result` message is emitted. The adapter should assert or default to `--verbose` when serving AgentHub.

**Workaround 4 -- MCP startup latency**: MCP server connections are asynchronous. The `system_init` event's tool list may be incomplete on the first turn. Subsequent turns will have the full list after `refreshTools` completes.

**Workaround 5 -- permission mode bypass for headless**: In subprocess mode, permission checks still fire even though there is no TTY. Use `--permission-mode bypassPermissions` to suppress. Alternatively, implement the stdin control protocol's `can_use_tool` request/response loop for fine-grained approval.

**Workaround 6 -- thinking content visibility**: Thinking blocks only appear in stream events when `thinkingConfig.type` is `"enabled"` (not `"adaptive"`). Set `Thinking.Type = "enabled"` to expose reasoning in AgentHub.

**Workaround 7 -- streaming tool execution may reorder events**: When `streamingToolExecution` GrowthBook gate is active, tools may execute during API streaming, producing interleaved `tool_use` and `assistant` delta events. The event consumer must handle out-of-order tool call/result pairs.

**Workaround 8 -- shallow fork for plan mode transitions**: When switching from `plan` to `default` permission mode mid-turn, CC forks internally. The adapter should detect `system/status` events with permission mode changes and note the fork boundary.

### 3.2 Codex Adapter

**Primary approach: Exec mode + Rollout Trace replay**

Since Codex has no public stream protocol, the adapter uses a two-phase approach:
1. Execute via `codex exec <prompt>` -- get final output
2. Read the rollout trace from `$CODEX_HOME/state/` for the complete event sequence

**Workaround 1 -- no streaming output from exec**: `codex exec` returns only the final text. To provide a streaming-like experience, the adapter must read `RolloutItem` entries from the rollout file and replay them as `AgentEvent` sequence. This is post-facto replay, not true real-time streaming.

```go
// Phase 1: Execute (blocks until complete)
cmd := exec.CommandContext(ctx, binaryPath, "exec", prompt)
output, err := cmd.Output()

// Phase 2: Read rollout for event replay
rolloutPath := filepath.Join(dataDir, "state", sessionID, "rollout")
events, err := parseRolloutItems(rolloutPath)
for _, item := range events {
    emit(normalizeRolloutItem(item))
}
emit(ResultPayload{Content: string(output), ...})
```

**Workaround 2 -- SessionId + ThreadId duality**: Codex uses a shared `SessionId` across the agent tree, with per-agent `ThreadId`. The adapter must map this tree to AgentHub's flat session model:
- Map `SessionId` to AgentHub `sessionID`
- Map each `ThreadId` to a separate AgentHub `Turn`
- Maintain parent-child relationships in AgentHub's Thread model

**Workaround 3 -- Agent tree events are not a single stream**: Multi-agent operations (spawn/wait/close) produce events across multiple thread streams. The adapter must either:
- Flatten all agent events into a single merged stream (losing tree topology), or
- Expose each agent's thread as a separate sub-stream (requires AgentHub to understand agent hierarchy)

**Workaround 4 -- config.toml generation**: Codex requires `$CODEX_HOME/config.toml` to exist before running. The adapter must auto-generate this file from `StartRequest.MCPConfig` and `StartRequest.Model`:

```toml
[model_providers.openai]
api_key = "sk-..."

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
```

**Workaround 5 -- OAuth MCP requires browser interaction**: Codex's MCP OAuth flow may open a browser for authentication. In headless AgentHub environments, this will fail. Disable OAuth MCP servers or use pre-authenticated connections.

**Workaround 6 -- apply command for diffs**: Codex generates file changes but does not apply them automatically in exec mode. Use `codex apply` (alias `codex a`) as a post-exec step to materialize diffs.

**Workaround 7 -- Fork mode semantics differ from CC**: `ForkMode.FullHistory` includes the complete parent transcript as initial context (massive token usage). `ForkMode.LastNTurns(n)` is recommended for AgentHub unless preserving full history is explicitly needed.

**Workaround 8 -- sandbox interaction with tools**: When SandboxConfig.Enabled is true, MCP tools and shell commands run within OS sandbox constraints. Tool results may fail with sandbox errors rather than tool-specific errors. The adapter should intercept and classify sandbox-denial vs. tool-failure.

### 3.3 OpenCode Adapter

**Primary approach: HTTP client against Hono server**

OpenCode runs a local HTTP server (default port 4096). The adapter communicates via REST + SSE.

```go
// Start OpenCode session
url := fmt.Sprintf("http://localhost:%d", opencodePort)
resp, err := http.Post(url+"/api/session", "application/json", body)

// Consume SSE stream
req, _ := http.NewRequest("GET", url+"/api/session/"+sessionID+"/events", nil)
req.Header.Set("Accept", "text/event-stream")
resp, err := client.Do(req)
```

**Workaround 1 -- server lifecycle management**: The adapter must either:
- Start `opencode` as a background process before making HTTP calls
- Connect to an already-running instance

Recommended: spawn `opencode` as a child process, wait for health check (poll `GET /health`), then send requests. Stop on session close unless shared.

**Workaround 2 -- Effect runtime error handling**: OpenCode uses Effect for all I/O. Errors are wrapped in Effect's `Cause` type rather than standard Go errors. The adapter should catch HTTP error responses and map `_tag` fields from OpenCode's 10-variant `LLMErrorReason` discriminated union:

```go
func mapOpenCodeError(body []byte) error {
    var errResp struct {
        _tag string `json:"_tag"`
        error string `json:"error"`
    }
    json.Unmarshal(body, &errResp)
    switch errResp._tag {
    case "RateLimit":
        return ErrRateLimit{...}
    case "Authentication":
        return ErrAuth{...}
    case "Transport":
        return ErrTransport{...}
    // ... etc
    }
}
```

**Workaround 3 -- 16 LLMEvent types vs AgentHub's 11**: OpenCode's LLMEvent model (16 types) is more granular than AgentHub's 11 AgentEvent types. The mapping should:
- Collapse `StepStart/StepFinish/Finish` into lifecycle events
- Map `TextStart/TextDelta/TextEnd` to `assistant_text` with appropriate Phase
- Collapse `ReasoningStart/Delta/End` into `reasoning`
- Map `ToolInputStart/Delta/End/ToolCall/ToolResult/ToolError` into `tool_call` + `tool_result`

**Workaround 4 -- Agent Info hardcoding vs. dynamic generation**: OpenCode has 8 hardcoded agents (build, plan, general, explore, scout, compaction, title, summary). The adapter should enumerate these as available sub-agents and expose them in `SubAgentDef[]` within `system_init`. When OpenCode's `Agent.generate()` is used (dynamic generation), the adapter must track the generated agent's lifecycle.

**Workaround 5 -- permission model is agent-level, not per-tool-rule**: OpenCode's permissions are defined per-agent (ruleset: allow/deny patterns), not as a global rule engine like CC. The adapter must translate AgentHub's `PermissionMode` + `AllowedTools/DeniedTools` into a custom agent with the appropriate ruleset, or call via the `permission.ask` plugin hook.

**Workaround 6 -- SQLite session persistence**: OpenCode stores sessions in SQLite via Drizzle ORM. The adapter can read from this database directly for session listing and message retrieval, but must not write to it (OpenCode owns the schema).

**Workaround 7 -- OpenAPI SDK generation potential**: OpenCode ships an OpenAPI spec that generates 70+ typed methods. AgentHub could generate a Go client from the same spec for type-safe integration. However, this requires the OpenCode server to be running and accessible.

**Workaround 8 -- tool runtime concurrency**: OpenCode's `ToolRuntime` executes tools concurrently (default concurrency=10). Tool results may arrive out of order. The adapter should match results to calls via `ToolCallID`.

### 3.4 Kanna (Cross-Provider Wrapper Pattern)

**Note**: Kanna is not a separate Agent CLI but a wrapper that manages both Claude Code and Codex sessions through a unified AgentCoordinator. It is included in this analysis because its architecture directly informs AgentHub's adapter design.

**Key patterns AgentHub should adopt from Kanna:**

1. **TranscriptEntry normalization**: Kanna converts both CC's NDJSON messages AND Codex's TurnItems into a single `TranscriptEntry` union type. AgentHub's `AgentEvent` type serves the same purpose.

2. **writeChain serialization**: Kanna's JSONL append uses `writeChain: Promise.resolve().then(...)` to serialize all writes. AgentHub's Go implementation can use a channel-based write queue or `sync.Mutex` for the same effect.

3. **16ms debounce broadcast**: For WebSocket-based UI delivery, batch events within a 16ms window to avoid flooding clients with per-event push. This is a UI-layer concern, not an adapter concern.

4. **Snapshot compaction threshold (2MB)**: When JSONL log files exceed 2MB total, compact to a single `snapshot.json`. AgentHub should adopt a similar threshold or make it configurable.

5. **Tool gating pattern**: Kanna gates only `AskUserQuestion` and `ExitPlanMode` (pauses stream, waits for user response). All other tools are auto-allowed. AgentHub's `PermissionBroker` interface generalizes this to any tool.

6. **Steer mode**: Kanna's steer mechanism cancels the current turn and restarts with a steered prefix. AgentHub's `InteractiveControl.SendSteer()` generalizes this with an explicit `ReplaceLast` flag.

7. **Draining indicator**: After the result event, the underlying agent may still run background tasks (compaction, tool cleanup). Kanna tracks this with `drainingStreams` Map and UI indicator. AgentHub should expose `InteractiveControl.Drain()` for the same purpose.

---

## 4. Event Mapping Reference

### 4.1 Native-to-Unified Event Mapping

| AgentHub AgentEvent | Claude Code NDJSON | Codex TurnItem | OpenCode LLMEvent | Kanna TranscriptEntry |
|---|---|---|---|---|
| `system_init` | `system_init` | (assembled from session start context) | (assembled from agent Info + tools) | `system_init` |
| `assistant_text` | `assistant` (content_block: text) | `AgentMessage` (phase=Stream/End) | `TextStart/Delta/End` | `assistant_text` |
| `reasoning` | `assistant` (content_block: thinking) | `Reasoning` | `ReasoningStart/Delta/End` | (stored but stripped) |
| `tool_call` | `assistant` (content_block: tool_use) | `McpToolCall` (InProgress) | `ToolInputStart/Delta/End` + `ToolCall` | `tool_call` |
| `tool_result` | `user` (type: tool_result) | `McpToolCall` (Completed/Failed) | `ToolResult` / `ToolError` | `tool_result` |
| `tool_progress` | `progress` | (N/A -- implicit) | (N/A -- implicit) | (N/A) |
| `result` | `result` | `Completed` (final only) | `Finish` | `result` |
| `system` (compact) | `system` (subtype: compact_boundary) | `ContextCompaction` | (via hook) | `compact_summary` |
| `system` (retry) | `system` (subtype: api_retry) | (N/A -- internal retry) | (N/A -- RouteExecutor retry) | (N/A) |
| `stream_event` | `stream_event` (partial) | `OutputTextDelta` | `TextDelta` | (normalized away) |
| `status_change` | `system` (subtype: status) | (N/A) | (N/A) | `status` |
| `approval_request` | (via control protocol) | (via Guardian) | (via permission.ask hook) | `ask_user_question` / `exit_plan_mode` |
| `tool_use_summary` | `tool_use_summary` | (N/A) | (N/A) | (rendered inline) |
| `user_replay` | `user` (isReplay: true) | `UserMessage` | (N/A) | (N/A) |

### 4.2 Tool Name Normalization

All four systems support MCP tools with the `mcp__<server>__<tool>` naming convention. AgentHub should adopt this as the canonical format.

| Source | Format | Example |
|---|---|---|
| CC built-in | `ToolName` | `Bash`, `Read`, `Write`, `Glob`, `Grep`, `WebFetch`, `WebSearch` |
| CC MCP | `mcp__<server>__<tool>` | `mcp__github__search_repos` |
| Codex built-in | `shell_command`, `exec_command`, `apply_patch`, etc. | `shell_command` |
| Codex MCP | `mcp__<server>__<tool>` | `mcp__github__search_repos` |
| OpenCode built-in | ASCII tool names | `grep`, `glob`, `read`, `bash`, `write`, `edit` |
| OpenCode MCP | MCP-tool name (no prefix, deduped by server) | `search_repos` (from github server) |

**Action**: AgentHub should normalize all MCP tools to `mcp__<server>__<tool>` format (CC/Codex convention) for consistency.

---

## 5. Next Steps for AgentHub

### Immediate (P0)

1. **Implement ClaudeCodeAdapter first** -- The NDJSON protocol is the most mature, publicly defined, and well-documented. It is the lowest-risk adapter to build against.

2. **Build EventStream infrastructure** -- The `AgentEvent` channel + `EventStream` wrapper is shared across all adapters. Implement the consumer side (channel reader, error propagation, cancellation) once.

3. **Define transport abstraction** -- `Start()` in the core interface abstracts over subprocess execution (CC/Codex) and HTTP connection (OpenCode). The transport layer should be a separate concern behind the adapter.

### Short-term (P1)

4. **Implement CodexAdapter with rollout replay** -- Accept that true streaming from Codex requires rollout trace parsing. Build the `parseRolloutItems()` pipeline.

5. **Build PermissionBroker integration** -- Wire CC's stdin control protocol `can_use_tool` to AgentHub's approval engine. This is the critical path for safe tool execution.

6. **Implement OpenCodeAdapter** -- Requires OpenCode server lifecycle management. Lower priority than CC because OpenCode's architecture (Effect runtime, SQLite persistence) is more complex to integrate with Go.

### Future (P2)

7. **Multi-agent tree support** -- Codex's agent tree and OpenCode's parent-child session tree need AgentHub Thread model extensions.

8. **OpenAPI-first SDK generation** -- Generate Go client from OpenCode's OpenAPI spec for type-safe HTTP integration.

9. **Tool Registry unification** -- Build a shared tool registry that translates between CC/Codex/OpenCode tool names so AgentHub users see consistent tool names regardless of backend.

---

*Analysis complete. 2026-05-21.*
