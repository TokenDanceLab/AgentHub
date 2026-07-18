package adapters

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"

	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// NDJSONStreamParser parses Claude Code's --output-format stream-json protocol.
// Each line is a complete JSON object. Lines that fail to parse are silently
// skipped (they go to stderr in Claude Code via the stdout guard).
type NDJSONStreamParser struct {
	emitter        EventEmitter
	run            store.Run
	ctx            context.Context // set by Parse(); used for control_request context propagation
	seq            int64
	toolNames      map[string]string        // toolUseID → toolName (for file_change detection)
	controlHandler ControlHandler           // nil = control messages ignored
	stdin          io.Writer                // nil = control responses not written
	hooks          HookChain                // AgentHook middleware (P0 #1 from researcher)
	budget         *runnerctx.ContextBudget // nil = no budget tracking
}

// NewNDJSONStreamParser creates a parser that emits events via the given emitter.
func NewNDJSONStreamParser(emitter EventEmitter, run store.Run) *NDJSONStreamParser {
	return &NDJSONStreamParser{emitter: emitter, run: run, seq: 0, toolNames: make(map[string]string)}
}

// WithControlHandler sets a handler for control messages and the stdin writer for responses.
func (p *NDJSONStreamParser) WithControlHandler(handler ControlHandler, stdin io.Writer) *NDJSONStreamParser {
	p.controlHandler = handler
	p.stdin = stdin
	return p
}

// WithHooks sets the AgentHook chain. Hooks run before/after tool use, on errors, etc.
func (p *NDJSONStreamParser) WithHooks(hooks HookChain) *NDJSONStreamParser {
	p.hooks = hooks
	return p
}

// Parse reads NDJSON from r until EOF or ctx cancellation.
func (p *NDJSONStreamParser) Parse(ctx context.Context, r io.Reader) error {
	p.ctx = ctx
	// Extract budget from context for token tracking (nil = no tracking).
	if budget, ok := ctx.Value(CtxBudgetKey).(*runnerctx.ContextBudget); ok {
		p.budget = budget
	}

	return ScanLines(ctx, r, func(line []byte) error {
		p.seq++
		func() {
			defer func() {
				if r := recover(); r != nil {
					slog.Error("ndjson: panic in parseLine, recovering to keep stream alive",
						"runId", p.run.ID, "seq", p.seq, "panic", r)
				}
			}()
			p.parseLine(line)
		}()
		return nil
	})
}

func (p *NDJSONStreamParser) parseLine(line []byte) {
	var msg claudeSDKMessage
	if err := json.Unmarshal(line, &msg); err != nil {
		slog.Debug("ndjson: skipping unparseable line", "error", err)
		return
	}

	scope := map[string]any{
		"projectId": p.run.ProjectID,
		"threadId":  p.run.ThreadID,
		"runId":     p.run.ID,
	}

	switch msg.Type {
	case "control_request":
		if p.controlHandler != nil && p.stdin != nil {
			var ctrlMsg ControlMessage
			if err := json.Unmarshal(line, &ctrlMsg); err == nil {
				_ = p.controlHandler.HandleControlRequest(p.ctx, p.stdin, ctrlMsg)
			}
		}
		return

	case "control_response", "control_cancel_request":
		return

	case "system":
		switch msg.Subtype {
		case "init":
			p.emitSessionInit(scope, &msg)
		case "compact_boundary":
			p.emitCompactBoundary(scope, &msg)
		case "status":
			p.emitStatusChange(scope, &msg)
		case "api_retry":
			p.emitAPIRetry(scope, &msg)
		case "task_started":
			p.emitTaskStarted(scope, &msg)
		case "task_dispatched":
			p.emitTaskDispatched(scope, &msg)
		case "task_progress":
			p.emitTaskProgress(scope, &msg)
		case "task_notification":
			// Re-extract status/summary: TaskStatus/TaskSummary use json:"-" to avoid
			// tag conflict with StatusField (system/status), so we parse them here.
			var taskMsg struct {
				Status  string `json:"status"`
				Summary string `json:"summary"`
			}
			if err := json.Unmarshal(line, &taskMsg); err == nil {
				msg.TaskStatus = taskMsg.Status
				if taskMsg.Summary != "" {
					msg.TaskSummary = taskMsg.Summary
				}
			}
			p.emitTaskNotification(scope, &msg)
		case "session_state_changed":
			p.emitSessionStateChanged(scope, &msg)
		case "hook_started":
			p.emitHookStarted(scope, &msg)
		case "hook_progress":
			p.emitHookProgress(scope, &msg)
		case "hook_response":
			p.emitHookResponse(scope, &msg)
		case "files_persisted":
			// Informational — logged but not emitted as dedicated event
		default:
			slog.Debug("ndjson: unhandled system subtype", "subtype", msg.Subtype)
		}

	case "assistant":
		p.parseAssistantMessage(scope, &msg)

	case "stream_event":
		p.parseStreamEvent(scope, &msg)

	case "user":
		p.emitToolResult(scope, &msg)

	case "result":
		p.parseResult(scope, &msg)

	case "tool_progress":
		p.emit(scope, BusEventToolCall, map[string]any{
			"toolUseId": msg.ToolUseID,
			"toolName":  msg.ToolName,
			"status":    "in_progress",
			"elapsed":   msg.ElapsedSeconds,
		})

	case "tool_use_summary":
		p.emit(scope, BusEventToolUseSummary, map[string]any{
			"summary":    msg.Summary,
			"toolUseIds": msg.PrecedingToolUseIDs,
		})

	case "auth_status":
		p.emit(scope, BusEventAuthStatus, map[string]any{
			"isAuthenticating": msg.IsAuthenticating,
			"output":           msg.AuthOutput,
			"error":            msg.AuthErrorMessage,
		})

	case "rate_limit_event":
		if msg.RateLimitInfo != nil {
			p.emit(scope, BusEventRateLimit, map[string]any{
				"status":      msg.RateLimitInfo.Status,
				"utilization": msg.RateLimitInfo.Utilization,
				"resetsAt":    msg.RateLimitInfo.ResetsAt,
			})
		}

	case "progress":
		// Generic progress event (distinct from tool_progress; emitted during
		// long-running tool executions). Map to BusEventToolCall for UI visibility.
		p.emit(scope, BusEventToolCall, map[string]any{
			"toolUseId": msg.ToolUseID,
			"toolName":  msg.ToolName,
			"status":    "in_progress",
			"elapsed":   msg.ElapsedSeconds,
		})

	case "attachment":
		// Per-turn attachments: file changes, structured output, queued commands.
		// Emit file_change events for each attachment so downstream can sync file state.
		if msg.FileChanges != nil {
			for _, fc := range msg.FileChanges {
				p.emit(scope, BusEventFileChange, map[string]any{
					"path":       fc.Path,
					"kind":       fc.Kind,
					"attachment": true,
				})
			}
		}
		if msg.AttachmentStructuredOutput != nil {
			slog.Debug("ndjson: attachment structured_output present")
		}
		if len(msg.QueuedCommands) > 0 {
			slog.Debug("ndjson: attachment queued_commands", "count", len(msg.QueuedCommands))
		}

	default:
		slog.Debug("ndjson: unhandled message type", "type", msg.Type)
	}
}
