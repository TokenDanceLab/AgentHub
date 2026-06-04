package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCustomAgentValidateAcceptsExpectedJSONBShapes(t *testing.T) {
	agent := &CustomAgent{
		CapabilityTags: `["code","review"]`,
		ToolWhitelist:  `["read_file","write_file"]`,
		ModelParams:    `{"temperature":0.2}`,
	}

	if err := agent.Validate(); err != nil {
		t.Fatalf("Validate returned error for valid JSONB shapes: %v", err)
	}
}

func TestCustomAgentValidateAllowsEmptyJSONBFields(t *testing.T) {
	if err := (&CustomAgent{}).Validate(); err != nil {
		t.Fatalf("Validate returned error for empty JSONB fields: %v", err)
	}
}

func TestCustomAgentValidateRejectsWrongJSONBShapes(t *testing.T) {
	tests := []struct {
		name    string
		agent   CustomAgent
		wantErr string
	}{
		{
			name:    "capability tags object",
			agent:   CustomAgent{CapabilityTags: `{"code":true}`},
			wantErr: "capability_tags must be a JSON array",
		},
		{
			name:    "tool whitelist string",
			agent:   CustomAgent{ToolWhitelist: `"read_file"`},
			wantErr: "tool_whitelist must be a JSON array",
		},
		{
			name:    "model params array",
			agent:   CustomAgent{ModelParams: `[]`},
			wantErr: "model_params must be a JSON object",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.agent.Validate()
			if err == nil {
				t.Fatal("Validate returned nil error")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("Validate error = %q, want substring %q", err.Error(), tt.wantErr)
			}
		})
	}
}

func TestCustomAgentValidateRejectsInvalidJSON(t *testing.T) {
	agent := &CustomAgent{CapabilityTags: `not-json`}
	if err := agent.Validate(); err == nil {
		t.Fatal("Validate should reject invalid JSON in capability_tags")
	}
}

// --- normalizeJSONValue tests ---

func TestNormalizeJSONValue_CompactsWhitespace(t *testing.T) {
	input := `{  "key"  :  "value"  ,  "num"  :  42  }`
	result, err := normalizeJSONValue(input)
	if err != nil {
		t.Fatalf("normalizeJSONValue error: %v", err)
	}
	if strings.Contains(result, "  ") {
		t.Errorf("normalized JSON should not contain double spaces: %q", result)
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		t.Fatalf("normalized JSON is invalid: %v", err)
	}
	if parsed["key"] != "value" || parsed["num"] != float64(42) {
		t.Errorf("data mismatch after normalization: %v", parsed)
	}
}

func TestNormalizeJSONValue_PreservesArrayOrder(t *testing.T) {
	input := `[ "c" , "a" , "b" ]`
	result, err := normalizeJSONValue(input)
	if err != nil {
		t.Fatalf("normalizeJSONValue error: %v", err)
	}
	var parsed []string
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		t.Fatalf("normalized JSON is invalid: %v", err)
	}
	if len(parsed) != 3 || parsed[0] != "c" || parsed[1] != "a" || parsed[2] != "b" {
		t.Errorf("array order not preserved: %v", parsed)
	}
}

func TestNormalizeJSONValue_RejectsInvalidJSON(t *testing.T) {
	_, err := normalizeJSONValue(`{bad json}`)
	if err == nil {
		t.Fatal("normalizeJSONValue should return error for invalid JSON")
	}
}

func TestCustomAgentNormalizeJSONB(t *testing.T) {
	agent := &CustomAgent{
		CapabilityTags: `[ "code" , "review" ]`,
		ToolWhitelist:  `[ "read" ]`,
		ModelParams:    `{ "temperature" : 0.7 }`,
	}
	if err := agent.normalizeJSONB(); err != nil {
		t.Fatalf("normalizeJSONB error: %v", err)
	}
	if strings.Contains(agent.CapabilityTags, " , ") {
		t.Errorf("CapabilityTags not normalized: %q", agent.CapabilityTags)
	}
	if strings.Contains(agent.ModelParams, " : ") {
		t.Errorf("ModelParams not normalized: %q", agent.ModelParams)
	}
}
