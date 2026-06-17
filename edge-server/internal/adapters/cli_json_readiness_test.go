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

func TestCLIJSONReadinessCommandPlansRedactPromptEnvAndPaths(t *testing.T) {
	secretPrompt := "SECRET_PROMPT_SHOULD_NOT_APPEAR"
	secretEnv := "OPENAI_API_KEY=sk-test-secret-value"
	privateWorkDir := `C:\Users\Example\private\agenthub`
	privateCommandPath := `C:\Users\Example\.codex\bin\codex.cmd`
	ctx := RunProcessContext{
		Prompt:          secretPrompt,
		AgentID:         "codex",
		Model:           "gpt-5",
		PermissionMode:  "plan",
		ReasoningEffort: "high",
		WorkDir:         privateWorkDir,
	}

	plan := BuildCLIInvocationPlanFromCommand(
		NewCodexAdapter("codex", "gpt-5.5"),
		ctx,
		privateCommandPath,
		[]string{"exec", "-c", "model=gpt-5.3-codex", "--json", secretPrompt},
		[]string{secretEnv, "AGENTHUB_SAFE_FLAG=1"},
		privateWorkDir,
	)
	payloadJSON := marshalReadinessPayload(t, plan.Payload())

	for _, leaked := range []string{
		secretPrompt,
		"sk-test-secret-value",
		`C:\Users\Example`,
		`.codex\bin`,
		privateCommandPath,
		privateWorkDir,
	} {
		if strings.Contains(payloadJSON, leaked) {
			t.Fatalf("redacted invocation plan leaked %q:\n%s", leaked, payloadJSON)
		}
	}
	if plan.CommandName != "codex.cmd" {
		t.Fatalf("CommandName = %q, want basename-only codex.cmd", plan.CommandName)
	}
	if plan.WorkDir != "agenthub" {
		t.Fatalf("WorkDir = %q, want basename-only agenthub", plan.WorkDir)
	}
	if !plan.PromptRedacted || !plan.RedactionApplied || !plan.NoSpendDefault || !plan.ApprovalRequired {
		t.Fatalf("plan redaction/safety flags mismatch: %#v", plan)
	}
	if plan.Observed || plan.RealTested {
		t.Fatalf("fixture command plan must not claim observed/real tested: %#v", plan)
	}
	if plan.MockAdapterUsed || plan.RealCliTested || plan.RealModelTested || plan.TokenDanceIDLogin {
		t.Fatalf("fixture command plan must split approved-real readiness claims as false: %#v", plan)
	}
	if plan.RealCliTestedReason == "" || plan.RealModelTestedReason == "" || plan.TokenDanceIDLoginReason == "" {
		t.Fatalf("fixture command plan must carry explicit blocked reasons: %#v", plan)
	}
	if !containsString(plan.ArgFlags, "--json") || !containsString(plan.ConfigKeys, "model") {
		t.Fatalf("plan lost safe command-shape evidence: %#v", plan)
	}
	if !containsString(plan.EnvNames, "OPENAI_API_KEY") || strings.Contains(payloadJSON, "=") {
		t.Fatalf("plan should retain env names only, without values: %#v\n%s", plan.EnvNames, payloadJSON)
	}
}

func TestCLIJSONReadinessPayloadSplitsRealCliModelAndLoginClaims(t *testing.T) {
	plan := BuildCLIInvocationPlanFromCommand(
		NewOpenCodeAdapter("opencode"),
		RunProcessContext{Prompt: "fixture prompt", AgentID: "opencode", WorkDir: `C:\Users\Example\private\agenthub`},
		`C:\tools\opencode.exe`,
		[]string{"run", "--json"},
		[]string{"TOKEN_DANCE_API_KEY=secret-value"},
		`C:\Users\Example\private\agenthub`,
	)
	payload := plan.Payload()

	for _, field := range []string{"mockAdapterUsed", "realCliTested", "realModelTested", "tokenDanceIdLogin"} {
		if value, ok := payload[field].(bool); !ok || value {
			t.Fatalf("%s = %#v, want boolean false in no-secret fixture plan: %#v", field, payload[field], payload)
		}
	}
	for _, field := range []string{"realCliTestedReason", "realModelTestedReason", "tokenDanceIdLoginReason"} {
		if value, ok := payload[field].(string); !ok || strings.TrimSpace(value) == "" {
			t.Fatalf("%s = %#v, want non-empty blocked reason: %#v", field, payload[field], payload)
		}
	}
	if payload["realTested"] != false {
		t.Fatalf("legacy realTested compatibility field = %#v, want false", payload["realTested"])
	}
}

func TestCodexExecJSONReadinessFixtureMapsBatchOutputStatusAndError(t *testing.T) {
	success := strings.Join([]string{
		`{"type":"thread.started","thread_id":"thread_cli_json"}`,
		`{"type":"turn.started"}`,
		`{"type":"item.completed","item":{"id":"item_msg","type":"agent_message","text":"Codex fixture answer."}}`,
		`{"type":"turn.completed","usage":{"input_tokens":7,"cached_input_tokens":2,"output_tokens":3}}`,
	}, "\n")
	emitter := parseCodexLines(t, success)

	if events := emitter.eventsOfType(BusEventTextBlock); len(events) != 1 || events[0].Payload["content"] != "Codex fixture answer." {
		t.Fatalf("Codex assistant output mismatch: %#v", events)
	}
	if events := emitter.eventsOfType(BusEventSessionStateChanged); len(events) != 2 || events[0].Payload["state"] != "busy" || events[1].Payload["state"] != "idle" {
		t.Fatalf("Codex status mapping mismatch: %#v", events)
	}
	if events := emitter.eventsOfType(BusEventResult); len(events) != 1 || events[0].Payload["success"] != true {
		t.Fatalf("Codex success result mismatch: %#v", events)
	}

	failure := `{"type":"turn.failed","error":{"message":"fixture auth not configured"}}`
	emitter = parseCodexLines(t, failure)
	events := emitter.eventsOfType(BusEventResult)
	if len(events) != 1 || events[0].Payload["success"] != false || events[0].Payload["error"] != "fixture auth not configured" {
		t.Fatalf("Codex error mapping mismatch: %#v", events)
	}
}

func TestClaudeStreamJSONReadinessFixtureMapsPermissionDecisionAndStatus(t *testing.T) {
	adapter := NewClaudeCodeAdapter("claude", "", "")
	broker := NewPermissionDecisionBroker()
	adapter.SetPermissionBroker(broker)
	run := store.Run{ID: "run_claude_json", ProjectID: "proj_json", ThreadID: "thread_json", Status: "started"}

	inner, _ := json.Marshal(ControlRequestInner{
		Subtype:   "can_use_tool",
		ToolName:  "Bash",
		ToolUseID: "tool_bash_1",
		Input:     map[string]any{"command": "git status --short"},
	})
	control, _ := json.Marshal(ControlMessage{
		Type:      "control_request",
		RequestID: "req_permission_1",
		Request:   inner,
	})
	stream := strings.Join([]string{
		`{"type":"system","subtype":"init","model":"claude-sonnet-4-6","permissionMode":"default","session_id":"ses_json"}`,
		`{"type":"system","subtype":"session_state_changed","state":"busy","session_id":"ses_json"}`,
		string(control),
		`{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Claude fixture answer."}]},"session_id":"ses_json"}`,
		`{"type":"result","subtype":"success","is_error":false,"duration_ms":25,"num_turns":1,"result":"done","session_id":"ses_json","usage":{"input_tokens":13,"output_tokens":5}}`,
	}, "\n")

	emitter := &mockEmitter{}
	var stdin bytes.Buffer
	done := make(chan error, 1)
	go func() {
		done <- adapter.ParseStream(context.Background(), strings.NewReader(stream), &stdin, emitter, run)
	}()

	pending, ok := waitForBrokeredPermissionDecision(t, broker, run.ID, "req_permission_1", PermissionDecision{
		Behavior:      "deny",
		Message:       "fixture denied",
		DecisionClass: "user_rejected",
	})
	if !ok {
		t.Fatal("Claude permission request was not bridged to broker")
	}
	if pending.ToolName != "Bash" || pending.ToolUseID != "tool_bash_1" || pending.ProjectID != run.ProjectID || pending.ThreadID != run.ThreadID {
		t.Fatalf("pending Claude permission scope mismatch: %#v", pending)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Claude fixture ParseStream: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Claude fixture did not resume after permission decision")
	}

	var response ControlMessage
	if err := json.Unmarshal(stdin.Bytes(), &response); err != nil {
		t.Fatalf("decode Claude stdin control response: %v", err)
	}
	var responseInner ControlResponseInner
	if err := json.Unmarshal(response.Response, &responseInner); err != nil {
		t.Fatalf("decode Claude control response body: %v", err)
	}
	if responseInner.Behavior != "deny" || responseInner.Message != "fixture denied" {
		t.Fatalf("Claude decision bridge mismatch: %#v", responseInner)
	}
	if events := emitter.eventsOfType(BusEventSessionInit); len(events) != 1 || events[0].Payload["model"] != "claude-sonnet-4-6" {
		t.Fatalf("Claude init/model metadata mismatch: %#v", events)
	}
	if events := emitter.eventsOfType(BusEventTextBlock); len(events) != 1 || events[0].Payload["content"] != "Claude fixture answer." {
		t.Fatalf("Claude text mapping mismatch: %#v", events)
	}
	if events := emitter.eventsOfType(BusEventResult); len(events) != 1 || events[0].Payload["success"] != true {
		t.Fatalf("Claude result mapping mismatch: %#v", events)
	}
}

func TestOpenCodeJSONReadinessFixtureMapsPermissionRiskStatusAndMetadata(t *testing.T) {
	input := strings.Join([]string{
		`{"type":"step_start","timestamp":1,"sessionID":"ses_open","model":"newapi/deepseek-v4-pro","provider":"newapi","tools":["read","bash"]}`,
		`{"type":"text","timestamp":2,"sessionID":"ses_open","part":{"type":"text","text":"OpenCode fixture answer."}}`,
		`{"type":"permission.asked","timestamp":3,"sessionID":"ses_open","requestID":"perm_shell_1","callID":"call_bash_1","toolName":"bash","riskLevel":"high","reason":"shell approval required","input":{"command":"git diff --check"}}`,
		`{"type":"step_finish","timestamp":4,"sessionID":"ses_open","part":{"type":"step_finish","reason":"stop","tokens":{"input":5,"output":6,"reasoning":1,"total":12,"cache":{"read":0,"write":0}},"cost":0.01}}`,
	}, "\n")
	emitter := parseOpenCodeLines(t, input)

	if events := emitter.eventsOfType(BusEventSessionInit); len(events) != 1 || events[0].Payload["model"] != "newapi/deepseek-v4-pro" || events[0].Payload["provider"] != "newapi" {
		t.Fatalf("OpenCode session metadata mismatch: %#v", events)
	}
	if events := emitter.eventsOfType(BusEventTextDelta); len(events) != 1 || events[0].Payload["content"] != "OpenCode fixture answer." {
		t.Fatalf("OpenCode text mapping mismatch: %#v", events)
	}
	permissions := emitter.eventsOfType(BusEventPermissionRequested)
	if len(permissions) != 1 {
		t.Fatalf("expected OpenCode permission risk event, got %d", len(permissions))
	}
	payload := permissions[0].Payload
	if payload["requestId"] != "perm_shell_1" || payload["toolName"] != "bash" || payload["riskLevel"] != "high" {
		t.Fatalf("OpenCode permission payload mismatch: %#v", payload)
	}
	if payload["decisionBridge"] != "blocked" || payload["nonInteractive"] != true {
		t.Fatalf("OpenCode permission risk should be explicitly blocked/non-interactive: %#v", payload)
	}
	if events := emitter.eventsOfType(BusEventSessionStateChanged); len(events) != 2 || events[0].Payload["state"] != "busy" || events[1].Payload["state"] != "idle" {
		t.Fatalf("OpenCode status mapping mismatch: %#v", events)
	}
	if events := emitter.eventsOfType(BusEventResult); len(events) != 1 || events[0].Payload["success"] != true {
		t.Fatalf("OpenCode result mapping mismatch: %#v", events)
	}

	adapter := NewOpenCodeAdapter("opencode")
	_, args, _, _ := adapter.BuildCommand(RunProcessContext{
		Prompt:         "fixture prompt",
		PermissionMode: "default",
	})
	if containsString(args, "--dangerously-skip-permissions") {
		t.Fatalf("OpenCode default permission mode must not enable bypass: %#v", args)
	}
	_, args, _, _ = adapter.BuildCommand(RunProcessContext{
		Prompt:         "fixture prompt",
		PermissionMode: "bypassPermissions",
	})
	if !containsString(args, "--dangerously-skip-permissions") {
		t.Fatalf("OpenCode bypass marker should only appear when explicitly requested: %#v", args)
	}
}

func TestCLIJSONReadinessModelProviderMetadataBaseline(t *testing.T) {
	for _, tc := range []struct {
		runtimeID string
		name      string
		model     string
	}{
		{"codex", "Codex", "gpt-5.5"},
		{"claude-code", "Claude Code", "claude-sonnet-4-6"},
		{"opencode", "OpenCode", "newapi/deepseek-v4-pro"},
	} {
		t.Run(tc.runtimeID, func(t *testing.T) {
			if got := DefaultModels[tc.runtimeID]; got != tc.model {
				t.Fatalf("DefaultModels[%s] = %q, want %q", tc.runtimeID, got, tc.model)
			}
			var adapter AgentAdapter
			switch tc.runtimeID {
			case "codex":
				adapter = NewCodexAdapter("codex", "")
			case "claude-code":
				adapter = NewClaudeCodeAdapter("claude", "", "")
			case "opencode":
				adapter = NewOpenCodeAdapter("opencode")
			}
			if adapter.Metadata().ID != tc.runtimeID || adapter.Metadata().Name != tc.name {
				t.Fatalf("metadata mismatch for %s: %#v", tc.runtimeID, adapter.Metadata())
			}
		})
	}
}

func marshalReadinessPayload(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return string(data)
}

func waitForBrokeredPermissionDecision(t *testing.T, broker *PermissionDecisionBroker, runID, requestID string, decision PermissionDecision) (PendingPermissionRequest, bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		pending, ok := broker.Decide(runID, requestID, decision)
		if ok {
			return pending, true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return PendingPermissionRequest{}, false
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}
