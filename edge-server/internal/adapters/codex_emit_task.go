package adapters

import (
	"encoding/json"
	"log/slog"
)

// Residual pure-helper peel #1103: collab task / error / todo emitters.

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
		slog.Debug("codex: emitTaskStarted unmarshal failed", "error", err)
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
		slog.Debug("codex: emitTaskNotification unmarshal failed", "error", err)
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
			} else {
				slog.Debug("codex: emitTaskNotification agent state unmarshal failed", "threadId", threadID)
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
		slog.Debug("codex: emitErrorItem unmarshal failed", "error", err)
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
		slog.Debug("codex: emitTodoList unmarshal failed", "error", err)
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
