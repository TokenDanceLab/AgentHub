package adapters

import (
	"encoding/json"
	"testing"
)

func TestMapACPUpdate_AgentMessageChunk(t *testing.T) {
	got := mapACPUpdate(acpSessionUpdateEvent{
		Type: "AgentMessageChunk",
		Content: []acpContentPart{
			{Type: "text", Text: "Hello"},
			{Type: "text", Text: " world"},
			{Type: "tool_use"}, // non-text parts skipped
		},
	})
	if len(got) != 2 {
		t.Fatalf("expected 2 text_delta events, got %d", len(got))
	}
	for i, want := range []string{"Hello", " world"} {
		if got[i].EventType != BusEventTextDelta {
			t.Errorf("event[%d] type = %q, want %q", i, got[i].EventType, BusEventTextDelta)
		}
		if got[i].Payload["content"] != want {
			t.Errorf("event[%d] content = %q, want %q", i, got[i].Payload["content"], want)
		}
		if _, ok := got[i].Payload["status"]; ok {
			t.Errorf("event[%d] should not carry status for text deltas", i)
		}
	}
}

func TestMapACPUpdate_AgentThoughtChunk(t *testing.T) {
	got := mapACPUpdate(acpSessionUpdateEvent{
		Type: "AgentThoughtChunk",
		Content: []acpContentPart{
			{Type: "text", Text: "reasoning..."},
		},
	})
	if len(got) != 1 {
		t.Fatalf("expected 1 thinking event, got %d", len(got))
	}
	if got[0].EventType != BusEventThinking {
		t.Errorf("type = %q, want %q", got[0].EventType, BusEventThinking)
	}
	if got[0].Payload["status"] != "delta" {
		t.Errorf("status = %v, want delta", got[0].Payload["status"])
	}
}

func TestMapACPUpdate_ToolCallCompletedEmitsResult(t *testing.T) {
	got := mapACPUpdate(acpSessionUpdateEvent{
		Type:       "ToolCall",
		ToolCallID: "tc_1",
		Title:      "read file",
		Kind:       "function",
		Status:     "completed",
		RawOutput:  json.RawMessage(`{"ok":true}`),
	})
	if len(got) != 2 {
		t.Fatalf("expected tool_call + tool_result, got %d", len(got))
	}
	if got[0].EventType != BusEventToolCall || got[0].Payload["tool_call_id"] != "tc_1" {
		t.Errorf("tool_call event wrong: %+v", got[0])
	}
	if got[1].EventType != BusEventToolResult {
		t.Fatalf("second event = %q, want %q", got[1].EventType, BusEventToolResult)
	}
	if got[1].Payload["raw_output"] != `{"ok":true}` {
		t.Errorf("raw_output = %v, want {\"ok\":true}", got[1].Payload["raw_output"])
	}
}

func TestMapACPUpdate_ToolCallRunningNoResult(t *testing.T) {
	got := mapACPUpdate(acpSessionUpdateEvent{
		Type:       "ToolCall",
		ToolCallID: "tc_2",
		Status:     "running",
	})
	if len(got) != 1 || got[0].EventType != BusEventToolCall {
		t.Fatalf("running tool call should emit only tool_call, got %+v", got)
	}
}

func TestMapACPUpdate_UsageUpdate(t *testing.T) {
	got := mapACPUpdate(acpSessionUpdateEvent{
		Type:        "UsageUpdate",
		UsageInput:  120,
		UsageOutput: 80,
	})
	if len(got) != 1 || got[0].EventType != BusEventContextUsage {
		t.Fatalf("expected 1 context_usage event, got %+v", got)
	}
	if got[0].Payload["tokens_used"] != 200 {
		t.Errorf("tokens_used = %v, want 200", got[0].Payload["tokens_used"])
	}
	if got[0].Payload["input_tokens"] != 120 || got[0].Payload["output_tokens"] != 80 {
		t.Errorf("input/output split wrong: %+v", got[0].Payload)
	}
}

func TestMapACPUpdate_UnknownTypeYieldsNothing(t *testing.T) {
	// Plan / SessionInfoUpdate / ToolCallUpdate are deliberately unmapped in
	// Phase 2 prep until the Edge frame design is approved.
	if got := mapACPUpdate(acpSessionUpdateEvent{Type: "Plan"}); len(got) != 0 {
		t.Errorf("Plan should map to nothing, got %+v", got)
	}
	if got := mapACPUpdate(acpSessionUpdateEvent{Type: "SessionInfoUpdate"}); len(got) != 0 {
		t.Errorf("SessionInfoUpdate should map to nothing, got %+v", got)
	}
	if got := mapACPUpdate(acpSessionUpdateEvent{Type: "ToolCallUpdate"}); len(got) != 0 {
		t.Errorf("ToolCallUpdate should map to nothing, got %+v", got)
	}
}

func TestMapACPUpdate_EmptyContentNoEmit(t *testing.T) {
	if got := mapACPUpdate(acpSessionUpdateEvent{Type: "AgentMessageChunk"}); len(got) != 0 {
		t.Errorf("empty content should emit nothing, got %+v", got)
	}
	// text part with empty text is dropped.
	if got := mapACPUpdate(acpSessionUpdateEvent{
		Type:    "AgentMessageChunk",
		Content: []acpContentPart{{Type: "text", Text: ""}},
	}); len(got) != 0 {
		t.Errorf("empty text part should emit nothing, got %+v", got)
	}
}

func TestMapACPPromptResult(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantNil bool
		reason  string
	}{
		{name: "end_turn", raw: `{"stopReason":"end_turn"}`, reason: "end_turn"},
		{name: "tool_use", raw: `{"stopReason":"tool_use"}`, reason: "tool_use"},
		{name: "empty", raw: ``, wantNil: true},
		{name: "no_stop_reason", raw: `{"other":1}`, wantNil: true},
		{name: "unparseable", raw: `{bad json`, wantNil: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := mapACPPromptResult(json.RawMessage(tt.raw))
			if tt.wantNil {
				if got != nil {
					t.Fatalf("expected nil, got %+v", got)
				}
				return
			}
			if got == nil {
				t.Fatalf("expected non-nil result event, got nil")
			}
			if got.EventType != BusEventResult {
				t.Errorf("event type = %q, want %q", got.EventType, BusEventResult)
			}
			if got.Payload["stop_reason"] != tt.reason {
				t.Errorf("stop_reason = %v, want %q", got.Payload["stop_reason"], tt.reason)
			}
		})
	}
}
