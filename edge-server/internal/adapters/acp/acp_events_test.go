package acp

import (
	"testing"

	"github.com/coder/acp-go-sdk"
)

func TestMapACPSessionUpdate_AgentMessageChunk(t *testing.T) {
	got := mapACPSessionUpdate(acp.UpdateAgentMessageText("Hello"))
	if len(got) != 1 {
		t.Fatalf("expected 1 text_delta event, got %d", len(got))
	}
	if got[0].EventType != BusEventTextDelta {
		t.Errorf("type = %q, want %q", got[0].EventType, BusEventTextDelta)
	}
	if got[0].Payload["content"] != "Hello" {
		t.Errorf("content = %v, want Hello", got[0].Payload["content"])
	}
	if _, ok := got[0].Payload["status"]; ok {
		t.Errorf("text deltas should not carry status")
	}
}

func TestMapACPSessionUpdate_AgentThoughtChunk(t *testing.T) {
	got := mapACPSessionUpdate(acp.UpdateAgentThoughtText("reasoning..."))
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

func TestMapACPSessionUpdate_ToolCallCompletedEmitsResult(t *testing.T) {
	got := mapACPSessionUpdate(acp.StartToolCall(
		"tc_1",
		"read file",
		acp.WithStartKind(acp.ToolKindRead),
		acp.WithStartStatus(acp.ToolCallStatusCompleted),
		acp.WithStartRawInput(map[string]any{"path": "/tmp/a.txt"}),
		acp.WithStartRawOutput(map[string]any{"ok": true}),
	))
	if len(got) != 2 {
		t.Fatalf("expected tool_call + tool_result, got %d", len(got))
	}
	if got[0].EventType != BusEventToolCall || got[0].Payload["tool_call_id"] != "tc_1" {
		t.Errorf("tool_call event wrong: %+v", got[0])
	}
	if got[0].Payload["toolName"] != "read file" {
		t.Errorf("tool_call toolName = %v, want read file", got[0].Payload["toolName"])
	}
	if input, ok := got[0].Payload["input"].(map[string]any); !ok || input["path"] != "/tmp/a.txt" {
		t.Errorf("tool_call input = %v, want map with path /tmp/a.txt", got[0].Payload["input"])
	}
	if got[1].EventType != BusEventToolResult {
		t.Fatalf("second event = %q, want %q", got[1].EventType, BusEventToolResult)
	}
	if got[1].Payload["toolName"] != "read file" {
		t.Errorf("tool_result toolName = %v, want read file", got[1].Payload["toolName"])
	}
	if got[1].Payload["raw_output"] != `{"ok":true}` {
		t.Errorf("raw_output = %v, want {\"ok\":true}", got[1].Payload["raw_output"])
	}
}

func TestMapACPSessionUpdate_ToolCallInProgressNoResult(t *testing.T) {
	got := mapACPSessionUpdate(acp.StartToolCall(
		"tc_2",
		"read file",
		acp.WithStartStatus(acp.ToolCallStatusInProgress),
	))
	if len(got) != 1 || got[0].EventType != BusEventToolCall {
		t.Fatalf("in-progress tool call should emit only tool_call, got %+v", got)
	}
	if got[0].Payload["status"] != "in_progress" {
		t.Errorf("status = %v, want in_progress", got[0].Payload["status"])
	}
	if got[0].Payload["toolName"] != "read file" {
		t.Errorf("toolName = %v, want read file", got[0].Payload["toolName"])
	}
}

func TestMapACPSessionUpdate_ToolCallToolNameKindFallback(t *testing.T) {
	got := mapACPSessionUpdate(acp.StartToolCall(
		"tc_3",
		"",
		acp.WithStartKind(acp.ToolKindExecute),
		acp.WithStartStatus(acp.ToolCallStatusInProgress),
	))
	if len(got) != 1 || got[0].EventType != BusEventToolCall {
		t.Fatalf("expected one tool_call event, got %+v", got)
	}
	if got[0].Payload["toolName"] != "execute" {
		t.Errorf("toolName = %v, want kind fallback execute", got[0].Payload["toolName"])
	}
}

func TestMapACPSessionUpdate_ToolCallNoNameFallsBackUnknown(t *testing.T) {
	got := mapACPSessionUpdate(acp.StartToolCall(
		"tc_4",
		"",
		acp.WithStartStatus(acp.ToolCallStatusInProgress),
	))
	if len(got) != 1 || got[0].EventType != BusEventToolCall {
		t.Fatalf("expected one tool_call event, got %+v", got)
	}
	if got[0].Payload["toolName"] != "unknown" {
		t.Errorf("toolName = %v, want unknown", got[0].Payload["toolName"])
	}
}

func TestMapACPSessionUpdate_UsageUpdate(t *testing.T) {
	got := mapACPSessionUpdate(acp.SessionUpdate{
		UsageUpdate: &acp.SessionUsageUpdate{Used: 120, Size: 100000},
	})
	if len(got) != 1 || got[0].EventType != BusEventContextUsage {
		t.Fatalf("expected 1 context_usage event, got %+v", got)
	}
	// Typed semantics: context window usage (used/size), not a per-turn
	// input/output split (the pre-SDK hand-rolled struct misread the schema).
	if got[0].Payload["tokens_used"] != 120 {
		t.Errorf("tokens_used = %v, want 120", got[0].Payload["tokens_used"])
	}
	if got[0].Payload["context_size"] != 100000 {
		t.Errorf("context_size = %v, want 100000", got[0].Payload["context_size"])
	}
}

func TestMapACPSessionUpdate_UnmappedVariantsYieldNothing(t *testing.T) {
	// Plan / SessionInfoUpdate / ToolCallUpdate / UserMessageChunk are
	// deliberately unmapped in Phase 2 prep until the Edge frame design is
	// approved.
	cases := []acp.SessionUpdate{
		{Plan: &acp.SessionUpdatePlan{Entries: []acp.PlanEntry{}}},
		{SessionInfoUpdate: &acp.SessionSessionInfoUpdate{}},
		{ToolCallUpdate: &acp.SessionToolCallUpdate{ToolCallId: "tc_3"}},
		{UserMessageChunk: &acp.SessionUpdateUserMessageChunk{Content: acp.TextBlock("echo")}},
	}
	for i, u := range cases {
		if got := mapACPSessionUpdate(u); len(got) != 0 {
			t.Errorf("case %d should map to nothing, got %+v", i, got)
		}
	}
}

func TestMapACPSessionUpdate_NonTextBlockNoEmit(t *testing.T) {
	// Image/audio/resource blocks are not emitted as text deltas.
	got := mapACPSessionUpdate(acp.UpdateAgentMessage(acp.ImageBlock("data", "image/png")))
	if len(got) != 0 {
		t.Errorf("image block should emit nothing, got %+v", got)
	}
	if got := mapACPSessionUpdate(acp.UpdateAgentMessageText("")); len(got) != 0 {
		t.Errorf("empty text should emit nothing, got %+v", got)
	}
}

func TestMapACPPromptResult(t *testing.T) {
	tests := []struct {
		name    string
		res     acp.PromptResponse
		wantNil bool
		reason  string
	}{
		{name: "end_turn", res: acp.PromptResponse{StopReason: acp.StopReasonEndTurn}, reason: "end_turn"},
		{name: "tool_use", res: acp.PromptResponse{StopReason: acp.StopReasonMaxTurnRequests}, reason: "max_turn_requests"},
		{name: "cancelled", res: acp.PromptResponse{StopReason: acp.StopReasonCancelled}, reason: "cancelled"},
		{name: "empty", res: acp.PromptResponse{}, wantNil: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := mapACPPromptResult(tt.res)
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
