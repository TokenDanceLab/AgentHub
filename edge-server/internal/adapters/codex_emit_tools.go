package adapters

import (
	"encoding/json"
	"log/slog"
)

// Residual pure-helper peel #1103: tool-call / tool-result / progress emitters.

func (a *CodexAdapter) emitToolCallFromItem(raw json.RawMessage, scope map[string]any, emitter EventEmitter, status string) {
	payload := map[string]any{"status": status}
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		slog.Debug("codex: emitToolCallFromItem base unmarshal failed", "error", err)
	}
	payload["callId"] = base.ID

	switch base.Type {
	case "command_execution":
		var item struct {
			Command string `json:"command"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolCallFromItem command_execution unmarshal failed", "error", err)
		}
		payload["toolName"] = "shell_command"
		payload["input"] = map[string]any{"command": item.Command}
	case "mcp_tool_call":
		var item struct {
			Server    string          `json:"server"`
			Tool      string          `json:"tool"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolCallFromItem mcp_tool_call unmarshal failed", "error", err)
		}
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
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolCallFromItem web_search unmarshal failed", "error", err)
		}
		payload["toolName"] = "web_search"
		payload["input"] = map[string]any{"query": item.Query, "action": item.Action}
		payload["kind"] = "web_search"
	}
	emitter.Emit(BusEventToolCall, scope, payload)
	// Emit dedicated MCP tool call event for downstream consumers that need
	// to distinguish MCP server tool activity from built-in tool activity.
	if base.Type == "mcp_tool_call" {
		emitter.Emit(BusEventMCPToolCall, scope, payload)
	}
}

func (a *CodexAdapter) emitToolResultFromItem(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	payload := map[string]any{}
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		slog.Debug("codex: emitToolResultFromItem base unmarshal failed", "error", err)
	}
	payload["callId"] = base.ID

	switch base.Type {
	case "command_execution":
		var item struct {
			Command          string `json:"command"`
			ExitCode         *int   `json:"exit_code"`
			AggregatedOutput string `json:"aggregated_output"`
			Status           string `json:"status"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolResultFromItem command_execution unmarshal failed", "error", err)
		}
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
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolResultFromItem mcp_tool_call unmarshal failed", "error", err)
		}
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
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolResultFromItem web_search unmarshal failed", "error", err)
		}
		payload["toolName"] = "web_search"
		payload["kind"] = "web_search"
		payload["output"] = map[string]any{"query": item.Query, "action": item.Action}
	}
	emitter.Emit(BusEventToolResult, scope, payload)
}

func (a *CodexAdapter) emitToolProgress(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		slog.Debug("codex: emitToolProgress base unmarshal failed", "error", err)
	}

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
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolProgress command_execution unmarshal failed", "error", err)
		}
		payload["toolName"] = "shell_command"
		payload["output"] = item.AggregatedOutput
	case "mcp_tool_call":
		var item struct {
			Server string `json:"server"`
			Tool   string `json:"tool"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolProgress mcp_tool_call unmarshal failed", "error", err)
		}
		payload["toolName"] = "mcp__" + item.Server + "__" + item.Tool
	case "web_search":
		var item struct {
			Query  string `json:"query"`
			Action string `json:"action"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolProgress web_search unmarshal failed", "error", err)
		}
		payload["toolName"] = "web_search"
		payload["kind"] = "web_search"
		payload["input"] = map[string]any{"query": item.Query, "action": item.Action}
	}
	emitter.Emit(BusEventToolCall, scope, payload)
	if base.Type == "mcp_tool_call" {
		emitter.Emit(BusEventMCPToolCall, scope, payload)
	}
}
