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
	MaxThinkingTokens int    // DEPRECATED: use ThinkingMode instead (kept for backward compat)

	// Thinking mode replaces deprecated --max-thinking-tokens.
	// "enabled", "adaptive", "disabled" — maps to Claude Code --thinking flag.
	ThinkingMode string

	// Permission & partial messages
	PermissionMode string // Claude Code --permission-mode (default/acceptEdits/bypassPermissions/plan/dontAsk)
	IncludePartial bool   // Claude Code --include-partial-messages for stream_event deltas
	FastMode       bool   // Claude Code fast mode

	// Structured output
	StructuredOutputSchema string // JSON Schema for structured output (--json-schema)

	// System prompt customization
	SystemPrompt       string // Override system prompt (--system-prompt)
	AppendSystemPrompt string // Append to default system prompt (--append-system-prompt)

	// Custom agents (--agents JSON)
	AgentDefinitions map[string]AgentDefinition // agent name → definition

	// MCP configuration
	MCPConfig string // MCP server config JSON (--mcp-config)

	// Tool allowlisting
	AllowedTools []string // allowed tool names (--allowedTools)

	// Spending cap
	MaxBudgetUSD float64 // API spending cap per run (--max-budget-usd)

	// OpenCode agent mode
	AgentName string // OpenCode --agent (build, plan, etc.)

	// Codex generic config overrides: each key=value passed as -c flag.
	// Supports any dotted TOML config path (e.g. web_search_mode, reasoning_summary, service_tier).
	ConfigOverrides map[string]string

	// Codex ephemeral mode: no session persistence to disk.
	Ephemeral bool

	// Context budget tracking (in-memory, per-run)
	Budget *ContextBudget
}

// AgentDefinition mirrors Claude Code's AgentDefinitionSchema for --agents flag.
// Ref: claude-code-source/src/entrypoints/sdk/coreSchemas.ts AgentDefinitionSchema
type AgentDefinition struct {
	Description string   `json:"description"`
	Prompt      string   `json:"prompt"`
	Tools       []string `json:"tools,omitempty"`
	Model       string   `json:"model,omitempty"`
}
