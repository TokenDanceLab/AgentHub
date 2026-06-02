package adapters

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os/exec"
	"strings"

	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// OpenCodeAdapter integrates the opencode CLI.
//
// Phase 1: opencode run "prompt" — batch mode, plain text output.
// Phase 2: opencode run "prompt" --format json — structured JSON events.
type OpenCodeAdapter struct {
	binaryPath string
	available  bool   // #177: true if the CLI binary exists and is executable
	budget     *runnerctx.ContextBudget // extracted from ctx in ParseStream; nil = no tracking
}

// NewOpenCodeAdapter creates an OpenCode adapter.
func NewOpenCodeAdapter(binaryPath string) *OpenCodeAdapter {
	_, err := exec.LookPath(binaryPath)
	return &OpenCodeAdapter{binaryPath: binaryPath, available: err == nil}
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

	// --format json: emit raw JSON events to stdout (our primary parsing path).
	// Pass --thinking unless explicitly disabled, so reasoning events are included in
	// the JSON output. When ThinkingMode=="disabled", omit --thinking to let the
	// provider skip thinking tokens entirely (saves cost/latency).
	args := []string{"run", "--format", "json"}
	if ctx.ThinkingMode != "disabled" {
		args = append(args, "--thinking")
	}

	// Model: resolve aliases, then pass as provider/model to OpenCode
	if ctx.Model != "" {
		resolved := ResolveModel("opencode", ctx.Model)
		if resolved == "" {
			resolved = ctx.Model
		}
		args = append(args, "-m", resolved)
	}

	// Reasoning effort → OpenCode --variant (provider-specific reasoning effort:
	// "high", "max", "minimal", etc.). This is independent of --thinking.
	if ctx.ReasoningEffort != "" {
		if effort := ResolveReasoningEffort("opencode", ctx.ReasoningEffort); effort != "" {
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

	// Permission mode: in non-interactive (batch) mode OpenCode has no terminal
	// to prompt the user. If permission ruleset would trigger permission.asked,
	// OpenCode blocks forever waiting for a reply that never comes.
	// --dangerously-skip-permissions makes OpenCode auto-approve everything;
	// AgentHub's SecurityHook is the real gatekeeper. Only skip permissions
	// when the caller explicitly requests bypassPermissions or yolo mode.
	if ctx.PermissionMode == "bypassPermissions" || ctx.PermissionMode == "yolo" {
		args = append(args, "--dangerously-skip-permissions")
	}

	// Attach files via --file (supports comma-separated list via ConfigOverrides)
	if files, ok := ctx.ConfigOverrides["files"]; ok && files != "" {
		for _, f := range splitComma(files) {
			if f != "" {
				args = append(args, "--file", f)
			}
		}
	}

	// Working directory as --dir (supplemental to process workDir)
	if ctx.WorkDir != "" {
		args = append(args, "--dir", ctx.WorkDir)
	}

	// Slash command via --command (e.g., /compact)
	if cmd, ok := ctx.ConfigOverrides["command"]; ok && cmd != "" {
		args = append(args, "--command", cmd)
	}

	// Session title via --title
	if title, ok := ctx.ConfigOverrides["title"]; ok && title != "" {
		args = append(args, "--title", title)
	}

	// Skills prompt: prepend to the prompt since OpenCode has no --append-system-prompt.
	if ctx.SkillsPrompt != "" {
		prompt = ctx.SkillsPrompt + "\n\n---\n\n" + prompt
	}

	// Context continuity: prepend thread history + pinned messages so OpenCode
	// has full Hub conversation context (not just the trigger message).
	if contextPreface := runnerctx.BuildContextPreface(ctx.Messages, ctx.PinnedMessages); contextPreface != "" {
		prompt = contextPreface + "\n---\n\n" + prompt
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

	// Extract budget from context for token tracking (nil = no tracking).
	if budget, ok := ctx.Value(CtxBudgetKey).(*runnerctx.ContextBudget); ok {
		a.budget = budget
	}

	return ScanLines(ctx, stdout, func(line []byte) (err error) {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("opencode: panic in stream handler, recovering to keep stream alive",
					"runId", run.ID, "panic", r)
				err = nil // allow ScanLines to continue
			}
		}()
		var evt opencodeEvent
		if err := json.Unmarshal(line, &evt); err != nil {
			slog.Debug("opencode: skipping unparseable line", "err", err)
			return nil
		}
		a.dispatch(scope, emitter, &evt)
		return nil
	})
}

// NeedsStdin returns false — OpenCode runs in batch mode with the prompt
// passed as a CLI argument, so it does NOT read stdin.
func (a *OpenCodeAdapter) NeedsStdin() bool { return false }

// Available reports whether the opencode CLI binary was found at startup.
// #177: check binary at startup, report unavailable if missing.
func (a *OpenCodeAdapter) Available() bool { return a.available }

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
				usageMap := map[string]any{
					"inputTokens":      evt.Part.Tokens.Input,
					"outputTokens":     evt.Part.Tokens.Output,
					"reasoningTokens":  evt.Part.Tokens.Reasoning,
					"totalTokens":      evt.Part.Tokens.Total,
					"cacheReadTokens":  evt.Part.Tokens.Cache.Read,
					"cacheWriteTokens": evt.Part.Tokens.Cache.Write,
				}
				result["usage"] = usageMap
				// Emit context usage metrics so budgeting and dashboards can track token burn.
				emitter.Emit(BusEventContextUsage, scope, usageMap)
				// Track cumulative token consumption for context budget.
				if a.budget != nil {
					a.budget.Track(evt.Part.Tokens.Input + evt.Part.Tokens.Output)
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
		result := map[string]any{
			"success": false,
		}
		// OpenCode errors can be either a plain string or an object like
		// { name: "AuthError", data: { message: "details" } }.
		switch e := evt.Error.(type) {
		case string:
			result["error"] = e
		case map[string]any:
			if msg, ok := e["message"].(string); ok && msg != "" {
				result["error"] = msg
			} else if name, ok := e["name"].(string); ok {
				result["error"] = name + ": " + extractErrorDataMessage(e)
			} else {
				result["error"] = "unknown error"
			}
		default:
			result["error"] = "unknown error"
		}
		emitter.Emit(BusEventResult, scope, result)
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
	Error        any           `json:"error,omitempty"` // string or object { name, data: { message } }
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
	Status     string `json:"status"`
	Input      any    `json:"input,omitempty"`
	Output     string `json:"output,omitempty"`
	Title      string `json:"title,omitempty"`
	Error      string `json:"error,omitempty"`
	Truncated  bool   `json:"truncated,omitempty"`
	OutputPath string `json:"outputPath,omitempty"`
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

// splitComma splits a comma-separated string into trimmed, non-empty tokens.
func splitComma(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// extractErrorDataMessage extracts the embedded message from an OpenCode error
// object's data.message field: { name: "...", data: { message: "..." } }.
func extractErrorDataMessage(e map[string]any) string {
	data, ok := e["data"]
	if !ok {
		return ""
	}
	dm, ok := data.(map[string]any)
	if !ok {
		return ""
	}
	msg, ok := dm["message"].(string)
	if !ok {
		return ""
	}
	return msg
}
