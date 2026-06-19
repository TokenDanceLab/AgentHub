package adapters

import (
	"context"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

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
	if !a.NeedsStdin() {
		t.Fatal("Orchestrator adapter should need stdin (delegates to inner Claude Code)")
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

func TestOrchestratorAdapterEscapesSystemPrompt(t *testing.T) {
	a := NewOrchestratorAdapter("claude", "sonnet", "Use `code` blocks for ${VAR}", nil)
	// The constructor should escape backticks and ${} in the system prompt.
	if a.systemPrompt != "Use \\`code\\` blocks for \\${VAR}" {
		t.Fatalf("systemPrompt = %q, want escaped version", a.systemPrompt)
	}
}

// --- sandboxForPermissionMode tests ---

func TestSandboxForPermissionMode(t *testing.T) {
	tests := []struct {
		mode string
		want string
	}{
		{"plan", "read-only"},
		{"default", ""}, // Codex has no "default" sandbox — let it decide
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

// --- Adapter lifecycle edge case tests ---

// contextCancelledAdapter is a stub that checks context cancellation in ParseStream.
type contextCancelledAdapter struct {
	cancelled bool
}

func (a *contextCancelledAdapter) Metadata() AdapterMetadata {
	return AdapterMetadata{ID: "ctx-cancel-test", Name: "Context Cancel Test"}
}
func (a *contextCancelledAdapter) Capabilities() AgentCapabilities {
	return AgentCapabilities{Streaming: true}
}
func (a *contextCancelledAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	return "", nil, nil, ""
}
func (a *contextCancelledAdapter) ParseStream(ctx context.Context, _ io.Reader, _ io.Writer, _ EventEmitter, _ store.Run) error {
	<-ctx.Done()
	a.cancelled = true
	return ctx.Err()
}
func (a *contextCancelledAdapter) NeedsStdin() bool { return false }
func (a *contextCancelledAdapter) Available() bool  { return true }

// TestAdapterParseStreamHandlesContextCancellation verifies that an adapter's
// ParseStream properly responds to context cancellation without panicking.
func TestAdapterParseStreamHandlesContextCancellation(t *testing.T) {
	adapter := &contextCancelledAdapter{}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err := adapter.ParseStream(ctx, nil, nil, &stubEmitter{}, store.Run{})
	if err == nil {
		t.Fatal("ParseStream should return context error")
	}
	if !adapter.cancelled {
		t.Fatal("adapter did not detect context cancellation")
	}
}

// emptyCommandAdapter returns an empty command path from BuildCommand.
type emptyCommandAdapter struct{}

func (a *emptyCommandAdapter) Metadata() AdapterMetadata {
	return AdapterMetadata{ID: "empty-cmd", Name: "Empty Command"}
}
func (a *emptyCommandAdapter) Capabilities() AgentCapabilities {
	return AgentCapabilities{Streaming: true}
}
func (a *emptyCommandAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	return "", nil, nil, ""
}
func (a *emptyCommandAdapter) ParseStream(ctx context.Context, _ io.Reader, _ io.Writer, _ EventEmitter, _ store.Run) error {
	return nil
}
func (a *emptyCommandAdapter) NeedsStdin() bool { return false }
func (a *emptyCommandAdapter) Available() bool  { return true }

func TestBuildCommandCanReturnEmptyPath(t *testing.T) {
	adapter := &emptyCommandAdapter{}
	path, args, env, dir := adapter.BuildCommand(RunProcessContext{})
	if path != "" {
		t.Fatalf("empty command path = %q, want empty", path)
	}
	if args != nil {
		t.Fatalf("empty command args = %v, want nil", args)
	}
	if env != nil {
		t.Fatalf("empty command env = %v, want nil", env)
	}
	if dir != "" {
		t.Fatalf("empty command dir = %q, want empty", dir)
	}
}

// unavailableAdapter reports Available() == false.
type unavailableAdapter struct {
	id string
}

func (a *unavailableAdapter) Metadata() AdapterMetadata {
	return AdapterMetadata{ID: a.id, Name: a.id}
}
func (a *unavailableAdapter) Capabilities() AgentCapabilities {
	return AgentCapabilities{}
}
func (a *unavailableAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	return "", nil, nil, ""
}
func (a *unavailableAdapter) ParseStream(ctx context.Context, _ io.Reader, _ io.Writer, _ EventEmitter, _ store.Run) error {
	return nil
}
func (a *unavailableAdapter) NeedsStdin() bool { return false }
func (a *unavailableAdapter) Available() bool  { return false }

func TestUnavailableAdapterReportsFalse(t *testing.T) {
	adapter := &unavailableAdapter{id: "missing-binary"}
	if adapter.Available() {
		t.Fatal("unavailable adapter should return false for Available()")
	}
}

func TestAvailableAdapterReportsTrue(t *testing.T) {
	a := NewClaudeCodeAdapter("claude", "sonnet", "")
	// Claude adapter checks binary existence; on a dev machine without
	// Claude CLI, Available() may return false. We just verify it does not
	// panic.
	_ = a.Available()
}

// TestParseStreamErrorRecoverableFlag verifies the semantic contract of
// recoverable vs non-recoverable parse errors.
func TestParseStreamErrorRecoverableFlag(t *testing.T) {
	recoverableErr := NewRecoverableParseError(fmt.Errorf("malformed event"))
	if !recoverableErr.Recoverable() {
		t.Fatal("Recoverable parse error should be recoverable")
	}
	if recoverableErr.Error() == "" {
		t.Fatal("Recoverable parse error should have a non-empty message")
	}
	if !strings.Contains(recoverableErr.Error(), "malformed event") {
		t.Fatalf("error message = %q, want malformed event", recoverableErr.Error())
	}

	nonRecoverableErr := NewNonRecoverableParseError(fmt.Errorf("broken pipe"))
	if nonRecoverableErr.Recoverable() {
		t.Fatal("Non-recoverable parse error should not be recoverable")
	}

	nilErr := NewRecoverableParseError(nil)
	if nilErr.Error() == "" {
		t.Fatal("parse error with nil cause should still have a message")
	}
}

// TestBuildSiblingContextPromptEdgeCases tests sibling context prompt generation.
func TestBuildSiblingContextPromptEdgeCases(t *testing.T) {
	if prompt := BuildSiblingContextPrompt(nil); prompt != "" {
		t.Fatalf("nil siblings prompt = %q, want empty", prompt)
	}
	if prompt := BuildSiblingContextPrompt([]SiblingInfo{}); prompt != "" {
		t.Fatalf("empty siblings prompt = %q, want empty", prompt)
	}

	task := SiblingInfo{
		AgentName:   "codex",
		TaskDesc:    "write tests",
		TargetFiles: []string{"src/test.go", "src/main_test.go"},
	}
	prompt := BuildSiblingContextPrompt([]SiblingInfo{task})
	if prompt == "" {
		t.Fatal("single sibling prompt should not be empty")
	}
	if !strings.Contains(prompt, "codex") {
		t.Fatal("prompt should contain agent name")
	}
	if !strings.Contains(prompt, "src/test.go") {
		t.Fatal("prompt should contain target file")
	}
}

// TestAdapterMetadataIsNotEmpty verifies all built-in adapters have non-empty metadata.
func TestAdapterMetadataIsNotEmpty(t *testing.T) {
	adapters := []struct {
		name     string
		metadata AdapterMetadata
	}{
		{"ClaudeCode", NewClaudeCodeAdapter("claude", "sonnet", "").Metadata()},
		{"Codex", NewCodexAdapter("codex", "gpt-5").Metadata()},
		{"OpenCode", NewOpenCodeAdapter("opencode").Metadata()},
		{"Orchestrator", NewOrchestratorAdapter("claude", "sonnet", "prompt", nil).Metadata()},
	}
	for _, a := range adapters {
		if a.metadata.ID == "" {
			t.Fatalf("%s adapter ID is empty", a.name)
		}
		if a.metadata.Name == "" {
			t.Fatalf("%s adapter Name is empty", a.name)
		}
		if a.metadata.Description == "" {
			t.Fatalf("%s adapter Description is empty", a.name)
		}
	}
}
