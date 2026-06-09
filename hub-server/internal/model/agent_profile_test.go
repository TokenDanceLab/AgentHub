package model

import (
	"testing"
)

func validProfile() *AgentProfile {
	return &AgentProfile{
		OwnerID:           "00000000-0000-0000-0000-000000000001",
		Name:              "Test Agent",
		RuntimeID:         "nodejs",
		Model:             "claude-sonnet-4-20250514",
		Provider:          "anthropic",
		ReasoningEffort:   "medium",
		ModelMapping:      `{"claude-sonnet-4-20250514": "anthropic"}`,
		Skills:            `["code-review", "debugging"]`,
		MCPServers:        `["filesystem"]`,
		ToolAllowlist:     `["read", "write"]`,
		ApprovalPolicy:    `{"bash": "always_ask"}`,
		PermissionMode:    "default",
		TargetPreferences: `{"language": "en"}`,
	}
}

func TestAgentProfile_Validate_Valid(t *testing.T) {
	p := validProfile()
	if err := p.Validate(); err != nil {
		t.Fatalf("expected valid profile to pass validation, got: %v", err)
	}
}

func TestAgentProfile_Validate_SkillsNotArray(t *testing.T) {
	p := validProfile()
	p.Skills = `"not_an_array"`
	if err := p.Validate(); err == nil {
		t.Fatal("expected error for skills not being a JSON array, got nil")
	}
}

func TestAgentProfile_Validate_SkillsInvalidJSON(t *testing.T) {
	p := validProfile()
	p.Skills = `not_json`
	if err := p.Validate(); err == nil {
		t.Fatal("expected error for skills not being valid JSON, got nil")
	}
}

func TestAgentProfile_Validate_MCPServersNotArray(t *testing.T) {
	p := validProfile()
	p.MCPServers = `"not_an_array"`
	if err := p.Validate(); err == nil {
		t.Fatal("expected error for mcp_servers not being a JSON array, got nil")
	}
}

func TestAgentProfile_Validate_ToolAllowlistNotArray(t *testing.T) {
	p := validProfile()
	p.ToolAllowlist = `"not_an_array"`
	if err := p.Validate(); err == nil {
		t.Fatal("expected error for tool_allowlist not being a JSON array, got nil")
	}
}

func TestAgentProfile_Validate_ModelMappingNotObject(t *testing.T) {
	p := validProfile()
	p.ModelMapping = `"not_an_object"`
	if err := p.Validate(); err == nil {
		t.Fatal("expected error for model_mapping not being a JSON object, got nil")
	}
}

func TestAgentProfile_Validate_ApprovalPolicyNotObject(t *testing.T) {
	p := validProfile()
	p.ApprovalPolicy = `"not_an_object"`
	if err := p.Validate(); err == nil {
		t.Fatal("expected error for approval_policy not being a JSON object, got nil")
	}
}

func TestAgentProfile_Validate_TargetPreferencesNotObject(t *testing.T) {
	p := validProfile()
	p.TargetPreferences = `"not_an_object"`
	if err := p.Validate(); err == nil {
		t.Fatal("expected error for target_preferences not being a JSON object, got nil")
	}
}

func TestAgentProfile_Validate_EmptyJSONBFields(t *testing.T) {
	p := validProfile()
	p.Skills = `[]`
	p.MCPServers = `[]`
	p.ToolAllowlist = `[]`
	p.ModelMapping = `{}`
	p.ApprovalPolicy = `{}`
	p.TargetPreferences = `{}`
	if err := p.Validate(); err != nil {
		t.Fatalf("expected empty JSONB default values to pass validation, got: %v", err)
	}
}

func TestAgentProfile_Validate_EmptyStrings(t *testing.T) {
	p := validProfile()
	p.Skills = ""
	p.MCPServers = ""
	p.ToolAllowlist = ""
	p.ModelMapping = ""
	p.ApprovalPolicy = ""
	p.TargetPreferences = ""
	if err := p.Validate(); err != nil {
		t.Fatalf("expected empty strings to pass validation, got: %v", err)
	}
}

func TestAgentHubAgentSpecV1ToAgentProfileFixture(t *testing.T) {
	spec := AgentHubAgentSpecV1{
		SchemaVersion: "agenthub.agent_spec.v1",
		ID:            "fixture-builder",
		Name:          "Fixture Builder",
		Description:   "Builds fixture-only AgentHub demos.",
		Runtime: AgentSpecRuntimeV1{
			ID:              "codex",
			Profile:         "codex-local-profile",
			Provider:        "tokendance-gateway",
			Model:           "deepseek-v4-flash",
			ReasoningEffort: "high",
		},
		Skills:        []string{"agenthub-builder", "code-review"},
		MCPServers:    []AgentSpecMCPServerV1{{ID: "filesystem", Transport: "stdio", Command: "mcp-server-filesystem"}},
		ToolAllowlist: []string{"read_file", "write_file", "grep"},
		MemoryPolicy:  map[string]any{"mode": "project", "retention": "ephemeral-fixture"},
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

	profile, err := AgentProfileFromAgentSpecV1("00000000-0000-0000-0000-000000000001", spec)
	if err != nil {
		t.Fatalf("AgentProfileFromAgentSpecV1: %v", err)
	}
	if profile.Name != "Fixture Builder" || profile.RuntimeID != "codex" || profile.Model != "deepseek-v4-flash" || profile.Provider != "tokendance-gateway" {
		t.Fatalf("profile core fields = %#v", profile)
	}
	if profile.Skills != `["agenthub-builder","code-review"]` {
		t.Fatalf("skills = %s", profile.Skills)
	}
	if profile.MCPServers != `[{"id":"filesystem","transport":"stdio","command":"mcp-server-filesystem"}]` {
		t.Fatalf("mcp_servers = %s", profile.MCPServers)
	}
	if profile.ToolAllowlist != `["read_file","write_file","grep"]` {
		t.Fatalf("tool_allowlist = %s", profile.ToolAllowlist)
	}
	if profile.ApprovalPolicy != `{"mode":"workspace-write","require_approval_for":["write_file"]}` {
		t.Fatalf("approval_policy = %s", profile.ApprovalPolicy)
	}
	if profile.TargetPreferences != `{"health":"fixture-healthy","mode":"local-edge","target_id":"local-edge-fixture"}` {
		t.Fatalf("target_preferences = %s", profile.TargetPreferences)
	}
	if err := profile.Validate(); err != nil {
		t.Fatalf("profile fixture should validate: %v", err)
	}
}
