package sdk

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSDKFixtureMapperClaudeGolden(t *testing.T) {
	assertSDKFixtureGolden(t, "claude")
}

func TestSDKFixtureMapperOpenAIGolden(t *testing.T) {
	assertSDKFixtureGolden(t, "openai")
}

func TestSDKFixtureMapperOpenCodeGolden(t *testing.T) {
	assertSDKFixtureGolden(t, "opencode")
}

func TestSDKFixtureMapperCustomOpenAICompatibleGolden(t *testing.T) {
	assertSDKFixtureGolden(t, "custom_openai_compatible")
}

func TestSDKFixtureMapperProviderOfflineEventMatrix(t *testing.T) {
	cases := []struct {
		name       string
		fixture    string
		wantTypes  []string
		wantEvents map[string]string
	}{
		{
			name: "claude agent sdk like",
			fixture: `{
				"provider": "claude-sdk-fixture",
				"events": [
					{"id": "claude_text", "type": "assistant_message", "content": "Claude fixture text", "evidenceRefs": ["event:claude_text"]},
					{"id": "claude_tool", "type": "tool_use", "toolUseId": "toolu_read", "toolName": "Read", "input": {"file_path": "edge-server/internal/adapters/sdk_fixture_mapper.go"}},
					{"id": "claude_tool_result", "type": "tool_result", "toolUseId": "toolu_read", "toolName": "Read", "output": "read fixture file"},
					{"id": "claude_file", "type": "file_changed", "toolUseId": "toolu_write", "toolName": "Write", "path": "edge-server/internal/adapters/sdk_fixture_mapper.go", "kind": "modified"},
					{"id": "claude_permission", "type": "permission_asked", "requestId": "perm_claude", "toolUseId": "toolu_bash", "toolName": "Bash", "riskLevel": "high", "reason": "offline fixture approval"},
					{"id": "claude_artifact", "type": "artifact_created", "artifactId": "artifact_claude", "path": "artifacts/claude-fixture.md", "kind": "markdown", "evidenceRefs": ["event:claude_file"]},
					{"id": "claude_result", "type": "terminal_result", "success": true, "summary": "Claude fixture complete", "evidenceRefs": ["artifact:artifact_claude"]}
				]
			}`,
			wantTypes: []string{
				BusEventTextBlock,
				BusEventToolCall,
				BusEventToolResult,
				BusEventFileChange,
				BusEventPermissionRequested,
				sdkFixtureEventArtifactCreated,
				BusEventResult,
			},
			wantEvents: map[string]string{
				"claude_text":        BusEventTextBlock,
				"claude_tool":        BusEventToolCall,
				"claude_tool_result": BusEventToolResult,
				"claude_file":        BusEventFileChange,
				"claude_permission":  BusEventPermissionRequested,
				"claude_artifact":    sdkFixtureEventArtifactCreated,
				"claude_result":      BusEventResult,
			},
		},
		{
			name: "openai agents sdk like",
			fixture: `{
				"provider": "openai-agents-sdk-fixture",
				"events": [
					{"id": "openai_text", "type": "message_output", "content": "OpenAI fixture text", "evidenceRefs": ["event:openai_text"]},
					{"id": "openai_tool", "type": "function_tool_call", "callId": "call_patch", "toolName": "apply_patch", "input": {"path": "edge-server/internal/adapters/sdk_fixture_mapper.go", "api_key": "sk-not-real"}},
					{"id": "openai_tool_result", "type": "function_tool_output", "callId": "call_patch", "toolName": "apply_patch", "output": "patch applied"},
					{"id": "openai_file", "type": "artifact_file", "callId": "call_patch", "toolName": "apply_patch", "path": "edge-server/internal/adapters/sdk_fixture_mapper_test.go", "kind": "modified"},
					{"id": "openai_permission", "type": "guardrail_triggered", "requestId": "guard_openai", "callId": "call_shell", "toolName": "shell", "riskLevel": "medium", "reason": "offline guardrail approval"},
					{"id": "openai_artifact", "type": "artifact_created", "artifactId": "artifact_openai", "path": "artifacts/openai-fixture.json", "kind": "json", "metadata": {"trace_url": "fixture://trace/openai", "token": "secret-token"}, "evidenceRefs": ["event:openai_file"]},
					{"id": "openai_result", "type": "run_result", "success": true, "summary": "OpenAI fixture complete", "evidenceRefs": ["artifact:artifact_openai"]}
				]
			}`,
			wantTypes: []string{
				BusEventTextBlock,
				BusEventToolCall,
				BusEventToolResult,
				BusEventFileChange,
				BusEventPermissionRequested,
				sdkFixtureEventArtifactCreated,
				BusEventResult,
			},
			wantEvents: map[string]string{
				"openai_text":        BusEventTextBlock,
				"openai_tool":        BusEventToolCall,
				"openai_tool_result": BusEventToolResult,
				"openai_file":        BusEventFileChange,
				"openai_permission":  BusEventPermissionRequested,
				"openai_artifact":    sdkFixtureEventArtifactCreated,
				"openai_result":      BusEventResult,
			},
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			stream, err := DecodeSDKFixtureStream([]byte(tt.fixture))
			if err != nil {
				t.Fatalf("decode fixture: %v", err)
			}

			mapped := MapSDKFixtureStream(stream, testSDKFixtureScope())
			gotTypes := make([]string, 0, len(mapped))
			for _, evt := range mapped {
				gotTypes = append(gotTypes, evt.Type)
				sourceEventID, _ := evt.Payload["sourceEventId"].(string)
				if wantType := tt.wantEvents[sourceEventID]; wantType != "" && evt.Type != wantType {
					t.Fatalf("source event %s mapped to %s, want %s", sourceEventID, evt.Type, wantType)
				}
				if evt.Scope["runId"] != "run_fixture" {
					t.Fatalf("mapped event %s lost replay scope: %#v", evt.Type, evt.Scope)
				}
				if evt.Payload["provider"] != stream.Provider {
					t.Fatalf("mapped event %s provider = %#v, want %s", evt.Type, evt.Payload["provider"], stream.Provider)
				}
			}
			if strings.Join(gotTypes, ",") != strings.Join(tt.wantTypes, ",") {
				t.Fatalf("mapped types = %v, want %v", gotTypes, tt.wantTypes)
			}

			replay := marshalSDKFixtureJSON(t, mapSDKEventsForHubReplay(mapped))
			for _, leaked := range []string{"sk-not-real", "secret-token"} {
				if strings.Contains(replay, leaked) {
					t.Fatalf("offline fixture replay leaked %q:\n%s", leaked, replay)
				}
			}
			for sourceEventID, eventType := range tt.wantEvents {
				if !strings.Contains(replay, sourceEventID) || !strings.Contains(replay, eventType) {
					t.Fatalf("replay missing source evidence %s or event type %s:\n%s", sourceEventID, eventType, replay)
				}
			}
		})
	}
}

func TestAgentHubAgentSpecV1BuildsSDKFixtureStream(t *testing.T) {
	spec := AgentHubAgentSpecV1{
		SchemaVersion: "agenthub.agent_spec.v1",
		ID:            "fixture-builder",
		Name:          "Fixture Builder",
		Runtime: AgentSpecRuntimeV1{
			ID:              "codex",
			Profile:         "codex-local-profile",
			Provider:        "tokendance-gateway",
			Model:           "deepseek-v4-flash",
			ReasoningEffort: "high",
		},
		ToolAllowlist: []string{"read_file", "write_file", "grep"},
		MCPServers:    []AgentSpecMCPServerV1{{ID: "filesystem", Transport: "stdio", Command: "mcp-server-filesystem"}},
		ApprovalPolicy: map[string]any{
			"mode":                 "workspace-write",
			"require_approval_for": []any{"write_file"},
		},
		TargetPreference: map[string]any{
			"mode":      "local-edge",
			"target_id": "local-edge-fixture",
			"health":    "fixture-healthy",
		},
		Fixture: AgentSpecFixturePolicyV1{Mode: "fixture-only", NoSpend: true, LiveRuntimeAllowed: false},
	}

	invocation, err := CompileAgentSpecV1ToRuntimeInvocationFixture(spec)
	if err != nil {
		t.Fatalf("CompileAgentSpecV1ToRuntimeInvocationFixture: %v", err)
	}
	if invocation.SchemaVersion != "agenthub.runtime_invocation.fixture.v1" {
		t.Fatalf("runtime invocation schema = %q", invocation.SchemaVersion)
	}
	if invocation.AdapterStrategy != "cli-json-fixture" || invocation.Provider != SDKFixtureProviderOpenAI {
		t.Fatalf("runtime invocation strategy/provider = %s/%s", invocation.AdapterStrategy, invocation.Provider)
	}
	if invocation.ExecutionMode != "fixture" || !invocation.NoSpendDefault || invocation.LiveRuntimeAllowed {
		t.Fatalf("runtime invocation safety flags = %#v", invocation)
	}
	if invocation.Context.AgentID != "codex" || invocation.Context.Model != "deepseek-v4-flash" || invocation.Context.PermissionMode != "workspace-write" {
		t.Fatalf("runtime invocation context = %#v", invocation.Context)
	}
	if strings.Join(invocation.Context.MCPServerIDs, ",") != "filesystem" {
		t.Fatalf("runtime invocation MCP IDs = %#v", invocation.Context.MCPServerIDs)
	}
	if invocation.CLIInvocationPlan == nil {
		t.Fatal("codex AgentSpec should compile to a redacted CLI invocation plan")
	}
	if invocation.CLIInvocationPlan.AdapterID != "codex-acp" || invocation.CLIInvocationPlan.CommandName == "" || strings.ContainsAny(invocation.CLIInvocationPlan.CommandName, `\/`) {
		t.Fatalf("CLI plan = %#v", invocation.CLIInvocationPlan)
	}
	if !invocation.CLIInvocationPlan.PromptRedacted || invocation.CLIInvocationPlan.Observed || invocation.CLIInvocationPlan.RealTested {
		t.Fatalf("CLI plan safety flags = %#v", invocation.CLIInvocationPlan)
	}

	stream, err := AgentSpecV1ToSDKFixtureStream(spec)
	if err != nil {
		t.Fatalf("AgentSpecV1ToSDKFixtureStream: %v", err)
	}
	if stream.Provider != SDKFixtureProviderOpenAI {
		t.Fatalf("provider = %q, want %q", stream.Provider, SDKFixtureProviderOpenAI)
	}

	mapped := MapSDKFixtureStream(stream, testSDKFixtureScope())
	if len(mapped) != 3 {
		t.Fatalf("mapped events = %d, want 3", len(mapped))
	}
	if mapped[0].Type != BusEventCLIInvocationPlan || mapped[1].Type != BusEventStatusChange || mapped[2].Type != BusEventSessionInit {
		t.Fatalf("mapped event types = %s, %s, %s", mapped[0].Type, mapped[1].Type, mapped[2].Type)
	}
	commandName, _ := mapped[0].Payload["commandName"].(string)
	if commandName == "" || strings.ContainsAny(commandName, `\/`) || mapped[0].Payload["noSpendDefault"] != true {
		t.Fatalf("invocation plan payload = %#v", mapped[0].Payload)
	}
	if mapped[1].Payload["runtimeId"] != "codex" || mapped[1].Payload["fixtureOnly"] != true || mapped[1].Payload["noSpendDefault"] != true {
		t.Fatalf("capability payload = %#v", mapped[1].Payload)
	}
	if mapped[2].Payload["model"] != "deepseek-v4-flash" || strings.Join(mapped[2].Payload["tools"].([]string), ",") != "read_file,write_file,grep" {
		t.Fatalf("session payload = %#v", mapped[2].Payload)
	}
}

func TestAgentHubAgentSpecV1CompilesSDKAndCLIInvocationFixtures(t *testing.T) {
	cases := []struct {
		name         string
		runtimeID    string
		wantProvider string
		wantStrategy string
		wantCLIPlan  bool
	}{
		{"openai agents sdk", "openai-agents-sdk", SDKFixtureProviderOpenAI, "sdk-json-fixture", false},
		{"claude agent sdk", "claude-agent-sdk", SDKFixtureProviderClaude, "sdk-json-fixture", false},
		{"codex cli json", "codex", SDKFixtureProviderOpenAI, "cli-json-fixture", true},
		{"opencode cli json", "opencode", SDKFixtureProviderOpenCode, "cli-json-fixture", true},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			spec := AgentHubAgentSpecV1{
				SchemaVersion: "agenthub.agent_spec.v1",
				ID:            "fixture-" + strings.ReplaceAll(tt.runtimeID, "-", "_"),
				Name:          tt.name,
				Runtime: AgentSpecRuntimeV1{
					ID:              tt.runtimeID,
					Model:           "fixture-model",
					ReasoningEffort: "medium",
				},
				ToolAllowlist: []string{"read_file", "edit_file"},
				ApprovalPolicy: map[string]any{
					"mode": "plan",
				},
				TargetPreference: map[string]any{
					"mode":      "local-edge",
					"workspace": `C:\Users\Example\private\agenthub`,
				},
				Fixture: AgentSpecFixturePolicyV1{Mode: "fixture-only", NoSpend: true, LiveRuntimeAllowed: false},
			}

			invocation, err := CompileAgentSpecV1ToRuntimeInvocationFixture(spec)
			if err != nil {
				t.Fatalf("CompileAgentSpecV1ToRuntimeInvocationFixture: %v", err)
			}
			if invocation.Provider != tt.wantProvider || invocation.AdapterStrategy != tt.wantStrategy {
				t.Fatalf("provider/strategy = %s/%s, want %s/%s", invocation.Provider, invocation.AdapterStrategy, tt.wantProvider, tt.wantStrategy)
			}
			if invocation.CLIInvocationPlan == nil != !tt.wantCLIPlan {
				t.Fatalf("CLI plan presence = %#v, want %v", invocation.CLIInvocationPlan, tt.wantCLIPlan)
			}
			if !containsString(invocation.ParserContract, BusEventResult) || !containsString(invocation.ParserContract, BusEventPermissionRequested) {
				t.Fatalf("parser contract missing core runtime events: %#v", invocation.ParserContract)
			}
			encoded := marshalSDKFixtureJSON(t, invocation)
			for _, leaked := range []string{`C:\Users\Example`, "fixture prompt", "API_KEY"} {
				if strings.Contains(encoded, leaked) {
					t.Fatalf("runtime invocation fixture leaked %q:\n%s", leaked, encoded)
				}
			}
			if tt.wantCLIPlan && (!strings.Contains(encoded, `"cli_invocation_plan"`) || !strings.Contains(encoded, `"promptRedacted": true`)) {
				t.Fatalf("CLI runtime invocation fixture missing redacted plan:\n%s", encoded)
			}
		})
	}
}

func TestSDKFixtureMapperCapabilityHealthMetadataForProviderFixtures(t *testing.T) {
	providers := []struct {
		name       string
		provider   string
		runtimeID  string
		transport  string
		capability SDKFixtureCapabilities
	}{
		{
			name:      "openai",
			provider:  SDKFixtureProviderOpenAI,
			runtimeID: "openai-agents-sdk-like",
			transport: "fixture-file",
			capability: SDKFixtureCapabilities{
				Streaming: true, ToolCalls: true, FileChanges: true, PermissionHooks: true, MultiTurn: true,
				FixtureOnly: true, NoSpendDefault: true, Transports: []string{"fixture-file"},
			},
		},
		{
			name:      "claude",
			provider:  SDKFixtureProviderClaude,
			runtimeID: "claude-sdk-like",
			transport: "fixture-file",
			capability: SDKFixtureCapabilities{
				Streaming: true, ToolCalls: true, FileChanges: true, PermissionHooks: true, MultiTurn: true,
				FixtureOnly: true, NoSpendDefault: true, Transports: []string{"fixture-file"},
			},
		},
		{
			name:      "opencode",
			provider:  SDKFixtureProviderOpenCode,
			runtimeID: "opencode-like",
			transport: "fixture-subprocess",
			capability: SDKFixtureCapabilities{
				Streaming: true, ToolCalls: true, FileChanges: true, PermissionHooks: true, ThinkingVisible: true,
				FixtureOnly: true, NoSpendDefault: true, Transports: []string{"fixture-subprocess"},
			},
		},
		{
			name:      "custom",
			provider:  SDKFixtureProviderCustomOpenAICompatible,
			runtimeID: "custom-openai-compatible",
			transport: "fixture-file",
			capability: SDKFixtureCapabilities{
				Streaming: true, ToolCalls: true, FileChanges: true, PermissionHooks: true, MCPIntegration: true,
				FixtureOnly: true, NoSpendDefault: true, Transports: []string{"fixture-file"},
			},
		},
	}

	for _, tt := range providers {
		t.Run(tt.name, func(t *testing.T) {
			stream := SDKFixtureStream{
				Provider: tt.provider,
				Events: []SDKFixtureEvent{{
					ID:                  "capability_" + tt.name,
					Type:                "capability_health",
					RuntimeID:           tt.runtimeID,
					AdapterID:           tt.runtimeID,
					AdapterMode:         "fixture",
					FixtureTransport:    tt.transport,
					WorkspacePathPolicy: "workspace-relative-or-basename",
					RawSDKObjectPolicy:  "never-expose-above-edge-adapter",
					Capabilities:        &tt.capability,
					Health: &SDKFixtureHealth{
						State:  "fixture-ready",
						Reason: "no SDK package, model call, API call, or CLI process was executed",
						Checks: map[string]string{
							"transport": "fixture-only",
							"spend":     "blocked",
						},
						Metadata: map[string]any{
							"workspace_path":    "D:\\Projects\\ExampleAgentHub\\private",
							"sdk_session_token": "not-real",
							"api_key":           "sk-not-real",
						},
					},
				}},
			}
			mapped := MapSDKFixtureStream(stream, testSDKFixtureScope())
			if len(mapped) != 1 || mapped[0].Type != BusEventStatusChange {
				t.Fatalf("mapped capability event = %#v", mapped)
			}
			payload := mapped[0].Payload
			if payload["provider"] != tt.provider || payload["runtimeId"] != tt.runtimeID {
				t.Fatalf("provider/runtime metadata = %#v", payload)
			}
			if payload["fixtureOnly"] != true || payload["noSpendDefault"] != true {
				t.Fatalf("missing fixture-only no-spend metadata: %#v", payload)
			}
			if payload["rawSdkObjectPolicy"] != "never-expose-above-edge-adapter" {
				t.Fatalf("raw SDK policy = %#v", payload["rawSdkObjectPolicy"])
			}
			capability, ok := payload["capabilities"].(map[string]any)
			if !ok || capability["toolCalls"] != true || capability["fixtureOnly"] != true || capability["noSpendDefault"] != true {
				t.Fatalf("capabilities payload = %#v", payload["capabilities"])
			}
			health, ok := payload["health"].(map[string]any)
			if !ok || health["state"] != "fixture-ready" {
				t.Fatalf("health payload = %#v", payload["health"])
			}
			replay := marshalSDKFixtureJSON(t, mapSDKEventsForHubReplay(mapped))
			for _, leaked := range []string{"sk-not-real", "D:\\Projects\\ExampleAgentHub", "not-real"} {
				if strings.Contains(replay, leaked) {
					t.Fatalf("capability health replay leaked %q:\n%s", leaked, replay)
				}
			}
		})
	}
}

func TestSDKFixtureMapperKeepsOutputWorkspaceRelativeAndRedacted(t *testing.T) {
	stream := SDKFixtureStream{
		Provider: SDKFixtureProviderClaude,
		Events: []SDKFixtureEvent{
			{
				ID:        "evt_secret_path",
				Type:      "tool_call",
				ToolName:  "Write",
				ToolUseID: "toolu_secret",
				Input: map[string]any{
					"file_path":  "C:\\Users\\Ding\\server\\secret.env",
					"api_key":    "sk-live-secret",
					"nested":     map[string]any{"authorization": "Bearer secret", "path": "../outside.txt"},
					"safe_value": "kept",
				},
			},
			{
				ID:   "artifact_secret_path",
				Type: "artifact",
				Path: "/home/ding/private/report.md",
			},
		},
	}

	mapped := MapSDKFixtureStream(stream, testSDKFixtureScope())
	if len(mapped) != 2 {
		t.Fatalf("expected 2 mapped events, got %d", len(mapped))
	}

	input, ok := mapped[0].Payload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected sanitized input map, got %#v", mapped[0].Payload["input"])
	}
	if input["file_path"] != "secret.env" {
		t.Fatalf("file_path was not basename-only: %#v", input["file_path"])
	}
	if input["api_key"] != "[redacted]" {
		t.Fatalf("api_key was not redacted: %#v", input["api_key"])
	}
	nested, ok := input["nested"].(map[string]any)
	if !ok {
		t.Fatalf("expected nested map, got %#v", input["nested"])
	}
	if nested["authorization"] != "[redacted]" || nested["path"] != "outside.txt" {
		t.Fatalf("nested fields were not sanitized: %#v", nested)
	}
	if input["safe_value"] != "kept" {
		t.Fatalf("safe value changed: %#v", input["safe_value"])
	}

	if mapped[1].Payload["path"] != "report.md" {
		t.Fatalf("artifact path was not basename-only: %#v", mapped[1].Payload["path"])
	}
}

func TestSDKFixtureMapperProviderNeutralReplayContract(t *testing.T) {
	stream := SDKFixtureStream{
		Provider: "agenthub-neutral-fixture",
		Events: []SDKFixtureEvent{
			{
				ID:                 "contract_plan_1",
				Type:               "invocation_plan",
				AdapterID:          "custom-agent",
				CommandName:        "C:\\Tools\\AgentHub\\custom-agent.exe",
				ArgFlags:           []string{"--json", "--model"},
				ConfigKeys:         []string{"approval.mode"},
				PositionalArgCount: 1,
				EnvNames:           []string{"AGENTHUB_TOKEN=secret-value", "OPENAI_API_KEY=sk-not-real"},
				WorkDir:            "C:\\Users\\Ding\\private\\workspace",
				PromptRedacted:     true,
				ExecutionMode:      "fixture",
			},
			{
				ID:        "contract_status_1",
				Type:      "status",
				SessionID: "session_contract",
				Status:    "running",
				Summary:   "runtime accepted fixture plan",
			},
			{
				ID:          "contract_progress_1",
				Type:        "progress",
				TaskID:      "task_contract",
				Description: "Replaying provider-neutral fixture",
				Status:      "in_progress",
				Percent:     42.5,
			},
			{
				ID:        "contract_tool_call_1",
				Type:      "tool_call",
				CallID:    "call_contract",
				ToolName:  "write_file",
				SessionID: "session_contract",
				Input: map[string]any{
					"path":          "D:\\Projects\\ExampleAgentHub\\.env",
					"access_token":  "secret-token",
					"safe_argument": "kept",
				},
			},
			{
				ID:        "contract_tool_result_1",
				Type:      "tool_result",
				CallID:    "call_contract",
				ToolName:  "write_file",
				Output:    "wrote fixture file",
				SessionID: "session_contract",
			},
			{
				ID:        "contract_usage_1",
				Type:      "usage",
				SessionID: "session_contract",
				Usage: &SDKFixtureUsage{
					InputTokens:  120,
					OutputTokens: 45,
					TotalTokens:  165,
					TotalCostUSD: 0.0123,
				},
				Model: "fixture-model",
			},
			{
				ID:        "contract_terminal_1",
				Type:      "terminal_result",
				SessionID: "session_contract",
				Success:   boolPtr(true),
				Summary:   "provider-neutral terminal result",
				Usage: &SDKFixtureUsage{
					InputTokens:  120,
					OutputTokens: 45,
					TotalTokens:  165,
				},
			},
			{
				ID:        "contract_error_1",
				Type:      "error",
				SessionID: "session_contract",
				Error:     "fixture runtime failed after redacted path C:\\Users\\Ding\\secret.txt",
				Reason:    "adapter_error",
			},
			{
				ID:        "contract_cancel_1",
				Type:      "cancelled",
				SessionID: "session_contract",
				Reason:    "user_cancelled",
				Summary:   "operator cancelled fixture run",
			},
		},
	}

	mapped := MapSDKFixtureStream(stream, testSDKFixtureScope())
	gotTypes := make([]string, 0, len(mapped))
	for _, evt := range mapped {
		gotTypes = append(gotTypes, evt.Type)
		if evt.Scope["runId"] != "run_fixture" {
			t.Fatalf("mapped event %s lost replay scope: %#v", evt.Type, evt.Scope)
		}
	}
	wantTypes := []string{
		BusEventCLIInvocationPlan,
		BusEventStatusChange,
		BusEventTaskProgress,
		BusEventToolCall,
		BusEventToolResult,
		BusEventContextUsage,
		BusEventResult,
		BusEventResult,
		BusEventResult,
	}
	if strings.Join(gotTypes, ",") != strings.Join(wantTypes, ",") {
		t.Fatalf("mapped types = %v, want %v", gotTypes, wantTypes)
	}

	plan := mapped[0].Payload
	if plan["commandName"] != "custom-agent.exe" || plan["workDir"] != "workspace" {
		t.Fatalf("invocation plan was not basename redacted: %#v", plan)
	}
	envNames, ok := plan["envNames"].([]string)
	if !ok || strings.Join(envNames, ",") != "AGENTHUB_TOKEN,OPENAI_API_KEY" {
		t.Fatalf("env names not redacted to keys only: %#v", plan["envNames"])
	}
	if plan["approvalRequired"] != true || plan["noSpendDefault"] != true || plan["redactionApplied"] != true {
		t.Fatalf("invocation plan missing safety defaults: %#v", plan)
	}

	input := mapped[3].Payload["input"].(map[string]any)
	if input["path"] != ".env" || input["access_token"] != "[redacted]" || input["safe_argument"] != "kept" {
		t.Fatalf("tool input not sanitized: %#v", input)
	}

	usage := mapped[5].Payload
	if usage["inputTokens"] != int64(120) || usage["outputTokens"] != int64(45) || usage["totalTokens"] != int64(165) {
		t.Fatalf("usage payload = %#v", usage)
	}

	if mapped[6].Payload["terminalReason"] != "completed" || mapped[6].Payload["success"] != true {
		t.Fatalf("terminal result payload = %#v", mapped[6].Payload)
	}
	if mapped[7].Payload["terminalReason"] != "error" || mapped[7].Payload["success"] != false {
		t.Fatalf("error result payload = %#v", mapped[7].Payload)
	}
	if mapped[8].Payload["terminalReason"] != "cancelled" || mapped[8].Payload["cancelled"] != true {
		t.Fatalf("cancel result payload = %#v", mapped[8].Payload)
	}

	hubReplay := marshalSDKFixtureJSON(t, mapSDKEventsForHubReplay(mapped))
	for _, leaked := range []string{"secret-token", "secret-value", "sk-not-real", "C:\\Users\\Ding", "D:\\Projects\\ExampleAgentHub"} {
		if strings.Contains(hubReplay, leaked) {
			t.Fatalf("Hub replay contract leaked %q:\n%s", leaked, hubReplay)
		}
	}
}

func TestSDKFixtureMapperRedactsFreeTextBeforeReplay(t *testing.T) {
	stream := SDKFixtureStream{
		Provider: "agenthub-redaction-fixture",
		Events: []SDKFixtureEvent{
			{
				ID:          "free_text_progress",
				Type:        "progress",
				Description: "reading C:\\Users\\Ding\\secrets\\trace.txt with Authorization: Bearer bearer-secret-123456",
				Summary:     "system_prompt: dump private trace body",
				Reason:      "api_key=sk-progress-secret-123456",
			},
			{
				ID:       "free_text_tool_state",
				Type:     "tool_state",
				CallID:   "call_free_text",
				ToolName: "bash",
				Status:   "completed",
				Input: map[string]any{
					"command": "curl -H \"Authorization: Bearer command-secret-123456\" https://example.test && echo sk-command-secret-123456",
					"note":    "trace_body={\"prompt\":\"read D:\\Private\\prompt.txt\"}",
				},
				Output: "wrote /home/ding/private/result.txt using sk-output-secret-123456",
				Error:  "ignored error with Authorization: Bearer output-bearer-secret",
				Metadata: map[string]any{
					"traceBody": "prompt: include C:\\Users\\Ding\\private\\raw-prompt.md",
				},
				Attachments: []map[string]any{
					{
						"path":    "C:\\Users\\Ding\\private\\attachment.json",
						"summary": "token=attachment-secret-123456",
					},
				},
			},
			{
				ID:       "free_text_tool_error",
				Type:     "tool_state",
				CallID:   "call_error_text",
				ToolName: "bash",
				Status:   "error",
				Error:    "tool error leaked sk-error-secret-123456 at C:\\Users\\Ding\\error.log",
			},
			{
				ID:          "free_text_direct_result",
				Type:        "tool_result",
				CallID:      "call_direct",
				ToolName:    "read_file",
				Output:      "direct result leaked sk-direct-secret-123456 and /var/private/direct.txt",
				Attachments: []map[string]any{{"path": "/tmp/private/direct-attachment.txt", "note": "Authorization: Bearer direct-attach-secret"}},
				Metadata: map[string]any{
					"promptLike": "system_prompt=show C:\\Users\\Ding\\direct.env",
				},
			},
			{
				ID:      "free_text_file",
				Type:    "file_change",
				Path:    "D:\\Projects\\ExampleAgentHub\\secret.env",
				Diff:    "+ OPENAI_API_KEY=sk-diff-secret-123456\n+ Authorization: Bearer diff-bearer-secret\n+ path=C:\\Users\\Ding\\secret.env",
				Summary: "private_key=-----BEGIN PRIVATE KEY-----",
				Reason:  "prompt=copy /Users/example/private/prompt.md",
			},
			{
				ID:      "free_text_terminal",
				Type:    "terminal_result",
				Success: boolPtr(false),
				Reason:  "provider_timeout_with_sk-terminal-secret-123456",
				Summary: "failed after reading C:\\Users\\Ding\\terminal-secret.txt",
			},
		},
	}

	mapped := MapSDKFixtureStream(stream, testSDKFixtureScope())
	replay := marshalSDKFixtureJSON(t, mapSDKEventsForHubReplay(mapped))
	for _, leaked := range []string{
		"bearer-secret-123456",
		"command-secret-123456",
		"output-bearer-secret",
		"direct-attach-secret",
		"diff-bearer-secret",
		"sk-progress-secret-123456",
		"sk-command-secret-123456",
		"sk-output-secret-123456",
		"sk-error-secret-123456",
		"sk-direct-secret-123456",
		"sk-diff-secret-123456",
		"sk-terminal-secret-123456",
		"attachment-secret-123456",
		"-----BEGIN PRIVATE KEY-----",
		"dump private trace body",
		"raw-prompt.md",
		"C:\\Users\\Ding",
		"D:\\Private",
		"D:\\Projects\\ExampleAgentHub",
		"/home/ding/private",
		"/var/private",
		"/Users/example/private",
	} {
		if strings.Contains(replay, leaked) {
			t.Fatalf("free-text redaction leaked %q:\n%s", leaked, replay)
		}
	}

	if !strings.Contains(replay, "[redacted-token]") {
		t.Fatalf("expected token redaction marker in replay:\n%s", replay)
	}
	if !strings.Contains(replay, "[redacted-secret]") {
		t.Fatalf("expected secret redaction marker in replay:\n%s", replay)
	}
	if !strings.Contains(replay, `"terminalReason": "error"`) || !strings.Contains(replay, "provider_timeout_with_[redacted-token]") {
		t.Fatalf("terminal reason was not normalized or sanitized reason was not preserved:\n%s", replay)
	}

	directResult := firstMappedPayloadOfType(t, mapped, BusEventToolResult, "call_direct")
	if _, ok := directResult["attachments"]; !ok {
		t.Fatalf("direct tool_result did not retain sanitized attachments: %#v", directResult)
	}
	if _, ok := directResult["metadata"]; !ok {
		t.Fatalf("direct tool_result did not retain sanitized metadata: %#v", directResult)
	}
}

func TestSDKFixtureMapperRedactsTopLevelRefsAndPreservesSanitizedTerminalReason(t *testing.T) {
	stream := SDKFixtureStream{
		Provider: "agenthub-ref-redaction-fixture",
		Events: []SDKFixtureEvent{
			{
				ID:        "ref_terminal",
				Type:      "terminal_result",
				Success:   boolPtr(false),
				TraceID:   "trace-C:\\Users\\Ding\\private\\trace.json-sk-traceid-secret-123456",
				TraceRefs: []string{"trace:/home/ding/private/span.json", "trace:Authorization: Bearer trace-ref-secret-123456"},
				EvidenceRefs: []string{
					"artifact:C:\\Users\\Ding\\private\\evidence.json",
					"event:sk-evidence-secret-123456",
				},
				Reason:  "provider_timeout sk-reason-secret-123456 at D:\\Private\\reason.txt",
				Summary: "terminal summary",
			},
		},
	}

	mapped := MapSDKFixtureStream(stream, testSDKFixtureScope())
	if len(mapped) != 1 {
		t.Fatalf("mapped events = %d, want 1", len(mapped))
	}
	payload := mapped[0].Payload
	if payload["terminalReason"] != "error" {
		t.Fatalf("terminalReason = %#v, want error", payload["terminalReason"])
	}
	reason, ok := payload["reason"].(string)
	if !ok || reason == "" {
		t.Fatalf("terminal result did not preserve sanitized reason: %#v", payload)
	}

	replay := marshalSDKFixtureJSON(t, mapSDKEventsForHubReplay(mapped))
	for _, leaked := range []string{
		"sk-traceid-secret-123456",
		"trace-ref-secret-123456",
		"sk-evidence-secret-123456",
		"sk-reason-secret-123456",
		"C:\\Users\\Ding",
		"D:\\Private",
		"/home/ding/private",
	} {
		if strings.Contains(replay, leaked) {
			t.Fatalf("top-level refs or reason leaked %q:\n%s", leaked, replay)
		}
	}
	if !strings.Contains(replay, "[redacted-token]") {
		t.Fatalf("expected redacted token marker for refs/reason:\n%s", replay)
	}
}

// TestCLIInvocationPlanRedactsPromptEnvAndPaths 已随 claude 家族迁往
// adapters/claude（#1760 claude 增量）：它以 claude-code 适配器为投影主体，
// 根包测试不得 import adapters/claude（claude → adapters 单向依赖）。

func assertSDKFixtureGolden(t *testing.T, name string) {
	t.Helper()

	streamData := readSDKFixtureTestdata(t, name+"_fixture.json")
	stream, err := DecodeSDKFixtureStream(streamData)
	if err != nil {
		t.Fatalf("decode fixture: %v", err)
	}

	mapped := MapSDKFixtureStream(stream, testSDKFixtureScope())
	actual := marshalSDKFixtureGolden(t, mapped)
	expected := normalizeSDKFixtureGoldenLineEndings(string(readSDKFixtureTestdata(t, name+"_golden.json")))
	if actual != expected {
		t.Fatalf("%s golden mismatch\nexpected:\n%s\nactual:\n%s", name, expected, actual)
	}
}

func readSDKFixtureTestdata(t *testing.T, filename string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "sdk_fixture_mapper", filename))
	if err != nil {
		t.Fatalf("read %s: %v", filename, err)
	}
	return data
}

func marshalSDKFixtureGolden(t *testing.T, mapped []SDKMappedEvent) string {
	t.Helper()
	return marshalSDKFixtureJSON(t, mapped)
}

func marshalSDKFixtureJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatalf("marshal SDK fixture JSON: %v", err)
	}
	return string(data) + "\n"
}

func normalizeSDKFixtureGoldenLineEndings(value string) string {
	return strings.ReplaceAll(value, "\r\n", "\n")
}

func testSDKFixtureScope() map[string]any {
	return map[string]any{
		"projectId": "proj_fixture",
		"threadId":  "thread_fixture",
		"runId":     "run_fixture",
	}
}

func mapSDKEventsForHubReplay(mapped []SDKMappedEvent) []map[string]any {
	replay := make([]map[string]any, len(mapped))
	for i, evt := range mapped {
		replay[i] = map[string]any{
			"type": "agent.stream",
			"payload": map[string]any{
				"id":                evt.Payload["sourceEventId"],
				"task_id":           "task_fixture",
				"edge_run_id":       evt.Scope["runId"],
				"session_id":        evt.Payload["sessionId"],
				"agent_instance_id": "agent_fixture",
				"event_seq":         i + 1,
				"event_type":        evt.Type,
				"payload":           evt.Payload,
				"created_at":        "2026-06-09T00:00:00Z",
			},
		}
	}
	return replay
}

func boolPtr(value bool) *bool {
	return &value
}

func firstMappedPayloadOfType(t *testing.T, mapped []SDKMappedEvent, eventType string, callID string) map[string]any {
	t.Helper()
	for _, evt := range mapped {
		if evt.Type != eventType {
			continue
		}
		if callID == "" || evt.Payload["callId"] == callID {
			return evt.Payload
		}
	}
	t.Fatalf("missing mapped event type=%s callId=%s in %#v", eventType, callID, mapped)
	return nil
}

// containsString 是根包 adapter_test.go 测试桩的本地副本（#1760 mapper
// 增量）：mapper 家族归组后根包 _test 符号不可跨包引用，与 claude/acp
// 包测试内置测试桩副本的既有模式一致。
func containsString(list []string, target string) bool {
	for _, value := range list {
		if value == target {
			return true
		}
	}
	return false
}
