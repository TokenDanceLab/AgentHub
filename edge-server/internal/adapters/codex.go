package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// CodexAdapter integrates the codex CLI.
//
// Phase 1: codex exec "prompt" -- batch mode, JSONL output (simple, reliable).
// Phase 2: codex app-server --listen stdio:// -- JSON-RPC full streaming.
//
// Residual pure helpers live in codex_*.go companions (peel #1103).
type CodexAdapter struct {
	binaryPath  string
	argPrefix   []string
	model       string
	available   bool                     // #177: true if the CLI binary exists and is executable
	openaiKey   string                   // OPENAI_API_KEY from parent env, passed to child process
	budget      *runnerctx.ContextBudget // extracted from ctx in ParseStream; nil = no tracking
	preflightOK bool                     // true if CLI binary + API key are both present
}

// NewCodexAdapter creates a Codex adapter.
func NewCodexAdapter(binaryPath, model string) *CodexAdapter {
	cmdPath, argPrefix, available := resolveCodexCommand(binaryPath, exec.LookPath, os.Stat, runtime.GOOS)
	// Capture OPENAI_API_KEY from parent environment so we can pass it through
	// to the Codex child process. The env sanitizer filters sensitive keys from
	// the sanitized child env, so adapter-level passthrough is required.
	openaiKey := os.Getenv("OPENAI_API_KEY")
	preflightOK := available && openaiKey != ""
	return &CodexAdapter{
		binaryPath:  cmdPath,
		argPrefix:   argPrefix,
		model:       model,
		available:   available,
		openaiKey:   openaiKey,
		preflightOK: preflightOK,
	}
}

func resolveCodexCommand(binaryPath string, lookPath func(string) (string, error), stat func(string) (os.FileInfo, error), goos string) (string, []string, bool) {
	return resolveNodeCLICommand(binaryPath, "node_modules/@openai/codex/bin/codex.js", lookPath, stat, goos)
}

func (a *CodexAdapter) Metadata() AdapterMetadata {
	return AdapterMetadata{
		ID:          "codex",
		Name:        "Codex",
		Description: "OpenAI Codex CLI — 代码生成、审查、沙箱执行",
	}
}

func (a *CodexAdapter) Capabilities() AgentCapabilities {
	return AgentCapabilities{
		Streaming:       false, // Phase 1: batch only; P1: streaming via app-server
		ToolCalls:       true,
		FileChanges:     true,
		ThinkingVisible: true, // reasoning items are emitted via item.completed
		MultiTurn:       true,
		MCPIntegration:  true, // mcp_tool_call items are fully handled
		SubAgentSpawn:   true, // collab_tool_call items map to BusEventTaskStarted/Notification
	}
}

func (a *CodexAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	prompt := ctx.Prompt
	if prompt == "" {
		prompt = "Continue."
	}

	model := ResolveModel("codex", ctx.Model)
	if model == "" {
		model = a.model
	}

	args := append([]string(nil), a.argPrefix...)
	args = append(args, "exec")
	if model != "" {
		args = append(args, "-c", "model="+model)
	}

	// Reasoning effort
	if ctx.ReasoningEffort != "" {
		effort := ResolveReasoningEffort("codex", ctx.ReasoningEffort)
		args = append(args, "-c", "model_reasoning_effort="+effort)
	}

	// Sandbox based on permission mode
	if ctx.PermissionMode != "" {
		sandbox := sandboxForPermissionMode(ctx.PermissionMode)
		if sandbox != "" {
			args = append(args, "--sandbox", sandbox)
		}
	}

	// Generic config overrides (-c key=value)
	for key, value := range ctx.ConfigOverrides {
		args = append(args, "-c", key+"="+value)
	}

	// Ephemeral mode: no session persistence
	if ctx.Ephemeral {
		args = append(args, "--ephemeral")
	}

	// Image input (--image / -i)
	if image, ok := ctx.ConfigOverrides["image"]; ok && image != "" {
		args = append(args, "--image", image)
	}

	// Set Codex's main working directory. Extra writable roots should be passed
	// through a separate config field; do not mirror Claude Code --add-dir here.
	if ctx.WorkDir != "" {
		args = append(args, "--cd", ctx.WorkDir)
	}

	// Edge runs often use temporary workspaces that are not Git repositories.
	args = append(args, "--skip-git-repo-check")

	// Structured JSON output
	args = append(args, "--json")

	// MCP server config injection. Codex accepts MCP server definitions via
	// config override: -c mcp_servers=<json>. The value is a JSON object mapping
	// server names to their configs (same schema as Claude Code's mcpServers).
	if ctx.MCPConfig != "" {
		args = append(args, "-c", "mcp_servers="+ctx.MCPConfig)
	}

	// Skills prompt: prepend to the prompt text since Codex has no --append-system-prompt.
	if ctx.SkillsPrompt != "" {
		prompt = ctx.SkillsPrompt + "\n\n---\n\n" + prompt
	}

	// System prompt: prepend since Codex has no --system-prompt flag.
	// Without this, user-configured system prompts are silently discarded
	// for Codex agents. See RunProcessContext.SystemPrompt / AppendSystemPrompt.
	if ctx.SystemPrompt != "" {
		prompt = ctx.SystemPrompt + "\n\n---\n\n" + prompt
	}
	if ctx.AppendSystemPrompt != "" {
		prompt = ctx.AppendSystemPrompt + "\n\n---\n\n" + prompt
	}

	// Context continuity: prepend thread history + pinned messages so Codex
	// has full Hub conversation context (not just the trigger message).
	if contextPreface := runnerctx.BuildContextPreface(ctx.Messages, ctx.PinnedMessages); contextPreface != "" {
		prompt = contextPreface + "\n---\n\n" + prompt
	}

	args = append(args, "--", prompt)

	// Empty workDir is rejected at REST/MCP gates (#854). Do not fall back to
	// UserHomeDir/DefaultWorkDir; keep empty and let the process CWD stay unset
	// if a bypass path reaches BuildCommand.
	workDir := strings.TrimSpace(ctx.WorkDir)

	var env []string
	// Pass OPENAI_API_KEY through to the Codex child process. The env sanitizer
	// strips sensitive keys from the sanitized parent env, so we must explicitly
	// inject it here. Without this, Codex hangs waiting for authentication.
	if a.openaiKey != "" {
		env = append(env, "OPENAI_API_KEY="+a.openaiKey)
	}
	url := os.Getenv("OPENAI_BASE_URL")
	if url != "" {
		env = append(env, "OPENAI_BASE_URL="+url)
	}

	return a.binaryPath, args, env, workDir
}

// sandboxForPermissionMode maps Claude Code permission modes to Codex sandbox levels.
func sandboxForPermissionMode(mode string) string {
	switch mode {
	case "plan":
		return "read-only"
	case "default":
		return "" // Codex has no "default" sandbox — let Codex decide
	case "acceptEdits", "dontAsk":
		return "workspace-write"
	case "bypassPermissions":
		return "danger-full-access"
	default:
		return ""
	}
}

func (a *CodexAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}

	// Extract budget from context for token tracking (nil = no tracking).
	if budget, ok := ctx.Value(CtxBudgetKey).(*runnerctx.ContextBudget); ok {
		a.budget = budget
	}

	workDir, _ := ctx.Value(CtxWorkDir).(string)
	jsonlMode := false
	offset := 0

	return ScanLines(ctx, stdout, func(line []byte) (err error) {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("codex: panic in stream handler, recovering to keep stream alive",
					"runId", run.ID, "panic", r)
				err = nil // allow ScanLines to continue
			}
		}()

		if !jsonlMode {
			var probe json.RawMessage
			if json.Unmarshal(line, &probe) == nil {
				jsonlMode = true
			}
		}

		if jsonlMode {
			var evt codexExecEvent
			if err := json.Unmarshal(line, &evt); err != nil {
				slog.Debug("codex: JSON parse error in stream, falling back to raw text", "error", err)
				emitter.Emit(BusEventTextDelta, scope, map[string]any{
					"content": string(line),
					"offset":  offset,
				})
				offset += len(line)
				return nil
			}
			a.dispatchCodexEvent(scope, emitter, &evt, workDir)
		} else {
			text := string(line)
			emitter.Emit(BusEventTextDelta, scope, map[string]any{
				"content": text,
				"offset":  offset,
			})
			offset += len(line)
		}
		return nil
	})
}

// NeedsStdin returns false — Codex uses JSONL output via --json flag
// and does NOT require bidirectional stdin communication.
func (a *CodexAdapter) NeedsStdin() bool { return false }

// Available reports whether the codex CLI binary was found at startup.
// #177: check binary at startup, report unavailable if missing.
func (a *CodexAdapter) Available() bool { return a.available }

// PreflightCheck verifies that Codex can actually execute by checking both
// the binary presence and required configuration (OPENAI_API_KEY). Returns
// an error describing what is missing if the adapter is not ready.
func (a *CodexAdapter) PreflightCheck() error {
	if !a.available {
		return fmt.Errorf("codex CLI binary not found: %s", a.binaryPath)
	}
	if a.openaiKey == "" {
		return fmt.Errorf("codex requires OPENAI_API_KEY environment variable")
	}
	return nil
}

// PreflightAdapter is an optional interface that adapters can implement to
// provide a pre-execution readiness check. The process executor calls this
// before launching the subprocess and fails the run immediately with a
// descriptive error if the check fails.
type PreflightAdapter interface {
	PreflightCheck() error
}
