package adapters

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/store"
)

// parseCodexLines feeds JSONL lines through the Codex adapter's ParseStream.
func parseCodexLines(t *testing.T, input string) *mockEmitter {
	return parseCodexLinesWithWorkDir(t, input, "")
}

func parseCodexLinesWithWorkDir(t *testing.T, input string, workDir string) *mockEmitter {
	t.Helper()
	adapter := NewCodexAdapter("codex", "")
	emitter := &mockEmitter{}
	run := store.Run{ID: "run_test", ProjectID: "proj_test", ThreadID: "thread_test", Status: "started"}
	ctx := context.Background()
	if workDir != "" {
		ctx = context.WithValue(ctx, CtxWorkDir, workDir)
	}
	if err := adapter.ParseStream(ctx, strings.NewReader(input), nil, emitter, run); err != nil {
		t.Fatalf("ParseStream failed: %v", err)
	}
	return emitter
}

// --- Thread/Turn lifecycle ---

func TestCodexThreadStarted(t *testing.T) {
	input := `{"type":"thread.started","thread_id":"thread_abc123"}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventSessionInit)
	if len(events) != 1 {
		t.Fatalf("expected 1 session_init, got %d", len(events))
	}
	if events[0].Payload["threadId"] != "thread_abc123" {
		t.Errorf("threadId = %v", events[0].Payload["threadId"])
	}
}

func TestCodexTurnStarted(t *testing.T) {
	input := `{"type":"turn.started"}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventSessionStateChanged)
	if len(events) != 1 {
		t.Fatalf("expected 1 session_state_changed, got %d", len(events))
	}
	if events[0].Payload["state"] != "busy" {
		t.Errorf("state = %v", events[0].Payload["state"])
	}
}

func TestCodexTurnCompleted(t *testing.T) {
	input := `{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":800,"output_tokens":500,"reasoning_output_tokens":200}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 result, got %d", len(events))
	}
	if events[0].Payload["success"] != true {
		t.Errorf("success = %v", events[0].Payload["success"])
	}
	usage, ok := events[0].Payload["usage"].(map[string]any)
	if !ok {
		t.Fatal("usage should be a map")
	}
	if usage["inputTokens"] != int64(1200) {
		t.Errorf("inputTokens = %v", usage["inputTokens"])
	}
	if usage["cachedInputTokens"] != int64(800) {
		t.Errorf("cachedInputTokens = %v", usage["cachedInputTokens"])
	}
	if usage["outputTokens"] != int64(500) {
		t.Errorf("outputTokens = %v", usage["outputTokens"])
	}
	if usage["reasoningOutputTokens"] != int64(200) {
		t.Errorf("reasoningOutputTokens = %v", usage["reasoningOutputTokens"])
	}
}

func TestCodexTurnFailed(t *testing.T) {
	input := `{"type":"turn.failed","error":{"message":"API rate limit exceeded"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 result, got %d", len(events))
	}
	if events[0].Payload["success"] != false {
		t.Errorf("success = %v", events[0].Payload["success"])
	}
	if events[0].Payload["error"] != "API rate limit exceeded" {
		t.Errorf("error = %v", events[0].Payload["error"])
	}
}

// --- Item completed: agent_message ---

func TestCodexAgentMessageCompleted(t *testing.T) {
	input := `{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Here is the generated code for your review."}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventTextBlock)
	if len(events) != 1 {
		t.Fatalf("expected 1 text_block, got %d", len(events))
	}
	if events[0].Payload["content"] != "Here is the generated code for your review." {
		t.Errorf("content = %v", events[0].Payload["content"])
	}
}

// --- Item completed: reasoning ---

func TestCodexReasoningCompleted(t *testing.T) {
	input := `{"type":"item.completed","item":{"id":"item_2","type":"reasoning","text":"The user asked for a Go HTTP server. I need to handle routes, middleware, and graceful shutdown."}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventThinking)
	if len(events) != 1 {
		t.Fatalf("expected 1 thinking, got %d", len(events))
	}
	if events[0].Payload["content"] != "The user asked for a Go HTTP server. I need to handle routes, middleware, and graceful shutdown." {
		t.Errorf("content = %v", events[0].Payload["content"])
	}
}

func TestCodexReasoningEmptyText(t *testing.T) {
	// Empty reasoning text should still emit (but with empty content)
	input := `{"type":"item.completed","item":{"id":"item_3","type":"reasoning","text":""}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventThinking)
	if len(events) != 0 {
		t.Fatalf("expected 0 thinking for empty text, got %d", len(events))
	}
}

// --- Item completed: command_execution ---

func TestCodexCommandExecutionCompleted(t *testing.T) {
	input := `{"type":"item.completed","item":{"id":"item_4","type":"command_execution","command":"go build ./...","aggregated_output":"Build succeeded","exit_code":0,"status":"completed"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventToolResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_result, got %d", len(events))
	}
	if events[0].Payload["toolName"] != "shell_command" {
		t.Errorf("toolName = %v", events[0].Payload["toolName"])
	}
	if events[0].Payload["output"] != "Build succeeded" {
		t.Errorf("output = %v", events[0].Payload["output"])
	}
	if events[0].Payload["exitCode"] != 0 {
		t.Errorf("exitCode = %v (type=%T)", events[0].Payload["exitCode"], events[0].Payload["exitCode"])
	}
	if events[0].Payload["status"] != "completed" {
		t.Errorf("status = %v", events[0].Payload["status"])
	}
}

func TestCodexCommandExecutionFailed(t *testing.T) {
	input := `{"type":"item.completed","item":{"id":"item_5","type":"command_execution","command":"rm -rf /","aggregated_output":"Permission denied","exit_code":1,"status":"failed"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventToolResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_result, got %d", len(events))
	}
	if events[0].Payload["status"] != "failed" {
		t.Errorf("status = %v", events[0].Payload["status"])
	}
}

// --- Item started: command_execution ---

func TestCodexCommandExecutionStarted(t *testing.T) {
	input := `{"type":"item.started","item":{"id":"item_6","type":"command_execution","command":"cargo build","aggregated_output":"","exit_code":null,"status":"in_progress"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_call, got %d", len(events))
	}
	if events[0].Payload["status"] != "started" {
		t.Errorf("status = %v", events[0].Payload["status"])
	}
	if events[0].Payload["toolName"] != "shell_command" {
		t.Errorf("toolName = %v", events[0].Payload["toolName"])
	}
}

// --- Item updated: command_execution (progress) ---

func TestCodexCommandExecutionUpdated(t *testing.T) {
	input := `{"type":"item.updated","item":{"id":"item_6b","type":"command_execution","command":"cargo build","aggregated_output":"   Compiling serde v1.0...\n","exit_code":null,"status":"in_progress"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_call (progress), got %d", len(events))
	}
	if events[0].Payload["status"] != "in_progress" {
		t.Errorf("status = %v", events[0].Payload["status"])
	}
	if events[0].Payload["toolName"] != "shell_command" {
		t.Errorf("toolName = %v", events[0].Payload["toolName"])
	}
}

// --- Item completed: file_change ---

func TestCodexFileChangeCompleted(t *testing.T) {
	input := `{"type":"item.completed","item":{"id":"item_7","type":"file_change","changes":[{"path":"src/main.rs","kind":"update"},{"path":"src/lib.rs","kind":"add"},{"path":"src/old.rs","kind":"delete"}],"status":"completed"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventFileChange)
	if len(events) != 3 {
		t.Fatalf("expected 3 file_change events, got %d", len(events))
	}

	want := []struct {
		path    string
		rawKind string
		kind    string
		action  string
	}{
		{"src/main.rs", "update", "modified", "modified"},
		{"src/lib.rs", "add", "created", "created"},
		{"src/old.rs", "delete", "deleted", "deleted"},
	}
	for i, w := range want {
		payload := events[i].Payload
		if payload["callId"] != "item_7" {
			t.Errorf("event[%d] callId = %v", i, payload["callId"])
		}
		if payload["toolName"] != "apply_patch" {
			t.Errorf("event[%d] toolName = %v", i, payload["toolName"])
		}
		if payload["path"] != w.path || payload["rawKind"] != w.rawKind || payload["kind"] != w.kind || payload["action"] != w.action {
			t.Errorf("event[%d] payload = %#v", i, payload)
		}
		if payload["status"] != "completed" {
			t.Errorf("event[%d] status = %v", i, payload["status"])
		}
	}
	for i, event := range events {
		if _, ok := event.Payload["files"]; ok {
			t.Fatalf("event[%d] should not include aggregate files payload: %#v", i, event.Payload)
		}
	}
}

func TestCodexFileChangeRelativizesWindowsAbsolutePathInWorkspace(t *testing.T) {
	workDir := `C:\Users\dev\project`
	input := `{"type":"item.completed","item":{"id":"item_abs","type":"file_change","changes":[{"path":"C:\\Users\\dev\\project\\src\\main.go","kind":"update"}],"status":"completed"}}`
	emitter := parseCodexLinesWithWorkDir(t, input, workDir)

	events := emitter.eventsOfType(BusEventFileChange)
	if len(events) != 1 {
		t.Fatalf("expected 1 file_change event, got %d", len(events))
	}
	if events[0].Payload["path"] != "src/main.go" {
		t.Fatalf("path = %#v, want workspace-relative src/main.go", events[0].Payload["path"])
	}
	if _, ok := events[0].Payload["outsideWorkspace"]; ok {
		t.Fatalf("inside workspace path should not set outsideWorkspace: %#v", events[0].Payload)
	}
}

func TestCodexFileChangeRedactsOutsideWorkspaceAbsolutePath(t *testing.T) {
	workDir := `C:\Users\dev\project`
	input := `{"type":"item.completed","item":{"id":"item_outside","type":"file_change","changes":[{"path":"C:\\Users\\dev\\secrets\\token.txt","kind":"update"}],"status":"completed"}}`
	emitter := parseCodexLinesWithWorkDir(t, input, workDir)

	events := emitter.eventsOfType(BusEventFileChange)
	if len(events) != 1 {
		t.Fatalf("expected 1 file_change event, got %d", len(events))
	}
	if events[0].Payload["path"] != "<outside-workspace>/token.txt" {
		t.Fatalf("path = %#v, want redacted basename", events[0].Payload["path"])
	}
	if events[0].Payload["outsideWorkspace"] != true {
		t.Fatalf("outsideWorkspace = %#v, want true", events[0].Payload["outsideWorkspace"])
	}
	if _, ok := events[0].Payload["files"]; ok {
		t.Fatalf("file_change event should not include aggregate files payload: %#v", events[0].Payload)
	}
	for _, value := range events[0].Payload {
		if s, ok := value.(string); ok && strings.Contains(s, `C:\Users\dev`) {
			t.Fatalf("payload leaked absolute user path: %#v", events[0].Payload)
		}
	}
}

func TestCodexFileChangeCleansEscapingRelativePath(t *testing.T) {
	input := `{"type":"item.completed","item":{"id":"item_rel","type":"file_change","changes":[{"path":"..\\outside\\secret.go","kind":"rename"}],"status":"completed"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventFileChange)
	if len(events) != 1 {
		t.Fatalf("expected 1 file_change event, got %d", len(events))
	}
	if events[0].Payload["path"] != "secret.go" {
		t.Fatalf("path = %#v, want safe basename", events[0].Payload["path"])
	}
	if events[0].Payload["outsideWorkspace"] != true {
		t.Fatalf("outsideWorkspace = %#v, want true", events[0].Payload["outsideWorkspace"])
	}
	if events[0].Payload["rawKind"] != "rename" || events[0].Payload["kind"] != "modified" || events[0].Payload["action"] != "modified" {
		t.Fatalf("unknown kind mapping mismatch: %#v", events[0].Payload)
	}
}

// --- Item started: file_change ---

func TestCodexFileChangeStarted(t *testing.T) {
	input := `{"type":"item.started","item":{"id":"item_fs","type":"file_change","changes":[{"path":"new_file.go","kind":"add"}],"status":"in_progress"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventFileChange)
	if len(events) != 1 {
		t.Fatalf("expected 1 file_change (started), got %d", len(events))
	}
	if events[0].Payload["path"] != "new_file.go" || events[0].Payload["action"] != "created" {
		t.Fatalf("file_change payload mismatch: %#v", events[0].Payload)
	}
}

// --- MCP tool call: completed ---

func TestCodexMcpToolCallCompleted(t *testing.T) {
	input := `{"type":"item.completed","item":{"id":"item_8","type":"mcp_tool_call","server":"github","tool":"list_issues","arguments":{"repo":"owner/repo","state":"open"},"result":{"content":[{"type":"text","text":"Found 3 issues: #1, #2, #3"}]},"status":"completed"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventToolResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_result, got %d", len(events))
	}
	if events[0].Payload["toolName"] != "mcp__github__list_issues" {
		t.Errorf("toolName = %v", events[0].Payload["toolName"])
	}
	if events[0].Payload["status"] != "completed" {
		t.Errorf("status = %v", events[0].Payload["status"])
	}
	if events[0].Payload["callId"] != "item_8" {
		t.Errorf("callId = %v", events[0].Payload["callId"])
	}
}

func TestCodexMcpToolCallFailed(t *testing.T) {
	input := `{"type":"item.completed","item":{"id":"item_9","type":"mcp_tool_call","server":"filesystem","tool":"read_file","arguments":{"path":"/missing.txt"},"error":{"message":"File not found"},"status":"failed"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventToolResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_result, got %d", len(events))
	}
	if events[0].Payload["error"] != "File not found" {
		t.Errorf("error = %v", events[0].Payload["error"])
	}
}

// --- MCP tool call: started ---

func TestCodexMcpToolCallStarted(t *testing.T) {
	input := `{"type":"item.started","item":{"id":"item_10","type":"mcp_tool_call","server":"postgres","tool":"query","arguments":{"sql":"SELECT 1"}}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_call, got %d", len(events))
	}
	if events[0].Payload["status"] != "started" {
		t.Errorf("status = %v", events[0].Payload["status"])
	}
	if events[0].Payload["toolName"] != "mcp__postgres__query" {
		t.Errorf("toolName = %v", events[0].Payload["toolName"])
	}
}

// --- MCP tool call: updated (progress) ---

func TestCodexMcpToolCallUpdated(t *testing.T) {
	input := `{"type":"item.updated","item":{"id":"item_11","type":"mcp_tool_call","server":"postgres","tool":"query","status":"in_progress"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_call (progress), got %d", len(events))
	}
	if events[0].Payload["status"] != "in_progress" {
		t.Errorf("status = %v", events[0].Payload["status"])
	}
	if events[0].Payload["toolName"] != "mcp__postgres__query" {
		t.Errorf("toolName = %v", events[0].Payload["toolName"])
	}
}

// --- Web search: started and completed ---

func TestCodexWebSearchStarted(t *testing.T) {
	input := `{"type":"item.started","item":{"id":"item_12","type":"web_search","query":"Go generics tutorial","action":"search"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_call, got %d", len(events))
	}
	if events[0].Payload["status"] != "started" {
		t.Errorf("status = %v", events[0].Payload["status"])
	}
	if events[0].Payload["toolName"] != "web_search" {
		t.Errorf("toolName = %v", events[0].Payload["toolName"])
	}
	if events[0].Payload["kind"] != "web_search" {
		t.Errorf("kind = %v", events[0].Payload["kind"])
	}
}

func TestCodexWebSearchCompleted(t *testing.T) {
	input := `{"type":"item.completed","item":{"id":"item_13","type":"web_search","query":"Go generics tutorial","action":"search"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventToolResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_result, got %d", len(events))
	}
	if events[0].Payload["kind"] != "web_search" {
		t.Errorf("kind = %v", events[0].Payload["kind"])
	}
}

// --- Collab tool call: started (sub-agent spawn) ---

func TestCodexCollabToolCallStarted(t *testing.T) {
	input := `{"type":"item.started","item":{"id":"item_14","type":"collab_tool_call","tool":"SpawnAgent","sender_thread_id":"parent_thread","receiver_thread_ids":[],"prompt":"Review the authentication module","agents_states":{},"status":"in_progress"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventTaskStarted)
	if len(events) != 1 {
		t.Fatalf("expected 1 task_started, got %d", len(events))
	}
	if events[0].Payload["taskId"] != "item_14" {
		t.Errorf("taskId = %v", events[0].Payload["taskId"])
	}
	if events[0].Payload["tool"] != "SpawnAgent" {
		t.Errorf("tool = %v", events[0].Payload["tool"])
	}
	if events[0].Payload["description"] != "Review the authentication module" {
		t.Errorf("description = %v", events[0].Payload["description"])
	}
	if events[0].Payload["senderThreadId"] != "parent_thread" {
		t.Errorf("senderThreadId = %v", events[0].Payload["senderThreadId"])
	}
}

// --- Collab tool call: completed (sub-agent finished) ---

func TestCodexCollabToolCallCompleted(t *testing.T) {
	input := `{"type":"item.completed","item":{"id":"item_15","type":"collab_tool_call","tool":"SpawnAgent","sender_thread_id":"parent_thread","receiver_thread_ids":["child_thread_1"],"prompt":"Review auth module","agents_states":{"child_thread_1":{"status":"Completed","message":"Auth module looks good"}},"status":"completed"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventTaskNotification)
	if len(events) != 1 {
		t.Fatalf("expected 1 task_notification, got %d", len(events))
	}
	if events[0].Payload["taskId"] != "item_15" {
		t.Errorf("taskId = %v", events[0].Payload["taskId"])
	}
	if events[0].Payload["status"] != "completed" {
		t.Errorf("status = %v", events[0].Payload["status"])
	}
	states, ok := events[0].Payload["agentsStates"].(map[string]any)
	if !ok {
		t.Fatal("agentsStates should be a map")
	}
	child, ok := states["child_thread_1"].(map[string]any)
	if !ok {
		t.Fatal("child_thread_1 should be a map")
	}
	if child["status"] != "Completed" {
		t.Errorf("child status = %v", child["status"])
	}
}

// --- Error item ---

func TestCodexErrorItem(t *testing.T) {
	input := `{"type":"item.completed","item":{"id":"item_16","type":"error","message":"Failed to connect to MCP server 'postgres': connection refused"}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 result, got %d", len(events))
	}
	if events[0].Payload["success"] != false {
		t.Errorf("success = %v", events[0].Payload["success"])
	}
	if events[0].Payload["error"] != "Failed to connect to MCP server 'postgres': connection refused" {
		t.Errorf("error = %v", events[0].Payload["error"])
	}
}

// --- Top-level error event ---

func TestCodexErrorEvent(t *testing.T) {
	input := `{"type":"error","message":"Authentication token expired. Run 'codex login'."}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 result, got %d", len(events))
	}
	if events[0].Payload["success"] != false {
		t.Errorf("success = %v", events[0].Payload["success"])
	}
	if events[0].Payload["error"] != "Authentication token expired. Run 'codex login'." {
		t.Errorf("error = %v", events[0].Payload["error"])
	}
}

// --- Todo list ---

func TestCodexTodoListCompleted(t *testing.T) {
	input := `{"type":"item.completed","item":{"id":"item_17","type":"todo_list","items":[{"text":"Read requirements","completed":true},{"text":"Implement feature","completed":false},{"text":"Write tests","completed":false}]}}`
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_call (plan), got %d", len(events))
	}
	if events[0].Payload["toolName"] != "plan" {
		t.Errorf("toolName = %v", events[0].Payload["toolName"])
	}
	if events[0].Payload["kind"] != "plan" {
		t.Errorf("kind = %v", events[0].Payload["kind"])
	}
	inputPayload, ok := events[0].Payload["input"].(map[string]any)
	if !ok {
		t.Fatal("input should be a map")
	}
	tasks, ok := inputPayload["tasks"].([]map[string]any)
	if !ok {
		t.Fatal("tasks should be a slice")
	}
	if len(tasks) != 3 {
		t.Fatalf("expected 3 tasks, got %d", len(tasks))
	}
	if tasks[0]["text"] != "Read requirements" {
		t.Errorf("task[0].text = %v", tasks[0]["text"])
	}
	if tasks[0]["completed"] != true {
		t.Errorf("task[0].completed = %v", tasks[0]["completed"])
	}
}

// --- Full turn sequence ---

func TestCodexFullTurnSequence(t *testing.T) {
	lines := []string{
		`{"type":"thread.started","thread_id":"thread_full"}`,
		`{"type":"turn.started"}`,
		`{"type":"item.started","item":{"id":"item_cmd","type":"command_execution","command":"ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}`,
		`{"type":"item.updated","item":{"id":"item_cmd","type":"command_execution","command":"ls","aggregated_output":"file1.go\n","exit_code":null,"status":"in_progress"}}`,
		`{"type":"item.completed","item":{"id":"item_cmd","type":"command_execution","command":"ls","aggregated_output":"file1.go\nfile2.go\n","exit_code":0,"status":"completed"}}`,
		`{"type":"item.completed","item":{"id":"item_msg","type":"agent_message","text":"I found two Go files in the directory."}}`,
		`{"type":"turn.completed","usage":{"input_tokens":500,"cached_input_tokens":100,"output_tokens":200,"reasoning_output_tokens":50}}`,
	}
	emitter := parseCodexLines(t, strings.Join(lines, "\n"))

	// Verify event sequence
	if len(emitter.eventsOfType(BusEventSessionInit)) != 1 {
		t.Error("missing session_init (thread.started)")
	}
	if len(emitter.eventsOfType(BusEventSessionStateChanged)) != 2 {
		t.Error("missing session_state_changed (turn.started)")
	}
	if len(emitter.eventsOfType(BusEventToolCall)) < 2 {
		// item.started + item.updated for command_execution
		t.Errorf("expected >=2 tool_call, got %d", len(emitter.eventsOfType(BusEventToolCall)))
	}
	if len(emitter.eventsOfType(BusEventToolResult)) != 1 {
		t.Error("missing tool_result (command_execution completed)")
	}
	if len(emitter.eventsOfType(BusEventTextBlock)) != 1 {
		t.Error("missing text_block (agent_message completed)")
	}
	if len(emitter.eventsOfType(BusEventResult)) != 1 {
		t.Error("missing result (turn.completed)")
	}

	// Verify event order
	if len(emitter.events) < 7 {
		t.Fatalf("expected >=7 events, got %d", len(emitter.events))
	}

	// First event should be session_init
	if emitter.events[0].Type != BusEventSessionInit {
		t.Errorf("event[0] type = %s, want %s", emitter.events[0].Type, BusEventSessionInit)
	}
	// Last event should be session_state_changed (idle emitted after turn.completed)
	last := emitter.events[len(emitter.events)-1]
	if last.Type != BusEventSessionStateChanged {
		t.Errorf("last event type = %s, want %s", last.Type, BusEventSessionStateChanged)
	}
}

func TestCodexExecMinimalJSONLFixture(t *testing.T) {
	input := strings.Join([]string{
		`{"type":"thread.started","thread_id":"thread_fixture"}`,
		`{"type":"turn.started"}`,
		`{"type":"item.completed","item":{"id":"item_msg","type":"agent_message","text":"OK"}}`,
		`{"type":"turn.completed","usage":{"input_tokens":11,"cached_input_tokens":3,"output_tokens":5}}`,
	}, "\n")

	emitter := parseCodexLines(t, input)

	if events := emitter.eventsOfType(BusEventSessionInit); len(events) != 1 || events[0].Payload["threadId"] != "thread_fixture" {
		t.Fatalf("thread.started event mismatch: %#v", events)
	}
	if events := emitter.eventsOfType(BusEventSessionStateChanged); len(events) != 2 {
		t.Fatalf("expected turn.started busy and turn.completed idle events, got %d", len(events))
	} else if events[0].Payload["state"] != "busy" || events[1].Payload["state"] != "idle" {
		t.Fatalf("session state sequence mismatch: %#v", events)
	}
	if events := emitter.eventsOfType(BusEventTextBlock); len(events) != 1 || events[0].Payload["content"] != "OK" {
		t.Fatalf("agent message event mismatch: %#v", events)
	}
	events := emitter.eventsOfType(BusEventResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 result event, got %d", len(events))
	}
	usage, ok := events[0].Payload["usage"].(map[string]any)
	if !ok {
		t.Fatal("usage should be a map")
	}
	if usage["inputTokens"] != int64(11) || usage["cachedInputTokens"] != int64(3) || usage["outputTokens"] != int64(5) {
		t.Fatalf("usage mismatch: %#v", usage)
	}
}

// --- Edge cases ---

func TestCodexEmptyLine(t *testing.T) {
	input := "  \n{\"type\":\"turn.started\"}\n\n{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":0,\"cached_input_tokens\":0,\"output_tokens\":0,\"reasoning_output_tokens\":0}}"
	emitter := parseCodexLines(t, input)

	if len(emitter.eventsOfType(BusEventSessionStateChanged)) != 2 {
		t.Error("missing turn.started")
	}
	if len(emitter.eventsOfType(BusEventResult)) != 1 {
		t.Error("missing turn.completed")
	}
}

func TestCodexUnknownItemType(t *testing.T) {
	// Unknown item types should be silently ignored
	input := `{"type":"item.completed","item":{"id":"item_x","type":"unknown_future_type","data":"some_value"}}`
	emitter := parseCodexLines(t, input)

	if len(emitter.events) != 0 {
		t.Fatalf("expected 0 events for unknown item type, got %d", len(emitter.events))
	}
}

func TestCodexNilItem(t *testing.T) {
	// item.started without an item field should be handled gracefully
	input := `{"type":"item.started"}`
	emitter := parseCodexLines(t, input)

	if len(emitter.events) != 0 {
		t.Fatalf("expected 0 events for nil item, got %d", len(emitter.events))
	}
}

func TestCodexMalformedJSON(t *testing.T) {
	// Malformed JSON lines should fall back to raw text
	input := "this is not json\n{broken"
	emitter := parseCodexLines(t, input)

	// Should emit raw text for the non-JSON line
	events := emitter.eventsOfType(BusEventTextDelta)
	if len(events) < 1 {
		t.Fatalf("expected >=1 text_delta for non-JSON lines, got %d", len(events))
	}
}

func TestCodexNonJSONOutput(t *testing.T) {
	// If the first line is not JSON, fall back to plain text mode
	input := "Hello from Codex!\nThis is the output."
	emitter := parseCodexLines(t, input)

	events := emitter.eventsOfType(BusEventTextDelta)
	if len(events) != 2 {
		t.Fatalf("expected 2 text_delta lines, got %d", len(events))
	}
	if events[0].Payload["content"] != "Hello from Codex!" {
		t.Errorf("line0 = %v", events[0].Payload["content"])
	}
}

// --- Codex BuildCommand flag tests ---

func TestCodexBuildCommandImageFlag(t *testing.T) {
	adapter := NewCodexAdapter("codex", "gpt-5")
	_, args, _, _ := adapter.BuildCommand(RunProcessContext{
		Prompt: "analyze image",
		ConfigOverrides: map[string]string{
			"image": "/path/to/screenshot.png",
		},
	})

	found := false
	for _, a := range args {
		if a == "--image" {
			found = true
			break
		}
	}
	if !found {
		t.Error("--image flag not found in args")
	}
}

func TestCodexBuildCommandAddDirFlag(t *testing.T) {
	adapter := NewCodexAdapter("codex", "gpt-5")
	_, args, _, _ := adapter.BuildCommand(RunProcessContext{
		Prompt:  "list files",
		WorkDir: "/home/user/project",
	})

	for _, a := range args {
		if a == "--add-dir" {
			t.Fatalf("--add-dir should not mirror WorkDir for Codex; args=%#v", args)
		}
	}
}

func TestCodexBuildCommandCdFlag(t *testing.T) {
	adapter := NewCodexAdapter("codex", "gpt-5")
	_, args, _, _ := adapter.BuildCommand(RunProcessContext{
		Prompt:  "list files",
		WorkDir: "/home/user/project",
	})

	found := false
	for i, a := range args {
		if a == "--cd" && i+1 < len(args) && args[i+1] == "/home/user/project" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("--cd flag not found in args")
	}
}

func TestCodexBuildCommandSkipsGitRepoCheckForEdgeWorkspace(t *testing.T) {
	adapter := NewCodexAdapter("codex", "gpt-5")
	_, args, _, _ := adapter.BuildCommand(RunProcessContext{
		Prompt: "hello",
	})

	found := false
	for _, a := range args {
		if a == "--skip-git-repo-check" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("--skip-git-repo-check not found in args")
	}
}

func TestCodexBuildCommandWebSearchModeViaConfig(t *testing.T) {
	adapter := NewCodexAdapter("codex", "gpt-5")
	_, args, _, _ := adapter.BuildCommand(RunProcessContext{
		Prompt: "search the web",
		ConfigOverrides: map[string]string{
			"web_search_mode": "basic",
		},
	})

	found := false
	for i, a := range args {
		if a == "-c" && i+1 < len(args) && args[i+1] == "web_search_mode=basic" {
			found = true
			break
		}
	}
	if !found {
		t.Error("-c web_search_mode=basic not found in args")
	}
}

func TestCodexBuildCommandNoExtraFlagsWhenEmpty(t *testing.T) {
	adapter := NewCodexAdapter("codex", "gpt-5")
	_, args, _, _ := adapter.BuildCommand(RunProcessContext{
		Prompt: "hello",
	})

	for _, a := range args {
		if a == "--image" {
			t.Error("--image should not be present when no image is configured")
		}
	}
	for _, a := range args {
		if a == "--add-dir" {
			t.Error("--add-dir should not be present when no WorkDir is set")
		}
	}
}

func TestCodexBuildCommandTerminatesFlagsBeforeLeadingDashPrompt(t *testing.T) {
	adapter := NewCodexAdapter("codex", "gpt-5")
	_, args, _, _ := adapter.BuildCommand(RunProcessContext{
		Prompt: "- review this diff",
	})

	terminator := -1
	for i, arg := range args {
		if arg == "--" {
			terminator = i
			break
		}
	}
	if terminator == -1 {
		t.Fatalf("args missing -- terminator: %#v", args)
	}
	if terminator+1 >= len(args) {
		t.Fatalf("-- terminator should be followed by prompt: %#v", args)
	}
	if args[terminator+1] != "- review this diff" {
		t.Fatalf("prompt after -- = %q, want %q; args=%#v", args[terminator+1], "- review this diff", args)
	}
}

func TestCodexBuildCommandKeepsNormalPromptAfterFlags(t *testing.T) {
	adapter := NewCodexAdapter("codex", "gpt-5")
	_, args, _, _ := adapter.BuildCommand(RunProcessContext{
		Prompt: "hello",
	})

	if len(args) < 2 {
		t.Fatalf("args too short: %#v", args)
	}
	if args[len(args)-2] != "--" || args[len(args)-1] != "hello" {
		t.Fatalf("normal prompt should remain the final argument after --: %#v", args)
	}
	foundJSON := false
	for _, arg := range args[:len(args)-2] {
		if arg == "--json" {
			foundJSON = true
			break
		}
	}
	if !foundJSON {
		t.Fatalf("--json should stay before the prompt terminator: %#v", args)
	}
}

type fakeFileInfo struct {
	name  string
	isDir bool
}

func (f fakeFileInfo) Name() string       { return f.name }
func (f fakeFileInfo) Size() int64        { return 1 }
func (f fakeFileInfo) Mode() os.FileMode  { return 0o644 }
func (f fakeFileInfo) ModTime() time.Time { return time.Time{} }
func (f fakeFileInfo) IsDir() bool        { return f.isDir }
func (f fakeFileInfo) Sys() any           { return nil }

func TestResolveCodexCommandUsesNodeEntrypointForWindowsNpmShim(t *testing.T) {
	cmdPath := filepath.Join("C:", "Users", "dev", "AppData", "Roaming", "npm", "codex.cmd")
	jsPath := filepath.Join(filepath.Dir(cmdPath), "node_modules", "@openai", "codex", "bin", "codex.js")
	nodePath := filepath.Join("C:", "Program Files", "nodejs", "node.exe")

	lookPath := func(name string) (string, error) {
		switch name {
		case "codex":
			return cmdPath, nil
		case "node":
			return nodePath, nil
		default:
			return "", errors.New("not found")
		}
	}
	stat := func(name string) (os.FileInfo, error) {
		if name == jsPath {
			return fakeFileInfo{name: "codex.js"}, nil
		}
		return nil, errors.New("not found")
	}

	cmd, prefix, ok := resolveCodexCommand("codex", lookPath, stat, "windows")
	if !ok {
		t.Fatal("resolveCodexCommand reported unavailable")
	}
	if cmd != nodePath {
		t.Fatalf("cmd = %q, want node path %q", cmd, nodePath)
	}
	if len(prefix) != 1 || prefix[0] != jsPath {
		t.Fatalf("prefix = %#v, want codex js path", prefix)
	}
}

func TestResolveCodexCommandKeepsNonNpmWindowsCmd(t *testing.T) {
	cmdPath := filepath.Join("C:", "tools", "codex-wrapper.cmd")
	lookPath := func(name string) (string, error) {
		if name == "codex" {
			return cmdPath, nil
		}
		return "", errors.New("not found")
	}
	stat := func(name string) (os.FileInfo, error) {
		return nil, errors.New("not found")
	}

	cmd, prefix, ok := resolveCodexCommand("codex", lookPath, stat, "windows")
	if !ok {
		t.Fatal("resolveCodexCommand reported unavailable")
	}
	if cmd != cmdPath {
		t.Fatalf("cmd = %q, want original cmd path %q", cmd, cmdPath)
	}
	if len(prefix) != 0 {
		t.Fatalf("prefix = %#v, want empty", prefix)
	}
}
