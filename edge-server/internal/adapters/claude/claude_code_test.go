package claude

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

// --- mockEventEmitter（源自根包 control_protocol_test.go，随 claude 家族
// 下沉；根包测试符号不可跨包引用） ---

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

func TestClaudeCodeParseStreamUsesBrokeredPermissionHandler(t *testing.T) {
	adapter := NewClaudeCodeAdapter("claude", "", "")
	broker := adapters.NewPermissionDecisionBroker()
	adapter.SetPermissionBroker(broker)
	run := store.Run{ID: "run_claude_broker", ProjectID: "proj_1", ThreadID: "thread_1", Status: "started"}

	inner, _ := json.Marshal(adapters.ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "Bash",
		ToolUseID: "tool_1",
		Input:     map[string]any{"command": "git status --short"},
	})
	msg, _ := json.Marshal(adapters.ControlMessage{
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

	pending, ok := broker.Decide("run_claude_broker", "req_1", adapters.PermissionDecision{
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

	var resp adapters.ControlMessage
	if err := json.Unmarshal(stdin.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal stdin response: %v", err)
	}
	var innerResp adapters.ControlResponseInner
	if err := json.Unmarshal(resp.Response, &innerResp); err != nil {
		t.Fatalf("unmarshal inner response: %v", err)
	}
	if innerResp.Behavior != "deny" || innerResp.Message != "blocked by test" || innerResp.DecisionClass != "user_rejected" {
		t.Fatalf("inner response = %#v, want denied broker decision", innerResp)
	}
}

// --- 以下测试自根包 adapter_test.go 随 claude 家族迁入（#1760 claude
// 增量），逻辑未改：根包测试不得引用 adapters/claude 符号（claude →
// adapters 单向依赖） ---

// --- Adapter Metadata tests ---

func TestClaudeCodeAdapterMetadata(t *testing.T) {
	a := NewClaudeCodeAdapter("claude", "sonnet", "")
	m := a.Metadata()
	if m.ID != "claude-code" {
		t.Fatalf("ID = %q, want claude-code", m.ID)
	}
	if m.Name != "Claude Code" {
		t.Fatalf("Name = %q, want Claude Code", m.Name)
	}
	if m.Description == "" {
		t.Fatal("Description should not be empty")
	}
}

// --- Adapter Capabilities tests ---

func TestClaudeCodeAdapterCapabilities(t *testing.T) {
	a := NewClaudeCodeAdapter("claude", "sonnet", "")
	c := a.Capabilities()
	if !c.Streaming {
		t.Fatal("Streaming should be true")
	}
	if !c.ToolCalls {
		t.Fatal("ToolCalls should be true")
	}
	if !c.FileChanges {
		t.Fatal("FileChanges should be true")
	}
	if !c.PermissionHooks {
		t.Fatal("PermissionHooks should be true")
	}
	if !c.ThinkingVisible {
		t.Fatal("ThinkingVisible should be true")
	}
	if !c.MultiTurn {
		t.Fatal("MultiTurn should be true")
	}
	if !c.MCPIntegration {
		t.Fatal("MCPIntegration should be true")
	}
}

// --- NeedsStdin tests ---

func TestClaudeCodeAdapterNeedsStdin(t *testing.T) {
	a := NewClaudeCodeAdapter("claude", "sonnet", "")
	if !a.NeedsStdin() {
		t.Fatal("Claude Code should need stdin")
	}
}

func TestAvailableAdapterReportsTrue(t *testing.T) {
	a := NewClaudeCodeAdapter("claude", "sonnet", "")
	// Claude adapter checks binary existence; on a dev machine without
	// Claude CLI, Available() may return false. We just verify it does not
	// panic.
	_ = a.Available()
}

// TestClaudeAdapterMetadataIsNotEmpty 校验 claude 家族内置适配器均有非空
// metadata（根包 TestAdapterMetadataIsNotEmpty 的 claude 行随家族迁入，
// #1760 claude 增量）。
func TestClaudeAdapterMetadataIsNotEmpty(t *testing.T) {
	adapters := []struct {
		name     string
		metadata AdapterMetadata
	}{
		{"ClaudeCode", NewClaudeCodeAdapter("claude", "sonnet", "").Metadata()},
		{"ClaudeACP", NewClaudeACPAdapter("", "").Metadata()},
	}
	for _, a := range adapters {
		if a.metadata.ID == "" {
			t.Fatalf("%s adapter ID is empty", a.name)
		}
		if a.metadata.Name == "" {
			t.Fatalf("%s adapter Name is empty", a.name)
		}
		if a.metadata.Description == "" {
			t.Fatalf("%s adapter Description is empty", a.name)
		}
	}
}

func TestClaudeBuildCommandOmitsAddDirWhenWorkDirEmpty(t *testing.T) {
	adapter := NewClaudeCodeAdapter("claude", "sonnet", "")
	_, args, _, workDir := adapter.BuildCommand(RunProcessContext{Prompt: "hello"})
	if workDir != "" {
		t.Fatalf("workDir = %q, want empty", workDir)
	}
	for i, a := range args {
		if a == "--add-dir" {
			// On Windows an --add-dir for TempDir may still be present; ensure it is not home.
			if i+1 < len(args) {
				home, err := os.UserHomeDir()
				if err == nil && home != "" && args[i+1] == home {
					t.Fatalf("--add-dir should not grant home: %q", args[i+1])
				}
			}
		}
	}
}
