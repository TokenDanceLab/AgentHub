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

func TestOpenCodeToolResultEvent(t *testing.T) {
	input := `{"type":"tool_result","part":{"type":"tool-result","callID":"call_1","toolName":"Read","output":"file contents","status":"completed"}}`
	emitter := parseOpenCodeLines(t, input)

	events := emitter.eventsOfType(BusEventToolResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_result event, got %d", len(events))
	}
	if events[0].Payload["callId"] != "call_1" {
		t.Errorf("callId = %v", events[0].Payload["callId"])
	}
	if events[0].Payload["toolName"] != "Read" {
		t.Errorf("toolName = %v", events[0].Payload["toolName"])
	}
	if events[0].Payload["status"] != "completed" {
		t.Errorf("status = %v", events[0].Payload["status"])
	}
}

func TestOpenCodeToolResultTriggersFileChange(t *testing.T) {
	input := `{"type":"tool_result","part":{"type":"tool-result","callID":"call_2","toolName":"Write","output":"ok","status":"completed"}}`
	emitter := parseOpenCodeLines(t, input)

	toolResults := emitter.eventsOfType(BusEventToolResult)
	if len(toolResults) != 1 {
		t.Fatalf("expected 1 tool_result, got %d", len(toolResults))
	}

	fileChanges := emitter.eventsOfType(BusEventFileChange)
	if len(fileChanges) != 1 {
		t.Fatalf("expected 1 file_change for Write tool, got %d", len(fileChanges))
	}
	if fileChanges[0].Payload["toolName"] != "Write" {
		t.Errorf("toolName = %v", fileChanges[0].Payload["toolName"])
	}
}

func TestOpenCodePermissionEvent(t *testing.T) {
	input := `{"type":"permission","part":{"type":"permission","toolName":"Bash","toolInput":{"command":"rm -rf /"}}}`
	emitter := parseOpenCodeLines(t, input)

	events := emitter.eventsOfType(BusEventStatusChange)
	if len(events) != 1 {
		t.Fatalf("expected 1 status_change event, got %d", len(events))
	}
	if events[0].Payload["permissionMode"] != "ask" {
		t.Errorf("permissionMode = %v", events[0].Payload["permissionMode"])
	}
	if events[0].Payload["permissionTool"] != "Bash" {
		t.Errorf("permissionTool = %v", events[0].Payload["permissionTool"])
	}
}

func TestOpenCodeFileEvent(t *testing.T) {
	input := `{"type":"file","part":{"type":"file","path":"/tmp/test.txt","operation":"write"}}`
	emitter := parseOpenCodeLines(t, input)

	events := emitter.eventsOfType(BusEventFileChange)
	if len(events) != 1 {
		t.Fatalf("expected 1 file_change event, got %d", len(events))
	}
	if events[0].Payload["path"] != "/tmp/test.txt" {
		t.Errorf("path = %v", events[0].Payload["path"])
	}
	if events[0].Payload["operation"] != "write" {
		t.Errorf("operation = %v", events[0].Payload["operation"])
	}
}

func TestOpenCodeSessionInitEvent(t *testing.T) {
	input := `{"type":"session.init","sessionID":"ses_abc","model":"anthropic/claude-sonnet-4-6","provider":"anthropic","tools":["Read","Write","Bash","Glob","Grep"]}`
	emitter := parseOpenCodeLines(t, input)

	events := emitter.eventsOfType(BusEventSessionInit)
	if len(events) != 1 {
		t.Fatalf("expected 1 session_init event, got %d", len(events))
	}
	if events[0].Payload["sessionId"] != "ses_abc" {
		t.Errorf("sessionId = %v", events[0].Payload["sessionId"])
	}
	if events[0].Payload["model"] != "anthropic/claude-sonnet-4-6" {
		t.Errorf("model = %v", events[0].Payload["model"])
	}
	if events[0].Payload["provider"] != "anthropic" {
		t.Errorf("provider = %v", events[0].Payload["provider"])
	}
}

func TestOpenCodeSessionErrorEvent(t *testing.T) {
	input := `{"type":"session.error","error":"authentication failed"}`
	emitter := parseOpenCodeLines(t, input)

	events := emitter.eventsOfType(BusEventResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 result event, got %d", len(events))
	}
	if events[0].Payload["success"] != false {
		t.Errorf("success = %v", events[0].Payload["success"])
	}
}

func TestOpenCodeTaskStartEvent(t *testing.T) {
	input := `{"type":"task_start","taskId":"task_1","taskDescription":"explore the codebase","taskType":"subagent"}`
	emitter := parseOpenCodeLines(t, input)

	events := emitter.eventsOfType(BusEventTaskStarted)
	if len(events) != 1 {
		t.Fatalf("expected 1 task_started event, got %d", len(events))
	}
	if events[0].Payload["taskId"] != "task_1" {
		t.Errorf("taskId = %v", events[0].Payload["taskId"])
	}
	if events[0].Payload["taskType"] != "subagent" {
		t.Errorf("taskType = %v", events[0].Payload["taskType"])
	}
}

func TestOpenCodeTaskProgressEvent(t *testing.T) {
	input := `{"type":"task_progress","taskId":"task_1","taskDescription":"exploring","lastToolName":"Grep"}`
	emitter := parseOpenCodeLines(t, input)

	events := emitter.eventsOfType(BusEventTaskProgress)
	if len(events) != 1 {
		t.Fatalf("expected 1 task_progress event, got %d", len(events))
	}
	if events[0].Payload["taskId"] != "task_1" {
		t.Errorf("taskId = %v", events[0].Payload["taskId"])
	}
	if events[0].Payload["lastToolName"] != "Grep" {
		t.Errorf("lastToolName = %v", events[0].Payload["lastToolName"])
	}
}

func TestOpenCodeTaskCompleteEvent(t *testing.T) {
	input := `{"type":"task_complete","taskId":"task_1","taskSummary":"found 15 matches","taskUsage":{"inputTokens":100,"outputTokens":50}}`
	emitter := parseOpenCodeLines(t, input)

	events := emitter.eventsOfType(BusEventTaskNotification)
	if len(events) != 1 {
		t.Fatalf("expected 1 task_notification event, got %d", len(events))
	}
	if events[0].Payload["taskId"] != "task_1" {
		t.Errorf("taskId = %v", events[0].Payload["taskId"])
	}
	if events[0].Payload["status"] != "completed" {
		t.Errorf("status = %v", events[0].Payload["status"])
	}
	if events[0].Payload["summary"] != "found 15 matches" {
		t.Errorf("summary = %v", events[0].Payload["summary"])
	}
}
