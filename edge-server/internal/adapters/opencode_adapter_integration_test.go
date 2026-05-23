package adapters

import (
	"context"
	"os"
	"os/exec"
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

	// Verify event sequence: step_start → text → step_finish
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
