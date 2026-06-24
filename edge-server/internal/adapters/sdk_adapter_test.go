package adapters

import "testing"

func TestAllAdapterConstructors(t *testing.T) {
	tests := []struct {
		name string
		fn   func() string
	}{
		{"AnthropicSDK", func() string { return NewAnthropicSDKAdapter("k", "m").Metadata().Name }},
		{"OpenAISDK", func() string { return NewOpenAISDKAdapter("k", "m").Metadata().Name }},
		{"ClaudeCode", func() string { return NewClaudeCodeAdapter("c", "m", "d").Metadata().Name }},
		{"Codex", func() string { return NewCodexAdapter("c", "m").Metadata().Name }},
		{"OpenCode", func() string { return NewOpenCodeAdapter("o").Metadata().Name }},
		{"Orchestrator", func() string { return NewOrchestratorAdapter("c", "m", "", nil).Metadata().Name }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if name := tt.fn(); name == "" {
				t.Errorf("%s: expected non-empty name", tt.name)
			}
		})
	}
}
