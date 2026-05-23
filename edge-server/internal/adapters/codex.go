package adapters

import (
	"context"
	"fmt"
	"io"

	"github.com/agenthub/edge-server/internal/store"
)

// CodexAdapter integrates the codex CLI.
//
// Phase 1: codex exec "prompt" -- batch mode, JSONL output (simple, reliable).
// Phase 2: codex app-server --listen stdio:// -- JSON-RPC full streaming.
type CodexAdapter struct {
	binaryPath string
	model      string
}

// NewCodexAdapter creates a Codex adapter.
func NewCodexAdapter(binaryPath, model string) *CodexAdapter {
	return &CodexAdapter{binaryPath: binaryPath, model: model}
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
		Streaming:   false, // Phase 1: batch only; P1: streaming via app-server
		ToolCalls:   true,
		FileChanges: true,
		MultiTurn:   true,
	}
}

func (a *CodexAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	prompt := ctx.Prompt
	if prompt == "" {
		prompt = "Continue."
	}

	model := ctx.Model
	if model == "" {
		model = a.model
	}

	args := []string{"exec", prompt}
	if model != "" {
		args = append(args, "-c", "model="+model)
	}

	workDir := ctx.WorkDir
	if workDir == "" {
		workDir = "."
	}

	env := []string{
		"AGENTHUB_RUN_ID=" + ctx.Run.ID,
		"AGENTHUB_PROJECT_ID=" + ctx.Run.ProjectID,
		"AGENTHUB_THREAD_ID=" + ctx.Run.ThreadID,
	}

	return a.binaryPath, args, env, workDir
}

func (a *CodexAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	// Phase 1: codex exec writes plain text to stdout (not yet JSONL with --json flag).
	// For now, capture as raw text blocks. Phase 2 will implement JSON-RPC parsing.
	buf := make([]byte, 32*1024)
	offset := 0
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		n, err := stdout.Read(buf)
		if n > 0 {
			text := string(buf[:n])
			emitter.Emit(BusEventTextDelta, scope, map[string]any{
				"content": text,
				"offset":  offset,
			})
			offset += n
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return fmt.Errorf("codex stdout: %w", err)
		}
	}
}
