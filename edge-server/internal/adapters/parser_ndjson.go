package adapters

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"time"

	"github.com/agenthub/edge-server/internal/store"
)

// NDJSONStreamParser parses Claude Code's --output-format stream-json protocol.
// Each line is a complete JSON object. Lines that fail to parse are silently
// skipped (they go to stderr in Claude Code via the stdout guard).
type NDJSONStreamParser struct {
	emitter        EventEmitter
	run            store.Run
	seq            int64
	toolNames      map[string]string // toolUseID → toolName (for file_change detection)
	controlHandler ControlHandler    // nil = control messages ignored
	stdin          io.Writer         // nil = control responses not written
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

// Parse reads NDJSON from r until EOF or ctx cancellation.
func (p *NDJSONStreamParser) Parse(ctx context.Context, r io.Reader) error {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 256*1024), 10*1024*1024) // 10MB max line

	for scanner.Scan() {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		p.seq++
		p.parseLine(line)
	}
	return scanner.Err()
}

func (p *NDJSONStreamParser) parseLine(line []byte) {
	var msg claudeSDKMessage
	if err := json.Unmarshal(line, &msg); err != nil {
		slog.Debug("ndjson: skipping unparseable line", "err", err)
		return
	}

	scope := map[string]any{
		"projectId": p.run.ProjectID,
		"threadId":  p.run.ThreadID,
		"runId":     p.run.ID,
	}
	now := time.Now().UnixMilli()

	switch msg.Type {
	case "control_request":
		if p.controlHandler != nil && p.stdin != nil {
			var ctrlMsg ControlMessage
			if err := json.Unmarshal(line, &ctrlMsg); err == nil {
				_ = p.controlHandler.HandleControlRequest(context.TODO(), p.stdin, ctrlMsg)
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

	default:
		slog.Debug("ndjson: unhandled message type", "type", msg.Type)
		_ = now
	}
}

func (p *NDJSONStreamParser) parseAssistantMessage(scope map[string]any, msg *claudeSDKMessage) {
	if msg.Message == nil {
		return
	}
	for _, block := range msg.Message.Content {
		switch block.Type {
		case "text":
			p.emit(scope, BusEventTextBlock, map[string]any{
				"content": block.Text,
			})
		case "tool_use":
			if block.ID != "" {
				p.toolNames[block.ID] = block.Name
			}
			p.emit(scope, BusEventToolCall, map[string]any{
				"callId":   block.ID,
				"toolName": block.Name,
				"input":    block.Input,
				"status":   "pending",
			})
		case "thinking":
			p.emit(scope, BusEventThinking, map[string]any{
				"content": block.Thinking,
			})
		}
	}
}

func (p *NDJSONStreamParser) parseStreamEvent(scope map[string]any, msg *claudeSDKMessage) {
	if msg.Event == nil {
		return
	}
	switch msg.Event.Type {
	case "content_block_delta":
		switch msg.Event.Delta.Type {
		case "text_delta":
			p.emit(scope, BusEventTextDelta, map[string]any{
				"content": msg.Event.Delta.Text,
			})
		case "thinking_delta":
			p.emit(scope, BusEventThinking, map[string]any{
				"content": msg.Event.Delta.Thinking,
			})
		}
	case "content_block_start":
		if msg.Event.ContentBlock != nil && msg.Event.ContentBlock.Type == "tool_use" {
			if msg.Event.ContentBlock.ID != "" {
				p.toolNames[msg.Event.ContentBlock.ID] = msg.Event.ContentBlock.Name
			}
			p.emit(scope, BusEventToolCall, map[string]any{
				"callId":   msg.Event.ContentBlock.ID,
				"toolName": msg.Event.ContentBlock.Name,
				"input":    msg.Event.ContentBlock.Input,
				"status":   "started",
			})
		}
	case "content_block_stop":
		// End of a content block — no additional info needed
	}
}

func (p *NDJSONStreamParser) parseResult(scope map[string]any, msg *claudeSDKMessage) {
	success := msg.Subtype == "success"
	payload := map[string]any{
		"success":  success,
		"duration": msg.DurationMs,
		"turns":    msg.NumTurns,
	}
	if msg.Usage != nil {
		payload["usage"] = map[string]any{
			"inputTokens":  msg.Usage.InputTokens,
			"outputTokens": msg.Usage.OutputTokens,
		}
	}
	if !success {
		payload["errors"] = msg.Errors
	}
	p.emit(scope, BusEventResult, payload)
}

func (p *NDJSONStreamParser) emitSessionInit(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventSessionInit, map[string]any{
		"model":          msg.Model,
		"tools":          msg.Tools,
		"mcpServers":     msg.MCPServers,
		"permissionMode": msg.PermissionMode,
		"version":        msg.Version,
	})
}

func (p *NDJSONStreamParser) emitToolResult(scope map[string]any, msg *claudeSDKMessage) {
	if msg.Message == nil {
		return
	}
	for _, block := range msg.Message.Content {
		if block.Type == "tool_result" {
			p.emit(scope, BusEventToolResult, map[string]any{
				"callId":  block.ToolUseID,
				"content": block.Content,
				"isError": block.IsError,
			})
			// Emit file_change for Write/Edit tools
			if toolName := p.toolNames[block.ToolUseID]; isFileModifyingTool(toolName) {
				p.emit(scope, BusEventFileChange, map[string]any{
					"callId":   block.ToolUseID,
					"toolName": toolName,
					"content":  block.Content,
					"isError":  block.IsError,
				})
			}
		}
	}
}

func (p *NDJSONStreamParser) emitCompactBoundary(scope map[string]any, msg *claudeSDKMessage) {
	payload := map[string]any{
		"trigger": msg.CompactTrigger,
	}
	if msg.CompactPreTokens > 0 {
		payload["preTokens"] = msg.CompactPreTokens
	}
	p.emit(scope, BusEventCompactBoundary, payload)
}

func (p *NDJSONStreamParser) emitStatusChange(scope map[string]any, msg *claudeSDKMessage) {
	payload := map[string]any{}
	if msg.StatusField != "" {
		payload["status"] = msg.StatusField
	}
	if msg.PermissionMode != "" {
		payload["permissionMode"] = msg.PermissionMode
	}
	p.emit(scope, BusEventStatusChange, payload)
}

func (p *NDJSONStreamParser) emitAPIRetry(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventAPIRetry, map[string]any{
		"attempt":      msg.RetryAttempt,
		"maxRetries":   msg.RetryMaxRetries,
		"retryDelayMs": msg.RetryDelayMs,
		"errorStatus":  msg.RetryErrorStatus,
		"error":        msg.AuthErrorMessage,
	})
}

func (p *NDJSONStreamParser) emitTaskStarted(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventTaskStarted, map[string]any{
		"taskId":      msg.TaskID,
		"toolUseId":   msg.ToolUseID,
		"description": msg.TaskDescription,
		"taskType":    msg.TaskType,
	})
}

func (p *NDJSONStreamParser) emitTaskProgress(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventTaskProgress, map[string]any{
		"taskId":       msg.TaskID,
		"description":  msg.TaskDescription,
		"lastToolName": msg.LastToolName,
		"usage":        msg.TaskUsage,
	})
}

func (p *NDJSONStreamParser) emitTaskNotification(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventTaskNotification, map[string]any{
		"taskId":  msg.TaskID,
		"status":  msg.TaskStatus,
		"summary": msg.TaskSummary,
		"usage":   msg.TaskUsage,
	})
}

func (p *NDJSONStreamParser) emitSessionStateChanged(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventSessionStateChanged, map[string]any{
		"state": msg.SessionState,
	})
}

func (p *NDJSONStreamParser) emitHookStarted(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventHookStarted, map[string]any{
		"hookId":    msg.HookID,
		"hookName":  msg.HookName,
		"hookEvent": msg.HookEvent,
	})
}

func (p *NDJSONStreamParser) emitHookProgress(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventHookProgress, map[string]any{
		"hookId":   msg.HookID,
		"hookName": msg.HookName,
		"stdout":   msg.HookStdout,
		"stderr":   msg.HookStderr,
	})
}

func (p *NDJSONStreamParser) emitHookResponse(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventHookResponse, map[string]any{
		"hookId":   msg.HookID,
		"hookName": msg.HookName,
		"outcome":  msg.HookOutcome,
		"exitCode": msg.HookExitCode,
		"stdout":   msg.HookStdout,
	})
}

func isFileModifyingTool(name string) bool {
	return name == "Write" || name == "Edit"
}

func (p *NDJSONStreamParser) emit(scope map[string]any, eventType string, payload map[string]any) {
	p.emitter.Emit(eventType, scope, payload)
}

// --- Claude SDK message schemas (subset used for parsing) ---

type claudeSDKMessage struct {
	Type    string `json:"type"`
	Subtype string `json:"subtype,omitempty"`

	// Assistant/user messages
	Message *claudeContentMessage `json:"message,omitempty"`
	Event   *claudeStreamEvent    `json:"event,omitempty"`

	// system/init fields
	Model          string   `json:"model,omitempty"`
	Tools          []string `json:"tools,omitempty"`
	MCPServers     []any    `json:"mcp_servers,omitempty"`
	PermissionMode string   `json:"permissionMode,omitempty"`
	Version        string   `json:"version,omitempty"`

	// result fields
	DurationMs int64        `json:"duration_ms,omitempty"`
	NumTurns   int          `json:"num_turns,omitempty"`
	Usage      *claudeUsage `json:"usage,omitempty"`
	Errors     []string     `json:"errors,omitempty"`

	// tool_progress fields
	ToolUseID      string  `json:"tool_use_id,omitempty"`
	ToolName       string  `json:"tool_name,omitempty"`
	ElapsedSeconds float64 `json:"elapsed_time_seconds,omitempty"`
	TaskID         string  `json:"task_id,omitempty"`

	// tool_use_summary fields
	Summary             string   `json:"summary,omitempty"`
	PrecedingToolUseIDs []string `json:"preceding_tool_use_ids,omitempty"`

	// auth_status fields
	IsAuthenticating bool     `json:"isAuthenticating,omitempty"`
	AuthOutput       []string `json:"output,omitempty"`
	AuthErrorMessage string   `json:"error,omitempty"`

	// rate_limit_event fields
	RateLimitInfo *claudeRateLimitInfo `json:"rate_limit_info,omitempty"`

	// compact_boundary fields
	CompactTrigger   string `json:"trigger,omitempty"`
	CompactPreTokens int64  `json:"pre_tokens,omitempty"`

	// system/status fields
	StatusField string `json:"status,omitempty"`

	// api_retry fields
	RetryAttempt     int `json:"attempt,omitempty"`
	RetryMaxRetries  int `json:"max_retries,omitempty"`
	RetryDelayMs     int `json:"retry_delay_ms,omitempty"`
	RetryErrorStatus any `json:"error_status,omitempty"`

	// task_started/progress/notification fields (shared fields; no json tags to avoid
	// conflicts with result's usage/summary — these are manually extracted)
	TaskDescription string `json:"description,omitempty"`
	TaskType        string `json:"task_type,omitempty"`
	TaskStatus      string `json:"-"`
	TaskSummary     string `json:"-"`
	TaskUsage       any    `json:"-"`
	LastToolName    string `json:"last_tool_name,omitempty"`

	// session_state_changed fields
	SessionState string `json:"state,omitempty"`

	// hook_* fields
	HookID       string `json:"hook_id,omitempty"`
	HookName     string `json:"hook_name,omitempty"`
	HookEvent    string `json:"hook_event,omitempty"`
	HookStdout   string `json:"stdout,omitempty"`
	HookStderr   string `json:"stderr,omitempty"`
	HookOutcome  string `json:"outcome,omitempty"`
	HookExitCode int    `json:"exit_code,omitempty"`
}

type claudeRateLimitInfo struct {
	Status      string  `json:"status"`
	ResetsAt    int64   `json:"resetsAt"`
	Utilization float64 `json:"utilization"`
}

type claudeContentMessage struct {
	Role    string               `json:"role"`
	Content []claudeContentBlock `json:"content"`
}

type claudeContentBlock struct {
	Type      string `json:"type"`
	Text      string `json:"text,omitempty"`
	Thinking  string `json:"thinking,omitempty"`
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	Input     any    `json:"input,omitempty"`
	ToolUseID string `json:"tool_use_id,omitempty"`
	Content   string `json:"content,omitempty"`
	IsError   bool   `json:"is_error,omitempty"`
}

type claudeStreamEvent struct {
	Type         string              `json:"type"`
	Delta        *claudeDelta        `json:"delta,omitempty"`
	ContentBlock *claudeContentBlock `json:"content_block,omitempty"`
}

type claudeDelta struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Thinking string `json:"thinking,omitempty"`
}

type claudeUsage struct {
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
}
