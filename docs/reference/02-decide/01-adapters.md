# 交叉分析：统一 Agent 适配器接口

> 生成日期：2026-05-21
> 数据来源：claude-code-sdk.md, codex-cli.md, kanna.md, opencode.md
> AgentHub 上下文：architecture.md, data-model.md, authority.md

## 1. 四维度对比表

### 1.1 启动与进程模型

| 维度 | Claude Code SDK | Codex CLI | OpenCode | Kanna (wrapper) |
|---|---|---|---|---|
| **二进制** | `claude` (Node.js/bun) | `codex` (Rust) | `opencode` (Bun) | Bun HTTP server 包装 CC/Codex |
| **非交互模式** | `-p "prompt" --output-format stream-json --verbose` | `codex exec "prompt"` (纯文本输出) | HTTP REST: `POST /session` + SSE stream | 内部调用: agent.send() |
| **流协议** | NDJSON（公开，约 13 种消息类型） | 内部 ResponseEvent/TurnItem（不可公开消费） | SSE: LLMEvent 16 种 tagged union | 统一 TranscriptEntry（服务端归一化） |
| **嵌入模式** | QueryEngine 作为库（TS import） | Rollout trace 回放（只读历史） | OpenCode Client SDK（HTTP + SSE） | 不适用（自身即 wrapper） |
| **配置** | `.mcp.json` + `settings.json` (JSON) | `config.toml` + CLI `-c key=value` | `opencode.toml` | 按 chat 设置 provider/model/effort |
| **语言** | TypeScript | Rust | TypeScript（Effect runtime） | TypeScript |

### 1.2 流输出格式

| 维度 | Claude Code | Codex | OpenCode | Kanna |
|---|---|---|---|---|
| **传输** | stdout NDJSON（每行一个 JSON 对象） | TUI 内部事件管道（无公开流） | HTTP SSE（Server-Sent Events） | WebSocket JSON 快照（16ms 去抖） |
| **顶层消息类型** | `system_init`, `assistant`, `user` (tool_result), `stream_event`, `result`, `tool_use_summary` | `OutputItemAdded`, `OutputTextDelta`, `Completed`, `ReasoningTextDelta` | `StepStart`, `TextStart/Delta/End`, `ToolInputStart/Delta/End`, `ToolCall`, `StepFinish`, `Finish` | `TranscriptEntry` union: `system_init`, `assistant_text`, `tool_call`, `tool_result`, `result`, `status` |
| **工具调用编码** | `assistant` 消息带 `content: [{type:"tool_use",...}]` 块 | `ResponseItem::FunctionCall` → 分派到 tool handler | `ToolCall` 事件带 codec 校验 | `tool_call` TranscriptEntry 带规范化字段 |
| **思考/推理** | `thinking` content block 在 `assistant` 消息内 | `ReasoningTextDelta` 流事件 | `ReasoningStart/Delta/End` 流事件 | 存储在 transcript 中，精简输出时剥离 |
| **完成信号** | `result` 消息（`subtype: "success"`, `is_error: bool`, exit code `0\|1`） | `Completed { response_id, token_usage, end_turn }` | `Finish` 事件带 stop reason | transcript 中的 `result` 条目 |
| **外部可消费性** | 是（公开协议） | 否（仅内部使用） | 是（SSE + SDK） | 是（WebSocket 协议） |

### 1.3 权限与审批模型

| 维度 | Claude Code | Codex | OpenCode | Kanna |
|---|---|---|---|---|
| **模式系统** | 6 种模式：`default`, `acceptEdits`, `bypassPermissions`, `plan`, `auto`, `dontAsk` | Sandbox 模式：`Disabled`, `Managed`（file_system + network） | Agent 级 ruleset：按工具 allow/deny 带 GLOB 模式 | 委托给底层 agent + 添加工具级门控 |
| **规则粒度** | 按工具 + 可选内容匹配：`"Bash(git *)"` | 按路径 FileSystemAccessMode：`ReadOnly`/`ReadWrite` | 按 agent 工具 allow/deny 列表，支持 `*` 通配符 | 工具级：仅门控 `AskUserQuestion` 和 `ExitPlanMode` |
| **规则来源** | 9 个来源带优先级：user, project, local, enterprise, managed, cliArg, command, session, hooks | config.toml 静态配置 | Agent Info + 用户 TOML 覆盖 | 静态配置，无多来源优先级 |
| **Hook 集成** | `PreToolUse`, `PostToolUse`, `PermissionRequest`, `PermissionDenied`（共 28 hooks） | `run_permission_request_hooks()` 在 ToolOrchestrator 中 | `permission.ask` plugin hook | 不适用（委托） |
| **沙箱** | Bash-only sandbox（CLI flag） | OS 级：macOS Seatbelt, Linux Landlock, Windows Restricted Token + WFP | 无 | 委托给底层 |
| **守护/审查者** | 无 | Guardian 系统用于高风险 shell 命令 + `ApprovalsReviewer` 角色 | 无（使用 ruleset + hook） | 不适用 |
| **升级** | Denial tracking 带阈值回退 | Sandbox 升级失败时：宽松 → 严格重试 | 无 | 不适用 |

### 1.4 Session / 会话管理

| 维度 | Claude Code | Codex | OpenCode | Kanna |
|---|---|---|---|---|
| **会话标识符** | `session_id`（UUID 字符串） | `SessionId`（共享）+ `ThreadId`（per agent）UUID 对 | `SessionID` branded string `"ses_..."` + parent_id 树 | `chatId`（UUID）+ sessionToken（来自 SDK） |
| **会话复用** | `resumeSession(sessionId)` | `codex resume --last`（选择器）+ rollout 恢复 | SQLite 支持，显式 fork/abort/summarize API | 自动：复用 sessionToken，检测 model/planMode 变更 |
| **Fork** | `forkSession()` SDK 函数：从已有 session 创建分支 | `Fork` 带 `FullHistory` 或 `LastNTurns(n)` 模式 | Fork 带 `parent_id` 引用在 SQLite 中 | 复制 transcript JSONL + 设置 `pendingForkSessionToken` + 原生 `forkSession` flag |
| **持久化** | JSONL `~/.claude/sessions/<id>.jsonl` | Rollout 文件在 `$CODEX_HOME/state/` + thread-store DB | SQLite（`SessionTable` + `PartTable` 通过 Drizzle ORM） | JSONL `transcripts/<chatId>.jsonl` + snapshot.json 压缩 |
| **多 Agent 树** | Subagent 通过 AgentTool（forkSubagent），扁平层级 | Agent tree：`AgentPath`（/root/child/grandchild），`AgentRegistry` 追踪 | 父子 session 树通过 `parent_id` | 不适用（包装单 agent 会话） |
| **上下文压缩** | `compact_boundary` system message | `ContextCompaction` TurnItem | `experimental.session.compacting` + `experimental.compaction.autocontinue` hooks | 继承自底层 agent |
| **消息队列** | 不适用（单次 API 调用） | SQ/EQ 模式（Submission Queue / Event Queue） | 不适用 | `queuedMessagesByChatId` Map + Steer 模式（mid-turn 消息注入） |

---

## 2. AgentHub 统一适配器接口（Go）

### 2.1 设计原则

1. **Provider 无关**：接口必须统一抽象子进程（CC/Codex）和 HTTP（OpenCode）两种传输方式。
2. **公共核心 + 扩展**：每个适配器实现基础接口；agent 特有功能通过 capability flag 和可选扩展接口暴露。
3. **事件驱动流**：所有适配器产生统一的 `AgentEvent` 流，无论内部事件编码方式如何。
4. **Turn 级生命周期**：适配器拥有单个 Turn 的完整生命周期（start → stream → result/failure → drain）。
5. **权限桥接**：AgentHub 的审批系统在工具执行前拦截工具调用，无论是通过 hook（CC）、sandbox rule（Codex）还是 callback（Kanna/OpenCode）。

### 2.2 核心接口

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

### 2.3 接口覆盖矩阵

| 适配器功能 | CC 使用 | Codex 使用 | OpenCode 使用 | Kanna 使用 | 核心接口中 |
|---|---|---|---|---|---|
| `Start()` | query()/prompt() | codex exec / TUI | POST /session | agent.send() | 是 |
| `Resume()` | resumeSession() | codex resume | session resume | sessionToken reuse | 是 |
| `AttachStream()` | NDJSON consumer | RolloutItem replay | SSE consumer | TranscriptEntry push | 是 |
| `ForkSession()` | forkSession() | fork + agent tree | Fork via SQLite | Copy JSONL + fork flag | 扩展: `SessionManager` |
| `ListSessions()` | listSessions() | list from state DB | Query SQLite | chatsById Map | 扩展: `SessionManager` |
| `Cancel()` | AbortController | Shutdown Op | Abort session | agent.cancel() | 扩展: `InteractiveControl` |
| `SendSteer()` | prependUserMessage() | Op::Interrupt + re-prompt | 不适用 | message.steer | 扩展: `InteractiveControl` |
| Permission callback | canUseTool() hook + PreToolUse hooks | run_permission_request_hooks | permission.ask hook | Tool gating callback | 扩展: `PermissionBroker` |
| MCP 集成 | MCP tools merged | MCP name-spaced tools | MCP → AI SDK Tool convert | Built into session | 通过 `StartRequest.MCPConfig` |
| Thinking 配置 | thinkingConfig | reasoning effort | Per-agent temperature/topP | Per-chat controls | `StartRequest.Thinking` |
| Compaction | auto + manual compact_boundary | ContextCompaction TurnItem | session.compacting hook | Inherited | 仅 capability flag |

---

## 3. 各 Agent 特殊处理与变通方案

### 3.1 Claude Code Adapter

**子进程模式（AgentHub P0 推荐）：**

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

**变通方案 1 —— stdout guard 干扰**：在 `stream-json` 模式下，CC 安装了一个 `streamJsonStdoutGuard`，将所有非 JSON 的 stdout 重定向到 stderr 并加 `[stdout-guard]` 前缀。适配器必须仅解析 stdout 的 NDJSON，并将 stderr 单独收集用于日志。

**变通方案 2 —— exit code 解读**：exit code 不足以判断成功。必须检查最后一行 NDJSON 中的 `result.is_error`。exit code 0 仍可能在 `result.errors[]` 中包含错误。

**变通方案 3 —— verbose flag 是获取完整事件的必要条件**：不加 `--verbose` 时只输出 `result` 消息。适配器应在为 AgentHub 服务时断言或默认使用 `--verbose`。

**变通方案 4 —— MCP 启动延迟**：MCP server 连接是异步的。`system_init` 事件的工具列表在第一个 Turn 可能不完整。后续 Turn 在 `refreshTools` 完成后会有完整列表。

**变通方案 5 —— headless 模式下的 permission mode bypass**：在子进程模式下，即使没有 TTY，权限检查仍会触发。使用 `--permission-mode bypassPermissions` 来抑制。或者实现 stdin 控制协议的 `can_use_tool` request/response 循环来实现细粒度审批。

**变通方案 6 —— thinking content 可见性**：Thinking blocks 仅在 `thinkingConfig.type` 为 `"enabled"`（而非 `"adaptive"`）时出现在流事件中。设置 `Thinking.Type = "enabled"` 以在 AgentHub 中暴露推理内容。

**变通方案 7 —— streaming tool execution 可能重排事件**：当 `streamingToolExecution` GrowthBook gate 激活时，工具可能在 API streaming 期间执行，产生交错的 `tool_use` 和 `assistant` delta 事件。事件消费者必须能处理乱序的 tool call/result 对。

**变通方案 8 —— plan mode 切换时的 shallow fork**：当 mid-turn 从 `plan` 切换到 `default` permission mode 时，CC 内部进行 fork。适配器应检测 permission mode 变更的 `system/status` 事件并记录 fork 边界。

### 3.2 Codex Adapter

**主要方式：Exec 模式 + Rollout Trace 回放**

由于 Codex 没有公开的流协议，适配器采用两阶段方式：
1. 通过 `codex exec <prompt>` 执行 —— 获取最终输出
2. 从 `$CODEX_HOME/state/` 读取 rollout trace 获取完整事件序列

**变通方案 1 —— exec 没有流式输出**：`codex exec` 只返回最终文本。要提供类似流式的体验，适配器必须从 rollout 文件读取 `RolloutItem` 条目并将其作为 `AgentEvent` 序列回放。这是事后回放，不是真正的实时流。

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

**变通方案 2 —— SessionId + ThreadId 双重性**：Codex 在 agent 树中使用共享的 `SessionId`，每个 agent 有独立的 `ThreadId`。适配器必须将此树映射到 AgentHub 的扁平 session 模型：
- 将 `SessionId` 映射到 AgentHub 的 `sessionID`
- 将每个 `ThreadId` 映射到独立的 AgentHub `Turn`
- 在 AgentHub 的 Thread 模型中维护父子关系

**变通方案 3 —— Agent tree 事件不是单一流**：多 agent 操作（spawn/wait/close）在多个 thread 流中产生事件。适配器必须：
- 将所有 agent 事件展平为单一合并流（丢失树拓扑），或
- 将每个 agent 的 thread 作为独立的子流暴露（需要 AgentHub 理解 agent 层级）

**变通方案 4 —— config.toml 生成**：Codex 要求 `$CODEX_HOME/config.toml` 在运行前存在。适配器必须从 `StartRequest.MCPConfig` 和 `StartRequest.Model` 自动生成此文件：

```toml
[model_providers.openai]
api_key = "sk-..."

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
```

**变通方案 5 —— OAuth MCP 需要浏览器交互**：Codex 的 MCP OAuth 流程可能打开浏览器进行认证。在 headless AgentHub 环境中这将失败。禁用 OAuth MCP server 或使用预认证连接。

**变通方案 6 —— apply 命令处理 diff**：Codex 生成文件变更但不会在 exec 模式下自动应用。使用 `codex apply`（别名 `codex a`）作为 exec 后步骤来落实 diff。

**变通方案 7 —— Fork 模式语义与 CC 不同**：`ForkMode.FullHistory` 将完整父 transcript 作为初始上下文（大量 token 消耗）。推荐 AgentHub 使用 `ForkMode.LastNTurns(n)`，除非明确需要保留完整历史。

**变通方案 8 —— sandbox 与工具的交互**：当 `SandboxConfig.Enabled` 为 true 时，MCP 工具和 shell 命令在 OS sandbox 约束内运行。工具结果可能以 sandbox 错误而非工具特定错误返回。适配器应拦截并区分 sandbox-denial 和 tool-failure。

### 3.3 OpenCode Adapter

**主要方式：基于 Hono server 的 HTTP client**

OpenCode 运行本地 HTTP server（默认端口 4096）。适配器通过 REST + SSE 通信。

```go
// Start OpenCode session
url := fmt.Sprintf("http://localhost:%d", opencodePort)
resp, err := http.Post(url+"/api/session", "application/json", body)

// Consume SSE stream
req, _ := http.NewRequest("GET", url+"/api/session/"+sessionID+"/events", nil)
req.Header.Set("Accept", "text/event-stream")
resp, err := client.Do(req)
```

**变通方案 1 —— server 生命周期管理**：适配器必须：
- 在发起 HTTP 调用前以后台进程方式启动 `opencode`
- 或连接到已在运行的实例

推荐：以子进程方式启动 `opencode`，等待 health check（轮询 `GET /health`），然后发送请求。除非共享，否则在 session 关闭时停止。

**变通方案 2 —— Effect runtime 错误处理**：OpenCode 对所有 I/O 使用 Effect。错误被包装在 Effect 的 `Cause` 类型中，而非标准 Go error。适配器应捕获 HTTP 错误响应，并从 OpenCode 的 10 变体 `LLMErrorReason` discriminated union 中映射 `_tag` 字段：

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

**变通方案 3 —— 16 种 LLMEvent 类型 vs AgentHub 的 11 种**：OpenCode 的 LLMEvent 模型（16 种类型）比 AgentHub 的 11 种 AgentEvent 类型更细粒度。映射应：
- 将 `StepStart/StepFinish/Finish` 折叠为生命周期事件
- 将 `TextStart/TextDelta/TextEnd` 映射到带适当 Phase 的 `assistant_text`
- 将 `ReasoningStart/Delta/End` 折叠为 `reasoning`
- 将 `ToolInputStart/Delta/End/ToolCall/ToolResult/ToolError` 映射到 `tool_call` + `tool_result`

**变通方案 4 —— Agent Info 硬编码 vs 动态生成**：OpenCode 有 8 个硬编码 agent（build, plan, general, explore, scout, compaction, title, summary）。适配器应枚举这些作为可用 sub-agent，并在 `system_init` 中以 `SubAgentDef[]` 暴露。当 OpenCode 的 `Agent.generate()` 用于动态生成时，适配器必须追踪生成 agent 的生命周期。

**变通方案 5 —— permission model 是 agent 级而非 per-tool-rule**：OpenCode 的权限按 agent 定义（ruleset: allow/deny patterns），而非像 CC 那样的全局规则引擎。适配器必须将 AgentHub 的 `PermissionMode` + `AllowedTools/DeniedTools` 翻译为带适当 ruleset 的自定义 agent，或通过 `permission.ask` plugin hook 调用。

**变通方案 6 —— SQLite session 持久化**：OpenCode 通过 Drizzle ORM 将 session 存储在 SQLite 中。适配器可直接从此数据库读取 session 列表和消息检索，但不得写入（OpenCode 拥有 schema）。

**变通方案 7 —— OpenAPI SDK 生成潜力**：OpenCode 内含一个 OpenAPI spec，可生成 70+ 个类型化方法。AgentHub 可从同一 spec 生成 Go client 以实现类型安全集成。但这要求 OpenCode server 正在运行且可访问。

**变通方案 8 —— tool runtime 并发**：OpenCode 的 `ToolRuntime` 并发执行工具（默认 concurrency=10）。工具结果可能无序到达。适配器应通过 `ToolCallID` 匹配结果和调用。

### 3.4 Kanna（跨 Provider Wrapper 模式）

**注意**：Kanna 不是独立的 Agent CLI，而是一个通过统一 AgentCoordinator 管理 Claude Code 和 Codex session 的 wrapper。它被纳入本分析是因为其架构直接启发 AgentHub 的适配器设计。

**AgentHub 应从 Kanna 采纳的关键模式：**

1. **TranscriptEntry 归一化**：Kanna 将 CC 的 NDJSON 消息和 Codex 的 TurnItem 统一转换为单一 `TranscriptEntry` union 类型。AgentHub 的 `AgentEvent` 类型服务于相同目的。

2. **writeChain 序列化**：Kanna 的 JSONL 追加使用 `writeChain: Promise.resolve().then(...)` 序列化所有写入。AgentHub 的 Go 实现可使用 channel-based write queue 或 `sync.Mutex` 达到相同效果。

3. **16ms 去抖广播**：对于基于 WebSocket 的 UI 交付，在 16ms 窗口内批处理事件，避免对每个事件都推送导致客户端过载。这是 UI 层面关注点，不是适配器层面关注点。

4. **Snapshot 压缩阈值（2MB）**：当 JSONL 日志文件总计超过 2MB 时，压缩为单个 `snapshot.json`。AgentHub 应采用类似阈值或使其可配置。

5. **工具门控模式**：Kanna 仅门控 `AskUserQuestion` 和 `ExitPlanMode`（暂停流，等待用户响应）。其他所有工具自动允许。AgentHub 的 `PermissionBroker` 接口将此泛化到任意工具。

6. **Steer 模式**：Kanna 的 steer 机制取消当前 turn 并以 steered 前缀重启。AgentHub 的 `InteractiveControl.SendSteer()` 通过显式 `ReplaceLast` flag 泛化此功能。

7. **Draining 指示器**：在 result 事件之后，底层 agent 可能仍在运行后台任务（compaction、工具清理）。Kanna 通过 `drainingStreams` Map 和 UI 指示器追踪此状态。AgentHub 应为相同目的暴露 `InteractiveControl.Drain()`。

---

## 4. 事件映射参考

### 4.1 原生到统一事件映射

| AgentHub AgentEvent | Claude Code NDJSON | Codex TurnItem | OpenCode LLMEvent | Kanna TranscriptEntry |
|---|---|---|---|---|
| `system_init` | `system_init` | （从 session start context 组装） | （从 agent Info + tools 组装） | `system_init` |
| `assistant_text` | `assistant` (content_block: text) | `AgentMessage` (phase=Stream/End) | `TextStart/Delta/End` | `assistant_text` |
| `reasoning` | `assistant` (content_block: thinking) | `Reasoning` | `ReasoningStart/Delta/End` | （存储但剥离） |
| `tool_call` | `assistant` (content_block: tool_use) | `McpToolCall` (InProgress) | `ToolInputStart/Delta/End` + `ToolCall` | `tool_call` |
| `tool_result` | `user` (type: tool_result) | `McpToolCall` (Completed/Failed) | `ToolResult` / `ToolError` | `tool_result` |
| `tool_progress` | `progress` | （不适用——隐式） | （不适用——隐式） | （不适用） |
| `result` | `result` | `Completed`（仅最终） | `Finish` | `result` |
| `system` (compact) | `system` (subtype: compact_boundary) | `ContextCompaction` | （via hook） | `compact_summary` |
| `system` (retry) | `system` (subtype: api_retry) | （不适用——内部重试） | （不适用——RouteExecutor retry） | （不适用） |
| `stream_event` | `stream_event` (partial) | `OutputTextDelta` | `TextDelta` | （归一化掉） |
| `status_change` | `system` (subtype: status) | （不适用） | （不适用） | `status` |
| `approval_request` | （via control protocol） | （via Guardian） | （via permission.ask hook） | `ask_user_question` / `exit_plan_mode` |
| `tool_use_summary` | `tool_use_summary` | （不适用） | （不适用） | （内联渲染） |
| `user_replay` | `user` (isReplay: true) | `UserMessage` | （不适用） | （不适用） |

### 4.2 工具名称规范化

四个系统都支持 MCP 工具，采用 `mcp__<server>__<tool>` 命名约定。AgentHub 应将此采纳为规范格式。

| 来源 | 格式 | 示例 |
|---|---|---|
| CC 内置 | `ToolName` | `Bash`, `Read`, `Write`, `Glob`, `Grep`, `WebFetch`, `WebSearch` |
| CC MCP | `mcp__<server>__<tool>` | `mcp__github__search_repos` |
| Codex 内置 | `shell_command`, `exec_command`, `apply_patch`, 等 | `shell_command` |
| Codex MCP | `mcp__<server>__<tool>` | `mcp__github__search_repos` |
| OpenCode 内置 | ASCII 工具名 | `grep`, `glob`, `read`, `bash`, `write`, `edit` |
| OpenCode MCP | MCP-tool 名（无前缀，按 server 去重） | `search_repos`（来自 github server） |

**行动**：AgentHub 应将所有 MCP 工具规范化为 `mcp__<server>__<tool>` 格式（CC/Codex 约定）以保持一致性。

---

## 5. AgentHub 后续步骤

### 立即（P0）

1. **首先实现 ClaudeCodeAdapter** —— NDJSON 协议是最成熟、公开定义且文档完善的。这是风险最低的适配器构建目标。

2. **构建 EventStream 基础设施** —— `AgentEvent` channel + `EventStream` wrapper 跨所有适配器共享。一次性实现消费端（channel reader、错误传播、取消）。

3. **定义 transport 抽象** —— 核心接口中的 `Start()` 抽象了子进程执行（CC/Codex）和 HTTP 连接（OpenCode）。transport 层应是适配器背后的独立关注点。

### 短期（P1）

4. **实现 CodexAdapter 带 rollout 回放** —— 接受 Codex 的真实流需要 rollout trace 解析这一事实。构建 `parseRolloutItems()` 管道。

5. **构建 PermissionBroker 集成** —— 将 CC 的 stdin 控制协议 `can_use_tool` 接入 AgentHub 的审批引擎。这是安全工具执行的关键路径。

6. **实现 OpenCodeAdapter** —— 需要 OpenCode server 生命周期管理。优先级低于 CC，因为 OpenCode 的架构（Effect runtime、SQLite 持久化）与 Go 集成更复杂。

### 远期（P2）

7. **多 Agent 树支持** —— Codex 的 agent tree 和 OpenCode 的父子 session tree 需要 AgentHub Thread 模型扩展。

8. **OpenAPI-first SDK 生成** —— 从 OpenCode 的 OpenAPI spec 生成 Go client 实现类型安全的 HTTP 集成。

9. **Tool Registry 统一** —— 构建共享工具注册表，在 CC/Codex/OpenCode 工具名之间进行翻译，使 AgentHub 用户无论后端是什么都能看到一致的工具名。

---

*分析完成。2026-05-21。*
