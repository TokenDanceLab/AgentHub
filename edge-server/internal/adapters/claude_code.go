package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// CCSwitchModelResolver resolves model aliases through the cc-switch database.
// When non-nil, the adapter will attempt to resolve model names dynamically
// through cc-switch before falling back to the static alias table.
type CCSwitchModelResolver interface {
	ResolveModelAlias(alias, appType string) (string, bool)
}

// ClaudeCodeAdapter integrates the claude CLI via NDJSON stream-json protocol.
//
// Invocation: claude -p "prompt" --output-format stream-json --verbose
// Protocol: NDJSON over stdout (each line a JSON message), stderr for diagnostics.
type ClaudeCodeAdapter struct {
	binaryPath       string
	argPrefix        []string // prepended before args when .cmd shim bypassed (Windows node path)
	model            string   // default model (fallback when runCtx.Model is empty)
	permissionMode   string   // default permission mode (fallback when runCtx.PermissionMode is empty)
	maxTurns         int
	available        bool // #177: true if the CLI binary exists and is executable
	permissionBroker *PermissionDecisionBroker

	// ccSwitchResolver dynamically resolves model aliases through the cc-switch
	// database. When non-nil and cc-switch routing is active, this takes
	// precedence over the static ModelAliases table for model resolution.
	ccSwitchResolver CCSwitchModelResolver
}

// NewClaudeCodeAdapter creates a Claude Code adapter.
// binaryPath is the path to the claude executable.
// model and permissionMode serve as defaults when the run context does not specify them.
func NewClaudeCodeAdapter(binaryPath, model, permissionMode string) *ClaudeCodeAdapter {
	cmdPath, argPrefix, available := resolveClaudeCommand(binaryPath, exec.LookPath, os.Stat, runtime.GOOS)
	return &ClaudeCodeAdapter{
		binaryPath:       cmdPath,
		argPrefix:        argPrefix,
		model:            model,
		permissionMode:   permissionMode,
		maxTurns:         50,
		available:        available,
		permissionBroker: nil,
	}
}

// resolveClaudeCommand handles Windows .cmd shim bypass for the claude CLI.
// On Windows, npm installs a claude.cmd shim that forwards args via %*,
// which corrupts multiline prompts when launched via os/exec. This function
// resolves the underlying Node.js entrypoint and returns it with the node
// binary path so prompts are passed as real argv values.
func resolveClaudeCommand(binaryPath string, lookPath func(string) (string, error), stat func(string) (os.FileInfo, error), goos string) (string, []string, bool) {
	resolved, err := lookPath(binaryPath)
	if err != nil {
		return binaryPath, nil, false
	}

	if goos != "windows" || !strings.EqualFold(filepath.Ext(resolved), ".cmd") {
		return resolved, nil, true
	}

	// The npm claude.cmd shim forwards args through %*, which corrupts multiline
	// prompts when Edge launches it via os/exec. Call the Node entrypoint
	// directly so prompts are passed as real argv values.
	script := filepath.Join(filepath.Dir(resolved), "node_modules", "@anthropic-ai", "claude-code", "cli.js")
	info, err := stat(script)
	if err != nil || info.IsDir() {
		return resolved, nil, true
	}
	nodePath, err := lookPath("node")
	if err != nil {
		return resolved, nil, true
	}
	return nodePath, []string{script}, true
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
		SubAgentSpawn:   true, // AgentTool (forkSubagent) for task delegation
	}
}

func (a *ClaudeCodeAdapter) SetPermissionBroker(broker *PermissionDecisionBroker) {
	a.permissionBroker = broker
}

// SetCCSwitchResolver configures dynamic model resolution through the cc-switch
// database. When set, the adapter will resolve model aliases via cc-switch first
// (reflecting the actual transparent proxy mapping), falling back to the static
// ModelAliases table only when cc-switch cannot resolve the alias.
func (a *ClaudeCodeAdapter) SetCCSwitchResolver(resolver CCSwitchModelResolver) {
	a.ccSwitchResolver = resolver
}

// resolveModelForAdapter resolves a model name for the claude-code adapter,
// checking cc-switch dynamic aliases first, then falling back to static aliases.
func (a *ClaudeCodeAdapter) resolveModelForAdapter(model string) string {
	if model == "" {
		return ""
	}
	// Try cc-switch dynamic resolution first (reflects actual transparent proxy).
	if a.ccSwitchResolver != nil {
		if resolved, ok := a.ccSwitchResolver.ResolveModelAlias(model, "claude"); ok {
			return resolved
		}
	}
	// Fall back to static alias table.
	return ResolveModel("claude-code", model)
}

// ccSwitchManaged returns true when the user's Claude Code is managed by
// cc-switch via settings.json. In this mode, all auth configuration is
// already in settings.json (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, model
// mappings) and Edge must not inject conflicting env vars — doing so
// overrides settings.json and causes immediate auth failures when the
// transparent proxy is active.
func ccSwitchManaged() bool {
	home, err := os.UserHomeDir()
	if err != nil {
		return false
	}
	settingsPath := filepath.Join(home, ".claude", "settings.json")
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		return false // file missing → not cc-switch managed
	}
	var settings struct {
		Env map[string]string `json:"env"`
	}
	if err := json.Unmarshal(data, &settings); err != nil {
		return false
	}
	// cc-switch sets ANTHROPIC_AUTH_TOKEN in settings.json. When present,
	// CC handles all auth internally via its own settings layer.
	return settings.Env["ANTHROPIC_AUTH_TOKEN"] != ""
}

func (a *ClaudeCodeAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	prompt := ctx.Prompt
	if prompt == "" {
		prompt = "Continue."
	}

	args := append([]string(nil), a.argPrefix...)
	args = append(args,
		"-p", prompt,
		"--output-format", "stream-json",
		"--verbose",
		fmt.Sprintf("--max-turns=%d", a.maxTurns),
	)

	// Model: runCtx override first, fallback to adapter default.
	// Uses cc-switch dynamic resolution when available.
	if ctx.Model != "" {
		args = append(args, "--model", a.resolveModelForAdapter(ctx.Model))
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
	appendPrompt := ctx.AppendSystemPrompt
	if ctx.SkillsPrompt != "" {
		if appendPrompt != "" {
			appendPrompt = ctx.SkillsPrompt + "\n\n" + appendPrompt
		} else {
			appendPrompt = ctx.SkillsPrompt
		}
	}
	// Context continuity: inject thread history + pinned messages into system prompt
	// so Claude Code has full conversation context even without --continue/--resume.
	if contextPreface := runnerctx.BuildContextPreface(ctx.Messages, ctx.PinnedMessages); contextPreface != "" {
		if appendPrompt != "" {
			appendPrompt = contextPreface + "\n\n" + appendPrompt
		} else {
			appendPrompt = contextPreface
		}
	}
	if appendPrompt != "" {
		args = append(args, "--append-system-prompt", appendPrompt)
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
	if ctx.SessionID != "" && ctx.ContinueLast {
		args = append(args, "--resume", ctx.SessionID)
	} else if ctx.SessionID != "" {
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

	// Pass auth env vars through to the Claude Code child process.
	// Strategy:
	//   - cc-switch managed: don't inject anything, CC reads settings.json.
	//     Injecting env vars would override settings.json and cause auth failures.
	//   - native/standalone: CC needs explicit auth credentials from OS env.
	var env []string
	if !ccSwitchManaged() {
		if key := os.Getenv("ANTHROPIC_API_KEY"); key != "" {
			env = append(env, "ANTHROPIC_API_KEY="+key)
		}
		if key := os.Getenv("CLAUDE_API_KEY"); key != "" {
			env = append(env, "CLAUDE_API_KEY="+key)
		}
		if key := os.Getenv("ANTHROPIC_AUTH_TOKEN"); key != "" {
			env = append(env, "ANTHROPIC_AUTH_TOKEN="+key)
		}
		if url := os.Getenv("ANTHROPIC_BASE_URL"); url != "" {
			env = append(env, "ANTHROPIC_BASE_URL="+url)
		}
	}
	// cc-switch managed: env stays empty → CC reads settings.json

	return a.binaryPath, args, env, workDir
}

func (a *ClaudeCodeAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	parser := NewNDJSONStreamParser(emitter, run)
	if stdin != nil {
		if a.permissionBroker != nil {
			parser.WithControlHandler(NewBrokeredPermissionHandler(emitter, a.permissionBroker, PermissionScope{
				ProjectID: run.ProjectID,
				ThreadID:  run.ThreadID,
				RunID:     run.ID,
			}), stdin)
		} else {
			parser.WithControlHandler(NewEventEmittingPermissionHandler(emitter), stdin)
		}
	}
	// Security hooks are now installed at the ProcessExecutor level via
	// SecureEmitter, covering all adapters uniformly (Claude Code, Codex, OpenCode).
	return parser.Parse(ctx, stdout)
}

// NeedsStdin returns true — Claude Code uses stdin for the control protocol
// (interrupt, permission responses).
func (a *ClaudeCodeAdapter) NeedsStdin() bool { return true }

// Available reports whether the claude CLI binary was found at startup.
// #177: check binary at startup, report unavailable if missing.
func (a *ClaudeCodeAdapter) Available() bool { return a.available }

// PreflightCheck verifies that Claude Code can actually execute by checking both
// the binary presence and required authentication. At least one auth mechanism
// must be available: cc-switch managed (settings.json), ANTHROPIC_API_KEY,
// CLAUDE_API_KEY, or ANTHROPIC_AUTH_TOKEN. Returns an error describing what is
// missing if the adapter is not ready.
func (a *ClaudeCodeAdapter) PreflightCheck() error {
	if !a.available {
		return fmt.Errorf("claude CLI binary not found: %s", a.binaryPath)
	}
	// cc-switch managed mode: settings.json has auth, CC handles everything.
	if ccSwitchManaged() {
		return nil
	}
	if os.Getenv("ANTHROPIC_API_KEY") == "" && os.Getenv("CLAUDE_API_KEY") == "" && os.Getenv("ANTHROPIC_AUTH_TOKEN") == "" {
		return fmt.Errorf("claude-code requires at least one of: ANTHROPIC_API_KEY, CLAUDE_API_KEY, ANTHROPIC_AUTH_TOKEN (or cc-switch managed settings.json)")
	}
	return nil
}
