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
