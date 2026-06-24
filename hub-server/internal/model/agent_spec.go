package model

import (
	"encoding/json"
	"fmt"
	"strings"
)

const agentHubAgentSpecV1Schema = "agenthub.agent_spec.v1"

type AgentHubAgentSpecV1 struct {
	SchemaVersion    string                   `json:"schema_version"`
	ID               string                   `json:"id"`
	Name             string                   `json:"name"`
	Description      string                   `json:"description,omitempty"`
	Avatar           map[string]string        `json:"avatar,omitempty"`
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

// AgentProfileFromAgentSpecV1 projects a Builder export into Hub AgentProfile
// fixture input. The conversion keeps live runtime execution disabled and only
// prepares JSONB profile fields for tests/TeamRun fixture wiring.
func AgentProfileFromAgentSpecV1(ownerID string, spec AgentHubAgentSpecV1) (*AgentProfile, error) {
	if strings.TrimSpace(spec.SchemaVersion) != agentHubAgentSpecV1Schema {
		return nil, fmt.Errorf("unsupported AgentHubAgentSpec schema_version %q", spec.SchemaVersion)
	}
	if strings.TrimSpace(ownerID) == "" {
		return nil, fmt.Errorf("ownerID is required")
	}
	if strings.TrimSpace(spec.Name) == "" {
		return nil, fmt.Errorf("name is required")
	}
	if strings.TrimSpace(spec.Runtime.ID) == "" {
		return nil, fmt.Errorf("runtime.id is required")
	}
	if spec.Fixture.LiveRuntimeAllowed {
		return nil, fmt.Errorf("AgentProfile fixture conversion rejects live runtime allowance")
	}

	modelMapping := map[string]any{
		"schema_version":  spec.SchemaVersion,
		"runtime_profile": spec.Runtime.Profile,
		"provider":        spec.Runtime.Provider,
		"model":           spec.Runtime.Model,
		"memory_policy":   spec.MemoryPolicy,
		"avatar":          spec.Avatar,
		"fixture": map[string]any{
			"mode":                 spec.Fixture.Mode,
			"no_spend":             true,
			"live_runtime_allowed": false,
		},
	}

	modelMappingJSON, err := mustAgentSpecJSON(modelMapping)
	if err != nil {
		return nil, fmt.Errorf("marshal model_mapping: %w", err)
	}
	skillsJSON, err := mustAgentSpecJSON(spec.Skills)
	if err != nil {
		return nil, fmt.Errorf("marshal skills: %w", err)
	}
	mcpJSON, err := mustAgentSpecJSON(spec.MCPServers)
	if err != nil {
		return nil, fmt.Errorf("marshal mcp_servers: %w", err)
	}
	toolAllowlistJSON, err := mustAgentSpecJSON(spec.ToolAllowlist)
	if err != nil {
		return nil, fmt.Errorf("marshal tool_allowlist: %w", err)
	}
	approvalPolicyJSON, err := mustAgentSpecJSON(spec.ApprovalPolicy)
	if err != nil {
		return nil, fmt.Errorf("marshal approval_policy: %w", err)
	}
	targetPrefsJSON, err := mustAgentSpecJSON(spec.TargetPreference)
	if err != nil {
		return nil, fmt.Errorf("marshal target_preference: %w", err)
	}

	profile := &AgentProfile{
		OwnerID:                ownerID,
		Name:                   strings.TrimSpace(spec.Name),
		Description:            strings.TrimSpace(spec.Description),
		RuntimeID:              strings.TrimSpace(spec.Runtime.ID),
		Model:                  strings.TrimSpace(spec.Runtime.Model),
		Provider:               strings.TrimSpace(spec.Runtime.Provider),
		ReasoningEffort:        strings.TrimSpace(spec.Runtime.ReasoningEffort),
		ModelMapping:           modelMappingJSON,
		Skills:                 skillsJSON,
		MCPServers:             mcpJSON,
		ToolAllowlist:          toolAllowlistJSON,
		ApprovalPolicy:         approvalPolicyJSON,
		PermissionMode:         firstAgentSpecMapString(spec.ApprovalPolicy, "mode"),
		TargetPreferences:      targetPrefsJSON,
		ContextBudgetMaxTokens: int(spec.Runtime.MaxOutputTokens),
		Version:                1,
	}
	if profile.ReasoningEffort == "" {
		profile.ReasoningEffort = "medium"
	}
	if profile.PermissionMode == "" {
		profile.PermissionMode = "default"
	}
	if profile.ContextBudgetMaxTokens <= 0 {
		profile.ContextBudgetMaxTokens = 200000
	}
	if err := profile.Validate(); err != nil {
		return nil, err
	}
	return profile, nil
}

func mustAgentSpecJSON(value any) (string, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func firstAgentSpecMapString(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	value, _ := values[key].(string)
	return value
}
