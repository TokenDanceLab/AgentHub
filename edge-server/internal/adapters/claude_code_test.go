package adapters

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/store"
)

func TestClaudeCodeParseStreamUsesBrokeredPermissionHandler(t *testing.T) {
	adapter := NewClaudeCodeAdapter("claude", "", "")
	broker := NewPermissionDecisionBroker()
	adapter.SetPermissionBroker(broker)
	run := store.Run{ID: "run_claude_broker", ProjectID: "proj_1", ThreadID: "thread_1", Status: "started"}

	inner, _ := json.Marshal(ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "Bash",
		ToolUseID: "tool_1",
		Input:     map[string]any{"command": "git status --short"},
	})
	msg, _ := json.Marshal(ControlMessage{
		Type:      "control_request",
		RequestID: "req_1",
		Request:   inner,
	})
	var stdin bytes.Buffer
	done := make(chan error, 1)

	go func() {
		done <- adapter.ParseStream(context.Background(), strings.NewReader(string(msg)+"\n"), &stdin, &mockEventEmitter{}, run)
	}()

	select {
	case err := <-done:
		t.Fatalf("ParseStream returned before permission decision: %v", err)
	case <-time.After(50 * time.Millisecond):
	}

	pending, ok := broker.Decide("run_claude_broker", "req_1", PermissionDecision{
		Behavior:      "deny",
		Message:       "blocked by test",
		DecisionClass: "user_rejected",
	})
	if !ok {
		t.Fatal("broker did not find pending Claude permission request")
	}
	if pending.ProjectID != "proj_1" || pending.ThreadID != "thread_1" || pending.ToolName != "Bash" || pending.ToolUseID != "tool_1" {
		t.Fatalf("pending request = %#v, want scoped Claude Bash request", pending)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("ParseStream: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("ParseStream did not resume after permission decision")
	}

	var resp ControlMessage
	if err := json.Unmarshal(stdin.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal stdin response: %v", err)
	}
	var innerResp ControlResponseInner
	if err := json.Unmarshal(resp.Response, &innerResp); err != nil {
		t.Fatalf("unmarshal inner response: %v", err)
	}
	if innerResp.Behavior != "deny" || innerResp.Message != "blocked by test" || innerResp.DecisionClass != "user_rejected" {
		t.Fatalf("inner response = %#v, want denied broker decision", innerResp)
	}
}
