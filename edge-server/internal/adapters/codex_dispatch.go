package adapters

import (
	"encoding/json"
	"log/slog"
)

// Residual pure-helper peel #1103: Codex stream event / item dispatch.
// Same package adapters; ParseStream continues to call dispatchCodexEvent.

func (a *CodexAdapter) dispatchCodexEvent(scope map[string]any, emitter EventEmitter, evt *codexExecEvent, workDir string) {
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
			usageMap := map[string]any{
				"inputTokens":           evt.Usage.InputTokens,
				"cachedInputTokens":     evt.Usage.CachedInputTokens,
				"outputTokens":          evt.Usage.OutputTokens,
				"reasoningOutputTokens": evt.Usage.ReasoningOutputTokens,
			}
			payload["usage"] = usageMap
			// Emit context usage metrics so budgeting and dashboards can track token burn.
			emitter.Emit(BusEventContextUsage, scope, usageMap)
			// Track cumulative token consumption for context budget.
			if a.budget != nil {
				a.budget.Track(int(evt.Usage.InputTokens + evt.Usage.OutputTokens))
			}
		}
		emitter.Emit(BusEventResult, scope, payload)
		emitter.Emit(BusEventSessionStateChanged, scope, map[string]any{
			"state": "idle",
		})

	case "turn.failed":
		msg := "turn failed"
		if evt.Error != nil && evt.Error.Message != "" {
			msg = evt.Error.Message
		}
		emitter.Emit(BusEventResult, scope, map[string]any{
			"success": false,
			"error":   msg,
		})
		emitter.Emit(BusEventSessionStateChanged, scope, map[string]any{
			"state": "idle",
		})

	case "item.started":
		a.dispatchItemStarted(scope, emitter, evt.Item, workDir)

	case "item.completed":
		a.dispatchItemCompleted(scope, emitter, evt.Item, workDir)

	case "item.updated":
		a.dispatchItemUpdated(scope, emitter, evt.Item, workDir)

	case "error":
		emitter.Emit(BusEventResult, scope, map[string]any{
			"success": false,
			"error":   evt.Message,
		})
	}
}

// --- Item dispatch (two-phase: probe type then decode) ---

func (a *CodexAdapter) dispatchItemStarted(scope map[string]any, emitter EventEmitter, raw json.RawMessage, workDir string) {
	if raw == nil {
		return
	}
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		slog.Debug("codex: item.started base unmarshal failed", "error", err)
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
		// Note: Codex currently emits file_change only as item.completed.
		// We handle item.started defensively in case the protocol evolves.
		a.emitFileChange(raw, scope, emitter, workDir)
	case "todo_list":
		a.emitTodoList(raw, scope, emitter)
	}
}

func (a *CodexAdapter) dispatchItemCompleted(scope map[string]any, emitter EventEmitter, raw json.RawMessage, workDir string) {
	if raw == nil {
		return
	}
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		slog.Debug("codex: item.completed base unmarshal failed", "error", err)
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
		a.emitFileChange(raw, scope, emitter, workDir)
	case "error":
		a.emitErrorItem(raw, scope, emitter)
	case "todo_list":
		a.emitTodoList(raw, scope, emitter)
	}
}

// dispatchItemUpdated handles item.updated events. Note that per the Codex
// exec protocol, file_change items are only emitted as item.completed — the
// file_change case here is defensive. collab_tool_call on item.updated is
// valid (sub-agent state transitions).
func (a *CodexAdapter) dispatchItemUpdated(scope map[string]any, emitter EventEmitter, raw json.RawMessage, workDir string) {
	if raw == nil {
		return
	}
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		slog.Debug("codex: item.updated base unmarshal failed", "error", err)
		return
	}
	switch base.Type {
	case "command_execution":
		a.emitToolProgress(raw, scope, emitter)
	case "mcp_tool_call":
		a.emitToolProgress(raw, scope, emitter)
	case "web_search":
		a.emitToolProgress(raw, scope, emitter)
	case "collab_tool_call":
		a.emitTaskNotification(raw, scope, emitter)
	case "todo_list":
		a.emitTodoList(raw, scope, emitter)
	case "file_change":
		// Defensive: Codex currently only emits file_change as item.completed.
		a.emitFileChange(raw, scope, emitter, workDir)
	}
}
