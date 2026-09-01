// Package orchestration holds the neutral, side-effect-free contract types
// shared between the adapters root package and the orchestrator sub-domain
// (A-V1 Step 0, #1526; Step 2, #1566).
//
// Dependency direction: orchestration imports nothing from adapters;
// adapters (and the adapters/orchestrator leaf package) import this package.
// This keeps the orchestrator extraction import-cycle-free:
//
//	adapters/orchestrator → orchestration
//
// (never orchestration → adapters).
//
// The types below are the adapter-domain contract surface: the unified
// AgentAdapter interface, the emitter/spawner ports, and the event-type
// vocabulary. The adapters root package keeps type aliases for backward
// compatibility; the leaf package imports them directly.
package orchestration

import (
	"context"
	"io"

	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// RunProcessContext is an alias for the shared runnerctx.RunProcessContext.
type RunProcessContext = runnerctx.RunProcessContext

// AgentAdapter is the unified interface for all Agent CLI backends.
// Each implementation speaks a CLI's native protocol directly.
//
// The adapter does NOT manage its own subprocess lifecycle — it provides
// BuildCommand to ProcessExecutor (which handles start/wait/cancel), and
// ParseStream to interpret structured output from the already-running process.
type AgentAdapter interface {
	// Metadata returns static information about this adapter.
	Metadata() AdapterMetadata

	// Capabilities returns the feature set this adapter supports.
	Capabilities() AgentCapabilities

	// BuildCommand builds the exec.Cmd arguments for a given run.
	BuildCommand(ctx RunProcessContext) (cmdPath string, args []string, env []string, workDir string)

	// ParseStream reads from the CLI's stdout and emits structured events.
	// It returns when the stream ends or ctx is cancelled.
	// stdin is provided for protocols that require bidirectional communication.
	ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error

	// NeedsStdin reports whether this adapter requires a writable stdin pipe
	// for bidirectional communication (e.g. control protocol, permission responses).
	// When false, the process executor will NOT open stdin, avoiding deadlocks
	// with CLIs that block on stdin read when a pipe is attached.
	NeedsStdin() bool

	// Available reports whether the adapter's CLI binary is executable.
	// When the binary does not exist or is not runnable, this returns false
	// and the adapter should be reported as unavailable in health/agent listings.
	// #177: check binary at startup, report unavailable if missing.
	Available() bool
}

// EventEmitter abstracts the event bus so adapters don't couple to it directly.
type EventEmitter interface {
	Emit(eventType string, scope map[string]any, payload any)
}

// AdapterMetadata holds static adapter identification.
type AdapterMetadata struct {
	ID          string // "claude-code", "codex", "opencode", "orchestrator"
	Name        string // Display name
	Version     string // CLI version if detected
	Description string // Human-readable
}

// AgentCapabilities describes what an agent adapter can do.
type AgentCapabilities struct {
	Streaming       bool
	ToolCalls       bool
	FileChanges     bool
	PermissionHooks bool
	ThinkingVisible bool
	MultiTurn       bool
	MCPIntegration  bool
	SubAgentSpawn   bool
}

// SubAgentTask describes a sub-agent task to be dispatched by the orchestrator.
// Reference: docs/reference/cross-comparison/03-orchestration.md Layer 3 (Supervisor routing).
type SubAgentTask struct {
	TaskID      string `json:"taskId"`
	Description string `json:"description"`
	AgentID     string `json:"agentId"` // target agent adapter ID
	Prompt      string `json:"prompt"`  // task prompt for the sub-agent
	Depth       int    `json:"depth"`   // delegation depth (root=0)
	ParentRunID string `json:"parentRunId"`
	ThreadID    string `json:"threadId,omitempty"` // inherited from parent run
	Model       string `json:"model,omitempty"`    // model override propagated from parent context

	// Budget carries the context budget from the parent orchestrator to the
	// child sub-agent. When nil, the sub-agent runs without budget tracking.
	Budget *runnerctx.ContextBudget `json:"-"`

	// SiblingAgents carries information about other sub-agents dispatched in
	// the same parallel batch. Each sub-agent receives this context so it can
	// avoid modifying files that other agents are working on. This prevents
	// file conflicts when multiple agents run concurrently in the same workspace.
	SiblingAgents []SiblingInfo `json:"siblingAgents,omitempty"`
}

// SiblingInfo describes a sibling sub-agent for parallel coordination.
// When multiple sub-agents are dispatched together, each receives a list
// of its siblings so it can avoid modifying overlapping files.
type SiblingInfo struct {
	AgentName   string   `json:"agentName"`             // display name or adapter ID
	TaskDesc    string   `json:"taskDesc"`              // human-readable task description
	TargetFiles []string `json:"targetFiles,omitempty"` // files this agent is expected to modify
}

// SubAgentSpawner is implemented by the lifecycle layer to create new runs for
// sub-agents dispatched by the orchestrator. The orchestrator adapter calls this
// when it detects a task_dispatched event in the NDJSON stream.
// This enables the AgentTree pattern from Codex CLI.
type SubAgentSpawner interface {
	SpawnSubAgent(run store.Run, task SubAgentTask) (agentInstanceID string, runID string, err error)
}

// --- Unified event types emitted by all adapters ---

// Bus event type strings (prefixed with "run.").
const (
	BusEventTextDelta           = "run.agent.text_delta"
	BusEventTextBlock           = "run.agent.text_block"
	BusEventThinking            = "run.agent.thinking"
	BusEventToolCall            = "run.agent.tool_call"
	BusEventToolResult          = "run.agent.tool_result"
	BusEventFileChange          = "run.agent.file_change"
	BusEventRouteDecision       = "run.agent.route_decision"
	BusEventSessionInit         = "run.agent.session_init"
	BusEventResult              = "run.agent.result"
	BusEventCompactBoundary     = "run.agent.compact_boundary"
	BusEventStatusChange        = "run.agent.status_change"
	BusEventAPIRetry            = "run.agent.api_retry"
	BusEventTaskStarted         = "run.agent.task_started"
	BusEventTaskDispatched      = "run.agent.task_dispatched"
	BusEventTaskProgress        = "run.agent.task_progress"
	BusEventTaskNotification    = "run.agent.task_notification"
	BusEventSubAgentStatus      = "run.agent.sub_agent_status"
	BusEventSessionStateChanged = "run.agent.session_state_changed"
	BusEventHookStarted         = "run.agent.hook_started"
	BusEventHookProgress        = "run.agent.hook_progress"
	BusEventHookResponse        = "run.agent.hook_response"
	BusEventToolUseSummary      = "run.agent.tool_use_summary"
	BusEventAuthStatus          = "run.agent.auth_status"
	BusEventRateLimit           = "run.agent.rate_limit"
	BusEventCLIInvocationPlan   = "run.agent.cli_invocation_plan"

	// MCP-specific tool call event. Emitted when a tool call originates from an MCP
	// server (rather than a built-in tool like Bash or Read). Downstream consumers
	// can distinguish MCP tool activity from native tool activity by subscribing to
	// this event type instead of the generic BusEventToolCall.
	BusEventMCPToolCall = "run.agent.mcp_tool_call"

	// Permission gating events
	BusEventPermissionRequested = "run.agent.permission_requested"
	BusEventPermissionDecided   = "run.agent.permission_decided"
	BusEventSessionMetrics      = "run.agent.session_metrics"
	BusEventContextUsage        = "run.agent.context_usage"
	BusEventContextWarning      = "run.agent.context_warning"
	BusEventContextCompaction   = "run.agent.context_compaction"

	// Plan approval gate events (P0 #3: Plan confirmation gate)
	BusEventPlanProposed = "run.agent.plan_proposed"
	BusEventPlanApproved = "run.agent.plan_approved"
	BusEventPlanRejected = "run.agent.plan_rejected"
	BusEventPlanExpired  = "run.agent.plan_expired"

	// Tool allowlist enforcement events (Edge runtime)
	BusEventToolRejected = "run.agent.tool_rejected"

	// Sub-agent aggregation / dispatch outcome events (ResultAggregator,
	// lifecycle/result_aggregator.go). The named constants centralize the
	// literals currently published as raw strings in result_aggregator.go
	// (Wave 2 adds them; Wave 3 will replace the raw publish call sites to
	// reference these names). events.md / event_contract_test.go already
	// treat these strings as the contract, so the values are frozen.
	BusEventTaskDispatchFailed = "run.agent.task_dispatch_failed"
	BusEventSubAgentsComplete  = "run.agent.sub_agents_complete"
)

// CtxBudgetKey is the context key for passing a *runnerctx.ContextBudget
// through ParseStream call chains. The orchestrator and the NDJSON/stream
// parsers read the budget from the context when provided.
type ctxKey string

// CtxBudgetKey is the context key for a *runnerctx.ContextBudget.
const CtxBudgetKey ctxKey = "agenthub-budget"

// CtxModelKey is the context key for the per-run model override (string).
// The lifecycle executor injects it into the parser context so adapters
// (orchestrator) read the model of their own run instead of shared state.
const CtxModelKey ctxKey = "agenthub-model"
