package model

import (
	"testing"
)

func validExecutionTarget() *ExecutionTarget {
	return &ExecutionTarget{
		OwnerID:            "00000000-0000-0000-0000-000000000001",
		Name:               "My Local Edge",
		TargetType:         "local_edge",
		Host:               "localhost",
		Port:               8080,
		WorkspaceRoot:      "/home/user/workspace",
		WorkspaceAllowlist: `["/home/user/workspace"]`,
		TrustLevel:         "local",
		HealthState:        "unknown",
		AuthMethod:         "none",
		Capabilities:       `{"gpu": true, "memory_gb": 16}`,
		Metadata:           `{"location": "home-office"}`,
	}
}

func TestExecutionTarget_Validate_Valid(t *testing.T) {
	et := validExecutionTarget()
	if err := et.Validate(); err != nil {
		t.Fatalf("expected valid execution target to pass validation, got: %v", err)
	}
}

func TestExecutionTarget_Validate_CapabilitiesNotObject(t *testing.T) {
	et := validExecutionTarget()
	et.Capabilities = `"not_an_object"`
	if err := et.Validate(); err == nil {
		t.Fatal("expected error for capabilities not being a JSON object, got nil")
	}
}

func TestExecutionTarget_Validate_MetadataNotObject(t *testing.T) {
	et := validExecutionTarget()
	et.Metadata = `"not_an_object"`
	if err := et.Validate(); err == nil {
		t.Fatal("expected error for metadata not being a JSON object, got nil")
	}
}

func TestExecutionTarget_Validate_WorkspaceAllowlistNotArray(t *testing.T) {
	et := validExecutionTarget()
	et.WorkspaceAllowlist = `{"path":"/home/user/workspace"}`
	if err := et.Validate(); err == nil {
		t.Fatal("expected error for workspace_allowlist not being a JSON array, got nil")
	}
}

func TestExecutionTarget_Validate_WorkspaceAllowlistNonStringArray(t *testing.T) {
	et := validExecutionTarget()
	et.WorkspaceAllowlist = `[123]`
	if err := et.Validate(); err == nil {
		t.Fatal("expected error for workspace_allowlist with non-string entries, got nil")
	}
}

func TestExecutionTarget_Validate_RejectsUnsupportedPolicyValues(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*ExecutionTarget)
	}{
		{"target_type", func(et *ExecutionTarget) { et.TargetType = "unknown" }},
		{"trust_level", func(et *ExecutionTarget) { et.TrustLevel = "root" }},
		{"health_state", func(et *ExecutionTarget) { et.HealthState = "green" }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			et := validExecutionTarget()
			tt.mutate(et)
			if err := et.Validate(); err == nil {
				t.Fatalf("expected error for unsupported %s, got nil", tt.name)
			}
		})
	}
}

func TestExecutionTarget_Validate_EmptyDefaults(t *testing.T) {
	et := &ExecutionTarget{
		OwnerID:      "00000000-0000-0000-0000-000000000001",
		Name:         "Minimal Target",
		TargetType:   "",
		Capabilities: "{}",
		Metadata:     "{}",
	}
	if err := et.Validate(); err != nil {
		t.Fatalf("expected empty defaults to pass validation, got: %v", err)
	}
}

func TestExecutionTarget_Validate_EmptyJSONBStrings(t *testing.T) {
	et := &ExecutionTarget{
		OwnerID:      "00000000-0000-0000-0000-000000000001",
		Name:         "No Capabilities Target",
		Capabilities: "",
		Metadata:     "",
	}
	if err := et.Validate(); err != nil {
		t.Fatalf("expected empty JSONB strings to pass validation, got: %v", err)
	}
}
