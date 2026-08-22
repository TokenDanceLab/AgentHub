package sdk

import (
	"fmt"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
)

const agentHubAgentSpecV1Schema = "agenthub.agent_spec.v1"
const runtimeInvocationFixtureV1Schema = "agenthub.runtime_invocation.fixture.v1"

type AgentHubAgentSpecV1 struct {
	SchemaVersion    string                   `json:"schema_version"`
	ID               string                   `json:"id"`
	Name             string                   `json:"name"`
	Description      string                   `json:"description,omitempty"`
	Runtime          AgentSpecRuntimeV1       `json:"runtime"`
	Skills           []string                 `json:"skills,omitempty"`
	MCPServers       []AgentSpecMCPServerV1   `json:"mcp_servers,omitempty"`
	ToolAllowlist    []string                 `json:"tool_allowlist,omitempty"`
	MemoryPolicy     map[string]any           `json:"memory_policy,omitempty"`
	ApprovalPolicy   map[string]any           `json:"approval_policy,omitempty"`
	TargetPreference map[string]any           `json:"target_preference,omitempty"`
	Fixture          AgentSpecFixturePolicyV1 `json:"fixture,omitempty"`
}

type AgentSpecRuntimeV1 struct {
	ID              string  `json:"id"`
	Profile         string  `json:"profile"`
	Provider        string  `json:"provider"`
	Model           string  `json:"model"`
	ReasoningEffort string  `json:"reasoning_effort,omitempty"`
	Temperature     float64 `json:"temperature,omitempty"`
	MaxOutputTokens int64   `json:"max_output_tokens,omitempty"`
}

type AgentSpecMCPServerV1 struct {
	ID        string `json:"id"`
	Transport string `json:"transport"`
	Command   string `json:"command,omitempty"`
	URL       string `json:"url,omitempty"`
}

type AgentSpecFixturePolicyV1 struct {
	Mode               string `json:"mode"`
	NoSpend            bool   `json:"no_spend"`
	LiveRuntimeAllowed bool   `json:"live_runtime_allowed"`
}

type RuntimeInvocationFixtureV1 struct {
	SchemaVersion       string                            `json:"schema_version"`
	AgentSpecID         string                            `json:"agent_spec_id"`
	RuntimeID           string                            `json:"runtime_id"`
	Provider            string                            `json:"provider"`
	AdapterStrategy     string                            `json:"adapter_strategy"`
	ExecutionMode       string                            `json:"execution_mode"`
	NoSpendDefault      bool                              `json:"no_spend_default"`
	LiveRuntimeAllowed  bool                              `json:"live_runtime_allowed"`
	PromptRedacted      bool                              `json:"prompt_redacted"`
	WorkDirPolicy       string                            `json:"work_dir_policy"`
	RawSDKObjectPolicy  string                            `json:"raw_sdk_object_policy"`
	Context             RuntimeInvocationContextFixtureV1 `json:"context"`
	ParserContract      []string                          `json:"parser_contract"`
	CLIInvocationPlan   *adapters.CLIInvocationPlan       `json:"cli_invocation_plan,omitempty"`
	ApprovalEvidenceRef string                            `json:"approval_evidence_ref,omitempty"`
}

type RuntimeInvocationContextFixtureV1 struct {
	AgentID         string   `json:"agent_id"`
	Model           string   `json:"model"`
	ReasoningEffort string   `json:"reasoning_effort,omitempty"`
	PermissionMode  string   `json:"permission_mode,omitempty"`
	AllowedTools    []string `json:"allowed_tools,omitempty"`
	MCPServerIDs    []string `json:"mcp_server_ids,omitempty"`
}

// AgentSpecV1ToSDKFixtureStream turns a Builder export into a no-spend SDK
// fixture stream. It does not start a CLI process, import an SDK, or contact a
// model/provider API.
func AgentSpecV1ToSDKFixtureStream(spec AgentHubAgentSpecV1) (SDKFixtureStream, error) {
	invocation, err := CompileAgentSpecV1ToRuntimeInvocationFixture(spec)
	if err != nil {
		return SDKFixtureStream{}, err
	}

	capability := runtimeInvocationFixtureCapabilities(spec)
	events := []SDKFixtureEvent{}
	if invocation.CLIInvocationPlan != nil {
		events = append(events, SDKFixtureEvent{
			ID:                  spec.ID + "_invocation_plan",
			Type:                "invocation_plan",
			AdapterID:           invocation.CLIInvocationPlan.AdapterID,
			CommandName:         invocation.CLIInvocationPlan.CommandName,
			ArgFlags:            invocation.CLIInvocationPlan.ArgFlags,
			ConfigKeys:          invocation.CLIInvocationPlan.ConfigKeys,
			PositionalArgCount:  invocation.CLIInvocationPlan.PositionalArgCount,
			EnvNames:            invocation.CLIInvocationPlan.EnvNames,
			WorkDir:             invocation.CLIInvocationPlan.WorkDir,
			PromptRedacted:      invocation.CLIInvocationPlan.PromptRedacted,
			ExecutionMode:       invocation.CLIInvocationPlan.ExecutionMode,
			RealTestedReason:    invocation.CLIInvocationPlan.RealTestedReason,
			ApprovalEvidenceRef: invocation.CLIInvocationPlan.ApprovalEvidenceRef,
		})
	}
	events = append(events,
		SDKFixtureEvent{
			ID:                  spec.ID + "_capability",
			Type:                "capability_health",
			RuntimeID:           invocation.RuntimeID,
			AdapterID:           invocation.RuntimeID,
			AdapterMode:         invocation.AdapterStrategy,
			FixtureTransport:    "fixture-file",
			WorkspacePathPolicy: invocation.WorkDirPolicy,
			RawSDKObjectPolicy:  invocation.RawSDKObjectPolicy,
			Capabilities:        &capability,
			Health: &FixtureHealth{
				State:  "fixture-ready",
				Reason: "AgentHubAgentSpec v1 fixture export; no SDK package, model call, API call, CLI process, or production credential was used",
				Checks: map[string]string{
					"adapter_strategy": invocation.AdapterStrategy,
					"approval_policy":  invocation.Context.PermissionMode,
					"target":           firstAgentSpecMapString(spec.TargetPreference, "mode"),
					"spend":            "blocked",
				},
				Metadata: map[string]any{
					"agentSpecId":    spec.ID,
					"agentName":      spec.Name,
					"skills":         spec.Skills,
					"mcpServers":     len(spec.MCPServers),
					"parserContract": invocation.ParserContract,
				},
			},
		},
		SDKFixtureEvent{
			ID:             spec.ID + "_session",
			Type:           "session_ready",
			SessionID:      spec.ID + "_fixture_session",
			Model:          invocation.Context.Model,
			Provider:       invocation.Provider,
			PermissionMode: invocation.Context.PermissionMode,
			Tools:          invocation.Context.AllowedTools,
		},
	)

	return SDKFixtureStream{
		Provider: invocation.Provider,
		Events:   events,
	}, nil
}

// CompileAgentSpecV1ToRuntimeInvocationFixture compiles a Builder export into
// a redacted, no-spend RuntimeInvocation fixture. It does not start a CLI
// process, import an SDK, call a provider API, or require production keys.
func CompileAgentSpecV1ToRuntimeInvocationFixture(spec AgentHubAgentSpecV1) (RuntimeInvocationFixtureV1, error) {
	if strings.TrimSpace(spec.SchemaVersion) != agentHubAgentSpecV1Schema {
		return RuntimeInvocationFixtureV1{}, fmt.Errorf("unsupported AgentHubAgentSpec schema_version %q", spec.SchemaVersion)
	}
	if strings.TrimSpace(spec.Runtime.ID) == "" {
		return RuntimeInvocationFixtureV1{}, fmt.Errorf("runtime.id is required")
	}
	if strings.TrimSpace(spec.Runtime.Model) == "" {
		return RuntimeInvocationFixtureV1{}, fmt.Errorf("runtime.model is required")
	}
	if spec.Fixture.LiveRuntimeAllowed {
		return RuntimeInvocationFixtureV1{}, fmt.Errorf("AgentHubAgentSpec fixture conversion rejects live runtime allowance")
	}

	provider := sdkFixtureProviderForAgentSpec(spec)
	strategy := runtimeInvocationFixtureStrategy(spec.Runtime.ID)
	permissionMode := firstAgentSpecMapString(spec.ApprovalPolicy, "mode")
	invocation := RuntimeInvocationFixtureV1{
		SchemaVersion:      runtimeInvocationFixtureV1Schema,
		AgentSpecID:        spec.ID,
		RuntimeID:          strings.TrimSpace(spec.Runtime.ID),
		Provider:           provider,
		AdapterStrategy:    strategy,
		ExecutionMode:      "fixture",
		NoSpendDefault:     true,
		LiveRuntimeAllowed: false,
		PromptRedacted:     true,
		WorkDirPolicy:      "workspace-relative-or-basename",
		RawSDKObjectPolicy: "never-expose-above-edge-adapter",
		Context: RuntimeInvocationContextFixtureV1{
			AgentID:         strings.TrimSpace(spec.Runtime.ID),
			Model:           spec.Runtime.Model,
			ReasoningEffort: spec.Runtime.ReasoningEffort,
			PermissionMode:  permissionMode,
			AllowedTools:    append([]string(nil), spec.ToolAllowlist...),
			MCPServerIDs:    agentSpecMCPServerIDs(spec.MCPServers),
		},
		ParserContract: runtimeInvocationFixtureParserContract(strategy),
	}
	if adapter := runtimeInvocationFixtureAdapter(spec.Runtime.ID, spec.Runtime.Model); adapter != nil {
		ctx := RunProcessContext{
			Prompt:          "[redacted AgentHubAgentSpec fixture prompt]",
			AgentID:         invocation.Context.AgentID,
			Model:           invocation.Context.Model,
			ReasoningEffort: invocation.Context.ReasoningEffort,
			PermissionMode:  invocation.Context.PermissionMode,
			AllowedTools:    invocation.Context.AllowedTools,
			WorkDir:         firstAgentSpecMapString(spec.TargetPreference, "workspace"),
		}
		plan := adapters.BuildCLIInvocationPlan(adapter, ctx)
		invocation.CLIInvocationPlan = &plan
	}
	return invocation, nil
}

func sdkFixtureProviderForAgentSpec(spec AgentHubAgentSpecV1) string {
	runtimeID := strings.ToLower(strings.TrimSpace(spec.Runtime.ID))
	switch runtimeID {
	case "codex", "openai-agents-sdk", "openai":
		return SDKFixtureProviderOpenAI
	case "claude", "claude-code", "claude-agent-sdk", "anthropic-agent-sdk":
		return SDKFixtureProviderClaude
	case "opencode":
		return SDKFixtureProviderOpenCode
	default:
		return SDKFixtureProviderCustomOpenAICompatible
	}
}

func runtimeInvocationFixtureStrategy(runtimeID string) string {
	switch strings.ToLower(strings.TrimSpace(runtimeID)) {
	case "codex", "claude-code", "opencode":
		return "cli-json-fixture"
	case "openai-agents-sdk", "openai", "claude-agent-sdk", "anthropic-agent-sdk", "claude":
		return "sdk-json-fixture"
	default:
		return "custom-runtime-fixture"
	}
}

// runtimeInvocationFixtureAdapter returns the concrete CLI adapter used for a
// redacted invocation-plan projection, or nil when the runtime has no
// cli-json fixture adapter. The claude-code branch is injected by package
// claude via RegisterClaudeCodeAdapterProvider；codex/opencode branches are
// injected by packages codex and opencode via RegisterCodexACPadapterProvider /
// RegisterOpencodeACPadapterProvider（#1760 各增量）：根包不得反向 import 子包
// （子包 → adapters 单向依赖），故经此钩子反向注入。
func runtimeInvocationFixtureAdapter(runtimeID string, model string) AgentAdapter {
	switch strings.ToLower(strings.TrimSpace(runtimeID)) {
	case "codex":
		if codexACPadapterProvider != nil {
			return codexACPadapterProvider()
		}
		return nil
	case "claude-code":
		if claudeCodeAdapterProvider != nil {
			return claudeCodeAdapterProvider(model)
		}
		return nil
	case "opencode":
		if opencodeACPadapterProvider != nil {
			return opencodeACPadapterProvider()
		}
		return nil
	default:
		return nil
	}
}

// claudeCodeAdapterProvider is registered by package claude at init time
// (fixture_provider.go). Non-nil only in binaries/tests that link the claude
// subpackage; root-package unit tests do not link it, and no root test
// exercises the "claude-code" fixture branch.
var claudeCodeAdapterProvider func(model string) AgentAdapter

// RegisterClaudeCodeAdapterProvider installs the claude-code constructor for
// AgentHubAgentSpec fixture projection. Called once from package claude's
// init; exported so the claude subpackage can inject without the root
// package importing it (import cycle avoidance, #1760).
func RegisterClaudeCodeAdapterProvider(provider func(model string) AgentAdapter) {
	claudeCodeAdapterProvider = provider
}

// codexACPadapterProvider is registered by package codex at init time
// (fixture_provider.go). Non-nil only in binaries/tests that link the codex
// subpackage; root-package unit tests link it via
// codex_opencode_fixture_link_test.go（blank import 触发 init 注入）.
var codexACPadapterProvider func() AgentAdapter

// RegisterCodexACPadapterProvider installs the codex-acp constructor for
// AgentHubAgentSpec fixture projection. Called once from package codex's
// init; exported so the codex subpackage can inject without the root package
// importing it (import cycle avoidance, #1760).
func RegisterCodexACPadapterProvider(provider func() AgentAdapter) {
	codexACPadapterProvider = provider
}

// opencodeACPadapterProvider is registered by package opencode at init time
// (fixture_provider.go). Non-nil only in binaries/tests that link the
// opencode subpackage; root-package unit tests link it via
// codex_opencode_fixture_link_test.go（blank import 触发 init 注入）.
var opencodeACPadapterProvider func() AgentAdapter

// RegisterOpencodeACPadapterProvider installs the opencode-acp constructor
// for AgentHubAgentSpec fixture projection. Called once from package
// opencode's init; exported so the opencode subpackage can inject without
// the root package importing it (import cycle avoidance, #1760).
func RegisterOpencodeACPadapterProvider(provider func() AgentAdapter) {
	opencodeACPadapterProvider = provider
}

func runtimeInvocationFixtureParserContract(strategy string) []string {
	base := []string{
		BusEventStatusChange,
		BusEventSessionInit,
		BusEventTextBlock,
		BusEventToolCall,
		BusEventToolResult,
		BusEventPermissionRequested,
		BusEventFileChange,
		BusEventContextUsage,
		BusEventResult,
	}
	if strategy == "cli-json-fixture" {
		return append([]string{BusEventCLIInvocationPlan, BusEventSessionStateChanged}, base...)
	}
	return base
}

func runtimeInvocationFixtureCapabilities(spec AgentHubAgentSpecV1) FixtureCapabilities {
	return FixtureCapabilities{
		Streaming:       true,
		ToolCalls:       len(spec.ToolAllowlist) > 0,
		FileChanges:     containsAgentSpecTool(spec.ToolAllowlist, "write_file") || containsAgentSpecTool(spec.ToolAllowlist, "edit_file"),
		PermissionHooks: true,
		MCPIntegration:  len(spec.MCPServers) > 0,
		FixtureOnly:     true,
		NoSpendDefault:  true,
		Transports:      []string{"fixture-file"},
	}
}

func agentSpecMCPServerIDs(servers []AgentSpecMCPServerV1) []string {
	ids := make([]string, 0, len(servers))
	for _, server := range servers {
		id := strings.TrimSpace(server.ID)
		if id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}

func containsAgentSpecTool(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), target) {
			return true
		}
	}
	return false
}

func firstAgentSpecMapString(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	value, _ := values[key].(string)
	return value
}
