package adapters

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

// mockEmitter captures emitted events for test verification.
type mockEmitter struct {
	mu     sync.Mutex
	events []emittedEvent
}

type emittedEvent struct {
	Type    string
	Scope   map[string]any
	Payload map[string]any
}

func (m *mockEmitter) Emit(eventType string, scope map[string]any, payload any) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, _ := payload.(map[string]any)
	if p == nil {
		p = map[string]any{}
	}
	m.events = append(m.events, emittedEvent{Type: eventType, Scope: scope, Payload: p})
}

func (m *mockEmitter) eventsOfType(typ string) []emittedEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	var result []emittedEvent
	for _, e := range m.events {
		if e.Type == typ {
			result = append(result, e)
		}
	}
	return result
}

func testRun() store.Run {
	return store.Run{
		ID:        "run_test",
		ProjectID: "proj_test",
		ThreadID:  "thread_test",
		Status:    "started",
	}
}

func parseLines(t *testing.T, input string) *mockEmitter {
	t.Helper()
	emitter := &mockEmitter{}
	parser := NewNDJSONStreamParser(emitter, testRun())
	ctx := context.Background()
	if err := parser.Parse(ctx, strings.NewReader(input)); err != nil {
		t.Fatalf("Parse failed: %v", err)
	}
	return emitter
}

func TestSystemInit(t *testing.T) {
	input := `{"type":"system","subtype":"init","model":"claude-sonnet-4-6","tools":["Read","Write","Bash"],"mcp_servers":[{"name":"filesystem","status":"connected"}],"permissionMode":"default","session_id":"ses_abc","version":"1.0.0"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventSessionInit)
	if len(events) != 1 {
		t.Fatalf("expected 1 session_init, got %d", len(events))
	}
	if events[0].Payload["model"] != "claude-sonnet-4-6" {
		t.Errorf("model = %v", events[0].Payload["model"])
	}
}

func TestAssistantTextBlock(t *testing.T) {
	input := `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello world"}],"model":"claude-sonnet-4-6"},"session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventTextBlock)
	if len(events) != 1 {
		t.Fatalf("expected 1 text_block, got %d", len(events))
	}
	if events[0].Payload["content"] != "Hello world" {
		t.Errorf("content = %v", events[0].Payload["content"])
	}
}

func TestAssistantToolUse(t *testing.T) {
	input := `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_01A","name":"Read","input":{"file_path":"/etc/hosts"}}]},"session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_call, got %d", len(events))
	}
	if events[0].Payload["callId"] != "toolu_01A" {
		t.Errorf("callId = %v", events[0].Payload["callId"])
	}
	if events[0].Payload["toolName"] != "Read" {
		t.Errorf("toolName = %v", events[0].Payload["toolName"])
	}
}

func TestAssistantThinking(t *testing.T) {
	input := `{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Let me analyze this..."}]},"session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventThinking)
	if len(events) != 1 {
		t.Fatalf("expected 1 thinking, got %d", len(events))
	}
}

func TestStreamEventTextDelta(t *testing.T) {
	input := `{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}},"session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventTextDelta)
	if len(events) != 1 {
		t.Fatalf("expected 1 text_delta, got %d", len(events))
	}
	if events[0].Payload["content"] != "Hello" {
		t.Errorf("content = %v", events[0].Payload["content"])
	}
}

func TestStreamEventToolUseStart(t *testing.T) {
	input := `{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_02B","name":"Write","input":{}}},"session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_call, got %d", len(events))
	}
	if events[0].Payload["status"] != "started" {
		t.Errorf("status = %v", events[0].Payload["status"])
	}
}

func TestUserToolResult(t *testing.T) {
	input := `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01A","content":"127.0.0.1 localhost","is_error":false}]},"session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventToolResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_result, got %d", len(events))
	}
	if events[0].Payload["callId"] != "toolu_01A" {
		t.Errorf("callId = %v", events[0].Payload["callId"])
	}
}

func TestFileChangeOnWriteToolResult(t *testing.T) {
	// First emit the assistant message with Write tool to register the tool name
	input := strings.Join([]string{
		`{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_write","name":"Write","input":{"file_path":"/test.txt"}}]},"session_id":"ses_abc"}`,
		`{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_write","content":"File written successfully.","is_error":false}]},"session_id":"ses_abc"}`,
	}, "\n")
	emitter := parseLines(t, input)

	// Should have tool_call for the Write
	events := emitter.eventsOfType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_call, got %d", len(events))
	}

	// Should have file_change for the Write result
	fc := emitter.eventsOfType(BusEventFileChange)
	if len(fc) != 1 {
		t.Fatalf("expected 1 file_change, got %d", len(fc))
	}
	if fc[0].Payload["toolName"] != "Write" {
		t.Errorf("toolName = %v", fc[0].Payload["toolName"])
	}
	if fc[0].Payload["callId"] != "toolu_write" {
		t.Errorf("callId = %v", fc[0].Payload["callId"])
	}

	// Should NOT have file_change for Read tool
	noFc := emitter.eventsOfType(BusEventFileChange)
	if len(noFc) != 1 {
		t.Fatalf("expected exactly 1 file_change total, got %d", len(noFc))
	}
}

func TestFileChangeOnEditToolResult(t *testing.T) {
	input := strings.Join([]string{
		`{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_edit","name":"Edit","input":{"file_path":"/test.txt","old_string":"a","new_string":"b"}}]},"session_id":"ses_abc"}`,
		`{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_edit","content":"File updated.","is_error":false}]},"session_id":"ses_abc"}`,
	}, "\n")
	emitter := parseLines(t, input)

	fc := emitter.eventsOfType(BusEventFileChange)
	if len(fc) != 1 {
		t.Fatalf("expected 1 file_change for Edit, got %d", len(fc))
	}
	if fc[0].Payload["toolName"] != "Edit" {
		t.Errorf("toolName = %v", fc[0].Payload["toolName"])
	}
}

func TestResultSuccess(t *testing.T) {
	input := `{"type":"result","subtype":"success","is_error":false,"duration_ms":4500,"num_turns":3,"result":"Done.","session_id":"ses_abc","usage":{"input_tokens":1200,"output_tokens":800}}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 result, got %d", len(events))
	}
	if events[0].Payload["success"] != true {
		t.Errorf("success = %v", events[0].Payload["success"])
	}
	if u, ok := events[0].Payload["usage"]; !ok || u == nil {
		t.Error("usage should be present")
	}
}

func TestResultError(t *testing.T) {
	input := `{"type":"result","subtype":"error_during_execution","is_error":true,"duration_ms":2000,"errors":["Permission denied"],"session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 result, got %d", len(events))
	}
	if events[0].Payload["success"] != false {
		t.Errorf("success = %v", events[0].Payload["success"])
	}
}

func TestToolProgress(t *testing.T) {
	input := `{"type":"tool_progress","tool_use_id":"toolu_03C","tool_name":"Bash","elapsed_time_seconds":2.5,"session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_call (from tool_progress), got %d", len(events))
	}
	if events[0].Payload["status"] != "in_progress" {
		t.Errorf("status = %v", events[0].Payload["status"])
	}
	if events[0].Payload["toolUseId"] != "toolu_03C" {
		t.Errorf("toolUseId = %v", events[0].Payload["toolUseId"])
	}
}

func TestCompactBoundary(t *testing.T) {
	input := `{"type":"system","subtype":"compact_boundary","trigger":"auto","pre_tokens":85000,"session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventCompactBoundary)
	if len(events) != 1 {
		t.Fatalf("expected 1 compact_boundary, got %d", len(events))
	}
}

func TestStatusChange(t *testing.T) {
	input := `{"type":"system","subtype":"status","status":"compacting","session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventStatusChange)
	if len(events) != 1 {
		t.Fatalf("expected 1 status_change, got %d", len(events))
	}
}

func TestAPIRetry(t *testing.T) {
	input := `{"type":"system","subtype":"api_retry","attempt":2,"max_retries":3,"retry_delay_ms":5000,"error_status":429,"session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventAPIRetry)
	if len(events) != 1 {
		t.Fatalf("expected 1 api_retry, got %d", len(events))
	}
}

func TestTaskLifecycle(t *testing.T) {
	input := strings.Join([]string{
		`{"type":"system","subtype":"task_started","task_id":"task_1","tool_use_id":"toolu_p","description":"Analyzing code","task_type":"local_agent","session_id":"ses_abc"}`,
		`{"type":"system","subtype":"task_progress","task_id":"task_1","description":"Reading files","last_tool_name":"Read","session_id":"ses_abc"}`,
		`{"type":"system","subtype":"task_notification","task_id":"task_1","status":"completed","summary":"Found 3 issues","session_id":"ses_abc"}`,
	}, "\n")
	emitter := parseLines(t, input)

	if len(emitter.eventsOfType(BusEventTaskStarted)) != 1 {
		t.Error("missing task_started")
	}
	if len(emitter.eventsOfType(BusEventTaskProgress)) != 1 {
		t.Error("missing task_progress")
	}
	if len(emitter.eventsOfType(BusEventTaskNotification)) != 1 {
		t.Error("missing task_notification")
	}
}

func TestSessionStateChanged(t *testing.T) {
	input := `{"type":"system","subtype":"session_state_changed","state":"idle","session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventSessionStateChanged)
	if len(events) != 1 {
		t.Fatalf("expected 1 session_state_changed, got %d", len(events))
	}
}

func TestHookLifecycle(t *testing.T) {
	input := strings.Join([]string{
		`{"type":"system","subtype":"hook_started","hook_id":"h1","hook_name":"my-hook","hook_event":"PreToolUse","session_id":"ses_abc"}`,
		`{"type":"system","subtype":"hook_progress","hook_id":"h1","hook_name":"my-hook","stdout":"running","session_id":"ses_abc"}`,
		`{"type":"system","subtype":"hook_response","hook_id":"h1","hook_name":"my-hook","outcome":"success","exit_code":0,"session_id":"ses_abc"}`,
	}, "\n")
	emitter := parseLines(t, input)

	if len(emitter.eventsOfType(BusEventHookStarted)) != 1 {
		t.Error("missing hook_started")
	}
	if len(emitter.eventsOfType(BusEventHookProgress)) != 1 {
		t.Error("missing hook_progress")
	}
	if len(emitter.eventsOfType(BusEventHookResponse)) != 1 {
		t.Error("missing hook_response")
	}
}

func TestToolUseSummary(t *testing.T) {
	input := `{"type":"tool_use_summary","summary":"Read 2 files","preceding_tool_use_ids":["toolu_a","toolu_b"],"session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventToolUseSummary)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_use_summary, got %d", len(events))
	}
	if events[0].Payload["summary"] != "Read 2 files" {
		t.Errorf("summary = %v", events[0].Payload["summary"])
	}
}

func TestAuthStatus(t *testing.T) {
	input := `{"type":"auth_status","isAuthenticating":true,"output":["Opening browser..."],"session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventAuthStatus)
	if len(events) != 1 {
		t.Fatalf("expected 1 auth_status, got %d", len(events))
	}
}

func TestRateLimitEvent(t *testing.T) {
	input := `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1716500000000,"utilization":0.85},"session_id":"ses_abc"}`
	emitter := parseLines(t, input)

	events := emitter.eventsOfType(BusEventRateLimit)
	if len(events) != 1 {
		t.Fatalf("expected 1 rate_limit, got %d", len(events))
	}
}

func TestSkippedUnparseableLine(t *testing.T) {
	input := "this is not json\n{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"valid\"}]},\"session_id\":\"ses_abc\"}"
	emitter := parseLines(t, input)

	// Only the valid JSON line should be processed
	events := emitter.eventsOfType(BusEventTextBlock)
	if len(events) != 1 {
		t.Fatalf("expected 1 text_block from valid line, got %d", len(events))
	}
}

func TestControlRequestIgnoredWithoutHandler(t *testing.T) {
	// Without a control handler, control_request should be silently skipped
	input := `{"type":"control_request","request_id":"req_1","request":{"subtype":"can_use_tool","tool_name":"Bash","tool_use_id":"toolu_x","input":{"command":"ls"}}}`
	emitter := parseLines(t, input)

	// No events should be emitted
	if len(emitter.events) != 0 {
		t.Fatalf("expected 0 events from control_request without handler, got %d", len(emitter.events))
	}
}
