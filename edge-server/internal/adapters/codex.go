package adapters

import (
	"bufio"
	"context"
	"encoding/json"
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

	args := []string{"exec"}
	if model != "" {
		args = append(args, "-c", "model="+model)
	}

	// Reasoning effort
	if ctx.ReasoningEffort != "" {
		args = append(args, "-c", "model_reasoning_effort="+ctx.ReasoningEffort)
	}

	// Sandbox based on permission mode
	if ctx.PermissionMode != "" {
		sandbox := sandboxForPermissionMode(ctx.PermissionMode)
		if sandbox != "" {
			args = append(args, "--sandbox", sandbox)
		}
	}

	// Structured JSON output
	args = append(args, "--json")

	args = append(args, prompt)

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

// sandboxForPermissionMode maps Claude Code permission modes to Codex sandbox levels.
func sandboxForPermissionMode(mode string) string {
	switch mode {
	case "plan":
		return "read-only"
	case "default":
		return "default"
	case "acceptEdits", "dontAsk":
		return "workspace-write"
	case "bypassPermissions":
		return "danger-full-access"
	default:
		return ""
	}
}

func (a *CodexAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	// Attempt JSONL parsing (exec --json output). Each line is a JSON object.
	// Fall back to raw text capture if the first line is not valid JSON.
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 256*1024), 10*1024*1024)

	jsonlMode := false
	offset := 0

	for scanner.Scan() {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		// Try JSONL parsing
		if !jsonlMode {
			var probe json.RawMessage
			if json.Unmarshal(line, &probe) == nil {
				jsonlMode = true
			}
		}

		if jsonlMode {
			var evt codexExecEvent
			if err := json.Unmarshal(line, &evt); err != nil {
				// If JSON parsing fails mid-stream, emit as raw text
				emitter.Emit(BusEventTextDelta, scope, map[string]any{
					"content": string(line),
					"offset":  offset,
				})
				offset += len(line)
				continue
			}
			a.dispatchCodexEvent(scope, emitter, &evt)
		} else {
			text := string(line)
			emitter.Emit(BusEventTextDelta, scope, map[string]any{
				"content": text,
				"offset":  offset,
			})
			offset += len(line)
		}
	}
	return scanner.Err()
}

// codexExecEvent represents a single JSONL line from codex exec --json output.
type codexExecEvent struct {
	Type    string          `json:"type"`
	Content string          `json:"content,omitempty"`
	Tool    *codexToolEvent `json:"tool,omitempty"`
	Error   string          `json:"error,omitempty"`
	Usage   *codexUsage     `json:"usage,omitempty"`
}

type codexToolEvent struct {
	Name   string `json:"name"`
	CallID string `json:"call_id,omitempty"`
	Input  any    `json:"input,omitempty"`
	Output string `json:"output,omitempty"`
}

type codexUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

func (a *CodexAdapter) dispatchCodexEvent(scope map[string]any, emitter EventEmitter, evt *codexExecEvent) {
	switch evt.Type {
	case "text":
		emitter.Emit(BusEventTextDelta, scope, map[string]any{
			"content": evt.Content,
		})
	case "tool_use":
		if evt.Tool != nil {
			emitter.Emit(BusEventToolCall, scope, map[string]any{
				"callId":   evt.Tool.CallID,
				"toolName": evt.Tool.Name,
				"input":    evt.Tool.Input,
			})
		}
	case "tool_result":
		if evt.Tool != nil {
			emitter.Emit(BusEventToolResult, scope, map[string]any{
				"callId":  evt.Tool.CallID,
				"toolName": evt.Tool.Name,
				"output":  evt.Tool.Output,
			})
		}
	case "result":
		result := map[string]any{
			"success": evt.Error == "",
		}
		if evt.Error != "" {
			result["error"] = evt.Error
		}
		if evt.Usage != nil {
			result["usage"] = evt.Usage
		}
		emitter.Emit(BusEventResult, scope, result)
	case "error":
		emitter.Emit(BusEventResult, scope, map[string]any{
			"success": false,
			"error":   evt.Error,
		})
	}
}
