package model

import (
	"testing"
)

func validExecutionTarget() *ExecutionTarget {
	return &ExecutionTarget{
		OwnerID:       "00000000-0000-0000-0000-000000000001",
		Name:          "My Local Edge",
		TargetType:    "local_edge",
		Host:          "localhost",
		Port:          8080,
		WorkspaceRoot: "/home/user/workspace",
		AuthMethod:    "none",
		Capabilities:  `{"gpu": true, "memory_gb": 16}`,
		Metadata:      `{"location": "home-office"}`,
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
