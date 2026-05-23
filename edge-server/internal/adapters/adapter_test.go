package adapters

import (
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

// --- Adapter Metadata tests ---

func TestClaudeCodeAdapterMetadata(t *testing.T) {
	a := NewClaudeCodeAdapter("claude", "sonnet", "")
	m := a.Metadata()
	if m.ID != "claude-code" {
		t.Fatalf("ID = %q, want claude-code", m.ID)
	}
	if m.Name != "Claude Code" {
		t.Fatalf("Name = %q, want Claude Code", m.Name)
	}
	if m.Description == "" {
		t.Fatal("Description should not be empty")
	}
}

func TestCodexAdapterMetadata(t *testing.T) {
	a := NewCodexAdapter("codex", "gpt-5")
	m := a.Metadata()
	if m.ID != "codex" {
		t.Fatalf("ID = %q, want codex", m.ID)
	}
	if m.Name != "Codex" {
		t.Fatalf("Name = %q, want Codex", m.Name)
	}
	if m.Description == "" {
		t.Fatal("Description should not be empty")
	}
}

func TestOpenCodeAdapterMetadata(t *testing.T) {
	a := NewOpenCodeAdapter("opencode")
	m := a.Metadata()
	if m.ID != "opencode" {
		t.Fatalf("ID = %q, want opencode", m.ID)
	}
	if m.Name != "OpenCode" {
		t.Fatalf("Name = %q, want OpenCode", m.Name)
	}
	if m.Description == "" {
		t.Fatal("Description should not be empty")
	}
}

func TestOrchestratorAdapterMetadata(t *testing.T) {
	a := NewOrchestratorAdapter("claude", "sonnet", "You are an orchestrator", nil)
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

// --- Adapter Capabilities tests ---

func TestClaudeCodeAdapterCapabilities(t *testing.T) {
	a := NewClaudeCodeAdapter("claude", "sonnet", "")
	c := a.Capabilities()
	if !c.Streaming {
		t.Fatal("Streaming should be true")
	}
	if !c.ToolCalls {
		t.Fatal("ToolCalls should be true")
	}
	if !c.FileChanges {
		t.Fatal("FileChanges should be true")
	}
	if !c.PermissionHooks {
		t.Fatal("PermissionHooks should be true")
	}
	if !c.ThinkingVisible {
		t.Fatal("ThinkingVisible should be true")
	}
	if !c.MultiTurn {
		t.Fatal("MultiTurn should be true")
	}
	if !c.MCPIntegration {
		t.Fatal("MCPIntegration should be true")
	}
}

func TestCodexAdapterCapabilities(t *testing.T) {
	a := NewCodexAdapter("codex", "gpt-5")
	c := a.Capabilities()
	if c.Streaming { // Phase 1: batch only
		t.Fatal("Streaming should be false for Phase 1")
	}
	if !c.ToolCalls {
		t.Fatal("ToolCalls should be true")
	}
	if !c.FileChanges {
		t.Fatal("FileChanges should be true")
	}
	if !c.MultiTurn {
		t.Fatal("MultiTurn should be true")
	}
}

func TestOpenCodeAdapterCapabilities(t *testing.T) {
	a := NewOpenCodeAdapter("opencode")
	c := a.Capabilities()
	if !c.Streaming {
		t.Fatal("Streaming should be true")
	}
	if !c.ToolCalls {
		t.Fatal("ToolCalls should be true")
	}
	if !c.FileChanges {
		t.Fatal("FileChanges should be true")
	}
	if !c.ThinkingVisible {
		t.Fatal("ThinkingVisible should be true")
	}
	if !c.MultiTurn {
		t.Fatal("MultiTurn should be true")
	}
}

func TestOrchestratorAdapterCapabilities(t *testing.T) {
	a := NewOrchestratorAdapter("claude", "sonnet", "You are an orchestrator", nil)
	c := a.Capabilities()
	if !c.Streaming {
		t.Fatal("Streaming should be true")
	}
	if !c.SubAgentSpawn {
		t.Fatal("SubAgentSpawn should be true")
	}
}

// --- NeedsStdin tests ---

func TestClaudeCodeAdapterNeedsStdin(t *testing.T) {
	a := NewClaudeCodeAdapter("claude", "sonnet", "")
	if !a.NeedsStdin() {
		t.Fatal("Claude Code should need stdin")
	}
}

func TestCodexAdapterNeedsStdin(t *testing.T) {
	a := NewCodexAdapter("codex", "gpt-5")
	if a.NeedsStdin() {
		t.Fatal("Codex should not need stdin")
	}
}

func TestOpenCodeAdapterNeedsStdin(t *testing.T) {
	a := NewOpenCodeAdapter("opencode")
	if a.NeedsStdin() {
		t.Fatal("OpenCode should not need stdin")
	}
}

func TestOrchestratorAdapterNeedsStdin(t *testing.T) {
	a := NewOrchestratorAdapter("claude", "sonnet", "You are an orchestrator", nil)
	if a.NeedsStdin() {
		t.Fatal("Orchestrator adapter should not need stdin")
	}
}

// --- Orchestrator tests ---

func TestNewOrchestratorAdapter(t *testing.T) {
	a := NewOrchestratorAdapter("claude", "sonnet", "You are an orchestrator", []string{"sub1", "sub2"})
	if a == nil {
		t.Fatal("OrchestratorAdapter should not be nil")
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
	if prompt[0:1] != "Y" && prompt[0:1] != "y" {
		t.Fatal("prompt should start with greeting")
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

// --- sandboxForPermissionMode tests ---

func TestSandboxForPermissionMode(t *testing.T) {
	tests := []struct {
		mode string
		want string
	}{
		{"plan", "read-only"},
		{"default", "default"},
		{"acceptEdits", "workspace-write"},
		{"dontAsk", "workspace-write"},
		{"bypassPermissions", "danger-full-access"},
		{"unknown", ""},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.mode, func(t *testing.T) {
			got := sandboxForPermissionMode(tt.mode)
			if got != tt.want {
				t.Fatalf("sandboxForPermissionMode(%q) = %q, want %q", tt.mode, got, tt.want)
			}
		})
	}
}

// --- NDJSON parser option tests ---

func TestNDJSONParserWithControlHandler(t *testing.T) {
	parser := NewNDJSONStreamParser(&stubEmitter{}, store.Run{})
	h := &DefaultPermissionHandler{}
	updated := parser.WithControlHandler(h, nil)
	if updated == nil {
		t.Fatal("WithControlHandler should return non-nil")
	}
}

func TestNDJSONParserWithHooks(t *testing.T) {
	parser := NewNDJSONStreamParser(&stubEmitter{}, store.Run{})
	updated := parser.WithHooks(HookChain{NewSecurityHook()})
	if updated == nil {
		t.Fatal("WithHooks should return non-nil")
	}
}

// --- Event emitter stub ---

type stubEmitter struct{}

func (s *stubEmitter) Emit(eventType string, scope map[string]any, payload any) {}
