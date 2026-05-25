package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/agenthub/edge-server/internal/store"
)

// ClaudeCodeAdapter integrates the claude CLI via NDJSON stream-json protocol.
//
// Invocation: claude -p "prompt" --output-format stream-json --verbose
// Protocol: NDJSON over stdout (each line a JSON message), stderr for diagnostics.
type ClaudeCodeAdapter struct {
	binaryPath     string
	model          string // default model (fallback when runCtx.Model is empty)
	permissionMode string // default permission mode (fallback when runCtx.PermissionMode is empty)
	maxTurns       int
}

// NewClaudeCodeAdapter creates a Claude Code adapter.
// binaryPath is the path to the claude executable.
// model and permissionMode serve as defaults when the run context does not specify them.
func NewClaudeCodeAdapter(binaryPath, model, permissionMode string) *ClaudeCodeAdapter {
	return &ClaudeCodeAdapter{
		binaryPath:     binaryPath,
		model:          model,
		permissionMode: permissionMode,
		maxTurns:       50,
	}
}

func (a *ClaudeCodeAdapter) Metadata() AdapterMetadata {
	return AdapterMetadata{
		ID:          "claude-code",
		Name:        "Claude Code",
		Description: "Anthropic Claude Code CLI — 完整工具链，支持 Bash/Read/Write/Edit/Grep/Glob/Agent/Task",
	}
}

func (a *ClaudeCodeAdapter) Capabilities() AgentCapabilities {
	return AgentCapabilities{
		Streaming:       true,
		ToolCalls:       true,
		FileChanges:     true,
		PermissionHooks: true,
		ThinkingVisible: true,
		MultiTurn:       true,
		MCPIntegration:  true,
	}
}

func (a *ClaudeCodeAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	prompt := ctx.Prompt
	if prompt == "" {
		prompt = "Continue."
	}

	args := []string{
		"-p", prompt,
		"--output-format", "stream-json",
		"--verbose",
		fmt.Sprintf("--max-turns=%d", a.maxTurns),
	}

	// Model: runCtx override first, fallback to adapter default
	if ctx.Model != "" {
		args = append(args, "--model", ResolveModel("claude-code", ctx.Model))
	} else if a.model != "" {
		args = append(args, "--model", a.model)
	}

	// Permission mode: runCtx override first, fallback to adapter default
	permMode := ctx.PermissionMode
	if permMode == "" {
		permMode = a.permissionMode
	}
	if permMode != "" {
		args = append(args, "--permission-mode", permMode)
	}

	// Reasoning effort (--effort)
	if ctx.ReasoningEffort != "" {
		effort := ResolveReasoningEffort("claude-code", ctx.ReasoningEffort)
		args = append(args, "--effort", effort)
	}

	// Thinking mode (--thinking) replaces deprecated --max-thinking-tokens.
	// Ref: claude-code-source/src/main.tsx line 976 — --max-thinking-tokens is hidden & deprecated.
	// Accepted values: "enabled", "adaptive", "disabled".
	if ctx.ThinkingMode != "" {
		args = append(args, "--thinking", ctx.ThinkingMode)
	} else if ctx.MaxThinkingTokens > 0 {
		// Fallback for callers still using the deprecated field: enable thinking.
		args = append(args, "--thinking", "enabled")
	}

	// Structured output (--json-schema)
	if ctx.StructuredOutputSchema != "" {
		args = append(args, "--json-schema", ctx.StructuredOutputSchema)
	}

	// System prompt customization
	if ctx.SystemPrompt != "" {
		args = append(args, "--system-prompt", ctx.SystemPrompt)
	}
	if ctx.AppendSystemPrompt != "" {
		args = append(args, "--append-system-prompt", ctx.AppendSystemPrompt)
	}

	// Custom agent definitions (--agents JSON)
	if len(ctx.AgentDefinitions) > 0 {
		agentsJSON, err := json.Marshal(ctx.AgentDefinitions)
		if err == nil {
			args = append(args, "--agents", string(agentsJSON))
		}
	}

	// MCP server config (--mcp-config)
	if ctx.MCPConfig != "" {
		args = append(args, "--mcp-config", ctx.MCPConfig)
	}

	// Tool allowlisting (--allowedTools)
	if len(ctx.AllowedTools) > 0 {
		for _, t := range ctx.AllowedTools {
			args = append(args, "--allowedTools", t)
		}
	}

	// Spending cap (--max-budget-usd)
	if ctx.MaxBudgetUSD > 0 {
		args = append(args, "--max-budget-usd", fmt.Sprintf("%.2f", ctx.MaxBudgetUSD))
	}

	// Fast mode
	if ctx.FastMode {
		args = append(args, "--fast")
	}

	// Include partial stream_event deltas
	if ctx.IncludePartial {
		args = append(args, "--include-partial-messages")
	}

	// Session continuity from run context
	if ctx.SessionID != "" {
		// --session-id for explicit ID assignment; --resume for picking up existing session
		args = append(args, "--session-id", ctx.SessionID)
	} else if ctx.ContinueLast {
		args = append(args, "--continue")
	}
	if ctx.ForkSession {
		args = append(args, "--fork-session")
	}

	// Allow tool access to the working directory
	workDir := ctx.WorkDir
	if workDir == "" {
		workDir = "."
	}
	args = append(args, "--add-dir", workDir)

	return a.binaryPath, args, nil, workDir
}

func (a *ClaudeCodeAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	parser := NewNDJSONStreamParser(emitter, run)
	if stdin != nil {
		parser.WithControlHandler(NewEventEmittingPermissionHandler(emitter), stdin)
	}
	// Wire security hooks into the parse pipeline (23-check safety validation).
	parser.WithHooks(HookChain{NewSecurityHook()})
	return parser.Parse(ctx, stdout)
}

// NeedsStdin returns true — Claude Code uses stdin for the control protocol
// (interrupt, permission responses).
func (a *ClaudeCodeAdapter) NeedsStdin() bool { return true }
