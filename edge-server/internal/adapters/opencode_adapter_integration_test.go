package adapters

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

func opencodePath(t *testing.T) string {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	path := os.Getenv("OPENCODE_PATH")
	if path == "" {
		path = "opencode"
	}
	if _, err := exec.LookPath(path); err != nil {
		t.Skipf("opencode binary not found at %q — set OPENCODE_PATH to run integration tests", path)
	}
	return path
}

func TestOpenCodeIntegrationBasicPrompt(t *testing.T) {
	adapter := NewOpenCodeAdapter(opencodePath(t))
	ctx := context.Background()
	run := store.Run{ID: "run_oc_int", ProjectID: "proj_oc", ThreadID: "thread_oc", Status: "started"}

	cmdPath, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
		Run:    run,
		Prompt: "reply with just the word ok",
	})

	cmd := exec.CommandContext(ctx, cmdPath, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}

	emitter := &mockEmitter{}
	if err := adapter.ParseStream(ctx, stdout, nil, emitter, run); err != nil {
		t.Fatalf("ParseStream: %v", err)
	}
	_ = cmd.Wait()

	// Verify event sequence: step_start -> text -> step_finish
	textEvents := emitter.eventsOfType(BusEventTextDelta)
	resultEvents := emitter.eventsOfType(BusEventResult)
	stateEvents := emitter.eventsOfType(BusEventSessionStateChanged)

	if len(textEvents) == 0 {
		t.Error("no text events received")
	}
	if len(resultEvents) == 0 {
		t.Error("no result event")
	}
	if len(resultEvents) > 0 {
		r := resultEvents[0]
		if r.Payload["success"] != true {
			t.Errorf("result success = %v, reason = %v", r.Payload["success"], r.Payload["reason"])
		}
		if _, ok := r.Payload["usage"]; !ok {
			t.Log("no token usage in result (may be normal for some providers)")
		}
	}

	t.Logf("events: text=%d, result=%d, state=%d", len(textEvents), len(resultEvents), len(stateEvents))
}

func TestOpenCodeIntegrationModelSelection(t *testing.T) {
	adapter := NewOpenCodeAdapter(opencodePath(t))
	run := store.Run{ID: "run_oc_model", ProjectID: "proj_oc", ThreadID: "thread_oc", Status: "started"}

	// Verify args only — don't actually run (avoids timeout with slow providers)
	_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
		Run:    run,
		Prompt: "say ok",
		Model:  "deepseek/deepseek-v4-pro",
	})

	hasModel := false
	for i, a := range args {
		if a == "-m" && i+1 < len(args) && args[i+1] == "deepseek/deepseek-v4-pro" {
			hasModel = true
		}
	}
	if !hasModel {
		t.Errorf("model not found in args: %v", args)
	}
}

func TestOpenCodeBuildCommandArgs(t *testing.T) {
	adapter := NewOpenCodeAdapter("opencode")
	run := store.Run{ID: "r1", ProjectID: "p1", ThreadID: "t1", Status: "started"}

	t.Run("basic", func(t *testing.T) {
		cmd, args, env, wd := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:    run,
			Prompt: "hello",
		})
		if cmd == "" {
			t.Error("cmd is empty")
		}
		hasFormatJSON := false
		hasPrompt := false
		for _, a := range args {
			if a == "--format" {
				hasFormatJSON = true
			}
			if a == "hello" {
				hasPrompt = true
			}
		}
		if !hasFormatJSON {
			t.Error("--format json not in args")
		}
		if !hasPrompt {
			t.Error("prompt not in args")
		}
		_ = env
		_ = wd
	})

	t.Run("model_with_provider", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:    run,
			Prompt: "hi",
			Model:  "anthropic/claude-sonnet-4-6",
		})
		hasModel := false
		for i, a := range args {
			if a == "-m" && i+1 < len(args) && args[i+1] == "anthropic/claude-sonnet-4-6" {
				hasModel = true
			}
		}
		if !hasModel {
			t.Error("provider/model format not in args")
		}
	})

	t.Run("model_without_provider", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:    run,
			Prompt: "hi",
			Model:  "gpt-5",
		})
		hasModel := false
		for i, a := range args {
			if a == "-m" && i+1 < len(args) && args[i+1] == "gpt-5" {
				hasModel = true
			}
		}
		if !hasModel {
			t.Error("bare model not passed through")
		}
	})

	t.Run("session_resume", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:       run,
			Prompt:    "hi",
			SessionID: "ses_abc",
		})
		hasSession := false
		for i, a := range args {
			if a == "--session" && i+1 < len(args) && args[i+1] == "ses_abc" {
				hasSession = true
			}
		}
		if !hasSession {
			t.Error("--session not in args")
		}
	})

	t.Run("session_continue", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:          run,
			Prompt:       "hi",
			ContinueLast: true,
		})
		hasContinue := false
		for _, a := range args {
			if a == "--continue" {
				hasContinue = true
			}
		}
		if !hasContinue {
			t.Error("--continue not in args")
		}
	})

	t.Run("session_fork", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:         run,
			Prompt:      "hi",
			ForkSession: true,
		})
		hasFork := false
		for _, a := range args {
			if a == "--fork" {
				hasFork = true
			}
		}
		if !hasFork {
			t.Error("--fork not in args")
		}
	})

	t.Run("permission_bypass", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:            run,
			Prompt:         "hi",
			PermissionMode: "bypassPermissions",
		})
		hasBypass := false
		for _, a := range args {
			if a == "--dangerously-skip-permissions" {
				hasBypass = true
			}
		}
		if !hasBypass {
			t.Error("--dangerously-skip-permissions not in args when PermissionMode is bypassPermissions")
		}
	})

	t.Run("permission_default_no_flag", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:            run,
			Prompt:         "hi",
			PermissionMode: "default",
		})
		for _, a := range args {
			if a == "--dangerously-skip-permissions" {
				t.Error("--dangerously-skip-permissions should not be present for default PermissionMode")
			}
		}
	})
}

// parseOpenCodeLines feeds JSON lines through the adapter's ParseStream for unit testing.
func parseOpenCodeLines(t *testing.T, input string) *mockEmitter {
	t.Helper()
	adapter := NewOpenCodeAdapter("opencode")
	emitter := &mockEmitter{}
	run := store.Run{ID: "run_test", ProjectID: "proj_test", ThreadID: "thread_test", Status: "started"}
	ctx := context.Background()
	if err := adapter.ParseStream(ctx, strings.NewReader(input), nil, emitter, run); err != nil {
		t.Fatalf("ParseStream failed: %v", err)
	}
	return emitter
}

func TestOpenCodeToolUseCompletedEvent(t *testing.T) {
	// Actual tool_use event from OpenCode v1.15.10 --format json output.
	// The part.type="tool" and state is a nested object with status/input/output.
	input := `{"type":"tool_use","timestamp":1779700881122,"sessionID":"ses_abc","part":{"type":"tool","tool":"read","callID":"call_00_test1","state":{"status":"completed","input":{"filePath":"/tmp/test.txt"},"output":"file contents","title":"test.txt"},"id":"prt_1","sessionID":"ses_abc","messageID":"msg_1"}}`
	emitter := parseOpenCodeLines(t, input)

	// tool_use with completed state emits both ToolCall and ToolResult
	callEvents := emitter.eventsOfType(BusEventToolCall)
	resultEvents := emitter.eventsOfType(BusEventToolResult)

	if len(callEvents) != 1 {
		t.Fatalf("expected 1 tool_call event, got %d", len(callEvents))
	}
	if callEvents[0].Payload["callId"] != "call_00_test1" {
		t.Errorf("callId = %v", callEvents[0].Payload["callId"])
	}
	if callEvents[0].Payload["toolName"] != "read" {
		t.Errorf("toolName = %v, expected 'read'", callEvents[0].Payload["toolName"])
	}
	if callEvents[0].Payload["status"] != "completed" {
		t.Errorf("status = %v", callEvents[0].Payload["status"])
	}

	if len(resultEvents) != 1 {
		t.Fatalf("expected 1 tool_result event, got %d", len(resultEvents))
	}
	if resultEvents[0].Payload["callId"] != "call_00_test1" {
		t.Errorf("result callId = %v", resultEvents[0].Payload["callId"])
	}
	if resultEvents[0].Payload["output"] != "file contents" {
		t.Errorf("output = %v", resultEvents[0].Payload["output"])
	}
}

func TestOpenCodeToolUseTriggersFileChange(t *testing.T) {
	// Write tool in actual OpenCode format triggers BusEventFileChange.
	input := `{"type":"tool_use","timestamp":1779700881122,"sessionID":"ses_abc","part":{"type":"tool","tool":"write","callID":"call_write_1","state":{"status":"completed","input":{"filePath":"/tmp/out.txt","content":"hello"},"output":"ok"},"id":"prt_2","sessionID":"ses_abc","messageID":"msg_2"}}`
	emitter := parseOpenCodeLines(t, input)

	fileChanges := emitter.eventsOfType(BusEventFileChange)
	if len(fileChanges) != 1 {
		t.Fatalf("expected 1 file_change for Write tool, got %d", len(fileChanges))
	}
	if fileChanges[0].Payload["toolName"] != "write" {
		t.Errorf("toolName = %v, expected 'write'", fileChanges[0].Payload["toolName"])
	}
	if fileChanges[0].Payload["callId"] != "call_write_1" {
		t.Errorf("callId = %v", fileChanges[0].Payload["callId"])
	}
}

func TestOpenCodeErrorEvent(t *testing.T) {
	// Actual error event from OpenCode v1.15.10 --format json output.
	input := `{"type":"error","timestamp":1779700800000,"sessionID":"ses_err","error":"authentication failed"}`
	emitter := parseOpenCodeLines(t, input)

	events := emitter.eventsOfType(BusEventResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 result event, got %d", len(events))
	}
	if events[0].Payload["success"] != false {
		t.Errorf("success = %v", events[0].Payload["success"])
	}
	if events[0].Payload["error"] != "authentication failed" {
		t.Errorf("error = %v", events[0].Payload["error"])
	}
}
