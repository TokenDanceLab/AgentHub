package adapters

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"
)

// --- mockEventEmitter ---

type mockEventEmitter struct {
	mu     sync.Mutex
	events []struct {
		eventType string
		payload   any
	}
}

func (m *mockEventEmitter) Emit(eventType string, _ map[string]any, payload any) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, struct {
		eventType string
		payload   any
	}{eventType, payload})
}

func (m *mockEventEmitter) pop() []struct {
	eventType string
	payload   any
} {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := m.events
	m.events = nil
	return out
}

// --- Write* JSON output tests ---

func TestWriteInterrupt(t *testing.T) {
	var buf bytes.Buffer
	err := WriteInterrupt(&buf, "req-1")
	if err != nil {
		t.Fatalf("WriteInterrupt: %v", err)
	}

	var msg ControlMessage
	if err := json.Unmarshal(buf.Bytes(), &msg); err != nil {
		t.Fatalf("unmarshal output: %v", err)
	}
	if msg.Type != "control_request" {
		t.Fatalf("Type = %q, want control_request", msg.Type)
	}
	if msg.RequestID != "req-1" {
		t.Fatalf("RequestID = %q, want req-1", msg.RequestID)
	}

	var inner ControlRequestInner
	if err := json.Unmarshal(msg.Request, &inner); err != nil {
		t.Fatalf("unmarshal inner request: %v", err)
	}
	if inner.Subtype != "interrupt" {
		t.Fatalf("Subtype = %q, want interrupt", inner.Subtype)
	}
}

func TestWriteSetModel(t *testing.T) {
	var buf bytes.Buffer
	err := WriteSetModel(&buf, "req-2", "claude-sonnet-4-6")
	if err != nil {
		t.Fatalf("WriteSetModel: %v", err)
	}

	var msg ControlMessage
	if err := json.Unmarshal(buf.Bytes(), &msg); err != nil {
		t.Fatalf("unmarshal output: %v", err)
	}
	if msg.Type != "control_request" {
		t.Fatalf("Type = %q, want control_request", msg.Type)
	}

	var inner ControlRequestInner
	if err := json.Unmarshal(msg.Request, &inner); err != nil {
		t.Fatalf("unmarshal inner request: %v", err)
	}
	if inner.Subtype != "set_model" {
		t.Fatalf("Subtype = %q, want set_model", inner.Subtype)
	}
	if inner.Model != "claude-sonnet-4-6" {
		t.Fatalf("Model = %q, want claude-sonnet-4-6", inner.Model)
	}
}

func TestWriteSetPermissionMode(t *testing.T) {
	var buf bytes.Buffer
	err := WriteSetPermissionMode(&buf, "req-3", "acceptEdits")
	if err != nil {
		t.Fatalf("WriteSetPermissionMode: %v", err)
	}

	var msg ControlMessage
	if err := json.Unmarshal(buf.Bytes(), &msg); err != nil {
		t.Fatalf("unmarshal output: %v", err)
	}
	if msg.Type != "control_request" {
		t.Fatalf("Type = %q, want control_request", msg.Type)
	}

	var inner ControlRequestInner
	if err := json.Unmarshal(msg.Request, &inner); err != nil {
		t.Fatalf("unmarshal inner request: %v", err)
	}
	if inner.Subtype != "set_permission_mode" {
		t.Fatalf("Subtype = %q, want set_permission_mode", inner.Subtype)
	}
	if inner.Mode != "acceptEdits" {
		t.Fatalf("Mode = %q, want acceptEdits", inner.Mode)
	}
}

func TestWriteStopTask(t *testing.T) {
	var buf bytes.Buffer
	err := WriteStopTask(&buf, "req-4", "task-abc")
	if err != nil {
		t.Fatalf("WriteStopTask: %v", err)
	}

	var msg ControlMessage
	if err := json.Unmarshal(buf.Bytes(), &msg); err != nil {
		t.Fatalf("unmarshal output: %v", err)
	}
	if msg.Type != "control_request" {
		t.Fatalf("Type = %q, want control_request", msg.Type)
	}

	var inner ControlRequestInner
	if err := json.Unmarshal(msg.Request, &inner); err != nil {
		t.Fatalf("unmarshal inner request: %v", err)
	}
	if inner.Subtype != "stop_task" {
		t.Fatalf("Subtype = %q, want stop_task", inner.Subtype)
	}
	if inner.TaskID != "task-abc" {
		t.Fatalf("TaskID = %q, want task-abc", inner.TaskID)
	}
}

func TestWriteStopTaskEmptyTaskID(t *testing.T) {
	var buf bytes.Buffer
	err := WriteStopTask(&buf, "req-5", "")
	if err != nil {
		t.Fatalf("WriteStopTask with empty taskID: %v", err)
	}

	var msg ControlMessage
	if err := json.Unmarshal(buf.Bytes(), &msg); err != nil {
		t.Fatalf("unmarshal output: %v", err)
	}
	var inner ControlRequestInner
	if err := json.Unmarshal(msg.Request, &inner); err != nil {
		t.Fatalf("unmarshal inner request: %v", err)
	}
	if inner.TaskID != "" {
		t.Fatalf("TaskID = %q, want empty", inner.TaskID)
	}
}

// --- HandleControlRequest tests ---

func TestHandleControlRequestInitialize(t *testing.T) {
	inner, _ := json.Marshal(ControlRequestInner{Subtype: "initialize"})
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: "req-init",
		Request:   inner,
	}
	handler := &DefaultPermissionHandler{}
	var buf bytes.Buffer
	err := handler.HandleControlRequest(context.Background(), &buf, msg)
	if err != nil {
		t.Fatalf("HandleControlRequest(initialize): %v", err)
	}
	// initialize should produce no output
	if buf.Len() != 0 {
		t.Fatalf("expected empty stdout for initialize, got %d bytes", buf.Len())
	}
}

func TestHandleControlRequestUnknownSubtype(t *testing.T) {
	inner, _ := json.Marshal(ControlRequestInner{Subtype: "unknown_type"})
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: "req-unknown",
		Request:   inner,
	}
	handler := &DefaultPermissionHandler{}
	var buf bytes.Buffer
	err := handler.HandleControlRequest(context.Background(), &buf, msg)
	if err != nil {
		t.Fatalf("HandleControlRequest(unknown): %v", err)
	}
}

func TestHandleControlRequestInvalidJSON(t *testing.T) {
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: "req-bad",
		Request:   json.RawMessage("not-json"),
	}
	handler := &DefaultPermissionHandler{}
	var buf bytes.Buffer
	err := handler.HandleControlRequest(context.Background(), &buf, msg)
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

// --- handleCanUseTool tests ---

func TestHandleCanUseToolSilentAutoApprove(t *testing.T) {
	inner, _ := json.Marshal(ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "Bash",
		ToolUseID: "tooluse-1",
		Input:     map[string]any{"command": "ls"},
	})
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: "req-tool",
		Request:   inner,
	}
	handler := &DefaultPermissionHandler{} // nil emitter = silent auto-approve
	var buf bytes.Buffer
	err := handler.HandleControlRequest(context.Background(), &buf, msg)
	if err != nil {
		t.Fatalf("HandleControlRequest(can_use_tool): %v", err)
	}

	// Verify response written to stdin
	var resp ControlMessage
	if err := json.Unmarshal(buf.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.Type != "control_response" {
		t.Fatalf("Type = %q, want control_response", resp.Type)
	}
	if resp.RequestID != "req-tool" {
		t.Fatalf("RequestID = %q, want req-tool", resp.RequestID)
	}

	var innerResp ControlResponseInner
	if err := json.Unmarshal(resp.Response, &innerResp); err != nil {
		t.Fatalf("unmarshal inner response: %v", err)
	}
	if innerResp.Behavior != "allow" {
		t.Fatalf("Behavior = %q, want allow", innerResp.Behavior)
	}
	if innerResp.Subtype != "success" {
		t.Fatalf("Subtype = %q, want success", innerResp.Subtype)
	}
	if innerResp.ToolUseID != "tooluse-1" {
		t.Fatalf("ToolUseID = %q, want tooluse-1", innerResp.ToolUseID)
	}
}

func TestHandleCanUseToolWithEmitter(t *testing.T) {
	emitter := &mockEventEmitter{}
	inner, _ := json.Marshal(ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "WebFetch",
		ToolUseID: "tooluse-2",
		Input:     map[string]any{"url": "https://example.com"},
	})
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: "req-tool-2",
		Request:   inner,
	}
	handler := &DefaultPermissionHandler{emitter: emitter}
	var buf bytes.Buffer
	err := handler.HandleControlRequest(context.Background(), &buf, msg)
	if err != nil {
		t.Fatalf("HandleControlRequest(can_use_tool with emitter): %v", err)
	}

	// Verify two events emitted (permission_requested + permission_decided)
	events := emitter.pop()
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(events))
	}

	if events[0].eventType != "run.agent.permission_requested" {
		t.Fatalf("event[0].Type = %q, want run.agent.permission_requested", events[0].eventType)
	}

	reqPayload, ok := events[0].payload.(map[string]any)
	if !ok {
		t.Fatal("event[0].payload is not map[string]any")
	}
	if reqPayload["toolName"] != "WebFetch" {
		t.Fatalf("payload toolName = %q, want WebFetch", reqPayload["toolName"])
	}
	if reqPayload["requestId"] != "req-tool-2" {
		t.Fatalf("payload requestId = %q, want req-tool-2", reqPayload["requestId"])
	}

	if events[1].eventType != "run.agent.permission_decided" {
		t.Fatalf("event[1].Type = %q, want run.agent.permission_decided", events[1].eventType)
	}

	decPayload, ok := events[1].payload.(map[string]any)
	if !ok {
		t.Fatal("event[1].payload is not map[string]any")
	}
	if decPayload["decision"] != "allow" {
		t.Fatalf("payload decision = %q, want allow", decPayload["decision"])
	}
}

func TestHandleCanUseToolResponseRoundTrip(t *testing.T) {
	inner, _ := json.Marshal(ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "Write",
		ToolUseID: "tooluse-3",
		Input:     map[string]any{"file": "test.txt"},
	})
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: "req-rtt",
		Request:   inner,
	}
	handler := &DefaultPermissionHandler{}
	var buf bytes.Buffer
	if err := handler.HandleControlRequest(context.Background(), &buf, msg); err != nil {
		t.Fatalf("HandleControlRequest: %v", err)
	}

	// Full round-trip: parse as another handler would
	var resp ControlMessage
	if err := json.Unmarshal(buf.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	var innerResp ControlResponseInner
	if err := json.Unmarshal(resp.Response, &innerResp); err != nil {
		t.Fatalf("unmarshal inner response: %v", err)
	}

	if innerResp.RequestID != "req-rtt" {
		t.Fatalf("round-trip RequestID = %q, want req-rtt", innerResp.RequestID)
	}
	if innerResp.Behavior != "allow" {
		t.Fatalf("round-trip Behavior = %q, want allow", innerResp.Behavior)
	}
}

// --- NewEventEmittingPermissionHandler test ---

func TestNewEventEmittingPermissionHandler(t *testing.T) {
	emitter := &mockEventEmitter{}
	handler := NewEventEmittingPermissionHandler(emitter)
	if handler.emitter != emitter {
		t.Fatal("NewEventEmittingPermissionHandler did not store emitter")
	}
}

// --- Write* round-trip: all outputs are valid JSON followed by newline ---

func TestWriteOutputsEndWithNewline(t *testing.T) {
	var buf bytes.Buffer

	tests := []struct {
		name string
		fn   func() error
	}{
		{"WriteInterrupt", func() error { return WriteInterrupt(&buf, "r1") }},
		{"WriteSetModel", func() error { return WriteSetModel(&buf, "r2", "m") }},
		{"WriteSetPermissionMode", func() error { return WriteSetPermissionMode(&buf, "r3", "auto") }},
		{"WriteStopTask", func() error { return WriteStopTask(&buf, "r4", "t1") }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			buf.Reset()
			if err := tt.fn(); err != nil {
				t.Fatalf("%s: %v", tt.name, err)
			}
			data := buf.Bytes()
			if len(data) == 0 || data[len(data)-1] != '\n' {
				t.Fatalf("%s output does not end with newline: %q", tt.name, data)
			}
			// Verify the rest (before newline) is valid JSON
			var msg ControlMessage
			if err := json.Unmarshal(data, &msg); err != nil {
				t.Fatalf("%s output is not valid JSON: %v", tt.name, err)
			}
			if msg.Type != "control_request" {
				t.Fatalf("%s Type = %q, want control_request", tt.name, msg.Type)
			}
		})
	}
}

// --- handleCanUseTool with various tool names and inputs ---

func TestHandleCanUseToolVariousTools(t *testing.T) {
	tests := []struct {
		toolName string
		input    any
	}{
		{"Bash", map[string]any{"command": "echo hello"}},
		{"Read", map[string]any{"file_path": "/tmp/test.txt"}},
		{"Write", map[string]any{"file_path": "/tmp/out.txt", "content": "data"}},
		{"Grep", map[string]any{"pattern": "TODO"}},
		{"WebFetch", map[string]any{"url": "https://example.com"}},
		{"Task", map[string]any{"description": "build project"}},
	}
	for _, tt := range tests {
		t.Run(tt.toolName, func(t *testing.T) {
			inner, _ := json.Marshal(ControlRequestInner{
				Subtype:   "can_use_tool",
				ToolName:  tt.toolName,
				ToolUseID: "tu-" + tt.toolName,
				Input:     tt.input,
			})
			msg := ControlMessage{
				Type:      "control_request",
				RequestID: "req-" + tt.toolName,
				Request:   inner,
			}
			handler := &DefaultPermissionHandler{}
			var buf bytes.Buffer
			if err := handler.HandleControlRequest(context.Background(), &buf, msg); err != nil {
				t.Fatalf("%s: %v", tt.toolName, err)
			}

			var resp ControlMessage
			if err := json.Unmarshal(buf.Bytes(), &resp); err != nil {
				t.Fatalf("%s unmarshal: %v", tt.toolName, err)
			}
			var innerResp ControlResponseInner
			if err := json.Unmarshal(resp.Response, &innerResp); err != nil {
				t.Fatalf("%s inner unmarshal: %v", tt.toolName, err)
			}
			if innerResp.Behavior != "allow" {
				t.Fatalf("%s Behavior = %q, want allow", tt.toolName, innerResp.Behavior)
			}
			if innerResp.ToolUseID != "tu-"+tt.toolName {
				t.Fatalf("%s ToolUseID = %q, want tu-%s", tt.toolName, innerResp.ToolUseID, tt.toolName)
			}
		})
	}
}

// --- handleCanUseTool emits events in correct order ---

// --- failingWriter triggers write errors ---

type failingWriter struct{}

func (f *failingWriter) Write([]byte) (int, error) { return 0, bytes.ErrTooLarge }

func TestWriteInterruptWriteError(t *testing.T) {
	err := WriteInterrupt(&failingWriter{}, "req-err")
	if err == nil {
		t.Fatal("expected write error, got nil")
	}
}

func TestWriteSetModelWriteError(t *testing.T) {
	err := WriteSetModel(&failingWriter{}, "req-err", "m")
	if err == nil {
		t.Fatal("expected write error, got nil")
	}
}

func TestWriteSetPermissionModeWriteError(t *testing.T) {
	err := WriteSetPermissionMode(&failingWriter{}, "req-err", "auto")
	if err == nil {
		t.Fatal("expected write error, got nil")
	}
}

func TestWriteStopTaskWriteError(t *testing.T) {
	err := WriteStopTask(&failingWriter{}, "req-err", "t1")
	if err == nil {
		t.Fatal("expected write error, got nil")
	}
}

// --- handleCanUseTool with failing writer ---

func TestHandleCanUseToolWriteError(t *testing.T) {
	inner, _ := json.Marshal(ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "Bash",
		ToolUseID: "tu-err",
	})
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: "req-err",
		Request:   inner,
	}
	handler := &DefaultPermissionHandler{}
	err := handler.HandleControlRequest(context.Background(), &failingWriter{}, msg)
	if err == nil {
		t.Fatal("expected write error, got nil")
	}
}

func TestHandleCanUseToolEventsOrdered(t *testing.T) {
	emitter := &mockEventEmitter{}
	inner, _ := json.Marshal(ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "Bash",
		ToolUseID: "tu-ordered",
	})

	handler := &DefaultPermissionHandler{emitter: emitter}
	var buf bytes.Buffer
	if err := handler.HandleControlRequest(context.Background(), &buf, ControlMessage{
		Type: "control_request", RequestID: "r-ordered", Request: inner,
	}); err != nil {
		t.Fatalf("HandleControlRequest: %v", err)
	}

	events := emitter.pop()
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(events))
	}
	if events[0].eventType != "run.agent.permission_requested" {
		t.Fatal("first event must be permission_requested")
	}
	if events[1].eventType != "run.agent.permission_decided" {
		t.Fatal("second event must be permission_decided")
	}
}

// TestPermissionDeciderCallback verifies that a bridged permission handler
// blocks until the PermissionDecider callback returns a decision.
func TestPermissionDeciderCallback(t *testing.T) {
	inner, _ := json.Marshal(ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "Bash",
		ToolUseID: "tu-decide",
	})

	deciderCalled := false
	decider := func(ctx context.Context, req PermissionRequest) PermissionDecision {
		deciderCalled = true
		if req.ToolName != "Bash" {
			t.Errorf("ToolName = %q, want Bash", req.ToolName)
		}
		if req.ToolUseID != "tu-decide" {
			t.Errorf("ToolUseID = %q, want tu-decide", req.ToolUseID)
		}
		return PermissionDecision{Behavior: "allow", Message: "approved by test"}
	}

	handler := NewBridgedPermissionHandler(nil, decider)
	var buf bytes.Buffer
	if err := handler.HandleControlRequest(context.Background(), &buf, ControlMessage{
		Type: "control_request", RequestID: "r-decide", Request: inner,
	}); err != nil {
		t.Fatalf("HandleControlRequest: %v", err)
	}

	if !deciderCalled {
		t.Fatal("decider was not called")
	}

	var resp ControlMessage
	if err := json.Unmarshal(buf.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	var innerResp ControlResponseInner
	if err := json.Unmarshal(resp.Response, &innerResp); err != nil {
		t.Fatalf("inner unmarshal: %v", err)
	}
	if innerResp.Behavior != "allow" {
		t.Fatalf("Behavior = %q, want allow", innerResp.Behavior)
	}
	if innerResp.Message != "approved by test" {
		t.Fatalf("Message = %q, want 'approved by test'", innerResp.Message)
	}
}

// TestPermissionDeciderDeny verifies that a decider can deny a tool and the
// denial is propagated correctly in the control_response.
func TestPermissionDeciderDeny(t *testing.T) {
	inner, _ := json.Marshal(ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "Bash",
		ToolUseID: "tu-deny",
	})

	decider := func(ctx context.Context, req PermissionRequest) PermissionDecision {
		return PermissionDecision{Behavior: "deny", Message: "blocked by policy"}
	}

	handler := NewBridgedPermissionHandler(nil, decider)
	var buf bytes.Buffer
	if err := handler.HandleControlRequest(context.Background(), &buf, ControlMessage{
		Type: "control_request", RequestID: "r-deny", Request: inner,
	}); err != nil {
		t.Fatalf("HandleControlRequest: %v", err)
	}

	var resp ControlMessage
	if err := json.Unmarshal(buf.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	var innerResp ControlResponseInner
	if err := json.Unmarshal(resp.Response, &innerResp); err != nil {
		t.Fatalf("inner unmarshal: %v", err)
	}
	if innerResp.Behavior != "deny" {
		t.Fatalf("Behavior = %q, want deny", innerResp.Behavior)
	}
	if innerResp.Message != "blocked by policy" {
		t.Fatalf("Message = %q, want 'blocked by policy'", innerResp.Message)
	}
}

// TestChannelPermissionDecider verifies that the channel-based decider
// correctly bridges permission requests over Go channels.
func TestChannelPermissionDecider(t *testing.T) {
	inner, _ := json.Marshal(ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "Read",
		ToolUseID: "tu-channel",
	})

	reqCh := make(chan PermissionRequest, 1)
	decCh := make(chan PermissionDecision, 1)

	decider := NewChannelPermissionDecider(reqCh, decCh)

	// Simulate Desktop picking up the request in a goroutine
	go func() {
		req := <-reqCh
		if req.ToolName != "Read" {
			t.Errorf("ToolName = %q, want Read", req.ToolName)
		}
		decCh <- PermissionDecision{Behavior: "allow", DecisionClass: "user_approved"}
	}()

	handler := NewBridgedPermissionHandler(nil, decider.Decide)
	var buf bytes.Buffer
	if err := handler.HandleControlRequest(context.Background(), &buf, ControlMessage{
		Type: "control_request", RequestID: "r-channel", Request: inner,
	}); err != nil {
		t.Fatalf("HandleControlRequest: %v", err)
	}

	var resp ControlMessage
	if err := json.Unmarshal(buf.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	var innerResp ControlResponseInner
	if err := json.Unmarshal(resp.Response, &innerResp); err != nil {
		t.Fatalf("inner unmarshal: %v", err)
	}
	if innerResp.Behavior != "allow" {
		t.Fatalf("Behavior = %q, want allow", innerResp.Behavior)
	}
	if innerResp.DecisionClass != "user_approved" {
		t.Fatalf("DecisionClass = %q, want user_approved", innerResp.DecisionClass)
	}
}

func TestBrokeredPermissionHandlerWaitsForDecision(t *testing.T) {
	inner, _ := json.Marshal(ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "Bash",
		ToolUseID: "tu-broker",
		Input:     map[string]any{"command": "go test ./..."},
	})
	broker := NewPermissionDecisionBroker()
	handler := NewBrokeredPermissionHandler(nil, broker, PermissionScope{
		RunID:     "run_broker",
		ProjectID: "proj_broker",
		ThreadID:  "thread_broker",
	})
	var buf bytes.Buffer
	done := make(chan error, 1)

	go func() {
		done <- handler.HandleControlRequest(context.Background(), &buf, ControlMessage{
			Type: "control_request", RequestID: "req_broker", Request: inner,
		})
	}()

	select {
	case err := <-done:
		t.Fatalf("handler returned before decision: %v", err)
	case <-time.After(50 * time.Millisecond):
	}

	pending, ok := broker.Decide("run_broker", "req_broker", PermissionDecision{
		Behavior:      "allow",
		DecisionClass: "user_approved",
	})
	if !ok {
		t.Fatal("broker did not find pending request")
	}
	if pending.ProjectID != "proj_broker" || pending.ThreadID != "thread_broker" || pending.ToolName != "Bash" {
		t.Fatalf("pending metadata = %#v, want scoped Bash request", pending)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("HandleControlRequest: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("handler did not resume after decision")
	}

	var resp ControlMessage
	if err := json.Unmarshal(buf.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	var innerResp ControlResponseInner
	if err := json.Unmarshal(resp.Response, &innerResp); err != nil {
		t.Fatalf("inner unmarshal: %v", err)
	}
	if innerResp.Behavior != "allow" || innerResp.DecisionClass != "user_approved" {
		t.Fatalf("inner response = %#v, want allow/user_approved", innerResp)
	}
}

func TestBrokeredPermissionHandlerContextCancellationDeniesAndRemovesPending(t *testing.T) {
	inner, _ := json.Marshal(ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "Write",
		ToolUseID: "tu-timeout",
	})
	broker := NewPermissionDecisionBroker()
	handler := NewBrokeredPermissionHandler(nil, broker, PermissionScope{RunID: "run_timeout"})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	var buf bytes.Buffer

	if err := handler.HandleControlRequest(ctx, &buf, ControlMessage{
		Type: "control_request", RequestID: "req_timeout", Request: inner,
	}); err != nil {
		t.Fatalf("HandleControlRequest: %v", err)
	}
	if _, ok := broker.Decide("run_timeout", "req_timeout", PermissionDecision{Behavior: "allow"}); ok {
		t.Fatal("timed-out permission request remained pending")
	}

	var resp ControlMessage
	if err := json.Unmarshal(buf.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	var innerResp ControlResponseInner
	if err := json.Unmarshal(resp.Response, &innerResp); err != nil {
		t.Fatalf("inner unmarshal: %v", err)
	}
	if innerResp.Behavior != "deny" {
		t.Fatalf("Behavior = %q, want deny timeout fallback", innerResp.Behavior)
	}
	if !strings.Contains(innerResp.Message, "cancelled") {
		t.Fatalf("Message = %q, want explicit cancellation reason", innerResp.Message)
	}
}

func TestBrokeredPermissionHandlerFailsClosedWhenRequestCannotRegister(t *testing.T) {
	inner, _ := json.Marshal(ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "Bash",
		ToolUseID: "tu-duplicate",
	})
	broker := NewPermissionDecisionBroker()
	if _, ok := broker.Begin(PermissionScope{RunID: "run_duplicate"}, PermissionRequest{RequestID: "req_duplicate"}); !ok {
		t.Fatal("failed to seed pending permission request")
	}
	handler := NewBrokeredPermissionHandler(nil, broker, PermissionScope{RunID: "run_duplicate"})
	var buf bytes.Buffer

	if err := handler.HandleControlRequest(context.Background(), &buf, ControlMessage{
		Type: "control_request", RequestID: "req_duplicate", Request: inner,
	}); err != nil {
		t.Fatalf("HandleControlRequest: %v", err)
	}

	var resp ControlMessage
	if err := json.Unmarshal(buf.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	var innerResp ControlResponseInner
	if err := json.Unmarshal(resp.Response, &innerResp); err != nil {
		t.Fatalf("inner unmarshal: %v", err)
	}
	if innerResp.Behavior != "deny" {
		t.Fatalf("Behavior = %q, want deny duplicate fallback", innerResp.Behavior)
	}
	if !strings.Contains(innerResp.Message, "could not be registered") {
		t.Fatalf("Message = %q, want registration failure reason", innerResp.Message)
	}
}

// TestControlProtocolMissingSubtypes ensures stub handlers for subtypes
// that are not yet fully implemented return an explicit unsupported response.
func TestControlProtocolMissingSubtypes(t *testing.T) {
	subtypes := []string{
		"get_context_usage",
		"mcp_status",
		"mcp_set_servers",
		"get_settings",
		"apply_flag_settings",
		"hook_callback",
	}
	for _, subtype := range subtypes {
		t.Run(subtype, func(t *testing.T) {
			inner, _ := json.Marshal(ControlRequestInner{Subtype: subtype})
			handler := &DefaultPermissionHandler{}
			var buf bytes.Buffer
			err := handler.HandleControlRequest(context.Background(), &buf, ControlMessage{
				Type: "control_request", RequestID: "r-stub", Request: inner,
			})
			if err != nil {
				t.Fatalf("HandleControlRequest for %q returned error: %v", subtype, err)
			}
			payload := decodeControlCapabilityResponse(t, buf.Bytes(), "r-stub")
			if payload.Status != "unsupported" {
				t.Fatalf("Status = %q, want unsupported", payload.Status)
			}
			if payload.RequestID != "r-stub" {
				t.Fatalf("RequestID = %q, want r-stub", payload.RequestID)
			}
			if payload.RequestedSubtype != subtype {
				t.Fatalf("RequestedSubtype = %q, want %q", payload.RequestedSubtype, subtype)
			}
			if payload.Subtype != subtype {
				t.Fatalf("Subtype = %q, want %q", payload.Subtype, subtype)
			}
		})
	}
}
