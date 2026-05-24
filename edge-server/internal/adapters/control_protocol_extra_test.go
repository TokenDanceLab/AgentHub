package adapters

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
)

// --- PermissionRequest / PermissionDecision struct tests ---

func TestPermissionRequestFields(t *testing.T) {
	req := PermissionRequest{
		RequestID: "req-perm-1",
		ToolName:  "Bash",
		ToolUseID: "tu-abc",
		Input:     map[string]any{"command": "ls"},
	}
	if req.RequestID != "req-perm-1" {
		t.Fatalf("RequestID = %q, want req-perm-1", req.RequestID)
	}
	if req.ToolName != "Bash" {
		t.Fatalf("ToolName = %q, want Bash", req.ToolName)
	}
	if req.ToolUseID != "tu-abc" {
		t.Fatalf("ToolUseID = %q, want tu-abc", req.ToolUseID)
	}
	input, ok := req.Input.(map[string]any)
	if !ok {
		t.Fatal("Input is not map[string]any")
	}
	if input["command"] != "ls" {
		t.Fatalf("Input.command = %q, want ls", input["command"])
	}
}

func TestPermissionDecisionAllow(t *testing.T) {
	dec := PermissionDecision{
		Behavior: "allow",
		Message:  "",
	}
	if dec.Behavior != "allow" {
		t.Fatalf("Behavior = %q, want allow", dec.Behavior)
	}
	if dec.Message != "" {
		t.Fatalf("Message = %q, want empty", dec.Message)
	}
}

func TestPermissionDecisionDeny(t *testing.T) {
	dec := PermissionDecision{
		Behavior: "deny",
		Message:  "tool not in allowlist",
	}
	if dec.Behavior != "deny" {
		t.Fatalf("Behavior = %q, want deny", dec.Behavior)
	}
	if dec.Message != "tool not in allowlist" {
		t.Fatalf("Message = %q, want 'tool not in allowlist'", dec.Message)
	}
}

// --- ControlMessage struct parsing tests ---

func TestControlMessageParsing(t *testing.T) {
	raw := []byte(`{"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Read"}}`)
	var msg ControlMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal ControlMessage: %v", err)
	}
	if msg.Type != "control_request" {
		t.Fatalf("Type = %q, want control_request", msg.Type)
	}
	if msg.RequestID != "r1" {
		t.Fatalf("RequestID = %q, want r1", msg.RequestID)
	}
	if msg.Response != nil {
		t.Fatal("Response should be nil for control_request")
	}
	var inner ControlRequestInner
	if err := json.Unmarshal(msg.Request, &inner); err != nil {
		t.Fatalf("unmarshal inner: %v", err)
	}
	if inner.Subtype != "can_use_tool" {
		t.Fatalf("Subtype = %q, want can_use_tool", inner.Subtype)
	}
	if inner.ToolName != "Read" {
		t.Fatalf("ToolName = %q, want Read", inner.ToolName)
	}
}

func TestControlMessageResponseParsing(t *testing.T) {
	raw := []byte(`{"type":"control_response","request_id":"r2","response":{"subtype":"success","behavior":"allow"}}`)
	var msg ControlMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal ControlMessage: %v", err)
	}
	if msg.Type != "control_response" {
		t.Fatalf("Type = %q, want control_response", msg.Type)
	}
	var inner ControlResponseInner
	if err := json.Unmarshal(msg.Response, &inner); err != nil {
		t.Fatalf("unmarshal inner response: %v", err)
	}
	if inner.Subtype != "success" {
		t.Fatalf("Subtype = %q, want success", inner.Subtype)
	}
	if inner.Behavior != "allow" {
		t.Fatalf("Behavior = %q, want allow", inner.Behavior)
	}
}

// --- ControlRequestInner full fields round-trip ---

func TestControlRequestInnerFullFields(t *testing.T) {
	maxTokens := 32000
	inner := ControlRequestInner{
		Subtype:               "set_model",
		ToolName:              "Bash",
		Input:                 map[string]any{"cmd": "ls"},
		ToolUseID:             "tu-123",
		PermissionSuggestions: []any{map[string]any{"tool": "Read"}},
		AgentID:               "agent-1",
		Description:           "Run a command",
		TaskID:                "task-1",
		Mode:                  "default",
		Model:                 "claude-sonnet-4-6",
		MaxThinkingTokens:     &maxTokens,
	}
	raw, err := json.Marshal(inner)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var parsed ControlRequestInner
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if parsed.Subtype != "set_model" {
		t.Fatalf("Subtype = %q, want set_model", parsed.Subtype)
	}
	if parsed.ToolName != "Bash" {
		t.Fatalf("ToolName = %q, want Bash", parsed.ToolName)
	}
	if parsed.AgentID != "agent-1" {
		t.Fatalf("AgentID = %q, want agent-1", parsed.AgentID)
	}
	if parsed.Description != "Run a command" {
		t.Fatalf("Description = %q, want 'Run a command'", parsed.Description)
	}
	if parsed.TaskID != "task-1" {
		t.Fatalf("TaskID = %q, want task-1", parsed.TaskID)
	}
	if parsed.Mode != "default" {
		t.Fatalf("Mode = %q, want default", parsed.Mode)
	}
	if parsed.Model != "claude-sonnet-4-6" {
		t.Fatalf("Model = %q, want claude-sonnet-4-6", parsed.Model)
	}
	if parsed.MaxThinkingTokens == nil || *parsed.MaxThinkingTokens != 32000 {
		t.Fatal("MaxThinkingTokens mismatch")
	}
}

// --- ControlResponseInner full fields round-trip ---

func TestControlResponseInnerFullFields(t *testing.T) {
	updatedInput := map[string]any{"file": "modified.txt"}
	inner := ControlResponseInner{
		Subtype:            "success",
		RequestID:          "req-full",
		Behavior:           "allow",
		UpdatedInput:       updatedInput,
		Message:            "approved",
		Interrupt:          false,
		ToolUseID:          "tu-full",
		DecisionClass:      "safe",
		UpdatedPermissions: []any{map[string]any{"tool": "Read", "allow": true}},
		Error:              "",
	}
	raw, err := json.Marshal(inner)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var parsed ControlResponseInner
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if parsed.Subtype != "success" {
		t.Fatalf("Subtype = %q, want success", parsed.Subtype)
	}
	if parsed.RequestID != "req-full" {
		t.Fatalf("RequestID = %q, want req-full", parsed.RequestID)
	}
	if parsed.Behavior != "allow" {
		t.Fatalf("Behavior = %q, want allow", parsed.Behavior)
	}
	if parsed.Message != "approved" {
		t.Fatalf("Message = %q, want approved", parsed.Message)
	}
	if parsed.ToolUseID != "tu-full" {
		t.Fatalf("ToolUseID = %q, want tu-full", parsed.ToolUseID)
	}
	if parsed.DecisionClass != "safe" {
		t.Fatalf("DecisionClass = %q, want safe", parsed.DecisionClass)
	}
	if parsed.Error != "" {
		t.Fatalf("Error = %q, want empty", parsed.Error)
	}
}

// --- handleCanUseTool: response format validation ---

func TestHandleCanUseToolResponseFormat(t *testing.T) {
	// Test with nil emitter (untyped nil — not wrapped in interface)
	t.Run("silent auto-approve", func(t *testing.T) {
		handler := &DefaultPermissionHandler{} // nil emitter = silent auto-approve
		var buf bytes.Buffer
		err := handler.handleCanUseTool(&buf, "req-fmt", &ControlRequestInner{
			Subtype:  "can_use_tool",
			ToolName: "Read",
			ToolUseID: "tu-fmt",
		})
		if err != nil {
			t.Fatalf("handleCanUseTool: %v", err)
		}
		data := buf.Bytes()
		if len(data) == 0 {
			t.Fatal("no output written")
		}
		if data[len(data)-1] != '\n' {
			t.Fatal("output does not end with newline")
		}
		var resp ControlMessage
		if err := json.Unmarshal(data, &resp); err != nil {
			t.Fatalf("output is not valid JSON: %v", err)
		}
		if resp.Type != "control_response" {
			t.Fatalf("Type = %q, want control_response", resp.Type)
		}
		var innerResp ControlResponseInner
		if err := json.Unmarshal(resp.Response, &innerResp); err != nil {
			t.Fatalf("inner response not valid JSON: %v", err)
		}
		if innerResp.Behavior != "allow" {
			t.Fatalf("Behavior = %q, want allow", innerResp.Behavior)
		}
	})

	t.Run("with emitter", func(t *testing.T) {
		emitter := &mockEventEmitter{}
		handler := &DefaultPermissionHandler{emitter: emitter}
		var buf bytes.Buffer
		err := handler.handleCanUseTool(&buf, "req-fmt", &ControlRequestInner{
			Subtype:  "can_use_tool",
			ToolName: "Read",
			ToolUseID: "tu-fmt",
		})
		if err != nil {
			t.Fatalf("handleCanUseTool: %v", err)
		}
		data := buf.Bytes()
		if len(data) == 0 {
			t.Fatal("no output written")
		}
		if data[len(data)-1] != '\n' {
			t.Fatal("output does not end with newline")
		}
		var resp ControlMessage
		if err := json.Unmarshal(data, &resp); err != nil {
			t.Fatalf("output is not valid JSON: %v", err)
		}
		if resp.Type != "control_response" {
			t.Fatalf("Type = %q, want control_response", resp.Type)
		}
		var innerResp ControlResponseInner
		if err := json.Unmarshal(resp.Response, &innerResp); err != nil {
			t.Fatalf("inner response not valid JSON: %v", err)
		}
		if innerResp.Behavior != "allow" {
			t.Fatalf("Behavior = %q, want allow", innerResp.Behavior)
		}
	})
}

// --- handleCanUseTool: verify all necessary response fields ---

func TestHandleCanUseToolResponseFields(t *testing.T) {
	handler := &DefaultPermissionHandler{}
	var buf bytes.Buffer
	err := handler.handleCanUseTool(&buf, "req-fields", &ControlRequestInner{
		Subtype:  "can_use_tool",
		ToolName: "Write",
		ToolUseID: "tu-fields",
		Input:    map[string]any{"file": "/tmp/test.txt", "content": "hello"},
	})
	if err != nil {
		t.Fatalf("handleCanUseTool: %v", err)
	}
	var outer ControlMessage
	if err := json.Unmarshal(buf.Bytes(), &outer); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if outer.Type != "control_response" {
		t.Fatalf("outer.Type = %q, want control_response", outer.Type)
	}
	if outer.RequestID != "req-fields" {
		t.Fatalf("outer.RequestID = %q, want req-fields", outer.RequestID)
	}
	if len(outer.Request) > 0 {
		t.Fatalf("outer.Request should be empty for response, got %s", outer.Request)
	}
	if len(outer.Response) == 0 {
		t.Fatal("outer.Response should not be empty")
	}
	var inner ControlResponseInner
	if err := json.Unmarshal(outer.Response, &inner); err != nil {
		t.Fatalf("unmarshal inner: %v", err)
	}
	if inner.Subtype != "success" {
		t.Fatalf("inner.Subtype = %q, want success", inner.Subtype)
	}
	if inner.RequestID != "req-fields" {
		t.Fatalf("inner.RequestID = %q, want req-fields", inner.RequestID)
	}
	if inner.Behavior != "allow" {
		t.Fatalf("inner.Behavior = %q, want allow", inner.Behavior)
	}
	if inner.ToolUseID != "tu-fields" {
		t.Fatalf("inner.ToolUseID = %q, want tu-fields", inner.ToolUseID)
	}
}

// --- DefaultPermissionHandler auto-approves all common tool types ---

func TestDefaultPermissionHandlerAlwaysAllows(t *testing.T) {
	tools := []string{"Bash", "Read", "Write", "Grep", "WebFetch", "WebSearch", "Task", "AskUserQuestion"}
	for _, tool := range tools {
		inner, _ := json.Marshal(ControlRequestInner{
			Subtype:  "can_use_tool",
			ToolName: tool,
			ToolUseID: "tu-" + tool,
		})
		msg := ControlMessage{
			Type:      "control_request",
			RequestID: "req-" + tool,
			Request:   inner,
		}
		handler := &DefaultPermissionHandler{}
		var buf bytes.Buffer
		err := handler.HandleControlRequest(context.Background(), &buf, msg)
		if err != nil {
			t.Fatalf("%s: HandleControlRequest: %v", tool, err)
		}
		var resp ControlMessage
		if err := json.Unmarshal(buf.Bytes(), &resp); err != nil {
			t.Fatalf("%s: unmarshal: %v", tool, err)
		}
		var innerResp ControlResponseInner
		if err := json.Unmarshal(resp.Response, &innerResp); err != nil {
			t.Fatalf("%s: inner unmarshal: %v", tool, err)
		}
		if innerResp.Behavior != "allow" {
			t.Fatalf("%s: Behavior = %q, want allow", tool, innerResp.Behavior)
		}
	}
}

// --- handleCanUseTool: emitter events carry correct payload data ---

func TestHandleCanUseToolEmitterPayloads(t *testing.T) {
	emitter := &mockEventEmitter{}
	handler := &DefaultPermissionHandler{emitter: emitter}
	var buf bytes.Buffer
	err := handler.handleCanUseTool(&buf, "req-payload", &ControlRequestInner{
		Subtype:  "can_use_tool",
		ToolName: "Write",
		ToolUseID: "tu-payload",
		Input:    map[string]any{"file_path": "/out.txt", "content": "hi"},
	})
	if err != nil {
		t.Fatalf("handleCanUseTool: %v", err)
	}
	events := emitter.pop()
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(events))
	}
	if events[0].eventType != "run.agent.permission_requested" {
		t.Fatalf("event[0].type = %q", events[0].eventType)
	}
	p0 := events[0].payload.(map[string]any)
	if p0["requestId"] != "req-payload" {
		t.Fatalf("event[0].requestId = %q", p0["requestId"])
	}
	if p0["toolName"] != "Write" {
		t.Fatalf("event[0].toolName = %q", p0["toolName"])
	}
	if p0["toolUseId"] != "tu-payload" {
		t.Fatalf("event[0].toolUseId = %q", p0["toolUseId"])
	}
	if events[1].eventType != "run.agent.permission_decided" {
		t.Fatalf("event[1].type = %q", events[1].eventType)
	}
	p1 := events[1].payload.(map[string]any)
	if p1["requestId"] != "req-payload" {
		t.Fatalf("event[1].requestId = %q", p1["requestId"])
	}
	if p1["decision"] != "allow" {
		t.Fatalf("event[1].decision = %q", p1["decision"])
	}
}

// --- Write* inner content verification ---

func TestWriteInterruptInnerContent(t *testing.T) {
	var buf bytes.Buffer
	if err := WriteInterrupt(&buf, "interrupt-1"); err != nil {
		t.Fatalf("WriteInterrupt: %v", err)
	}
	var msg ControlMessage
	json.Unmarshal(buf.Bytes(), &msg)
	var inner ControlRequestInner
	json.Unmarshal(msg.Request, &inner)
	if inner.Subtype != "interrupt" {
		t.Fatalf("Subtype = %q, want interrupt", inner.Subtype)
	}
}

func TestWriteStopTaskInnerContent(t *testing.T) {
	var buf bytes.Buffer
	if err := WriteStopTask(&buf, "stop-1", "task-sub-123"); err != nil {
		t.Fatalf("WriteStopTask: %v", err)
	}
	var msg ControlMessage
	json.Unmarshal(buf.Bytes(), &msg)
	var inner ControlRequestInner
	json.Unmarshal(msg.Request, &inner)
	if inner.Subtype != "stop_task" {
		t.Fatalf("Subtype = %q, want stop_task", inner.Subtype)
	}
	if inner.TaskID != "task-sub-123" {
		t.Fatalf("TaskID = %q, want task-sub-123", inner.TaskID)
	}
}

// --- Interface compliance ---

func TestDefaultPermissionHandlerSatisfiesControlHandler(t *testing.T) {
	// Compile-time check: DefaultPermissionHandler implements ControlHandler
	var _ ControlHandler = (*DefaultPermissionHandler)(nil)
	// If we reach here, the interface is satisfied
}
