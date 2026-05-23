// Package runnerctx provides shared types for passing run-level context
// between the API handler, lifecycle executor, and agent adapters.
package runnerctx

import "github.com/agenthub/edge-server/internal/store"

// RunProcessContext carries all parameters needed to build and execute an agent command.
// It is shared between lifecycle (executor) and adapters (command builder) to avoid
// duplicate struct definitions.
type RunProcessContext struct {
	Run     store.Run
	Prompt  string // User message content
	AgentID string // Agent adapter ID
	Model   string // Model override
	WorkDir string // Working directory

	// Session continuity
	SessionID    string // Specific session to resume
	ContinueLast bool   // Resume most recent session
	ForkSession  bool   // Fork before continuing

	// Reasoning & thinking budget
	ReasoningEffort   string // "low"|"medium"|"high"|"max" (Claude Code), "minimal"|"low"|"medium"|"high"|"xhigh" (Codex)
	MaxThinkingTokens int    // Claude Code --max-thinking-tokens

	// Permission & partial messages
	PermissionMode string // Claude Code --permission-mode (default/acceptEdits/bypassPermissions/plan/dontAsk)
	IncludePartial bool   // Claude Code --include-partial-messages for stream_event deltas
	FastMode       bool   // Claude Code fast mode

	// OpenCode agent mode
	AgentName string // OpenCode --agent (build, plan, etc.)
}
