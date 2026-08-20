package adapters

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/store"
)

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
// OrchestratorAdapter 已迁移到叶子包，其 Metadata 校验见叶子包
// orchestrator_adapter_test.go（#1566）。Claude 家族已归组到 adapters/claude
// （校验见 claude/claude_code_test.go），codex/opencode 家族已归组到
// adapters/codex、adapters/opencode（校验见各自子包测试，#1760 各增量）。
func TestAdapterMetadataIsNotEmpty(t *testing.T) {
	adapters := []struct {
		name     string
		metadata AdapterMetadata
	}{
		{"ACP", NewAcpAdapter("acp", nil, "ACP experimental").Metadata()},
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

func TestDefaultWorkDirDoesNotReturnHome(t *testing.T) {
	home, err := os.UserHomeDir()
	got := DefaultWorkDir()
	if got != "" {
		t.Fatalf("DefaultWorkDir() = %q, want empty (no home fallback)", got)
	}
	if err == nil && home != "" && got == home {
		t.Fatalf("DefaultWorkDir must not return user home %q", home)
	}
}

func containsString(list []string, target string) bool {
	for _, value := range list {
		if value == target {
			return true
		}
	}
	return false
}
