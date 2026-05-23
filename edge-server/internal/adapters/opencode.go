package adapters

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"

	"github.com/agenthub/edge-server/internal/store"
)

// OpenCodeAdapter integrates the opencode CLI.
//
// Phase 1: opencode run "prompt" — batch mode, plain text output.
// Phase 2: opencode run "prompt" --format json — structured JSON events.
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
		Streaming:       true, // Phase 2: JSON event streaming
		ToolCalls:       true,
		FileChanges:     true,
		ThinkingVisible: true,
		MultiTurn:       true,
	}
}

func (a *OpenCodeAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	prompt := ctx.Prompt
	if prompt == "" {
		prompt = "Continue."
	}

	args := []string{"run", "--format", "json"}

	model := ctx.Model
	if model != "" {
		args = append(args, "-m", model)
	}
	if ctx.SessionID != "" {
		args = append(args, "--session", ctx.SessionID)
	} else if ctx.ContinueLast {
		args = append(args, "--continue")
	}
	if ctx.ForkSession {
		args = append(args, "--fork")
	}

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

func (a *OpenCodeAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 256*1024), 10*1024*1024)

	for scanner.Scan() {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var evt opencodeEvent
		if err := json.Unmarshal(line, &evt); err != nil {
			slog.Debug("opencode: skipping unparseable line", "err", err)
			continue
		}
		a.dispatch(scope, emitter, &evt)
	}
	return scanner.Err()
}

func (a *OpenCodeAdapter) dispatch(scope map[string]any, emitter EventEmitter, evt *opencodeEvent) {
	switch evt.Type {
	case "step_start":
		emitter.Emit(BusEventSessionStateChanged, scope, map[string]any{
			"state": "busy",
		})
	case "text":
		if evt.Part != nil {
			emitter.Emit(BusEventTextDelta, scope, map[string]any{
				"content": evt.Part.Text,
			})
		}
	case "tool_use":
		if evt.Part != nil {
			emitter.Emit(BusEventToolCall, scope, map[string]any{
				"callId":   evt.Part.CallID,
				"toolName": evt.Part.ToolName,
				"input":    evt.Part.Input,
				"status":   evt.Part.State,
			})
		}
	case "reasoning":
		if evt.Part != nil {
			emitter.Emit(BusEventThinking, scope, map[string]any{
				"content": evt.Part.Text,
			})
		}
	case "step_finish":
		if evt.Part != nil {
			emitter.Emit(BusEventResult, scope, map[string]any{
				"success": evt.Part.Reason == "stop",
				"reason":  evt.Part.Reason,
				"usage":   evt.Part.Usage,
			})
		}
		emitter.Emit(BusEventSessionStateChanged, scope, map[string]any{
			"state": "idle",
		})
	case "error":
		emitter.Emit(BusEventResult, scope, map[string]any{
			"success": false,
			"error":   evt.ErrorMessage,
		})
	default:
		slog.Debug("opencode: unhandled event type", "type", evt.Type)
	}
}

// --- OpenCode JSON event schemas ---

type opencodeEvent struct {
	Type         string          `json:"type"`
	Timestamp    int64           `json:"timestamp,omitempty"`
	SessionID    string          `json:"sessionID,omitempty"`
	Part         *opencodePart   `json:"part,omitempty"`
	ErrorMessage string          `json:"error,omitempty"`
}

type opencodePart struct {
	Text     string `json:"text,omitempty"`
	CallID   string `json:"callId,omitempty"`
	ToolName string `json:"toolName,omitempty"`
	Input    any    `json:"input,omitempty"`
	State    string `json:"state,omitempty"`
	Reason   string `json:"reason,omitempty"`
	Usage    any    `json:"usage,omitempty"`
}
