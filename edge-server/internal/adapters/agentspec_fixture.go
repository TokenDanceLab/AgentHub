package adapters

import (
	"fmt"
	"strings"
)

const agentHubAgentSpecV1Schema = "agenthub.agent_spec.v1"

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

// AgentSpecV1ToSDKFixtureStream turns a Builder export into a no-spend SDK
// fixture stream. It does not start a CLI process, import an SDK, or contact a
// model/provider API.
func AgentSpecV1ToSDKFixtureStream(spec AgentHubAgentSpecV1) (SDKFixtureStream, error) {
	if strings.TrimSpace(spec.SchemaVersion) != agentHubAgentSpecV1Schema {
		return SDKFixtureStream{}, fmt.Errorf("unsupported AgentHubAgentSpec schema_version %q", spec.SchemaVersion)
	}
	if strings.TrimSpace(spec.Runtime.ID) == "" {
		return SDKFixtureStream{}, fmt.Errorf("runtime.id is required")
	}
	if strings.TrimSpace(spec.Runtime.Model) == "" {
		return SDKFixtureStream{}, fmt.Errorf("runtime.model is required")
	}
	if spec.Fixture.LiveRuntimeAllowed {
		return SDKFixtureStream{}, fmt.Errorf("AgentHubAgentSpec fixture conversion rejects live runtime allowance")
	}

	provider := sdkFixtureProviderForAgentSpec(spec)
	capability := SDKFixtureCapabilities{
		Streaming:       true,
		ToolCalls:       len(spec.ToolAllowlist) > 0,
		FileChanges:     containsAgentSpecTool(spec.ToolAllowlist, "write_file") || containsAgentSpecTool(spec.ToolAllowlist, "edit_file"),
		PermissionHooks: true,
		MCPIntegration:  len(spec.MCPServers) > 0,
		FixtureOnly:     true,
		NoSpendDefault:  true,
		Transports:      []string{"fixture-file"},
	}

	return SDKFixtureStream{
		Provider: provider,
		Events: []SDKFixtureEvent{
			{
				ID:                  spec.ID + "_capability",
				Type:                "capability_health",
				RuntimeID:           spec.Runtime.ID,
				AdapterID:           spec.Runtime.ID,
				AdapterMode:         "fixture",
				FixtureTransport:    "fixture-file",
				WorkspacePathPolicy: "workspace-relative-or-basename",
				RawSDKObjectPolicy:  "never-expose-above-edge-adapter",
				Capabilities:        &capability,
				Health: &SDKFixtureHealth{
					State:  "fixture-ready",
					Reason: "AgentHubAgentSpec v1 fixture export; no SDK package, model call, API call, or CLI process was executed",
					Checks: map[string]string{
						"approval_policy": firstAgentSpecMapString(spec.ApprovalPolicy, "mode"),
						"target":          firstAgentSpecMapString(spec.TargetPreference, "mode"),
						"spend":           "blocked",
					},
					Metadata: map[string]any{
						"agentSpecId": spec.ID,
						"agentName":   spec.Name,
						"skills":      spec.Skills,
						"mcpServers":  len(spec.MCPServers),
					},
				},
			},
			{
				ID:             spec.ID + "_session",
				Type:           "session_ready",
				SessionID:      spec.ID + "_fixture_session",
				Model:          spec.Runtime.Model,
				Provider:       provider,
				PermissionMode: firstAgentSpecMapString(spec.ApprovalPolicy, "mode"),
				Tools:          spec.ToolAllowlist,
			},
		},
	}, nil
}

func sdkFixtureProviderForAgentSpec(spec AgentHubAgentSpecV1) string {
	runtimeID := strings.ToLower(strings.TrimSpace(spec.Runtime.ID))
	switch runtimeID {
	case "codex", "openai-agents-sdk", "openai":
		return SDKFixtureProviderOpenAI
	case "claude", "claude-code":
		return SDKFixtureProviderClaude
	case "opencode":
		return SDKFixtureProviderOpenCode
	default:
		return SDKFixtureProviderCustomOpenAICompatible
	}
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
