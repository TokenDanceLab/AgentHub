// Package adapters provides the unified AgentAdapter interface and registry
// for integrating external Agent CLIs (Claude Code, Codex, OpenCode) into
// the Edge Server's run lifecycle.
package adapters

import (
	"context"
	"io"

	"github.com/agenthub/edge-server/internal/store"
)

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
	// Placeholders in args and env are expanded by the caller (ProcessExecutor)
	// using the existing CommandTemplate system before the process starts.
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

// RunProcessContext provides the context needed to build a command and parse its output.
type RunProcessContext struct {
	Run     store.Run
	Prompt  string // User's message content (for {{run.prompt}})
	AgentID string // Which agent configuration to use (for {{agent.id}})
	Model   string // Optional model override (for {{agent.model}})
	WorkDir string // Working directory (for {{run.workdir}})
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
	Streaming       bool // Real-time event streaming
	ToolCalls       bool // Supports tool use/calls
	FileChanges     bool // Produces file diffs/changes
	PermissionHooks bool // Supports permission request interception
	ThinkingVisible bool // Can expose reasoning/thinking content
	MultiTurn       bool // Supports multi-turn conversations
	MCPIntegration  bool // Supports MCP tool registration
	SubAgentSpawn   bool // Can spawn sub-agents (orchestrator)
}

// --- Unified event types emitted by all adapters ---

// AgentEventType enumerates structured event types parsed from agent streams.
type AgentEventType string

const (
	EventTextDelta   AgentEventType = "agent.text.delta"    // Streaming text delta
	EventTextBlock   AgentEventType = "agent.text.block"    // Complete text block
	EventThinking    AgentEventType = "agent.thinking"      // Reasoning content
	EventToolCall    AgentEventType = "agent.tool.call"     // Tool execution requested
	EventToolResult  AgentEventType = "agent.tool.result"   // Tool execution completed
	EventFileChange  AgentEventType = "agent.file.change"   // File created/modified/deleted
	EventSessionInit AgentEventType = "agent.session.init"  // Session initialized
	EventResult      AgentEventType = "agent.result"        // Turn completed/failed
)

// Bus event type strings (prefixed with "run.").
const (
	BusEventTextDelta   = "run.agent.text_delta"
	BusEventTextBlock   = "run.agent.text_block"
	BusEventThinking    = "run.agent.thinking"
	BusEventToolCall    = "run.agent.tool_call"
	BusEventToolResult  = "run.agent.tool_result"
	BusEventFileChange  = "run.agent.file_change"
	BusEventSessionInit = "run.agent.session_init"
	BusEventResult      = "run.agent.result"
)
