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

	// Model: if it contains "/", pass as provider/model; otherwise pass as-is
	if ctx.Model != "" {
		args = append(args, "-m", ctx.Model)
	}

	// Reasoning effort: --thinking enables thinking, --variant sets effort level
	if ctx.ReasoningEffort != "" {
		args = append(args, "--thinking")
		args = append(args, "--variant", ctx.ReasoningEffort)
	}

	// Agent mode (build, plan, etc.)
	if ctx.AgentName != "" {
		args = append(args, "--agent", ctx.AgentName)
	}

	// Session continuity
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
	// Forward sessionID to scope if present
	if evt.SessionID != "" {
		scope["sessionId"] = evt.SessionID
	}

	switch evt.Type {
	case "step_start":
		emitter.Emit(BusEventSessionInit, scope, map[string]any{
			"sessionId": evt.SessionID,
		})
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
	case "tool_result":
		if evt.Part != nil {
			emitter.Emit(BusEventToolResult, scope, map[string]any{
				"callId":   evt.Part.CallID,
				"toolName": evt.Part.ToolName,
				"output":   evt.Part.Output,
				"status":   evt.Part.Status,
			})
			if isFileModifyingTool(evt.Part.ToolName) {
				emitter.Emit(BusEventFileChange, scope, map[string]any{
					"callId":   evt.Part.CallID,
					"toolName": evt.Part.ToolName,
					"content":  evt.Part.Output,
				})
			}
		}
	case "permission":
		if evt.Part != nil {
			emitter.Emit(BusEventStatusChange, scope, map[string]any{
				"permissionMode":  "ask",
				"permissionTool":  evt.Part.ToolName,
				"permissionInput": evt.Part.ToolInput,
			})
		}
	case "file":
		if evt.Part != nil {
			emitter.Emit(BusEventFileChange, scope, map[string]any{
				"path":      evt.Part.Path,
				"operation": evt.Part.Operation,
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
			result := map[string]any{
				"success": evt.Part.Reason == "stop",
				"reason":  evt.Part.Reason,
			}
			if evt.Part.Tokens != nil {
				result["usage"] = map[string]any{
					"inputTokens":      evt.Part.Tokens.Input,
					"outputTokens":     evt.Part.Tokens.Output,
					"reasoningTokens":  evt.Part.Tokens.Reasoning,
					"totalTokens":      evt.Part.Tokens.Total,
					"cacheReadTokens":  evt.Part.Tokens.Cache.Read,
					"cacheWriteTokens": evt.Part.Tokens.Cache.Write,
				}
			}
			if evt.Part.Cost > 0 {
				result["cost"] = evt.Part.Cost
			}
			emitter.Emit(BusEventResult, scope, result)
		}
		emitter.Emit(BusEventSessionStateChanged, scope, map[string]any{
			"state": "idle",
		})
	case "session.init":
		emitter.Emit(BusEventSessionInit, scope, map[string]any{
			"sessionId": evt.SessionID,
			"model":     evt.Model,
			"provider":  evt.Provider,
			"tools":     evt.Tools,
		})
	case "session.error":
		emitter.Emit(BusEventResult, scope, map[string]any{
			"success": false,
			"error":   evt.ErrorMessage,
		})
	case "task_start":
		emitter.Emit(BusEventTaskStarted, scope, map[string]any{
			"taskId":      evt.TaskID,
			"description": evt.TaskDescription,
			"taskType":    evt.TaskType,
		})
	case "task_progress":
		emitter.Emit(BusEventTaskProgress, scope, map[string]any{
			"taskId":       evt.TaskID,
			"description":  evt.TaskDescription,
			"lastToolName": evt.LastToolName,
			"usage":        evt.TaskUsage,
		})
	case "task_complete":
		emitter.Emit(BusEventTaskNotification, scope, map[string]any{
			"taskId":  evt.TaskID,
			"status":  "completed",
			"summary": evt.TaskSummary,
			"usage":   evt.TaskUsage,
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
	Type            string        `json:"type"`
	Timestamp       int64         `json:"timestamp,omitempty"`
	SessionID       string        `json:"sessionID,omitempty"`
	Part            *opencodePart `json:"part,omitempty"`
	ErrorMessage    string        `json:"error,omitempty"`
	Model           string        `json:"model,omitempty"`
	Provider        string        `json:"provider,omitempty"`
	Tools           []string      `json:"tools,omitempty"`
	TaskID          string        `json:"taskId,omitempty"`
	TaskDescription string        `json:"taskDescription,omitempty"`
	TaskType        string        `json:"taskType,omitempty"`
	TaskSummary     string        `json:"taskSummary,omitempty"`
	TaskUsage       any           `json:"taskUsage,omitempty"`
	LastToolName    string        `json:"lastToolName,omitempty"`
}

type opencodePart struct {
	ID        string          `json:"id,omitempty"`
	Text      string          `json:"text,omitempty"`
	CallID    string          `json:"callId,omitempty"`
	ToolName  string          `json:"toolName,omitempty"`
	Input     any             `json:"input,omitempty"`
	State     string          `json:"state,omitempty"`
	Reason    string          `json:"reason,omitempty"`
	Type      string          `json:"type,omitempty"`
	Tokens    *opencodeTokens `json:"tokens,omitempty"`
	Cost      float64         `json:"cost,omitempty"`
	Output    string          `json:"output,omitempty"`
	Status    string          `json:"status,omitempty"`
	ToolInput any             `json:"toolInput,omitempty"`
	Path      string          `json:"path,omitempty"`
	Operation string          `json:"operation,omitempty"`
}

type opencodeTokens struct {
	Total     int           `json:"total"`
	Input     int           `json:"input"`
	Output    int           `json:"output"`
	Reasoning int           `json:"reasoning"`
	Cache     opencodeCache `json:"cache"`
}

type opencodeCache struct {
	Write int `json:"write"`
	Read  int `json:"read"`
}
