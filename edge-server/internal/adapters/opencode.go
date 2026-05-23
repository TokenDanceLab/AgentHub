package adapters

import (
	"context"
	"fmt"
	"io"

	"github.com/agenthub/edge-server/internal/store"
)

// OpenCodeAdapter integrates the opencode CLI.
//
// Phase 1: opencode run "prompt" -- batch mode, plain text output.
// Phase 2: opencode serve --port N -- HTTP REST + SSE streaming.
type OpenCodeAdapter struct {
	binaryPath string
}

// NewOpenCodeAdapter creates an OpenCode adapter.
func NewOpenCodeAdapter(binaryPath string) *OpenCodeAdapter {
	return &OpenCodeAdapter{binaryPath: binaryPath}
}

func (a *OpenCodeAdapter) Metadata() AdapterMetadata {
	return AdapterMetadata{
		ID:          "opencode",
		Name:        "OpenCode",
		Description: "OpenCode CLI — 多 Provider、会话管理、ACP 协议",
	}
}

func (a *OpenCodeAdapter) Capabilities() AgentCapabilities {
	return AgentCapabilities{
		Streaming:  false, // Phase 1: batch only; P1: SSE via serve
		ToolCalls:  true,
		FileChanges: true,
		MultiTurn:  true,
	}
}

func (a *OpenCodeAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	prompt := ctx.Prompt
	if prompt == "" {
		prompt = "Continue."
	}

	args := []string{"run", prompt}

	model := ctx.Model
	if model != "" {
		args = append(args, "-m", model)
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

func (a *OpenCodeAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	// Phase 1: opencode run writes plain text to stdout.
	// Phase 2 will implement SSE parsing from serve mode.
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
			return fmt.Errorf("opencode stdout: %w", err)
		}
	}
}
