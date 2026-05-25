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

	// Model: resolve aliases, then pass as provider/model to OpenCode
	if ctx.Model != "" {
		resolved := ResolveModel("opencode", ctx.Model)
		if resolved == "" {
			resolved = ctx.Model
		}
		args = append(args, "-m", resolved)
	}

	// Reasoning effort: --thinking enables thinking, --variant sets effort level
	if ctx.ReasoningEffort != "" {
		effort := ResolveReasoningEffort("opencode", ctx.ReasoningEffort)
		args = append(args, "--thinking")
		if effort != "" {
			args = append(args, "--variant", effort)
		}
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

	// Permission mode: bypassPermissions maps to --dangerously-skip-permissions
	if ctx.PermissionMode == "bypassPermissions" {
		args = append(args, "--dangerously-skip-permissions")
	}

	args = append(args, prompt)

	workDir := ctx.WorkDir
	if workDir == "" {
		workDir = "."
	}

	var env []string // runtime vars set by process executor

	return a.binaryPath, args, env, workDir
}

func (a *OpenCodeAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}

	scanner := bufio.NewScanner(stdout)
	configureAdapterScanner(scanner)

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

// NeedsStdin returns false — OpenCode runs in batch mode with the prompt
// passed as a CLI argument, so it does NOT read stdin.
func (a *OpenCodeAdapter) NeedsStdin() bool { return false }

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
		if evt.Part != nil && evt.Part.State != nil {
			toolName := evt.Part.Tool
			state := evt.Part.State
			// Emit tool call event (start notification)
			emitter.Emit(BusEventToolCall, scope, map[string]any{
				"callId":   evt.Part.CallID,
				"toolName": toolName,
				"input":    state.Input,
				"status":   state.Status,
			})
			// Emit tool result event (completion/error)
			resultPayload := map[string]any{
				"callId":   evt.Part.CallID,
				"toolName": toolName,
				"status":   state.Status,
			}
			if state.Status == "error" {
				resultPayload["error"] = state.Error
			} else {
				resultPayload["output"] = state.Output
			}
			emitter.Emit(BusEventToolResult, scope, resultPayload)
			// Emit file change event for file-modifying tools
			if isFileModifyingTool(toolName) {
				emitter.Emit(BusEventFileChange, scope, map[string]any{
					"callId":   evt.Part.CallID,
					"toolName": toolName,
					"content":  state.Output,
				})
			}
		}
	case "reasoning":
		if evt.Part != nil {
			emitter.Emit(BusEventThinking, scope, map[string]any{
				"content": evt.Part.Text,
			})
		}
	case "step_finish":
		result := map[string]any{"success": true}
		if evt.Part != nil {
			result["success"] = evt.Part.Reason == "stop" || evt.Part.Reason == ""
			result["reason"] = evt.Part.Reason
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
		}
		emitter.Emit(BusEventResult, scope, result)
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
	Type         string        `json:"type"`
	Timestamp    float64       `json:"timestamp,omitempty"`
	SessionID    string        `json:"sessionID,omitempty"`
	Part         *opencodePart `json:"part,omitempty"`
	ErrorMessage string        `json:"error,omitempty"`
	Model        string        `json:"model,omitempty"`
	Provider     string        `json:"provider,omitempty"`
	Tools        []string      `json:"tools,omitempty"`
}

type opencodePart struct {
	ID        string `json:"id,omitempty"`
	SessionID string `json:"sessionID,omitempty"`
	MessageID string `json:"messageID,omitempty"`
	Type      string `json:"type,omitempty"`

	// StepStartPart fields
	Snapshot string `json:"snapshot,omitempty"`

	// TextPart / ReasoningPart fields
	Text string        `json:"text,omitempty"`
	Time *opencodeTime `json:"time,omitempty"`

	// ToolPart fields
	CallID string             `json:"callID,omitempty"`
	Tool   string             `json:"tool,omitempty"`
	State  *opencodeToolState `json:"state,omitempty"`

	// StepFinishPart fields
	Reason string          `json:"reason,omitempty"`
	Tokens *opencodeTokens `json:"tokens,omitempty"`
	Cost   float64         `json:"cost,omitempty"`
}

type opencodeToolState struct {
	Status string `json:"status"`
	Input  any    `json:"input,omitempty"`
	Output string `json:"output,omitempty"`
	Title  string `json:"title,omitempty"`
	Error  string `json:"error,omitempty"`
}

type opencodeTime struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
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
