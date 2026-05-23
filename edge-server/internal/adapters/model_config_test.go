package adapters

import "testing"

func TestResolveModelAlias(t *testing.T) {
	tests := []struct {
		agentID string
		model   string
		want    string
	}{
		{"claude-code", "sonnet", "claude-sonnet-4-6"},
		{"claude-code", "opus", "claude-opus-4-7"},
		{"codex", "gpt-5", "gpt-5.3-codex"},
		{"opencode", "sonnet", "anthropic/claude-sonnet-4-6"},
		// Passthrough for unknown model
		{"claude-code", "custom-model", "custom-model"},
		// Passthrough for unknown agent
		{"unknown-agent", "sonnet", "sonnet"},
		// Empty model returns empty
		{"claude-code", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.agentID+"/"+tt.model, func(t *testing.T) {
			got := ResolveModel(tt.agentID, tt.model)
			if got != tt.want {
				t.Errorf("ResolveModel(%q, %q) = %q, want %q", tt.agentID, tt.model, got, tt.want)
			}
		})
	}
}

func TestResolveReasoningEffort(t *testing.T) {
	tests := []struct {
		agentID string
		effort  string
		want    string
	}{
		{"claude-code", "high", "high"},
		{"codex", "low", "minimal"},
		{"codex", "max", "xhigh"},
		{"opencode", "low", "minimal"},
		{"opencode", "high", "high"},
		// Passthrough for unknown effort
		{"claude-code", "custom", "custom"},
		// Unknown agent passthrough
		{"unknown", "low", "low"},
		// Empty returns empty
		{"claude-code", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.agentID+"/"+tt.effort, func(t *testing.T) {
			got := ResolveReasoningEffort(tt.agentID, tt.effort)
			if got != tt.want {
				t.Errorf("ResolveReasoningEffort(%q, %q) = %q, want %q", tt.agentID, tt.effort, got, tt.want)
			}
		})
	}
}

func TestResolveModelWithDefault(t *testing.T) {
	// Explicit model takes priority
	got := ResolveModelWithDefault("claude-code", "sonnet")
	if got != "claude-sonnet-4-6" {
		t.Errorf("got %q, want claude-sonnet-4-6", got)
	}

	// Falls back to default
	got = ResolveModelWithDefault("claude-code", "")
	if got != "claude-sonnet-4-6" {
		t.Errorf("got %q, want claude-sonnet-4-6 (default)", got)
	}

	// codex default
	got = ResolveModelWithDefault("codex", "")
	if got != "gpt-5.3-codex" {
		t.Errorf("got %q, want gpt-5.3-codex (default)", got)
	}

	// opencode has no default model
	got = ResolveModelWithDefault("opencode", "")
	if got != "" {
		t.Errorf("got %q, want empty (opencode has no default)", got)
	}
}
