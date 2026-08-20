// DEPRECATED: the NDJSON stream-json parser (`claude -p --output-format
// stream-json --verbose`) is superseded by the official claude-agent-acp ACP
// adapter (claude_acp.go, registry id "claude-acp", third ACP migration
// switch, per ACP Go migration §6). This adapter is
// retained as a mature fallback and control: it keeps its full capability set
// and its brokered approval chain (NewBrokeredPermissionHandler →
// PermissionDecisionBroker), and claude_code_test.go remains the reference
// for the legacy parser contract. New feature work must target claude-acp;
// removal is deferred until claude-acp passes environment verification (see
// claude_acp.go TODO 真跑验证). Logic intentionally unchanged.
//
// #1760 claude 增量：本文件随 claude 家族归组到子包 claude；仍依赖根包
// internal/adapters 的共享助手（ResolveModel / 权限处理链 / NDJSON parser 等，
// 方向与 sdk 子包一致：claude → adapters 单向）。
package claude

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// SwitchModelResolver resolves model aliases through the cc-switch database.
// When non-nil, the adapter will attempt to resolve model names dynamically
// through cc-switch before falling back to the static alias table.
type SwitchModelResolver interface {
	ResolveModelAlias(alias, appType string) (string, bool)
}

// ClaudeCodeAdapter integrates the claude CLI via NDJSON stream-json protocol.
//
// DEPRECATED — see the package-level note: superseded by the official
// claude-agent-acp ACP adapter (claude_acp.go, "claude-acp"). Retained as a
// mature fallback and control, logic unchanged.
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
	permissionBroker *adapters.PermissionDecisionBroker

	// ccSwitchResolver dynamically resolves model aliases through the cc-switch
	// database. When non-nil and cc-switch routing is active, this takes
	// precedence over the static ModelAliases table for model resolution.
	ccSwitchResolver SwitchModelResolver
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
func resolveClaudeCommand(binaryPath string, lookPath func(string) (string, error), stat func(string) (os.FileInfo, error), goos string) (string, []string, bool) {
	return resolveNodeCLICommand(binaryPath, "node_modules/@anthropic-ai/claude-code/cli.js", lookPath, stat, goos)
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

func (a *ClaudeCodeAdapter) SetPermissionBroker(broker *adapters.PermissionDecisionBroker) {
	a.permissionBroker = broker
}

// SetCCSwitchResolver configures dynamic model resolution through the cc-switch
// database. When set, the adapter will resolve model aliases via cc-switch first
// (reflecting the actual transparent proxy mapping), falling back to the static
// ModelAliases table only when cc-switch cannot resolve the alias.
func (a *ClaudeCodeAdapter) SetCCSwitchResolver(resolver SwitchModelResolver) {
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
	return adapters.ResolveModel("claude-code", model)
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
	// #nosec G304 -- reads the user's own Claude Code settings file
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
	sanitizedPrompt, filtered := runnerctx.SanitizeMessage(runnerctx.Message{Role: "user", Content: ctx.Prompt})
	if filtered {
		slog.Warn("claude-code: sanitized prompt",
			"originalLen", len(ctx.Prompt),
		)
	}
	prompt := sanitizedPrompt.Content
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

	args = a.appendModelAndPermissionArgs(args, ctx)

	// Structured output (--json-schema)
	if ctx.StructuredOutputSchema != "" {
		args = append(args, "--json-schema", ctx.StructuredOutputSchema)
	}

	// On Windows, agents frequently reference "/tmp" (a Unix convention) in
	// prompts. This path does not exist on Windows — the equivalent is
	// os.TempDir() (e.g. C:\Users\<user>\AppData\Local\Temp). Grant the
	// agent write access to the system temp directory and inject a hint so
	// it knows to use the native path.
	windowsTmpHint := claudeWindowsTmpHint()

	// System prompt customization
	if ctx.SystemPrompt != "" {
		args = append(args, "--system-prompt", ctx.SystemPrompt)
	}
	appendPrompt := buildClaudeAppendPrompt(ctx, windowsTmpHint)
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
	// The merged MCP config JSON is written to a temp file so the CLI receives
	// a file path (as --mcp-config expects) rather than inline JSON, which
	// could exceed OS argument length limits.
	if ctx.MCPConfig != "" {
		if mcpPath, err := adapters.WriteMCPConfigTempFile(ctx.MCPConfig); err != nil {
			slog.Warn("mcp: failed to write temp config file, passing inline",
				"error", err)
			args = append(args, "--mcp-config", ctx.MCPConfig)
		} else {
			args = append(args, "--mcp-config", mcpPath)
		}
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

	// Session handling.
	// Each run creates a fresh CC conversation via --session-id.
	// When ContinueLast is set with a SessionID, use --resume to rejoin
	// the existing session; otherwise use --continue without a session ID.
	args = appendClaudeSessionArgs(args, ctx)

	// Allow tool access to the working directory when an explicit workDir is set.
	// Empty workDir is rejected at the REST/MCP gate (#854); do not invent a
	// home/default root here (that previously expanded to UserHomeDir).
	workDir := strings.TrimSpace(ctx.WorkDir)
	if workDir != "" {
		args = append(args, "--add-dir", workDir)
	}

	// On Windows, also grant access to the system temp directory so the agent
	// can write to it when prompts reference /tmp.
	if runtime.GOOS == "windows" {
		if tmpDir := os.TempDir(); tmpDir != "" {
			args = append(args, "--add-dir", tmpDir)
		}
	}

	// Pass auth env vars through to the Claude Code child process.
	// Strategy:
	//   - cc-switch managed: don't inject anything, CC reads settings.json.
	//     Injecting env vars would override settings.json and cause auth failures.
	//     However, a nil Env inherits the parent's full os.Environ(), which could
	//     leak ANTHROPIC_API_KEY etc. into the child and override settings.json.
	//     Explicitly filter out auth-related vars so only settings.json is used.
	//   - native/standalone: CC needs explicit auth credentials from OS env.
	env := buildClaudeAuthEnv()

	return a.binaryPath, args, env, workDir
}

// appendModelAndPermissionArgs appends --model/--permission-mode/--effort/
// --thinking flags from the run context, falling back to adapter defaults.
func (a *ClaudeCodeAdapter) appendModelAndPermissionArgs(args []string, ctx RunProcessContext) []string {
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
		effort := adapters.ResolveReasoningEffort("claude-code", ctx.ReasoningEffort)
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
	return args
}

// claudeWindowsTmpHint returns a hint string pointing agents at the native
// Windows temp directory, or "" when not on Windows / no temp dir is set.
func claudeWindowsTmpHint() string {
	if runtime.GOOS != "windows" {
		return ""
	}
	if tmpDir := os.TempDir(); tmpDir != "" {
		return fmt.Sprintf(
			"[Windows path note] The system temp directory is %s. "+
				"When the user references /tmp, use this Windows path instead. "+
				"Example: /tmp/hello.py → %s\\hello.py",
			tmpDir, tmpDir,
		)
	}
	return ""
}

// buildClaudeAppendPrompt assembles the --append-system-prompt content from
// the skills prompt, context preface, and the Windows temp hint.
func buildClaudeAppendPrompt(ctx RunProcessContext, windowsTmpHint string) string {
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
	// Inject Windows temp directory hint if applicable.
	if windowsTmpHint != "" {
		if appendPrompt != "" {
			appendPrompt = windowsTmpHint + "\n\n" + appendPrompt
		} else {
			appendPrompt = windowsTmpHint
		}
	}
	return appendPrompt
}

// appendClaudeSessionArgs appends the session handling flags (--resume,
// --session-id, --continue, --fork-session).
func appendClaudeSessionArgs(args []string, ctx RunProcessContext) []string {
	if ctx.SessionID != "" && ctx.ContinueLast {
		args = append(args, "--resume", ctx.SessionID)
	} else if ctx.SessionID != "" {
		args = append(args, "--session-id", ctx.SessionID)
	}
	if ctx.ContinueLast && ctx.SessionID == "" {
		args = append(args, "--continue")
	}
	if ctx.ForkSession {
		args = append(args, "--fork-session")
	}
	return args
}

// buildClaudeAuthEnv assembles the child-process environment for the claude
// CLI: filtered parent env for cc-switch managed setups, or explicit auth
// variable injection for native/standalone setups.
func buildClaudeAuthEnv() []string {
	var env []string
	if ccSwitchManaged() {
		for _, e := range os.Environ() {
			if strings.HasPrefix(e, "ANTHROPIC_API_KEY=") ||
				strings.HasPrefix(e, "CLAUDE_API_KEY=") ||
				strings.HasPrefix(e, "ANTHROPIC_AUTH_TOKEN=") ||
				strings.HasPrefix(e, "ANTHROPIC_BASE_URL=") {
				continue
			}
			env = append(env, e)
		}
	} else {
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
	return env
}

func (a *ClaudeCodeAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	parser := adapters.NewNDJSONStreamParser(emitter, run)
	if stdin != nil {
		if a.permissionBroker != nil {
			parser.WithControlHandler(adapters.NewBrokeredPermissionHandler(emitter, a.permissionBroker, adapters.PermissionScope{
				ProjectID: run.ProjectID,
				ThreadID:  run.ThreadID,
				RunID:     run.ID,
			}), stdin)
		} else {
			parser.WithControlHandler(adapters.NewEventEmittingPermissionHandler(emitter), stdin)
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
