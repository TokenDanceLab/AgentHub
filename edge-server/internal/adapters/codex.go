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

// NeedsStdin returns false — Codex uses JSONL output via --json flag
// and does NOT require bidirectional stdin communication.
func (a *CodexAdapter) NeedsStdin() bool { return false }

// --- Event types ---

// codexExecEvent represents a single JSONL line from codex exec --json output.
//
// The outer "type" field discriminates the event (thread.started, turn.started,
// turn.completed, turn.failed, item.started, item.completed, item.updated, error).
// For item.* events, the "item" field contains a nested object with its own "type"
// field (agent_message, reasoning, command_execution, file_change, mcp_tool_call,
// collab_tool_call, web_search, todo_list, error).
//
// Reference: codex-rs/exec/src/exec_events.rs — ThreadEvent / ThreadItem / ThreadItemDetails
type codexExecEvent struct {
	Type     string          `json:"type"`
	ThreadID string          `json:"thread_id,omitempty"`
	Usage    *codexUsage     `json:"usage,omitempty"`
	Item     json.RawMessage `json:"item,omitempty"`
	Message  string          `json:"message,omitempty"`
	Error    *codexError     `json:"error,omitempty"` // nested error on turn.failed
}

type codexError struct {
	Message string `json:"message"`
}

type codexUsage struct {
	InputTokens           int64 `json:"input_tokens"`
	CachedInputTokens     int64 `json:"cached_input_tokens"`
	OutputTokens          int64 `json:"output_tokens"`
	ReasoningOutputTokens int64 `json:"reasoning_output_tokens"`
}

// itemBase is used to probe the item's "type" field before decoding the full payload.
type itemBase struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

// codexItemError is the nested error in MCP tool call items.
type codexItemError struct {
	Message string `json:"message"`
}

// --- Event dispatch ---

func (a *CodexAdapter) dispatchCodexEvent(scope map[string]any, emitter EventEmitter, evt *codexExecEvent) {
	switch evt.Type {
	case "thread.started":
		emitter.Emit(BusEventSessionInit, scope, map[string]any{
			"threadId": evt.ThreadID,
		})

	case "turn.started":
		emitter.Emit(BusEventSessionStateChanged, scope, map[string]any{
			"state": "busy",
		})

	case "turn.completed":
		payload := map[string]any{"success": true}
		if evt.Usage != nil {
			payload["usage"] = map[string]any{
				"inputTokens":           evt.Usage.InputTokens,
				"cachedInputTokens":     evt.Usage.CachedInputTokens,
				"outputTokens":          evt.Usage.OutputTokens,
				"reasoningOutputTokens": evt.Usage.ReasoningOutputTokens,
			}
		}
		emitter.Emit(BusEventResult, scope, payload)

	case "turn.failed":
		msg := "turn failed"
		if evt.Error != nil && evt.Error.Message != "" {
			msg = evt.Error.Message
		}
		emitter.Emit(BusEventResult, scope, map[string]any{
			"success": false,
			"error":   msg,
		})

	case "item.started":
		a.dispatchItemStarted(scope, emitter, evt.Item)

	case "item.completed":
		a.dispatchItemCompleted(scope, emitter, evt.Item)

	case "item.updated":
		a.dispatchItemUpdated(scope, emitter, evt.Item)

	case "error":
		emitter.Emit(BusEventResult, scope, map[string]any{
			"success": false,
			"error":   evt.Message,
		})
	}
}

// --- Item dispatch (two-phase: probe type then decode) ---

func (a *CodexAdapter) dispatchItemStarted(scope map[string]any, emitter EventEmitter, raw json.RawMessage) {
	if raw == nil {
		return
	}
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		return
	}
	switch base.Type {
	case "command_execution":
		a.emitToolCallFromItem(raw, scope, emitter, "started")
	case "mcp_tool_call":
		a.emitToolCallFromItem(raw, scope, emitter, "started")
	case "web_search":
		a.emitToolCallFromItem(raw, scope, emitter, "started")
	case "collab_tool_call":
		a.emitTaskStarted(raw, scope, emitter)
	case "file_change":
		a.emitFileChange(raw, scope, emitter)
	case "todo_list":
		a.emitTodoList(raw, scope, emitter)
	}
}

func (a *CodexAdapter) dispatchItemCompleted(scope map[string]any, emitter EventEmitter, raw json.RawMessage) {
	if raw == nil {
		return
	}
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		return
	}
	switch base.Type {
	case "agent_message":
		a.emitTextBlock(raw, scope, emitter)
	case "reasoning":
		a.emitThinking(raw, scope, emitter)
	case "command_execution":
		a.emitToolResultFromItem(raw, scope, emitter)
	case "mcp_tool_call":
		a.emitToolResultFromItem(raw, scope, emitter)
	case "web_search":
		a.emitToolResultFromItem(raw, scope, emitter)
	case "collab_tool_call":
		a.emitTaskNotification(raw, scope, emitter)
	case "file_change":
		a.emitFileChange(raw, scope, emitter)
	case "error":
		a.emitErrorItem(raw, scope, emitter)
	case "todo_list":
		a.emitTodoList(raw, scope, emitter)
	}
}

func (a *CodexAdapter) dispatchItemUpdated(scope map[string]any, emitter EventEmitter, raw json.RawMessage) {
	if raw == nil {
		return
	}
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		return
	}
	switch base.Type {
	case "command_execution":
		a.emitToolProgress(raw, scope, emitter)
	case "mcp_tool_call":
		a.emitToolProgress(raw, scope, emitter)
	case "todo_list":
		a.emitTodoList(raw, scope, emitter)
	case "file_change":
		a.emitFileChange(raw, scope, emitter)
	}
}

// --- Item type handler helpers ---

func (a *CodexAdapter) emitTextBlock(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		return
	}
	if item.Text != "" {
		emitter.Emit(BusEventTextBlock, scope, map[string]any{
			"content": item.Text,
		})
	}
}

func (a *CodexAdapter) emitThinking(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		return
	}
	if item.Text != "" {
		emitter.Emit(BusEventThinking, scope, map[string]any{
			"content": item.Text,
		})
	}
}

func (a *CodexAdapter) emitToolCallFromItem(raw json.RawMessage, scope map[string]any, emitter EventEmitter, status string) {
	payload := map[string]any{"status": status}
	var base itemBase
	_ = json.Unmarshal(raw, &base)
	payload["callId"] = base.ID

	switch base.Type {
	case "command_execution":
		var item struct {
			Command string `json:"command"`
		}
		_ = json.Unmarshal(raw, &item)
		payload["toolName"] = "shell_command"
		payload["input"] = map[string]any{"command": item.Command}
	case "mcp_tool_call":
		var item struct {
			Server    string          `json:"server"`
			Tool      string          `json:"tool"`
			Arguments json.RawMessage `json:"arguments"`
		}
		_ = json.Unmarshal(raw, &item)
		payload["toolName"] = "mcp__" + item.Server + "__" + item.Tool
		if item.Arguments != nil {
			var args any
			if err := json.Unmarshal(item.Arguments, &args); err == nil {
				payload["input"] = args
			}
		}
	case "web_search":
		var item struct {
			Query  string `json:"query"`
			Action string `json:"action"`
		}
		_ = json.Unmarshal(raw, &item)
		payload["toolName"] = "web_search"
		payload["input"] = map[string]any{"query": item.Query, "action": item.Action}
		payload["kind"] = "web_search"
	}
	emitter.Emit(BusEventToolCall, scope, payload)
}

func (a *CodexAdapter) emitToolResultFromItem(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	payload := map[string]any{}
	var base itemBase
	_ = json.Unmarshal(raw, &base)
	payload["callId"] = base.ID

	switch base.Type {
	case "command_execution":
		var item struct {
			Command          string `json:"command"`
			ExitCode         *int   `json:"exit_code"`
			AggregatedOutput string `json:"aggregated_output"`
			Status           string `json:"status"`
		}
		_ = json.Unmarshal(raw, &item)
		payload["toolName"] = "shell_command"
		payload["output"] = item.AggregatedOutput
		if item.ExitCode != nil {
			payload["exitCode"] = *item.ExitCode
		}
		payload["status"] = item.Status
	case "mcp_tool_call":
		var item struct {
			Server    string          `json:"server"`
			Tool      string          `json:"tool"`
			Status    string          `json:"status"`
			Result    json.RawMessage `json:"result"`
			ItemError *codexItemError `json:"error"`
		}
		_ = json.Unmarshal(raw, &item)
		payload["toolName"] = "mcp__" + item.Server + "__" + item.Tool
		payload["status"] = item.Status
		if item.Result != nil {
			var result any
			if err := json.Unmarshal(item.Result, &result); err == nil {
				payload["output"] = result
			}
		}
		if item.ItemError != nil {
			payload["error"] = item.ItemError.Message
		}
	case "web_search":
		var item struct {
			Query  string `json:"query"`
			Action string `json:"action"`
		}
		_ = json.Unmarshal(raw, &item)
		payload["toolName"] = "web_search"
		payload["kind"] = "web_search"
		payload["output"] = map[string]any{"query": item.Query, "action": item.Action}
	}
	emitter.Emit(BusEventToolResult, scope, payload)
}

func (a *CodexAdapter) emitFileChange(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		ID      string `json:"id"`
		Status  string `json:"status"`
		Changes []struct {
			Path string `json:"path"`
			Kind string `json:"kind"`
		} `json:"changes"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		return
	}
	payload := map[string]any{
		"callId":   item.ID,
		"toolName": "apply_patch",
		"status":   item.Status,
	}
	files := make([]map[string]any, 0, len(item.Changes))
	for _, ch := range item.Changes {
		files = append(files, map[string]any{
			"path": ch.Path,
			"kind": ch.Kind,
		})
	}
	payload["files"] = files
	emitter.Emit(BusEventFileChange, scope, payload)
}

func (a *CodexAdapter) emitToolProgress(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var base itemBase
	_ = json.Unmarshal(raw, &base)

	payload := map[string]any{
		"callId":    base.ID,
		"toolUseId": base.ID,
		"status":    "in_progress",
	}

	switch base.Type {
	case "command_execution":
		var item struct {
			Command          string `json:"command"`
			AggregatedOutput string `json:"aggregated_output"`
		}
		_ = json.Unmarshal(raw, &item)
		payload["toolName"] = "shell_command"
		payload["output"] = item.AggregatedOutput
	case "mcp_tool_call":
		var item struct {
			Server string `json:"server"`
			Tool   string `json:"tool"`
		}
		_ = json.Unmarshal(raw, &item)
		payload["toolName"] = "mcp__" + item.Server + "__" + item.Tool
	}
	emitter.Emit(BusEventToolCall, scope, payload)
}

func (a *CodexAdapter) emitTaskStarted(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		ID                string                     `json:"id"`
		Tool              string                     `json:"tool"`
		SenderThreadID    string                     `json:"sender_thread_id"`
		ReceiverThreadIDs []string                   `json:"receiver_thread_ids"`
		Prompt            string                     `json:"prompt"`
		AgentsStates      map[string]json.RawMessage `json:"agents_states"`
		Status            string                     `json:"status"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		return
	}
	emitter.Emit(BusEventTaskStarted, scope, map[string]any{
		"taskId":            item.ID,
		"tool":              item.Tool,
		"senderThreadId":    item.SenderThreadID,
		"receiverThreadIds": item.ReceiverThreadIDs,
		"description":       item.Prompt,
		"status":            item.Status,
	})
}

func (a *CodexAdapter) emitTaskNotification(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		ID                string                     `json:"id"`
		Tool              string                     `json:"tool"`
		SenderThreadID    string                     `json:"sender_thread_id"`
		ReceiverThreadIDs []string                   `json:"receiver_thread_ids"`
		Prompt            string                     `json:"prompt"`
		AgentsStates      map[string]json.RawMessage `json:"agents_states"`
		Status            string                     `json:"status"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		return
	}
	notification := map[string]any{
		"taskId": item.ID,
		"tool":   item.Tool,
		"status": item.Status,
	}
	if len(item.AgentsStates) > 0 {
		states := make(map[string]any, len(item.AgentsStates))
		for threadID, rawState := range item.AgentsStates {
			var state map[string]any
			if json.Unmarshal(rawState, &state) == nil {
				states[threadID] = state
			}
		}
		notification["agentsStates"] = states
	}
	emitter.Emit(BusEventTaskNotification, scope, notification)
}

func (a *CodexAdapter) emitErrorItem(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		return
	}
	emitter.Emit(BusEventResult, scope, map[string]any{
		"success": false,
		"error":   item.Message,
	})
}

func (a *CodexAdapter) emitTodoList(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		ID    string `json:"id"`
		Items []struct {
			Text      string `json:"text"`
			Completed bool   `json:"completed"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		return
	}
	tasks := make([]map[string]any, 0, len(item.Items))
	for _, t := range item.Items {
		tasks = append(tasks, map[string]any{
			"text":      t.Text,
			"completed": t.Completed,
		})
	}
	emitter.Emit(BusEventToolCall, scope, map[string]any{
		"callId":   item.ID,
		"toolName": "plan",
		"input":    map[string]any{"tasks": tasks},
		"kind":     "plan",
	})
}
