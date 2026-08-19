package sdk

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/runnerctx"
)

// testEventEmitter collects all events emitted during ParseStream for assertions.
type testEventEmitter struct {
	events []testEvent
}

type testEvent struct {
	EventType string
	Scope     map[string]any
	Payload   map[string]any
}

func (e *testEventEmitter) Emit(eventType string, scope map[string]any, payload any) {
	payloadMap, _ := payload.(map[string]any)
	e.events = append(e.events, testEvent{
		EventType: eventType,
		Scope:     scope,
		Payload:   payloadMap,
	})
}

// eventsOfType returns all events matching the given type.
func (e *testEventEmitter) eventsOfType(typ string) []testEvent {
	var out []testEvent
	for _, ev := range e.events {
		if ev.EventType == typ {
			out = append(out, ev)
		}
	}
	return out
}

// TestAnthropicSDK_E2E_SSEStream verifies that parseSSEStream correctly parses a
// realistic Anthropic streaming SSE response and emits the expected Edge events.
//
// It covers the full stream lifecycle:
//   - message_start  → run.agent.status_change
//   - content_block_delta (text_delta)  → run.agent.text_delta
//   - content_block_stop (text)         → run.agent.text_block
//   - message_stop   → run.agent.context_usage + run.agent.result
func TestAnthropicSDK_E2E_SSEStream(t *testing.T) {
	// Build a realistic Anthropic SSE stream-json response.
	// Reference: https://docs.anthropic.com/en/api/messages-streaming
	sseBody := joinLines(
		"event: message_start",
		`data: {"type":"message_start","message":{"id":"msg_01AbCdEfGh","type":"message","role":"assistant","model":"claude-sonnet-4-6-20250514","content":[],"usage":{"input_tokens":52}}}`,
		"",
		"event: content_block_start",
		`data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
		"",
		"event: content_block_delta",
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`,
		"",
		"event: content_block_delta",
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" from Claude!"}}`,
		"",
		"event: content_block_stop",
		`data: {"type":"content_block_stop","index":0}`,
		"",
		"event: message_delta",
		`data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}`,
		"",
		"event: message_stop",
		`data: {"type":"message_stop"}`,
		"",
	)

	// Serve the SSE stream from an httptest server for realistic HTTP transport.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(sseBody))
	}))
	defer srv.Close()

	// Fetch the SSE stream from the mock server.
	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("failed to GET mock server: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("mock server returned %d, want 200", resp.StatusCode)
	}

	// Create the adapter (no real API key needed -- we only call parseSSEStream).
	adapter := &AnthropicSDKAdapter{
		apiKey:     "test-key-not-used",
		baseURL:    "https://api.anthropic.com",
		model:      "claude-sonnet-4-6-20250514",
		maxTokens:  16384,
		available:  true,
		httpClient: &http.Client{},
	}

	emitter := &testEventEmitter{}
	scope := map[string]any{
		"projectId": "proj-test",
		"threadId":  "thr-test",
		"runId":     "run-test",
	}
	model := "claude-sonnet-4-6-20250514"

	ctx := context.Background()
	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, model)
	if err != nil {
		t.Fatalf("parseSSEStream returned error: %v", err)
	}

	// --- Assertions ---

	// 1. Verify we got events at all.
	if len(emitter.events) == 0 {
		t.Fatal("expected at least one event, got none")
	}

	// 2. Verify run.agent.status_change (from message_start).
	statusChanges := emitter.eventsOfType(BusEventStatusChange)
	if len(statusChanges) != 1 {
		t.Fatalf("expected 1 status_change event, got %d", len(statusChanges))
	}
	sc := statusChanges[0]
	if sc.Payload["status"] != "running" {
		t.Errorf("status_change status = %q, want %q", sc.Payload["status"], "running")
	}
	if sc.Payload["model"] != "claude-sonnet-4-6-20250514" {
		t.Errorf("status_change model = %q, want %q", sc.Payload["model"], "claude-sonnet-4-6-20250514")
	}
	if sc.Payload["provider"] != "anthropic" {
		t.Errorf("status_change provider = %q, want %q", sc.Payload["provider"], "anthropic")
	}

	// 3. Verify text_delta events (from content_block_delta).
	textDeltas := emitter.eventsOfType(BusEventTextDelta)
	if len(textDeltas) != 2 {
		t.Fatalf("expected 2 text_delta events, got %d", len(textDeltas))
	}
	if textDeltas[0].Payload["content"] != "Hello" {
		t.Errorf("text_delta[0] content = %q, want %q", textDeltas[0].Payload["content"], "Hello")
	}
	if textDeltas[1].Payload["content"] != " from Claude!" {
		t.Errorf("text_delta[1] content = %q, want %q", textDeltas[1].Payload["content"], " from Claude!")
	}
	for i, td := range textDeltas {
		if td.Payload["provider"] != "anthropic" {
			t.Errorf("text_delta[%d] provider = %q, want %q", i, td.Payload["provider"], "anthropic")
		}
	}

	// 4. Verify text_block event (from content_block_stop, accumulates text deltas).
	textBlocks := emitter.eventsOfType(BusEventTextBlock)
	if len(textBlocks) != 1 {
		t.Fatalf("expected 1 text_block event, got %d", len(textBlocks))
	}
	tb := textBlocks[0]
	expectedText := "Hello from Claude!"
	if tb.Payload["content"] != expectedText {
		t.Errorf("text_block content = %q, want %q", tb.Payload["content"], expectedText)
	}
	if tb.Payload["provider"] != "anthropic" {
		t.Errorf("text_block provider = %q, want %q", tb.Payload["provider"], "anthropic")
	}

	// 5. Verify context_usage event (from message_stop).
	contextUsages := emitter.eventsOfType(BusEventContextUsage)
	if len(contextUsages) != 1 {
		t.Fatalf("expected 1 context_usage event, got %d", len(contextUsages))
	}
	cu := contextUsages[0]
	if cu.Payload["inputTokens"] != int64(52) {
		t.Errorf("context_usage inputTokens = %v (%T), want 52", cu.Payload["inputTokens"], cu.Payload["inputTokens"])
	}
	if cu.Payload["outputTokens"] != int64(12) {
		t.Errorf("context_usage outputTokens = %v (%T), want 12", cu.Payload["outputTokens"], cu.Payload["outputTokens"])
	}
	if cu.Payload["model"] != model {
		t.Errorf("context_usage model = %q, want %q", cu.Payload["model"], model)
	}

	// 6. Verify result event (from message_stop).
	results := emitter.eventsOfType(BusEventResult)
	if len(results) != 1 {
		t.Fatalf("expected 1 result event, got %d", len(results))
	}
	r := results[0]
	if r.Payload["success"] != true {
		t.Errorf("result success = %v, want true", r.Payload["success"])
	}
	if r.Payload["terminalReason"] != "completed" {
		t.Errorf("result terminalReason = %q, want %q", r.Payload["terminalReason"], "completed")
	}
	if r.Payload["provider"] != "anthropic" {
		t.Errorf("result provider = %q, want %q", r.Payload["provider"], "anthropic")
	}

	// 7. Verify total event count.
	// Expected: 1 status_change + 2 text_delta + 1 text_block + 1 context_usage + 1 result = 6
	expectedCount := 6
	if len(emitter.events) != expectedCount {
		t.Errorf("total events = %d, want %d. Events:\n", len(emitter.events), expectedCount)
		for i, ev := range emitter.events {
			t.Logf("  [%d] %s: %v", i, ev.EventType, ev.Payload)
		}
	}

	// 8. Verify all events carry the correct scope.
	for i, ev := range emitter.events {
		if ev.Scope["projectId"] != "proj-test" {
			t.Errorf("event[%d] %s scope.projectId = %q, want %q", i, ev.EventType, ev.Scope["projectId"], "proj-test")
		}
		if ev.Scope["threadId"] != "thr-test" {
			t.Errorf("event[%d] %s scope.threadId = %q, want %q", i, ev.EventType, ev.Scope["threadId"], "thr-test")
		}
		if ev.Scope["runId"] != "run-test" {
			t.Errorf("event[%d] %s scope.runId = %q, want %q", i, ev.EventType, ev.Scope["runId"], "run-test")
		}
	}
}

// TestAnthropicSDK_E2E_SSEStream_WithThinking verifies that the adapter correctly
// handles a stream that includes thinking blocks (extended thinking mode).
func TestAnthropicSDK_E2E_SSEStream_WithThinking(t *testing.T) {
	sseBody := joinLines(
		"event: message_start",
		`data: {"type":"message_start","message":{"id":"msg_think_01","type":"message","role":"assistant","model":"claude-sonnet-4-6-20250514","content":[],"usage":{"input_tokens":40}}}`,
		"",
		// Thinking block
		"event: content_block_start",
		`data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}`,
		"",
		"event: content_block_delta",
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think about this..."}}`,
		"",
		"event: content_block_stop",
		`data: {"type":"content_block_stop","index":0}`,
		"",
		// Text block
		"event: content_block_start",
		`data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`,
		"",
		"event: content_block_delta",
		`data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"The answer is 42."}}`,
		"",
		"event: content_block_stop",
		`data: {"type":"content_block_stop","index":1}`,
		"",
		"event: message_delta",
		`data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":25}}`,
		"",
		"event: message_stop",
		`data: {"type":"message_stop"}`,
		"",
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(sseBody))
	}))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("failed to GET mock server: %v", err)
	}
	defer resp.Body.Close()

	adapter := &AnthropicSDKAdapter{
		apiKey:     "test-key-not-used",
		baseURL:    "https://api.anthropic.com",
		model:      "claude-sonnet-4-6-20250514",
		maxTokens:  16384,
		available:  true,
		httpClient: &http.Client{},
	}

	emitter := &testEventEmitter{}
	scope := map[string]any{
		"projectId": "proj-test",
		"threadId":  "thr-test",
		"runId":     "run-test",
	}

	ctx := context.Background()
	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, "claude-sonnet-4-6-20250514")
	if err != nil {
		t.Fatalf("parseSSEStream returned error: %v", err)
	}

	// Verify thinking events.
	thinkingEvents := emitter.eventsOfType(BusEventThinking)
	if len(thinkingEvents) < 2 {
		t.Fatalf("expected at least 2 thinking events (start + delta), got %d", len(thinkingEvents))
	}
	// First thinking event: content_block_start → status "started"
	if thinkingEvents[0].Payload["status"] != "started" {
		t.Errorf("thinking[0] status = %q, want %q", thinkingEvents[0].Payload["status"], "started")
	}
	// Second thinking event: thinking_delta with content
	if thinkingEvents[1].Payload["content"] != "Let me think about this..." {
		t.Errorf("thinking[1] content = %q, want %q", thinkingEvents[1].Payload["content"], "Let me think about this...")
	}

	// Verify text still works after thinking.
	textBlocks := emitter.eventsOfType(BusEventTextBlock)
	if len(textBlocks) != 1 {
		t.Fatalf("expected 1 text_block after thinking, got %d", len(textBlocks))
	}
	if textBlocks[0].Payload["content"] != "The answer is 42." {
		t.Errorf("text_block content = %q, want %q", textBlocks[0].Payload["content"], "The answer is 42.")
	}

	// Verify final result still emitted.
	results := emitter.eventsOfType(BusEventResult)
	if len(results) != 1 {
		t.Fatalf("expected 1 result event, got %d", len(results))
	}
	if results[0].Payload["success"] != true {
		t.Errorf("result success = %v, want true", results[0].Payload["success"])
	}
}

// joinLines joins strings with newlines and appends a trailing newline.
func joinLines(lines ...string) string {
	return strings.Join(lines, "\n") + "\n"
}

// TestAnthropicSDK_E2E_SSEStream_MultiBlock verifies correct handling of multiple
// text blocks (simulating multi-turn or multi-content responses).
func TestAnthropicSDK_E2E_SSEStream_MultiBlock(t *testing.T) {
	sseBody := joinLines(
		"event: message_start",
		`data: {"type":"message_start","message":{"id":"msg_multi","type":"message","role":"assistant","model":"claude-sonnet-4-6-20250514","content":[],"usage":{"input_tokens":30}}}`,
		"",
		// Block 0: text
		"event: content_block_start",
		`data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
		"",
		"event: content_block_delta",
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"First block."}}`,
		"",
		"event: content_block_stop",
		`data: {"type":"content_block_stop","index":0}`,
		"",
		// Block 1: text
		"event: content_block_start",
		`data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`,
		"",
		"event: content_block_delta",
		`data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Second block."}}`,
		"",
		"event: content_block_stop",
		`data: {"type":"content_block_stop","index":1}`,
		"",
		"event: message_delta",
		`data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":8}}`,
		"",
		"event: message_stop",
		`data: {"type":"message_stop"}`,
		"",
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(sseBody))
	}))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("failed to GET mock server: %v", err)
	}
	defer resp.Body.Close()

	adapter := &AnthropicSDKAdapter{
		apiKey:     "test-key-not-used",
		model:      "claude-sonnet-4-6-20250514",
		maxTokens:  16384,
		available:  true,
		httpClient: &http.Client{},
	}

	emitter := &testEventEmitter{}
	scope := map[string]any{
		"projectId": "proj-test",
		"threadId":  "thr-test",
		"runId":     "run-test",
	}

	ctx := context.Background()
	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, "claude-sonnet-4-6-20250514")
	if err != nil {
		t.Fatalf("parseSSEStream returned error: %v", err)
	}

	// Two text_delta events (one per block).
	textDeltas := emitter.eventsOfType(BusEventTextDelta)
	if len(textDeltas) != 2 {
		t.Fatalf("expected 2 text_delta events, got %d", len(textDeltas))
	}

	// Two text_block events (one per block).
	textBlocks := emitter.eventsOfType(BusEventTextBlock)
	if len(textBlocks) != 2 {
		t.Fatalf("expected 2 text_block events, got %d", len(textBlocks))
	}
	if textBlocks[0].Payload["content"] != "First block." {
		t.Errorf("text_block[0] = %q, want %q", textBlocks[0].Payload["content"], "First block.")
	}
	if textBlocks[1].Payload["content"] != "Second block." {
		t.Errorf("text_block[1] = %q, want %q", textBlocks[1].Payload["content"], "Second block.")
	}

	// Verify blocks are independent (accumulator resets between blocks).
}

// TestAnthropicSDK_E2E_SSEStream_ContextCancellation verifies that parseSSEStream
// returns early when the context is cancelled mid-stream.
func TestAnthropicSDK_E2E_SSEStream_ContextCancellation(t *testing.T) {
	sseBody := joinLines(
		"event: message_start",
		`data: {"type":"message_start","message":{"id":"msg_cancel","type":"message","role":"assistant","model":"claude-sonnet-4-6-20250514","content":[],"usage":{"input_tokens":10}}}`,
		"",
		"event: content_block_start",
		`data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
		"",
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(sseBody))
	}))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("failed to GET mock server: %v", err)
	}
	defer resp.Body.Close()

	adapter := &AnthropicSDKAdapter{apiKey: "test", maxTokens: 16384, available: true}
	emitter := &testEventEmitter{}
	scope := map[string]any{"projectId": "p", "threadId": "t", "runId": "r"}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately before parsing

	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, "claude-sonnet-4-6-20250514")
	if err == nil {
		t.Error("expected context cancellation error, got nil")
	}
	if err != context.Canceled {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}

// TestAnthropicSDK_E2E_SSEStream_EmptyStream verifies graceful handling of an
// empty stream (no data lines).
func TestAnthropicSDK_E2E_SSEStream_EmptyStream(t *testing.T) {
	// SSE body with only comments and blank lines — no data lines.
	sseBody := joinLines(
		"event: message_start",
		"",
		"event: message_stop",
		"",
		// Note: no "data:" lines, so no events will be emitted.
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(sseBody))
	}))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("failed to GET mock server: %v", err)
	}
	defer resp.Body.Close()

	adapter := &AnthropicSDKAdapter{apiKey: "test", maxTokens: 16384, available: true}
	emitter := &testEventEmitter{}
	scope := map[string]any{"projectId": "p", "threadId": "t", "runId": "r"}

	ctx := context.Background()
	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, "claude-sonnet-4-6-20250514")
	if err != nil {
		t.Fatalf("parseSSEStream returned unexpected error: %v", err)
	}
	if len(emitter.events) != 0 {
		t.Errorf("expected 0 events from empty stream, got %d", len(emitter.events))
	}
}

// TestAnthropicSDK_E2E_SSEStream_ErrorEvent verifies that an error SSE event
// results in a non-recoverable parse error and a failure result event.
func TestAnthropicSDK_E2E_SSEStream_ErrorEvent(t *testing.T) {
	sseBody := joinLines(
		"event: error",
		`data: {"type":"error","error":{"type":"invalid_request_error","message":"Invalid API key"}}`,
		"",
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(sseBody))
	}))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("failed to GET mock server: %v", err)
	}
	defer resp.Body.Close()

	adapter := &AnthropicSDKAdapter{apiKey: "test", maxTokens: 16384, available: true}
	emitter := &testEventEmitter{}
	scope := map[string]any{"projectId": "p", "threadId": "t", "runId": "r"}

	ctx := context.Background()
	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, "claude-sonnet-4-6-20250514")
	if err == nil {
		t.Fatal("expected error from SSE error event, got nil")
	}

	// Verify the error was emitted as a result event.
	results := emitter.eventsOfType(BusEventResult)
	if len(results) != 1 {
		t.Fatalf("expected 1 result event from error, got %d", len(results))
	}
	r := results[0]
	if r.Payload["success"] != false {
		t.Errorf("result success = %v, want false", r.Payload["success"])
	}
	if r.Payload["terminalReason"] != "error" {
		t.Errorf("result terminalReason = %q, want %q", r.Payload["terminalReason"], "error")
	}
	if r.Payload["error"] != "Invalid API key" {
		t.Errorf("result error = %q, want %q", r.Payload["error"], "Invalid API key")
	}
}

// TestAnthropicSDK_E2E_SSEStream_MalformedJSON verifies that malformed JSON
// data lines are silently skipped (logged at debug level) without failing.
func TestAnthropicSDK_E2E_SSEStream_MalformedJSON(t *testing.T) {
	sseBody := joinLines(
		"event: message_start",
		`data: {"type":"message_start","message":{"id":"msg_mal","type":"message","role":"assistant","model":"claude-sonnet-4-6-20250514","content":[],"usage":{"input_tokens":10}}}`,
		"",
		// Malformed JSON line — should be skipped.
		`data: {this is not valid json}`,
		"",
		"event: content_block_start",
		`data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
		"",
		"event: content_block_delta",
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Still works."}}`,
		"",
		"event: content_block_stop",
		`data: {"type":"content_block_stop","index":0}`,
		"",
		"event: message_delta",
		`data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}`,
		"",
		"event: message_stop",
		`data: {"type":"message_stop"}`,
		"",
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(sseBody))
	}))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("failed to GET mock server: %v", err)
	}
	defer resp.Body.Close()

	adapter := &AnthropicSDKAdapter{apiKey: "test", maxTokens: 16384, available: true}
	emitter := &testEventEmitter{}
	scope := map[string]any{"projectId": "p", "threadId": "t", "runId": "r"}

	ctx := context.Background()
	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, "claude-sonnet-4-6-20250514")
	if err != nil {
		t.Fatalf("parseSSEStream should not fail on malformed JSON: %v", err)
	}

	// Malformed line is skipped; valid events still processed.
	textDeltas := emitter.eventsOfType(BusEventTextDelta)
	if len(textDeltas) != 1 {
		t.Errorf("expected 1 text_delta despite malformed line, got %d", len(textDeltas))
	}
	textBlocks := emitter.eventsOfType(BusEventTextBlock)
	if len(textBlocks) != 1 {
		t.Errorf("expected 1 text_block despite malformed line, got %d", len(textBlocks))
	}
	if textBlocks[0].Payload["content"] != "Still works." {
		t.Errorf("text_block content = %q, want %q", textBlocks[0].Payload["content"], "Still works.")
	}

	// Verify the stream completed successfully.
	results := emitter.eventsOfType(BusEventResult)
	if len(results) != 1 {
		t.Fatalf("expected 1 result event, got %d", len(results))
	}
	if results[0].Payload["success"] != true {
		t.Errorf("stream should have completed successfully despite malformed line")
	}
}

// TestAnthropicSDK_BuildMessages_SanitizesHistoryAndPrompt verifies that
// buildMessages passes history messages and the current prompt through
// runnerctx.SanitizeMessage (control chars stripped, invalid roles filtered),
// locking the sanitize semantics that the openai-sdk twin mirrors (#1349).
func TestAnthropicSDK_BuildMessages_SanitizesHistoryAndPrompt(t *testing.T) {
	adapter := &AnthropicSDKAdapter{
		model:      "claude-sonnet-4-6",
		available:  true,
		httpClient: &http.Client{},
	}

	ctx := runnerctx.RunProcessContext{
		Messages: []runnerctx.Message{
			{Role: "user", Content: "Hello\x00World\x1b[31m"},
			{Role: "hacker", Content: "Injected role"}, // invalid → "system" → dropped
		},
		Prompt: "Run\x07this",
	}

	messages := adapter.buildMessages(ctx)

	// user history + current prompt; the invalid-role message is filtered to
	// "system" by SanitizeMessage and skipped.
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages (sanitized history + prompt), got %d", len(messages))
	}
	if messages[0].Role != "user" || messages[0].Content != "HelloWorld[31m" {
		t.Errorf("history message = %q/%q, want user/%q",
			messages[0].Role, messages[0].Content, "HelloWorld[31m")
	}
	if messages[1].Role != "user" || messages[1].Content != "Runthis" {
		t.Errorf("prompt message = %q/%q, want user/%q",
			messages[1].Role, messages[1].Content, "Runthis")
	}
}

// Ensure testEventEmitter implements EventEmitter at compile time.
var _ EventEmitter = (*testEventEmitter)(nil)
