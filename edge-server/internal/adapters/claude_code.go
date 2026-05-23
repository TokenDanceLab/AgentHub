package adapters

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"

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
		binaryPath:      binaryPath,
		model:           model,
		permissionMode:  permissionMode,
		maxTurns:        50,
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
		args = append(args, "--model", ctx.Model)
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

	// Reasoning effort & thinking budget
	if ctx.MaxThinkingTokens > 0 {
		args = append(args, "--max-thinking-tokens", fmt.Sprintf("%d", ctx.MaxThinkingTokens))
	}

	// Include partial stream_event deltas
	if ctx.IncludePartial {
		args = append(args, "--include-partial-messages")
	}

	// Session continuity from run context
	if ctx.SessionID != "" {
		args = append(args, "--resume", ctx.SessionID)
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

	// Inject AgentHub context as env vars for the agent to consume
	env := []string{
		"AGENTHUB_RUN_ID=" + ctx.Run.ID,
		"AGENTHUB_PROJECT_ID=" + ctx.Run.ProjectID,
		"AGENTHUB_THREAD_ID=" + ctx.Run.ThreadID,
		"AGENTHUB_AGENT_ID=" + ctx.AgentID,
	}

	return a.binaryPath, args, env, workDir
}

func (a *ClaudeCodeAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	parser := NewNDJSONStreamParser(emitter, run)
	if stdin != nil {
		parser.WithControlHandler(&DefaultPermissionHandler{}, stdin)
	}
	return parser.Parse(ctx, stdout)
}

// DetectClaudeVersion attempts to get the installed claude version.
func DetectClaudeVersion(binaryPath string) string {
	if binaryPath == "" {
		binaryPath = "claude"
	}
	cmd := exec.Command(binaryPath, "--version")
	out, err := cmd.Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}
