package adapters

import (
	"context"
	"os"
	"os/exec"
	"testing"

	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

func claudePath(t *testing.T) string {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	path := os.Getenv("CLAUDE_PATH")
	if path == "" {
		path = "claude"
	}
	if _, err := exec.LookPath(path); err != nil {
		t.Skipf("claude binary not found at %q — set CLAUDE_PATH to run integration tests", path)
	}
	return path
}

func TestClaudeCodeIntegrationBasicPrompt(t *testing.T) {
	adapter := NewClaudeCodeAdapter(claudePath(t), "", "")
	ctx := context.Background()
	run := store.Run{ID: "run_int_test", ProjectID: "proj_int", ThreadID: "thread_int", Status: "started"}

	cmdPath, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
		Run:    run,
		Prompt: "say the word hello and nothing else",
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
	if err := cmd.Wait(); err != nil {
		t.Fatalf("claude exited with error: %v", err)
	}

	// Verify we got at least a session_init and result
	initEvents := emitter.eventsOfType(BusEventSessionInit)
	if len(initEvents) == 0 {
		t.Error("no session_init event")
	}

	resultEvents := emitter.eventsOfType(BusEventResult)
	if len(resultEvents) == 0 {
		t.Error("no result event")
	}
	if len(resultEvents) > 0 && resultEvents[0].Payload["success"] != true {
		t.Errorf("result success = %v", resultEvents[0].Payload["success"])
	}

	// Verify we got text output
	textBlocks := emitter.eventsOfType(BusEventTextBlock)
	textDeltas := emitter.eventsOfType(BusEventTextDelta)
	if len(textBlocks) == 0 && len(textDeltas) == 0 {
		t.Error("no text output received")
	}

	t.Logf("events: %d init, %d text_block, %d text_delta, %d result",
		len(initEvents), len(textBlocks), len(textDeltas), len(resultEvents))
}

func TestClaudeCodeIntegrationToolUse(t *testing.T) {
	adapter := NewClaudeCodeAdapter(claudePath(t), "", "")
	ctx := context.Background()
	run := store.Run{ID: "run_int_tool", ProjectID: "proj_int", ThreadID: "thread_int", Status: "started"}

	// Prompt that requires a tool call (Read a specific file)
	cmdPath, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
		Run:    run,
		Prompt: "read the file AGENTS.md and tell me the first rule mentioned in it",
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

	toolCalls := emitter.eventsOfType(BusEventToolCall)
	toolResults := emitter.eventsOfType(BusEventToolResult)

	t.Logf("tool_calls=%d, tool_results=%d, file_changes=%d",
		len(toolCalls), len(toolResults), len(emitter.eventsOfType(BusEventFileChange)))

	// Should have at least one tool call (Read AGENTS.md)
	if len(toolCalls) == 0 {
		t.Error("no tool calls — expected at least Read tool")
	}
}

func TestClaudeCodeIntegrationCancellation(t *testing.T) {
	adapter := NewClaudeCodeAdapter(claudePath(t), "", "")
	ctx, cancel := context.WithCancel(context.Background())

	run := store.Run{ID: "run_int_cancel", ProjectID: "proj_int", ThreadID: "thread_int", Status: "started"}

	cmdPath, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
		Run:    run,
		Prompt: "list every file in this project recursively and describe each one in detail. then write a comprehensive summary of every file you examined.",
	})

	cmd := exec.CommandContext(ctx, cmdPath, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}

	// Cancel almost immediately
	cancel()

	emitter := &mockEmitter{}
	_ = adapter.ParseStream(ctx, stdout, nil, emitter, run)
	_ = cmd.Wait()

	// The process should have been killed; we may or may not get a result
	// Verify we at least don't crash
	resultEvents := emitter.eventsOfType(BusEventResult)
	t.Logf("events after cancel: result=%d, text=%d, tool=%d",
		len(resultEvents),
		len(emitter.eventsOfType(BusEventTextBlock)),
		len(emitter.eventsOfType(BusEventToolCall)))
}

func TestClaudeCodeIntegrationWithStdinControl(t *testing.T) {
	adapter := NewClaudeCodeAdapter(claudePath(t), "", "bypassPermissions")
	ctx := context.Background()
	run := store.Run{ID: "run_int_ctrl", ProjectID: "proj_int", ThreadID: "thread_int", Status: "started"}

	cmdPath, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
		Run:    run,
		Prompt: "write a file called test_hello.txt with content 'hello world'",
	})

	cmd := exec.CommandContext(ctx, cmdPath, args...)
	stdout, _ := cmd.StdoutPipe()
	stdin, _ := cmd.StdinPipe()
	cmd.Start()

	emitter := &mockEmitter{}
	if err := adapter.ParseStream(ctx, stdout, stdin, emitter, run); err != nil {
		t.Logf("ParseStream: %v (may be expected after file write)", err)
	}
	_ = cmd.Wait()

	// With bypassPermissions + stdin, the Write should not require explicit permission
	fileChanges := emitter.eventsOfType(BusEventFileChange)
	t.Logf("file_change events: %d", len(fileChanges))

	// Clean up
	os.Remove("test_hello.txt")

	// Verify we got a result
	if len(emitter.eventsOfType(BusEventResult)) == 0 {
		t.Error("no result event")
	}
}

func TestClaudeCodeBuildCommandArgs(t *testing.T) {
	adapter := NewClaudeCodeAdapter("claude", "claude-sonnet-4-6", "default")
	run := store.Run{ID: "run_test", ProjectID: "p1", ThreadID: "t1", Status: "started"}

	t.Run("basic", func(t *testing.T) {
		cmd, args, env, wd := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:    run,
			Prompt: "hello",
		})
		if cmd == "" {
			t.Error("cmd is empty")
		}
		if len(args) == 0 {
			t.Error("no args")
		}
		hasPrompt := false
		hasModel := false
		hasStreamJSON := false
		for _, a := range args {
			if a == "hello" {
				hasPrompt = true
			}
			if a == "--model" {
				hasModel = true
			}
			if a == "stream-json" {
				hasStreamJSON = true
			}
		}
		if !hasPrompt {
			t.Error("prompt not in args")
		}
		if !hasStreamJSON {
			t.Error("stream-json not in args")
		}
		_ = env
		_ = wd
		_ = hasModel
	})

	t.Run("session_id", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:       run,
			Prompt:    "hello",
			SessionID: "ses_abc",
		})
		hasSessionID := false
		hasValue := false
		for i, a := range args {
			if a == "--session-id" {
				hasSessionID = true
				if i+1 < len(args) && args[i+1] == "ses_abc" {
					hasValue = true
				}
			}
		}
		if !hasSessionID {
			t.Error("--session-id not in args when SessionID set")
		}
		if !hasValue {
			t.Error("--session-id value missing")
		}
	})

	t.Run("session_continue", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:          run,
			Prompt:       "hello",
			ContinueLast: true,
		})
		hasContinue := false
		for _, a := range args {
			if a == "--continue" {
				hasContinue = true
			}
		}
		if !hasContinue {
			t.Error("--continue not in args when ContinueLast set")
		}
	})

	t.Run("session_fork", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:         run,
			Prompt:      "hello",
			ForkSession: true,
		})
		hasFork := false
		for _, a := range args {
			if a == "--fork-session" {
				hasFork = true
			}
		}
		if !hasFork {
			t.Error("--fork-session not in args when ForkSession set")
		}
	})

	t.Run("reasoning_effort", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:             run,
			Prompt:          "hello",
			ReasoningEffort: "high",
		})
		hasEffort := false
		hasValue := false
		for i, a := range args {
			if a == "--effort" {
				hasEffort = true
				if i+1 < len(args) && args[i+1] == "high" {
					hasValue = true
				}
			}
		}
		if !hasEffort {
			t.Error("--effort not in args when ReasoningEffort set")
		}
		if !hasValue {
			t.Error("effort value missing after flag")
		}
	})

	t.Run("thinking_deprecated_fallback", func(t *testing.T) {
		// MaxThinkingTokens triggers --thinking enabled fallback since the flag is deprecated.
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:               run,
			Prompt:            "hello",
			MaxThinkingTokens: 16000,
		})
		hasThinking := false
		hasEnabled := false
		for i, a := range args {
			if a == "--thinking" {
				hasThinking = true
				if i+1 < len(args) && args[i+1] == "enabled" {
					hasEnabled = true
				}
			}
		}
		if !hasThinking {
			t.Error("--thinking not in args when MaxThinkingTokens set (deprecated fallback)")
		}
		if !hasEnabled {
			t.Error("--thinking value not 'enabled' when MaxThinkingTokens set")
		}
	})

	t.Run("thinking_mode_explicit", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:          run,
			Prompt:       "hello",
			ThinkingMode: "adaptive",
		})
		hasThinking := false
		hasAdaptive := false
		for i, a := range args {
			if a == "--thinking" {
				hasThinking = true
				if i+1 < len(args) && args[i+1] == "adaptive" {
					hasAdaptive = true
				}
			}
		}
		if !hasThinking {
			t.Error("--thinking not in args when ThinkingMode set")
		}
		if !hasAdaptive {
			t.Error("--thinking value not 'adaptive' when ThinkingMode='adaptive'")
		}
	})

	t.Run("json_schema", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:                    run,
			Prompt:                 "hello",
			StructuredOutputSchema: `{"type":"object"}`,
		})
		hasFlag := false
		hasValue := false
		for i, a := range args {
			if a == "--json-schema" {
				hasFlag = true
				if i+1 < len(args) && args[i+1] == `{"type":"object"}` {
					hasValue = true
				}
			}
		}
		if !hasFlag {
			t.Error("--json-schema not in args when StructuredOutputSchema set")
		}
		if !hasValue {
			t.Error("json-schema value missing")
		}
	})

	t.Run("system_prompt", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:          run,
			Prompt:       "hello",
			SystemPrompt: "You are a helpful assistant.",
		})
		hasFlag := false
		for _, a := range args {
			if a == "--system-prompt" {
				hasFlag = true
			}
		}
		if !hasFlag {
			t.Error("--system-prompt not in args when SystemPrompt set")
		}
	})

	t.Run("append_system_prompt", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:                run,
			Prompt:             "hello",
			AppendSystemPrompt: "Always be concise.",
		})
		hasFlag := false
		for _, a := range args {
			if a == "--append-system-prompt" {
				hasFlag = true
			}
		}
		if !hasFlag {
			t.Error("--append-system-prompt not in args when AppendSystemPrompt set")
		}
	})

	t.Run("agent_definitions", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:    run,
			Prompt: "hello",
			AgentDefinitions: map[string]runnerctx.AgentDefinition{
				"reviewer": {Description: "reviews code", Prompt: "You are a reviewer", Tools: []string{"Read"}},
			},
		})
		hasAgents := false
		for _, a := range args {
			if a == "--agents" {
				hasAgents = true
			}
		}
		if !hasAgents {
			t.Error("--agents not in args when AgentDefinitions set")
		}
	})

	t.Run("mcp_config", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:       run,
			Prompt:    "hello",
			MCPConfig: `{"server":{"command":"node"}}`,
		})
		hasFlag := false
		for _, a := range args {
			if a == "--mcp-config" {
				hasFlag = true
			}
		}
		if !hasFlag {
			t.Error("--mcp-config not in args when MCPConfig set")
		}
	})

	t.Run("allowed_tools", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:          run,
			Prompt:       "hello",
			AllowedTools: []string{"Read", "Grep"},
		})
		var tools []string
		for i, a := range args {
			if a == "--allowedTools" && i+1 < len(args) {
				tools = append(tools, args[i+1])
			}
		}
		if len(tools) != 2 || tools[0] != "Read" || tools[1] != "Grep" {
			t.Errorf("--allowedTools values = %v, want [Read Grep]", tools)
		}
	})

	t.Run("max_budget_usd", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:          run,
			Prompt:       "hello",
			MaxBudgetUSD: 5.00,
		})
		hasFlag := false
		hasValue := false
		for i, a := range args {
			if a == "--max-budget-usd" {
				hasFlag = true
				if i+1 < len(args) && args[i+1] == "5.00" {
					hasValue = true
				}
			}
		}
		if !hasFlag {
			t.Error("--max-budget-usd not in args when MaxBudgetUSD set")
		}
		if !hasValue {
			t.Error("max-budget-usd value missing")
		}
	})

	t.Run("fast_mode", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:      run,
			Prompt:   "hello",
			FastMode: true,
		})
		hasFast := false
		for _, a := range args {
			if a == "--fast" {
				hasFast = true
			}
		}
		if !hasFast {
			t.Error("--fast not in args when FastMode set")
		}
	})

	t.Run("include_partial", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:            run,
			Prompt:         "hello",
			IncludePartial: true,
		})
		hasPartial := false
		for _, a := range args {
			if a == "--include-partial-messages" {
				hasPartial = true
			}
		}
		if !hasPartial {
			t.Error("--include-partial-messages not in args when IncludePartial set")
		}
	})

	t.Run("permission_mode", func(t *testing.T) {
		_, args, _, _ := adapter.BuildCommand(runnerctx.RunProcessContext{
			Run:            run,
			Prompt:         "hello",
			PermissionMode: "plan",
		})
		hasFlag := false
		hasValue := false
		for i, a := range args {
			if a == "--permission-mode" {
				hasFlag = true
				if i+1 < len(args) && args[i+1] == "plan" {
					hasValue = true
				}
			}
		}
		if !hasFlag {
			t.Error("--permission-mode not in args when PermissionMode set")
		}
		if !hasValue {
			t.Error("permission-mode value missing after flag")
		}
	})
}

func TestClaudeCodeIntegrationNoBinary(t *testing.T) {
	adapter := NewClaudeCodeAdapter("/nonexistent/claude", "", "")

	// BuildCommand should still work — it just returns args
	cmd, args, env, wd := adapter.BuildCommand(runnerctx.RunProcessContext{
		Run:    store.Run{ID: "r1", ProjectID: "p1", ThreadID: "t1", Status: "started"},
		Prompt: "hi",
	})
	if cmd != "/nonexistent/claude" {
		t.Errorf("cmd = %q", cmd)
	}
	if len(args) == 0 {
		t.Error("no args")
	}
	_ = env
	_ = wd

	// Verify we don't try to execute the nonexistent binary in BuildCommand
	// (ProcessExecutor handles actual execution)
}
