package orchestrator

import (
	"strings"
	"testing"
)

// ── Orchestrator adapter behavior tests（随实现迁移到叶子包，#1566）──────────
// 原位于根包 adapter_test.go；构造函数改为注入 AgentExecutor port。

func TestAdapterMetadata(t *testing.T) {
	a := NewOrchestratorAdapter(&fakeAgentExecutor{}, "You are an orchestrator")
	m := a.Metadata()
	if m.ID != "orchestrator" {
		t.Fatalf("ID = %q, want orchestrator", m.ID)
	}
	if m.Name != "Orchestrator" {
		t.Fatalf("Name = %q, want Orchestrator", m.Name)
	}
	if m.Description == "" {
		t.Fatal("Description should not be empty")
	}
}

func TestAdapterCapabilities(t *testing.T) {
	a := NewOrchestratorAdapter(&fakeAgentExecutor{}, "You are an orchestrator")
	c := a.Capabilities()
	if !c.Streaming {
		t.Fatal("Streaming should be true")
	}
	if !c.SubAgentSpawn {
		t.Fatal("SubAgentSpawn should be true")
	}
}

func TestAdapterNeedsStdin(t *testing.T) {
	a := NewOrchestratorAdapter(&fakeAgentExecutor{}, "You are an orchestrator")
	if !a.NeedsStdin() {
		t.Fatal("Orchestrator adapter should need stdin")
	}
}

func TestNewOrchestratorAdapter(t *testing.T) {
	a := NewOrchestratorAdapter(&fakeAgentExecutor{}, "You are an orchestrator")
	if a == nil {
		t.Fatal("Adapter should not be nil")
	}
	if a.systemPrompt != "You are an orchestrator" {
		t.Fatalf("systemPrompt = %q, want 'You are an orchestrator'", a.systemPrompt)
	}
}

func TestDefaultOrchestratorPrompt(t *testing.T) {
	prompt := DefaultOrchestratorPrompt([]string{"agent-a", "agent-b"})
	if prompt == "" {
		t.Fatal("DefaultOrchestratorPrompt should not be empty")
	}
	if !strings.Contains(prompt, "<ROLE>") {
		t.Fatal("prompt should contain <ROLE> XML section")
	}
}

func TestFormatAgentList(t *testing.T) {
	tests := []struct {
		name     string
		agents   []string
		expected string
	}{
		{"empty", nil, "none"},
		{"empty slice", []string{}, "none"},
		{"single", []string{"agent-a"}, "agent-a"},
		{"multiple", []string{"agent-a", "agent-b", "agent-c"}, "agent-a, agent-b, agent-c"},
		{"with backtick", []string{"`evil`"}, "\\`evil\\`"},
		{"with dollar brace", []string{"${foo}"}, "\\${foo}"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatAgentList(tt.agents)
			if got != tt.expected {
				t.Fatalf("formatAgentList(%v) = %q, want %q", tt.agents, got, tt.expected)
			}
		})
	}
}

func TestEscapePromptLiteral(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"plain text", "plain text"},
		{"`code`", "\\`code\\`"},
		{"${VAR}", "\\${VAR}"},
		{"`code` and ${VAR}", "\\`code\\` and \\${VAR}"},
		{"already\\`escaped", "already\\\\`escaped"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := escapePromptLiteral(tt.input)
			if got != tt.expected {
				t.Fatalf("escapePromptLiteral(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestAdapterEscapesSystemPrompt(t *testing.T) {
	a := NewOrchestratorAdapter(&fakeAgentExecutor{}, "Use `code` blocks for ${VAR}")
	// The constructor should escape backticks and ${} in the system prompt.
	if a.systemPrompt != "Use \\`code\\` blocks for \\${VAR}" {
		t.Fatalf("systemPrompt = %q, want escaped version", a.systemPrompt)
	}
}
