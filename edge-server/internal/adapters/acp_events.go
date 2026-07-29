// Package adapters — ACP event mapping (experimental, #1404 Phase 2 prep).
//
// This file hosts the pure, binary-independent translation from ACP
// session/update events to Edge run.agent.* events. Keeping the mapper pure
// (no I/O, no state) lets us unit-test the protocol mapping before a real
// ACP agent binary is available for end-to-end integration (Phase 2).
//
// Reference: docs/analysis/acp-spike-phase1.md §3 (Translation Mapping).
package adapters

import (
	"encoding/json"
)

// acpContentPart models one part of an ACP AgentMessageChunk / AgentThoughtChunk
// content array. ACP reuses the LSP-style content part shape: {type, text}.
type acpContentPart struct {
	Type string `json:"type"`             // "text" | "tool_use" | "tool_result"
	Text string `json:"text,omitempty"`   // present when Type == "text"
}

// acpSessionUpdateEvent models one entry in a session/update notification's
// params.update array. Only the fields relevant to Edge event mapping are
// decoded; unknown fields are ignored (forward-compatible with ACP revisions).
type acpSessionUpdateEvent struct {
	Type string `json:"type"` // "AgentMessageChunk" | "AgentThoughtChunk" | "ToolCall" | "ToolCallUpdate" | "UsageUpdate" | "Plan" | "SessionInfoUpdate"

	// AgentMessageChunk / AgentThoughtChunk
	Content []acpContentPart `json:"content,omitempty"`

	// ToolCall / ToolCallUpdate
	ToolCallID string          `json:"id,omitempty"`
	Title      string          `json:"title,omitempty"`
	Kind       string          `json:"kind,omitempty"`   // e.g. "function", "command"
	Status     string          `json:"status,omitempty"` // "running" | "completed" | "failed"
	RawInput   json.RawMessage `json:"rawInput,omitempty"`
	RawOutput  json.RawMessage `json:"rawOutput,omitempty"`

	// UsageUpdate (token usage). ACP field names are advisory; the mapper
	// tolerates either input/output integers or nested objects.
	UsageInput  int `json:"input,omitempty"`
	UsageOutput int `json:"output,omitempty"`
}

// mappedEvent is the output of the pure ACP→Edge mapper: an Edge bus event
// type plus a map[string]any payload (compatible with EventEmitter.Emit).
type mappedEvent struct {
	EventType string
	Payload   map[string]any
}

// mapACPUpdate translates a single ACP session/update event into zero or more
// Edge run.agent.* events. It is pure: no I/O, no side effects, no errors —
// unrecognized update types yield no events (the caller may log them).
//
// Mapping table (see acp-spike-phase1.md §3):
//
//	AgentMessageChunk  → run.agent.text_delta   (per text part)
//	AgentThoughtChunk  → run.agent.thinking     (per text part, status "delta")
//	ToolCall           → run.agent.tool_call    (+ run.agent.tool_result when completed)
//	UsageUpdate        → run.agent.context_usage
//
// Plan / SessionInfoUpdate / ToolCallUpdate are intentionally unmapped in
// Phase 2 prep — they need design sign-off on the Edge-side frame model.
func mapACPUpdate(u acpSessionUpdateEvent) []mappedEvent {
	switch u.Type {
	case "AgentMessageChunk":
		return mapContentChunks(u.Content, BusEventTextDelta, "")

	case "AgentThoughtChunk":
		// Thinking deltas reuse the thinking event with status "delta" so the
		// existing frontend thinking renderer applies without a new frame type.
		return mapContentChunks(u.Content, BusEventThinking, "delta")

	case "ToolCall":
		ev := mappedEvent{EventType: BusEventToolCall, Payload: map[string]any{
			"tool_call_id": u.ToolCallID,
			"title":        u.Title,
			"kind":         u.Kind,
			"status":       u.Status,
		}}
		out := []mappedEvent{ev}
		// A completed tool call carries its result: emit tool_result alongside
		// so downstream consumers see the full tool lifecycle from one update.
		if u.Status == "completed" {
			result := mappedEvent{EventType: BusEventToolResult, Payload: map[string]any{
				"tool_call_id": u.ToolCallID,
				"status":       u.Status,
			}}
			if len(u.RawOutput) > 0 {
				result.Payload["raw_output"] = string(u.RawOutput)
			}
			out = append(out, result)
		}
		return out

	case "UsageUpdate":
		return []mappedEvent{{
			EventType: BusEventContextUsage,
			Payload: map[string]any{
				"tokens_used":    u.UsageInput + u.UsageOutput,
				"input_tokens":  u.UsageInput,
				"output_tokens": u.UsageOutput,
			},
		}}

	default:
		// Unmapped ACP event types (Plan, SessionInfoUpdate, ToolCallUpdate).
		// Phase 2 will assign Edge events once the frame design is approved.
		return nil
	}
}

// mapContentChunks emits one Edge event per text part in an ACP content array.
// status is empty for text deltas and "delta" for thinking deltas.
func mapContentChunks(parts []acpContentPart, eventType, status string) []mappedEvent {
	var out []mappedEvent
	for _, p := range parts {
		if p.Type != "text" || p.Text == "" {
			// Non-text content parts (tool_use / tool_result embedded in a
			// message chunk) are not emitted here; they surface via ToolCall.
			continue
		}
		payload := map[string]any{"content": p.Text}
		if status != "" {
			payload["status"] = status
		}
		out = append(out, mappedEvent{EventType: eventType, Payload: payload})
	}
	return out
}

// acpPromptResult models the result object of a session/prompt JSON-RPC
// response. ACP returns StopReason when the turn is complete.
type acpPromptResult struct {
	StopReason string `json:"stopReason"` // "end_turn" | "tool_use" | "max_turns" | ...
}

// mapACPPromptResult translates a session/prompt response result into an Edge
// run.agent.result event. Returns nil when the result is empty/unparseable so
// the caller can skip emission without a spurious "empty result" event.
func mapACPPromptResult(raw json.RawMessage) *mappedEvent {
	if len(raw) == 0 {
		return nil
	}
	var res acpPromptResult
	if err := json.Unmarshal(raw, &res); err != nil || res.StopReason == "" {
		return nil
	}
	return &mappedEvent{
		EventType: BusEventResult,
		Payload: map[string]any{
			"stop_reason": res.StopReason,
		},
	}
}
