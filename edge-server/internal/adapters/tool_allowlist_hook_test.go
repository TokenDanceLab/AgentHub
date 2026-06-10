package adapters

import (
	"context"
	"errors"
	"testing"
)

func TestToolAllowlistHookEmptyAllowlistPassesAll(t *testing.T) {
	h := NewToolAllowlistHook(nil, nil, nil)
	_, blocked, _ := h.PreToolUse(context.Background(), "Bash", map[string]any{
		"command": "rm -rf /",
	})
	if blocked {
		t.Fatal("empty allowlist should pass all tools through")
	}
}

func TestToolAllowlistHookEmptyAllowlistIsNotRestrictive(t *testing.T) {
	h := NewToolAllowlistHook(nil, nil, nil)
	if h.IsRestrictive() {
		t.Fatal("nil allowlist should not be restrictive")
	}

	h = NewToolAllowlistHook([]string{}, nil, nil)
	if h.IsRestrictive() {
		t.Fatal("empty allowlist should not be restrictive")
	}
}

func TestToolAllowlistHookAllowsListedTool(t *testing.T) {
	rec := &allowlistTestEmitter{}
	h := NewToolAllowlistHook([]string{"Read", "Grep", "Glob"}, rec, nil)

	_, blocked, reason := h.PreToolUse(context.Background(), "Read", map[string]any{
		"filePath": "/some/file.txt",
	})
	if blocked {
		t.Fatalf("Read should be allowed, got blocked: %s", reason)
	}
	if len(rec.events) > 0 {
		t.Fatalf("no rejection events expected, got: %v", rec.events)
	}
}

func TestToolAllowlistHookBlocksUnlistedTool(t *testing.T) {
	rec := &allowlistTestEmitter{scope: map[string]any{"runId": "run_test"}}
	h := NewToolAllowlistHook([]string{"Read", "Grep", "Glob"}, rec, rec.scope)

	_, blocked, reason := h.PreToolUse(context.Background(), "Bash", map[string]any{
		"command": "ls -la",
	})
	if !blocked {
		t.Fatal("Bash should be blocked when not in allowlist")
	}
	if reason == "" {
		t.Fatal("expected non-empty block reason")
	}
	if len(rec.events) != 1 || rec.events[0] != BusEventToolRejected {
		t.Fatalf("expected one tool_rejected event, got: %v", rec.events)
	}
	if rec.lastPayload["toolName"] != "Bash" {
		t.Fatalf("rejected event toolName = %v, want Bash", rec.lastPayload["toolName"])
	}
	if rec.lastPayload["status"] != "rejected" {
		t.Fatalf("rejected event status = %v, want rejected", rec.lastPayload["status"])
	}
}

func TestToolAllowlistHookBlocksWriteWhenOnlyReadAllowed(t *testing.T) {
	h := NewToolAllowlistHook([]string{"Read"}, nil, nil)

	_, blocked, reason := h.PreToolUse(context.Background(), "Write", map[string]any{
		"filePath": "/some/file.txt",
	})
	if !blocked {
		t.Fatal("Write should be blocked when only Read is allowed")
	}
	if reason == "" {
		t.Fatal("expected non-empty block reason")
	}
}

func TestToolAllowlistHookIsRestrictive(t *testing.T) {
	h := NewToolAllowlistHook([]string{"Read"}, nil, nil)
	if !h.IsRestrictive() {
		t.Fatal("non-empty allowlist should be restrictive")
	}
}

func TestToolAllowlistHookEmitsRejectionEventWithScope(t *testing.T) {
	scope := map[string]any{
		"projectId": "proj_1",
		"threadId":  "thread_1",
		"runId":     "run_1",
	}
	rec := &allowlistTestEmitter{scope: scope}
	h := NewToolAllowlistHook([]string{"Read"}, rec, scope)

	_, blocked, _ := h.PreToolUse(context.Background(), "Write", map[string]any{
		"filePath": "/etc/passwd",
	})
	if !blocked {
		t.Fatal("Write should be blocked")
	}

	if len(rec.events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(rec.events))
	}
	if rec.events[0] != BusEventToolRejected {
		t.Fatalf("event type = %q, want %q", rec.events[0], BusEventToolRejected)
	}
	// Verify the scope was passed through
	if rec.lastScope["runId"] != "run_1" {
		t.Fatalf("scope runId = %v, want run_1", rec.lastScope["runId"])
	}
	// Verify the payload
	if rec.lastPayload["toolName"] != "Write" {
		t.Fatalf("payload toolName = %v, want Write", rec.lastPayload["toolName"])
	}
}

func TestToolAllowlistHookNoEmitterDoesNotPanic(t *testing.T) {
	h := NewToolAllowlistHook([]string{"Read"}, nil, nil)

	// Should not panic when emitter is nil
	_, blocked, reason := h.PreToolUse(context.Background(), "Write", map[string]any{})
	if !blocked {
		t.Fatal("Write should be blocked")
	}
	if reason == "" {
		t.Fatal("expected block reason even without emitter")
	}
}

func TestToolAllowlistHookFormatAllowlistShort(t *testing.T) {
	h := NewToolAllowlistHook([]string{"Read", "Grep"}, nil, nil)
	formatted := h.formatAllowlist()
	if formatted != "Grep, Read" {
		t.Fatalf("formatAllowlist = %q, want %q", formatted, "Grep, Read")
	}
}

func TestToolAllowlistHookFormatAllowlistLong(t *testing.T) {
	tools := []string{"Read", "Grep", "Glob", "Write", "Edit", "Bash"}
	h := NewToolAllowlistHook(tools, nil, nil)
	formatted := h.formatAllowlist()
	// Should be sorted and truncated to 5 + "+ 1 more"
	if formatted != "Bash, Edit, Glob, Grep, Read + 1 more" {
		t.Fatalf("formatAllowlist = %q, want truncated sorted list", formatted)
	}
}

func TestToolAllowlistHookFormatAllowlistEmpty(t *testing.T) {
	h := NewToolAllowlistHook(nil, nil, nil)
	formatted := h.formatAllowlist()
	if formatted != "" {
		t.Fatalf("formatAllowlist = %q, want empty", formatted)
	}
}

func TestToolAllowlistHookAllowsMCPToolWhenListed(t *testing.T) {
	h := NewToolAllowlistHook([]string{"mcp__stitch__get_screen", "Read"}, nil, nil)
	_, blocked, _ := h.PreToolUse(context.Background(), "mcp__stitch__get_screen", map[string]any{})
	if blocked {
		t.Fatal("listed MCP tool should be allowed")
	}
}

func TestToolAllowlistHookBlocksMCPToolWhenNotListed(t *testing.T) {
	h := NewToolAllowlistHook([]string{"Read"}, nil, nil)
	_, blocked, _ := h.PreToolUse(context.Background(), "mcp__stitch__create_project", map[string]any{})
	if !blocked {
		t.Fatal("unlisted MCP tool should be blocked")
	}
}

// PostToolUse passes through
func TestToolAllowlistHookPostToolUsePassthrough(t *testing.T) {
	h := NewToolAllowlistHook([]string{"Read"}, nil, nil)
	output := h.PostToolUse(context.Background(), "Read", "file content")
	if output != "file content" {
		t.Fatalf("PostToolUse = %q, want %q", output, "file content")
	}
}

// PermissionRequest always returns Allow
func TestToolAllowlistHookPermissionRequestReturnsAllow(t *testing.T) {
	h := NewToolAllowlistHook([]string{"Read"}, nil, nil)
	decision := h.PermissionRequest(context.Background(), "Bash", RiskHigh)
	if decision != PermAllow {
		t.Fatalf("PermissionRequest = %s, want %s", decision, PermAllow)
	}
}

// OnError returns Retry
func TestToolAllowlistHookOnErrorReturnsRetry(t *testing.T) {
	h := NewToolAllowlistHook([]string{"Read"}, nil, nil)
	action := h.OnError(context.Background(), errors.New("err"))
	if action != ErrRetry {
		t.Fatalf("OnError = %s, want %s", action, ErrRetry)
	}
}

// PrePrompt passes through
func TestToolAllowlistHookPrePromptPassthrough(t *testing.T) {
	h := NewToolAllowlistHook([]string{"Read"}, nil, nil)
	result := h.PrePrompt(context.Background(), "test prompt")
	if result != "test prompt" {
		t.Fatalf("PrePrompt = %q, want %q", result, "test prompt")
	}
}

// PostResponse passes through
func TestToolAllowlistHookPostResponsePassthrough(t *testing.T) {
	h := NewToolAllowlistHook([]string{"Read"}, nil, nil)
	result := h.PostResponse(context.Background(), "test response")
	if result != "test response" {
		t.Fatalf("PostResponse = %q, want %q", result, "test response")
	}
}

// allowlistTestEmitter captures emitted events for test assertions.
type allowlistTestEmitter struct {
	events      []string
	lastScope   map[string]any
	lastPayload map[string]any
	scope       map[string]any
}

func (e *allowlistTestEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.events = append(e.events, eventType)
	e.lastScope = scope
	if p, ok := payload.(map[string]any); ok {
		e.lastPayload = p
	}
}

// Test ToolAllowlistHook in a HookChain integration
func TestToolAllowlistHookInChainBlocksBeforeSecurityHook(t *testing.T) {
	rec := &allowlistTestEmitter{}
	allowlistHook := NewToolAllowlistHook([]string{"Read"}, rec, nil)
	securityHook := NewSecurityHook()
	chain := HookChain{allowlistHook, securityHook}

	// Bash is not in allowlist — allowlist hook blocks it first
	_, blocked, reason := chain.RunPreToolUse(context.Background(), "Bash", map[string]any{
		"command": "ls -la",
	})
	if !blocked {
		t.Fatal("expected Bash to be blocked by allowlist hook in chain")
	}
	if reason == "" {
		t.Fatal("expected non-empty block reason from allowlist")
	}

	// Read is in allowlist — passes allowlist, then passes security hook
	_, blocked, _ = chain.RunPreToolUse(context.Background(), "Read", map[string]any{
		"filePath": "/some/file.txt",
	})
	if blocked {
		t.Fatal("Read should pass through both hooks")
	}
}

func TestToolAllowlistHookInChainWithSecurityHookBlocksDangerousBash(t *testing.T) {
	rec := &allowlistTestEmitter{}
	// Allow Bash in allowlist but security hook should block rm -rf /
	allowlistHook := NewToolAllowlistHook([]string{"Read", "Bash"}, rec, nil)
	securityHook := NewSecurityHook()
	chain := HookChain{allowlistHook, securityHook}

	// Bash is in allowlist, but rm -rf / is dangerous — security hook blocks it
	_, blocked, reason := chain.RunPreToolUse(context.Background(), "Bash", map[string]any{
		"command": "rm -rf /",
	})
	if !blocked {
		t.Fatal("expected rm -rf / to be blocked by security hook")
	}
	if reason == "" {
		t.Fatal("expected block reason from security hook")
	}
}
