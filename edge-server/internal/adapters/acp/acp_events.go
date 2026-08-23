// Package adapters — ACP event mapping (experimental, #1404 Phase 2 prep).
//
// This file hosts the pure, binary-independent translation from ACP
// session/update events to Edge run.agent.* events. Keeping the mapper pure
// (no I/O, no state) lets us unit-test the protocol mapping before a real
// ACP agent binary is available for end-to-end integration (Phase 2).
//
// Input types are the typed SessionUpdate/SessionNotification/PromptResponse
// generated from the official ACP schema by github.com/coder/acp-go-sdk
// (v0.13.5) — no hand-rolled ACP structs are decoded here.
//
// Reference: ACP spike analysis §3 (Translation Mapping), ACP Go migration (option C').
package acp

import (
	"encoding/json"
	"strings"

	"github.com/coder/acp-go-sdk"
)

// mappedEvent is the output of the pure ACP→Edge mapper: an Edge bus event
// type plus a map[string]any payload (compatible with EventEmitter.Emit).
type mappedEvent struct {
	EventType string
	Payload   map[string]any
}

// mapACPSessionUpdate translates one typed ACP session/update notification
// into zero or more Edge run.agent.* events. It is pure: no I/O, no side
// effects, no errors — unrecognized update variants yield no events (the
// caller may log them).
//
// Mapping table (see acp-spike-phase1.md §3):
//
//	AgentMessageChunk → run.agent.text_delta   (single content block)
//	AgentThoughtChunk → run.agent.thinking     (content block, status "delta")
//	ToolCall          → run.agent.tool_call    (+ run.agent.tool_result when completed)
//	UsageUpdate       → run.agent.context_usage
//
// Plan / PlanUpdate / SessionInfoUpdate / ToolCallUpdate / UserMessageChunk
// and the other variants are intentionally unmapped in Phase 2 prep — they
// need design sign-off on the Edge-side frame model.
//
// NOTE on UsageUpdate semantics: the official schema reports session context
// window usage (Used / Size), not a per-turn input/output token split. The
// pre-SDK hand-rolled struct (input/output integers) was a misreading of the
// protocol and is gone — payloads now carry "tokens_used" and "context_size".
func mapACPSessionUpdate(u acp.SessionUpdate) []mappedEvent {
	switch {
	case u.AgentMessageChunk != nil:
		return mapContentBlock(u.AgentMessageChunk.Content, BusEventTextDelta, "")

	case u.AgentThoughtChunk != nil:
		// Thinking deltas reuse the thinking event with status "delta" so the
		// existing frontend thinking renderer applies without a new frame type.
		return mapContentBlock(u.AgentThoughtChunk.Content, BusEventThinking, "delta")

	case u.ToolCall != nil:
		return mapToolCall(*u.ToolCall)

	case u.UsageUpdate != nil:
		return []mappedEvent{{
			EventType: BusEventContextUsage,
			Payload: map[string]any{
				"tokens_used":  u.UsageUpdate.Used,
				"context_size": u.UsageUpdate.Size,
			},
		}}

	default:
		// Unmapped ACP update variants (Plan, PlanUpdate, SessionInfoUpdate,
		// ToolCallUpdate, UserMessageChunk, ...). Phase 2 will assign Edge
		// events once the frame design is approved.
		return nil
	}
}

// mapContentBlock emits one Edge event per session/update content block.
// ACP streams one ContentBlock per notification, so the pre-SDK array-based
// mapper collapses to a single block; status is empty for text deltas and
// "delta" for thinking deltas.
func mapContentBlock(block acp.ContentBlock, eventType, status string) []mappedEvent {
	if block.Text == nil || block.Text.Text == "" {
		// Non-text content blocks (image/audio/resource) are not emitted
		// here; they surface via ToolCall / PromptCapabilities.
		return nil
	}
	payload := map[string]any{"content": block.Text.Text}
	if status != "" {
		payload["status"] = status
	}
	return []mappedEvent{{EventType: eventType, Payload: payload}}
}

// mapToolCall translates a typed ToolCall update. A completed tool call
// carries its result: emit tool_result alongside so downstream consumers
// see the full tool lifecycle from one update.
func mapToolCall(t acp.SessionUpdateToolCall) []mappedEvent {
	toolName := acpSessionToolName(t.Title, t.Kind)
	ev := mappedEvent{EventType: BusEventToolCall, Payload: map[string]any{
		"tool_call_id": string(t.ToolCallId),
		"title":        t.Title,
		"kind":         string(t.Kind),
		"toolName":     toolName,
		"status":       string(t.Status),
	}}
	if input, ok := t.RawInput.(map[string]any); ok && len(input) > 0 {
		ev.Payload["input"] = input
	}
	out := []mappedEvent{ev}

	if t.Status == acp.ToolCallStatusCompleted {
		result := mappedEvent{EventType: BusEventToolResult, Payload: map[string]any{
			"tool_call_id": string(t.ToolCallId),
			"toolName":     toolName,
			"status":       string(t.Status),
		}}
		if raw := rawOutputString(t.RawOutput); raw != "" {
			result.Payload["raw_output"] = raw
		}
		out = append(out, result)
	}
	return out
}

// acpSessionToolName derives a tool name for the tool_call/tool_result payload.
// ACP identifies the tool call by id/kind/title; prefer the human-readable
// title, falling back to the kind, then "unknown". SecureEmitter relies on this
// name to route tool_call events through the unified ToolAllowlistHook /
// SecurityHook chain (#1879).
func acpSessionToolName(title string, kind acp.ToolKind) string {
	if t := strings.TrimSpace(title); t != "" {
		return t
	}
	if k := strings.TrimSpace(string(kind)); k != "" {
		return k
	}
	return "unknown"
}

// rawOutputString marshals the typed RawOutput (any, decoded by the SDK) back
// to its JSON wire form for the tool_result payload. Numbers may round-trip
// as float64 (encoding/json default) — acceptable for display payloads.
func rawOutputString(v any) string {
	if v == nil {
		return ""
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

// mapACPPromptResult translates a typed session/prompt response into an Edge
// run.agent.result event. Returns nil when StopReason is empty so the caller
// can skip emission without a spurious "empty result" event.
func mapACPPromptResult(res acp.PromptResponse) *mappedEvent {
	if res.StopReason == "" {
		return nil
	}
	return &mappedEvent{
		EventType: BusEventResult,
		Payload: map[string]any{
			"stop_reason": string(res.StopReason),
		},
	}
}
