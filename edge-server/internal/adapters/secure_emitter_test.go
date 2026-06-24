package adapters

import (
	"context"
	"testing"
)

// --- Mock hooks for SecureEmitter tests ---

// blockAllHook blocks all PreToolUse calls.
type blockAllHook struct{}

func (h *blockAllHook) PreToolUse(ctx context.Context, toolName string, input map[string]any) (map[string]any, bool, string) {
	return input, true, "blocked by test"
}
func (h *blockAllHook) PostToolUse(ctx context.Context, toolName string, output string) string { return output }
func (h *blockAllHook) PermissionRequest(ctx context.Context, toolName string, risk RiskLevel) PermDecision {
	return PermAllow
}
func (h *blockAllHook) OnError(ctx context.Context, err error) ErrorAction            { return ErrRetry }
func (h *blockAllHook) PrePrompt(ctx context.Context, prompt string) string            { return prompt }
func (h *blockAllHook) PostResponse(ctx context.Context, response string) string       { return response }

// modifyInputHook modifies PreToolUse input by adding a key.
type modifyInputHook struct{}

func (h *modifyInputHook) PreToolUse(ctx context.Context, toolName string, input map[string]any) (map[string]any, bool, string) {
	if input == nil {
		input = make(map[string]any)
	}
	input["modified"] = true
	return input, false, ""
}
func (h *modifyInputHook) PostToolUse(ctx context.Context, toolName string, output string) string { return output }
func (h *modifyInputHook) PermissionRequest(ctx context.Context, toolName string, risk RiskLevel) PermDecision {
	return PermAllow
}
func (h *modifyInputHook) OnError(ctx context.Context, err error) ErrorAction      { return ErrRetry }
func (h *modifyInputHook) PrePrompt(ctx context.Context, prompt string) string      { return prompt }
func (h *modifyInputHook) PostResponse(ctx context.Context, response string) string { return response }

// appendToOutputHook appends text to PostToolUse output.
type appendToOutputHook struct {
	suffix string
}

func (h *appendToOutputHook) PreToolUse(ctx context.Context, toolName string, input map[string]any) (map[string]any, bool, string) {
	return input, false, ""
}
func (h *appendToOutputHook) PostToolUse(ctx context.Context, toolName string, output string) string {
	return output + h.suffix
}
func (h *appendToOutputHook) PermissionRequest(ctx context.Context, toolName string, risk RiskLevel) PermDecision {
	return PermAllow
}
func (h *appendToOutputHook) OnError(ctx context.Context, err error) ErrorAction      { return ErrRetry }
func (h *appendToOutputHook) PrePrompt(ctx context.Context, prompt string) string      { return prompt }
func (h *appendToOutputHook) PostResponse(ctx context.Context, response string) string { return response }

// --- Tests ---

func TestNewSecureEmitter(t *testing.T) {
	inner := &recordingEmitter{}
	ctx := context.Background()
	hooks := HookChain{&blockAllHook{}}

	se := NewSecureEmitter(ctx, inner, hooks)
	if se == nil {
		t.Fatal("NewSecureEmitter should not return nil")
	}
	if se.inner == nil {
		t.Fatal("SecureEmitter.inner should not be nil")
	}
	if se.hooks == nil {
		t.Fatal("SecureEmitter.hooks should not be nil")
	}
}

func TestSecureEmitter_EmitNoHooks(t *testing.T) {
	inner := &recordingEmitter{}
	se := NewSecureEmitter(context.Background(), inner, nil)

	se.Emit(BusEventToolCall, nil, map[string]any{
		"toolName": "Read",
		"input":    map[string]any{"filePath": "/test"},
	})
	se.Emit(BusEventToolResult, nil, map[string]any{
		"toolName": "Read",
		"content":  "file contents",
	})
	se.Emit(BusEventTextDelta, nil, "some text")

	// All events should pass through unchanged.
	if len(inner.events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(inner.events))
	}
	if inner.events[0].eventType != BusEventToolCall {
		t.Errorf("event 0 type = %q", inner.events[0].eventType)
	}
	if inner.events[1].eventType != BusEventToolResult {
		t.Errorf("event 1 type = %q", inner.events[1].eventType)
	}
	if inner.events[2].eventType != BusEventTextDelta {
		t.Errorf("event 2 type = %q", inner.events[2].eventType)
	}
}

func TestSecureEmitter_EmitEmptyHooks(t *testing.T) {
	inner := &recordingEmitter{}
	se := NewSecureEmitter(context.Background(), inner, HookChain{})

	se.Emit(BusEventToolCall, nil, map[string]any{
		"toolName": "Read",
		"input":    map[string]any{"filePath": "/test"},
	})

	if len(inner.events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(inner.events))
	}
}

func TestSecureEmitter_EmitNonMapPayloadPassthrough(t *testing.T) {
	inner := &recordingEmitter{}
	se := NewSecureEmitter(context.Background(), inner, HookChain{&blockAllHook{}})

	// Non-map payload should pass through to inner without hook processing.
	se.Emit(BusEventToolCall, nil, "string payload")
	se.Emit(BusEventToolResult, nil, 42)
	se.Emit(BusEventTextDelta, nil, nil)

	if len(inner.events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(inner.events))
	}
}

func TestSecureEmitter_EmitDefaultEventPassthrough(t *testing.T) {
	inner := &recordingEmitter{}
	se := NewSecureEmitter(context.Background(), inner, HookChain{&blockAllHook{}})

	p := map[string]any{"toolName": "Bash", "input": map[string]any{"command": "rm -rf /"}}
	se.Emit(BusEventTextDelta, nil, p) // Not tool_call or tool_result — passthrough
	se.Emit(BusEventTextBlock, nil, p)
	se.Emit("random.event", nil, p)

	if len(inner.events) != 3 {
		t.Fatalf("expected 3 passthrough events, got %d", len(inner.events))
	}
}

func TestSecureEmitter_PreToolUseBlock(t *testing.T) {
	inner := &recordingEmitter{}
	se := NewSecureEmitter(context.Background(), inner, HookChain{&blockAllHook{}})

	payload := map[string]any{
		"toolName": "Bash",
		"input":    map[string]any{"command": "ls"},
	}
	se.Emit(BusEventToolCall, nil, payload)

	events := inner.eventsByType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_call event, got %d", len(events))
	}
	p := events[0].payload.(map[string]any)
	if p["status"] != "blocked" {
		t.Errorf("status = %v, want blocked", p["status"])
	}
	if p["blockReason"] != "blocked by test" {
		t.Errorf("blockReason = %v, want 'blocked by test'", p["blockReason"])
	}
}

func TestSecureEmitter_PreToolUseModify(t *testing.T) {
	inner := &recordingEmitter{}
	se := NewSecureEmitter(context.Background(), inner, HookChain{&modifyInputHook{}})

	payload := map[string]any{
		"toolName": "Write",
		"input":    map[string]any{"filePath": "/test"},
	}
	se.Emit(BusEventToolCall, nil, payload)

	events := inner.eventsByType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_call event, got %d", len(events))
	}
	p := events[0].payload.(map[string]any)
	input, _ := p["input"].(map[string]any)
	if input["modified"] != true {
		t.Errorf("input should be modified by hook: %v", input)
	}
	// Original payload's input map may be mutated by in-place hook modification.
	// This is expected behavior — hooks receive the actual map.
}

func TestSecureEmitter_PreToolUseEmptyToolNamePassthrough(t *testing.T) {
	inner := &recordingEmitter{}
	se := NewSecureEmitter(context.Background(), inner, HookChain{&blockAllHook{}})

	payload := map[string]any{
		"toolName": "", // empty tool name
		"input":    map[string]any{},
	}
	se.Emit(BusEventToolCall, nil, payload)

	events := inner.eventsByType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	p := events[0].payload.(map[string]any)
	// Should be unblocked since toolName is empty — hook is bypassed
	if p["status"] == "blocked" {
		t.Error("empty toolName should bypass PreToolUse hook")
	}
}

func TestSecureEmitter_PreToolUseMissingToolNamePassthrough(t *testing.T) {
	inner := &recordingEmitter{}
	se := NewSecureEmitter(context.Background(), inner, HookChain{&blockAllHook{}})

	payload := map[string]any{
		"input": map[string]any{}, // no toolName key
	}
	se.Emit(BusEventToolCall, nil, payload)

	events := inner.eventsByType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	p := events[0].payload.(map[string]any)
	if p["status"] == "blocked" {
		t.Error("missing toolName should bypass PreToolUse hook")
	}
}

func TestSecureEmitter_PostToolUseOutputModify(t *testing.T) {
	inner := &recordingEmitter{}
	se := NewSecureEmitter(context.Background(), inner, HookChain{&appendToOutputHook{suffix: " [OK]"}})

	payload := map[string]any{
		"toolName": "Read",
		"content":  "original content",
	}
	se.Emit(BusEventToolResult, nil, payload)

	events := inner.eventsByType(BusEventToolResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_result event, got %d", len(events))
	}
	p := events[0].payload.(map[string]any)
	if p["content"] != "original content [OK]" {
		t.Errorf("content = %q, want 'original content [OK]'", p["content"])
	}
}

func TestSecureEmitter_PostToolUseOutputKeyModify(t *testing.T) {
	inner := &recordingEmitter{}
	se := NewSecureEmitter(context.Background(), inner, HookChain{&appendToOutputHook{suffix: " [OK]"}})

	// Test with "output" key (Codex/OpenCode style)
	payload := map[string]any{
		"toolName": "Read",
		"output":   "codex output",
	}
	se.Emit(BusEventToolResult, nil, payload)

	events := inner.eventsByType(BusEventToolResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 tool_result event, got %d", len(events))
	}
	p := events[0].payload.(map[string]any)
	if p["output"] != "codex output [OK]" {
		t.Errorf("output = %q, want 'codex output [OK]'", p["output"])
	}
}

func TestSecureEmitter_PostToolUseEmptyToolNamePassthrough(t *testing.T) {
	inner := &recordingEmitter{}
	se := NewSecureEmitter(context.Background(), inner, HookChain{&appendToOutputHook{suffix: " [X]"}})

	payload := map[string]any{
		"toolName": "",
		"content":  "should not change",
	}
	se.Emit(BusEventToolResult, nil, payload)

	events := inner.eventsByType(BusEventToolResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	p := events[0].payload.(map[string]any)
	if p["content"] != "should not change" {
		t.Errorf("empty toolName should bypass PostToolUse: got %q", p["content"])
	}
}

func TestSecureEmitter_HookChainMultipleModifications(t *testing.T) {
	inner := &recordingEmitter{}
	se := NewSecureEmitter(context.Background(), inner, HookChain{
		&appendToOutputHook{suffix: " [A]"},
		&appendToOutputHook{suffix: " [B]"},
	})

	payload := map[string]any{
		"toolName": "Read",
		"content":  "base",
	}
	se.Emit(BusEventToolResult, nil, payload)

	events := inner.eventsByType(BusEventToolResult)
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	p := events[0].payload.(map[string]any)
	if p["content"] != "base [A] [B]" {
		t.Errorf("chain output = %q, want 'base [A] [B]'", p["content"])
	}
}

func TestSecureEmitter_HookChainFirstBlockWins(t *testing.T) {
	inner := &recordingEmitter{}
	// Two hooks: first blocks, second tries to modify (should not run)
	se := NewSecureEmitter(context.Background(), inner, HookChain{
		&blockAllHook{},
		&modifyInputHook{},
	})

	payload := map[string]any{
		"toolName": "Bash",
		"input":    map[string]any{"command": "ls"},
	}
	se.Emit(BusEventToolCall, nil, payload)

	events := inner.eventsByType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	p := events[0].payload.(map[string]any)
	if p["status"] != "blocked" {
		t.Errorf("first hook should block: got status=%v", p["status"])
	}
	input, _ := p["input"].(map[string]any)
	if input["modified"] == true {
		t.Error("second hook should not run after first blocks")
	}
}

func TestSecureEmitter_ScopePropagation(t *testing.T) {
	inner := &recordingEmitter{}
	se := NewSecureEmitter(context.Background(), inner, HookChain{&modifyInputHook{}})

	scope := map[string]any{"runId": "r1", "projectId": "p1"}
	payload := map[string]any{
		"toolName": "Write",
		"input":    map[string]any{"filePath": "/test"},
	}
	se.Emit(BusEventToolCall, scope, payload)

	events := inner.eventsByType(BusEventToolCall)
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].scope["runId"] != "r1" || events[0].scope["projectId"] != "p1" {
		t.Errorf("scope not propagated: %v", events[0].scope)
	}
}
