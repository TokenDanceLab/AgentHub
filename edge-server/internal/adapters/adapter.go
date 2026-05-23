// Package adapters provides the unified AgentAdapter interface and registry
// for integrating external Agent CLIs (Claude Code, Codex, OpenCode) into
// the Edge Server's run lifecycle.
package adapters

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

// --- Unified event types emitted by all adapters ---

// Bus event type strings (prefixed with "run.").
const (
	BusEventTextDelta           = "run.agent.text_delta"
	BusEventTextBlock           = "run.agent.text_block"
	BusEventThinking            = "run.agent.thinking"
	BusEventToolCall            = "run.agent.tool_call"
	BusEventToolResult          = "run.agent.tool_result"
	BusEventFileChange          = "run.agent.file_change"
	BusEventSessionInit         = "run.agent.session_init"
	BusEventResult              = "run.agent.result"
	BusEventCompactBoundary     = "run.agent.compact_boundary"
	BusEventStatusChange        = "run.agent.status_change"
	BusEventAPIRetry            = "run.agent.api_retry"
	BusEventTaskStarted         = "run.agent.task_started"
	BusEventTaskProgress        = "run.agent.task_progress"
	BusEventTaskNotification    = "run.agent.task_notification"
	BusEventSessionStateChanged = "run.agent.session_state_changed"
	BusEventHookStarted         = "run.agent.hook_started"
	BusEventHookProgress        = "run.agent.hook_progress"
	BusEventHookResponse        = "run.agent.hook_response"
	BusEventToolUseSummary      = "run.agent.tool_use_summary"
	BusEventAuthStatus          = "run.agent.auth_status"
	BusEventRateLimit           = "run.agent.rate_limit"

	// Permission gating events
	BusEventPermissionRequested = "run.agent.permission_requested"
	BusEventPermissionDecided   = "run.agent.permission_decided"
)

// Context keys for adapter-level context propagation.
type ctxKey string

// CtxSessionID is used to pass the session ID through context to adapters
// so the permission handler can include it in permission events.
const CtxSessionID ctxKey = "agenthub-session-id"
