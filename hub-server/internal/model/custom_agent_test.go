package model

import (
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
