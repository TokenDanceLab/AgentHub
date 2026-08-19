package sdk

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// =============================================================================
// OpenAI SDK E2E SSE stream behavioral tests
// =============================================================================
//
// These tests exercise parseSSEStream with real HTTP transport (httptest.NewServer)
// and realistic OpenAI Chat Completions streaming fixture data.
//
// The OpenAI SSE format differs from Anthropic's:
//   - Lines are "data: <json>" (no "event:" prefix)
//   - Stream ends with "data: [DONE]"
//   - Each JSON chunk is an openaiChatChunk with choices[].delta
//   - No explicit error events in-stream; errors surface as HTTP status codes
//
// Shared helpers (from anthropic_sdk_e2e_test.go):
//   - testEventEmitter, testEvent, eventsOfType, joinLines
//   - compile-time check: var _ EventEmitter = (*testEventEmitter)(nil)

// TestOpenAISDK_E2E_SSEStream verifies the full stream lifecycle:
//
//	text_delta x2 → text_block → context_usage → result
func TestOpenAISDK_E2E_SSEStream(t *testing.T) {
	// Realistic OpenAI Chat Completions streaming response.
	// Reference: https://platform.openai.com/docs/api-reference/chat/streaming
	sseBody := joinLines(
		// First chunk: role + first text token
		`data: {"id":"chatcmpl-AbCdEfGhIjKlMnOpQrStUv","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}`,
		// Second chunk: more text
		`data: {"id":"chatcmpl-AbCdEfGhIjKlMnOpQrStUv","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[{"index":0,"delta":{"content":" from OpenAI!"},"finish_reason":null}]}`,
		// Third chunk: finish + usage
		`data: {"id":"chatcmpl-AbCdEfGhIjKlMnOpQrStUv","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":15,"completion_tokens":8,"total_tokens":23}}`,
		// Stream end marker
		`data: [DONE]`,
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

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("mock server returned %d, want 200", resp.StatusCode)
	}

	adapter := &OpenAISDKAdapter{
		apiKey:     "test-key-not-used",
		baseURL:    "https://api.openai.com",
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}

	emitter := &testEventEmitter{}
	scope := map[string]any{
		"projectId": "proj-test",
		"threadId":  "thr-test",
		"runId":     "run-test",
	}
	model := "gpt-5.5"

	ctx := context.Background()
	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, model)
	if err != nil {
		t.Fatalf("parseSSEStream returned error: %v", err)
	}

	// 1. Verify we got events.
	if len(emitter.events) == 0 {
		t.Fatal("expected at least one event, got none")
	}

	// 2. Verify text_delta events.
	textDeltas := emitter.eventsOfType(BusEventTextDelta)
	if len(textDeltas) != 2 {
		t.Fatalf("expected 2 text_delta events, got %d", len(textDeltas))
	}
	if textDeltas[0].Payload["content"] != "Hello" {
		t.Errorf("text_delta[0] content = %q, want %q", textDeltas[0].Payload["content"], "Hello")
	}
	if textDeltas[1].Payload["content"] != " from OpenAI!" {
		t.Errorf("text_delta[1] content = %q, want %q", textDeltas[1].Payload["content"], " from OpenAI!")
	}
	for i, td := range textDeltas {
		if td.Payload["provider"] != "openai" {
			t.Errorf("text_delta[%d] provider = %q, want %q", i, td.Payload["provider"], "openai")
		}
	}

	// 3. Verify text_block event (accumulated from all deltas).
	textBlocks := emitter.eventsOfType(BusEventTextBlock)
	if len(textBlocks) != 1 {
		t.Fatalf("expected 1 text_block event, got %d", len(textBlocks))
	}
	expectedText := "Hello from OpenAI!"
	if textBlocks[0].Payload["content"] != expectedText {
		t.Errorf("text_block content = %q, want %q", textBlocks[0].Payload["content"], expectedText)
	}
	if textBlocks[0].Payload["provider"] != "openai" {
		t.Errorf("text_block provider = %q, want %q", textBlocks[0].Payload["provider"], "openai")
	}

	// 4. Verify context_usage event.
	contextUsages := emitter.eventsOfType(BusEventContextUsage)
	if len(contextUsages) != 1 {
		t.Fatalf("expected 1 context_usage event, got %d", len(contextUsages))
	}
	cu := contextUsages[0]
	if cu.Payload["inputTokens"] != int64(15) {
		t.Errorf("context_usage inputTokens = %v (%T), want 15", cu.Payload["inputTokens"], cu.Payload["inputTokens"])
	}
	if cu.Payload["outputTokens"] != int64(8) {
		t.Errorf("context_usage outputTokens = %v (%T), want 8", cu.Payload["outputTokens"], cu.Payload["outputTokens"])
	}
	if cu.Payload["model"] != model {
		t.Errorf("context_usage model = %q, want %q", cu.Payload["model"], model)
	}

	// 5. Verify result event.
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
	if r.Payload["provider"] != "openai" {
		t.Errorf("result provider = %q, want %q", r.Payload["provider"], "openai")
	}
	if r.Payload["finishReason"] != "stop" {
		t.Errorf("result finishReason = %q, want %q", r.Payload["finishReason"], "stop")
	}
	if r.Payload["model"] != model {
		t.Errorf("result model = %q, want %q", r.Payload["model"], model)
	}

	// 6. Verify total event count: 2 text_delta + 1 text_block + 1 context_usage + 1 result = 5.
	// Note: OpenAI adapter does NOT emit status_change in parseSSEStream (session_init is in ParseStream).
	expectedCount := 5
	if len(emitter.events) != expectedCount {
		t.Errorf("total events = %d, want %d. Events:\n", len(emitter.events), expectedCount)
		for i, ev := range emitter.events {
			t.Logf("  [%d] %s: %v", i, ev.EventType, ev.Payload)
		}
	}

	// 7. Verify all events carry the correct scope.
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

// TestOpenAISDK_E2E_SSEStream_WithReasoning verifies handling of reasoning/thinking
// content emitted by o-series models (e.g., o3, o4-mini) via reasoning_content delta.
func TestOpenAISDK_E2E_SSEStream_WithReasoning(t *testing.T) {
	sseBody := joinLines(
		// Reasoning chunk
		`data: {"id":"chatcmpl-reason-01","object":"chat.completion.chunk","created":1719000000,"model":"o3","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"Let me analyze this problem step by step."},"finish_reason":null}]}`,
		// More reasoning
		`data: {"id":"chatcmpl-reason-01","object":"chat.completion.chunk","created":1719000000,"model":"o3","choices":[{"index":0,"delta":{"reasoning_content":" First, I need to understand the constraints."},"finish_reason":null}]}`,
		// Transition to visible content
		`data: {"id":"chatcmpl-reason-01","object":"chat.completion.chunk","created":1719000000,"model":"o3","choices":[{"index":0,"delta":{"content":"The answer is 42."},"finish_reason":null}]}`,
		// Finish
		`data: {"id":"chatcmpl-reason-01","object":"chat.completion.chunk","created":1719000000,"model":"o3","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":50,"completion_tokens":30,"total_tokens":80}}`,
		`data: [DONE]`,
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

	adapter := &OpenAISDKAdapter{
		apiKey:     "test-key-not-used",
		model:      "o3",
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
	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, "o3")
	if err != nil {
		t.Fatalf("parseSSEStream returned error: %v", err)
	}

	// Verify thinking events from reasoning_content.
	thinkingEvents := emitter.eventsOfType(BusEventThinking)
	if len(thinkingEvents) != 2 {
		t.Fatalf("expected 2 thinking events from reasoning_content, got %d", len(thinkingEvents))
	}
	if thinkingEvents[0].Payload["content"] != "Let me analyze this problem step by step." {
		t.Errorf("thinking[0] content = %q, want %q",
			thinkingEvents[0].Payload["content"], "Let me analyze this problem step by step.")
	}
	if thinkingEvents[1].Payload["content"] != " First, I need to understand the constraints." {
		t.Errorf("thinking[1] content = %q, want %q",
			thinkingEvents[1].Payload["content"], " First, I need to understand the constraints.")
	}
	for i, te := range thinkingEvents {
		if te.Payload["provider"] != "openai" {
			t.Errorf("thinking[%d] provider = %q, want %q", i, te.Payload["provider"], "openai")
		}
	}

	// Verify text still works after reasoning.
	textBlocks := emitter.eventsOfType(BusEventTextBlock)
	if len(textBlocks) != 1 {
		t.Fatalf("expected 1 text_block after reasoning, got %d", len(textBlocks))
	}
	if textBlocks[0].Payload["content"] != "The answer is 42." {
		t.Errorf("text_block content = %q, want %q", textBlocks[0].Payload["content"], "The answer is 42.")
	}

	// Verify final result.
	results := emitter.eventsOfType(BusEventResult)
	if len(results) != 1 {
		t.Fatalf("expected 1 result event, got %d", len(results))
	}
	if results[0].Payload["success"] != true {
		t.Errorf("result success = %v, want true", results[0].Payload["success"])
	}
}

// TestOpenAISDK_E2E_SSEStream_WithToolCalls verifies correct handling of
// streaming tool call deltas (accumulated across multiple chunks).
func TestOpenAISDK_E2E_SSEStream_WithToolCalls(t *testing.T) {
	sseBody := joinLines(
		// Chunk 1: tool call ID + name
		`data: {"id":"chatcmpl-tool-01","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_AbCdEfGh","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}`,
		// Chunk 2: first argument fragment
		`data: {"id":"chatcmpl-tool-01","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"city\":"}}]},"finish_reason":null}]}`,
		// Chunk 3: second argument fragment
		`data: {"id":"chatcmpl-tool-01","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"Tokyo\"}"}}]},"finish_reason":null}]}`,
		// Chunk 4: finish
		`data: {"id":"chatcmpl-tool-01","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":20,"completion_tokens":15,"total_tokens":35}}`,
		`data: [DONE]`,
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

	adapter := &OpenAISDKAdapter{
		apiKey:     "test-key-not-used",
		model:      "gpt-5.5",
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
	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, "gpt-5.5")
	if err != nil {
		t.Fatalf("parseSSEStream returned error: %v", err)
	}

	// Verify no text deltas (pure tool call stream).
	textDeltas := emitter.eventsOfType(BusEventTextDelta)
	if len(textDeltas) != 0 {
		t.Errorf("expected 0 text_delta events for tool-only stream, got %d", len(textDeltas))
	}

	// Verify no text block (no text content).
	textBlocks := emitter.eventsOfType(BusEventTextBlock)
	if len(textBlocks) != 0 {
		t.Errorf("expected 0 text_block events for tool-only stream, got %d", len(textBlocks))
	}

	// Verify tool call event with accumulated arguments.
	toolCalls := emitter.eventsOfType(BusEventToolCall)
	if len(toolCalls) != 1 {
		t.Fatalf("expected 1 tool_call event, got %d", len(toolCalls))
	}
	tc := toolCalls[0]
	if tc.Payload["callId"] != "call_AbCdEfGh" {
		t.Errorf("tool_call callId = %q, want %q", tc.Payload["callId"], "call_AbCdEfGh")
	}
	if tc.Payload["toolName"] != "get_weather" {
		t.Errorf("tool_call toolName = %q, want %q", tc.Payload["toolName"], "get_weather")
	}
	if tc.Payload["status"] != "pending" {
		t.Errorf("tool_call status = %q, want %q", tc.Payload["status"], "pending")
	}
	if tc.Payload["provider"] != "openai" {
		t.Errorf("tool_call provider = %q, want %q", tc.Payload["provider"], "openai")
	}
	// Verify input was parsed from accumulated JSON fragments.
	input, ok := tc.Payload["input"].(map[string]any)
	if !ok {
		t.Fatalf("tool_call input is not map[string]any, got %T", tc.Payload["input"])
	}
	if input["city"] != "Tokyo" {
		t.Errorf("tool_call input.city = %q, want %q", input["city"], "Tokyo")
	}

	// Verify finish reason reflects tool_calls.
	results := emitter.eventsOfType(BusEventResult)
	if len(results) != 1 {
		t.Fatalf("expected 1 result event, got %d", len(results))
	}
	if results[0].Payload["finishReason"] != "tool_calls" {
		t.Errorf("result finishReason = %q, want %q", results[0].Payload["finishReason"], "tool_calls")
	}
	if results[0].Payload["success"] != true {
		t.Errorf("result success = %v, want true", results[0].Payload["success"])
	}

	// Verify total count: 1 tool_call + 1 context_usage + 1 result = 3.
	expectedCount := 3
	if len(emitter.events) != expectedCount {
		t.Errorf("total events = %d, want %d. Events:\n", len(emitter.events), expectedCount)
		for i, ev := range emitter.events {
			t.Logf("  [%d] %s: %v", i, ev.EventType, ev.Payload)
		}
	}
}

// TestOpenAISDK_E2E_SSEStream_UsageOnlyChunk verifies that usage-only chunks
// (with stream_options include_usage) are handled correctly — they update
// token counts without emitting text events.
func TestOpenAISDK_E2E_SSEStream_UsageOnlyChunk(t *testing.T) {
	sseBody := joinLines(
		// First text chunk
		`data: {"id":"chatcmpl-usage-01","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[{"index":0,"delta":{"role":"assistant","content":"Short reply."},"finish_reason":null}]}`,
		// Usage-only chunk (no choices — from stream_options: {include_usage: true})
		`data: {"id":"chatcmpl-usage-01","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`,
		// Final chunk with finish
		`data: {"id":"chatcmpl-usage-01","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`,
		`data: [DONE]`,
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

	adapter := &OpenAISDKAdapter{
		apiKey:     "test-key-not-used",
		model:      "gpt-5.5",
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
	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, "gpt-5.5")
	if err != nil {
		t.Fatalf("parseSSEStream returned error: %v", err)
	}

	// Usage-only chunk should not create extra text deltas.
	textDeltas := emitter.eventsOfType(BusEventTextDelta)
	if len(textDeltas) != 1 {
		t.Fatalf("expected 1 text_delta (usage-only chunk should not emit), got %d", len(textDeltas))
	}
	if textDeltas[0].Payload["content"] != "Short reply." {
		t.Errorf("text_delta content = %q, want %q", textDeltas[0].Payload["content"], "Short reply.")
	}

	// Token counts should reflect the usage-only chunk.
	cu := emitter.eventsOfType(BusEventContextUsage)
	if len(cu) != 1 {
		t.Fatalf("expected 1 context_usage event, got %d", len(cu))
	}
	if cu[0].Payload["inputTokens"] != int64(10) {
		t.Errorf("context_usage inputTokens = %v, want 10", cu[0].Payload["inputTokens"])
	}
	if cu[0].Payload["outputTokens"] != int64(5) {
		t.Errorf("context_usage outputTokens = %v, want 5", cu[0].Payload["outputTokens"])
	}

	// Result should still be successful.
	results := emitter.eventsOfType(BusEventResult)
	if len(results) != 1 {
		t.Fatalf("expected 1 result event, got %d", len(results))
	}
	if results[0].Payload["success"] != true {
		t.Errorf("result success = %v, want true", results[0].Payload["success"])
	}
}

// TestOpenAISDK_E2E_SSEStream_EmptyStream verifies that an empty stream
// (no data lines, or only comments/blank lines) produces no events.
func TestOpenAISDK_E2E_SSEStream_EmptyStream(t *testing.T) {
	// SSE body with no valid data: lines — only blank lines and non-data lines.
	sseBody := joinLines(
		// Blank line
		// Comment-like line (not "data:" prefixed)
		`: this is an SSE comment`,
		// Another blank
		// Note: no "data:" lines at all
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

	adapter := &OpenAISDKAdapter{
		apiKey:     "test-key-not-used",
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}
	emitter := &testEventEmitter{}
	scope := map[string]any{"projectId": "p", "threadId": "t", "runId": "r"}

	ctx := context.Background()
	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, "gpt-5.5")
	if err != nil {
		t.Fatalf("parseSSEStream returned unexpected error: %v", err)
	}

	// Empty stream should produce 3 events: context_usage (all zeros) + result.
	// Because parseSSEStream ALWAYS emits context_usage and result after the loop,
	// even with no data. This is a behavioral difference from Anthropic adapter.
	if len(emitter.events) != 2 {
		t.Errorf("expected 2 events (context_usage + result) from empty stream, got %d", len(emitter.events))
		for i, ev := range emitter.events {
			t.Logf("  [%d] %s: %v", i, ev.EventType, ev.Payload)
		}
	}

	// context_usage should report zero tokens.
	cu := emitter.eventsOfType(BusEventContextUsage)
	if len(cu) == 1 {
		if cu[0].Payload["inputTokens"] != int64(0) {
			t.Errorf("context_usage inputTokens = %v, want 0", cu[0].Payload["inputTokens"])
		}
	}

	// result should still report success (empty response is not an error).
	results := emitter.eventsOfType(BusEventResult)
	if len(results) == 1 {
		if results[0].Payload["success"] != true {
			t.Errorf("result success = %v, want true (empty stream is not an error)", results[0].Payload["success"])
		}
	}
}

// TestOpenAISDK_E2E_SSEStream_ContextCancellation verifies that parseSSEStream
// returns early with context.Canceled when the context is cancelled mid-stream.
func TestOpenAISDK_E2E_SSEStream_ContextCancellation(t *testing.T) {
	// Provide enough data so the scanner can read at least one line before cancellation.
	sseBody := joinLines(
		`data: {"id":"chatcmpl-cancel-01","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}`,
		// More data that won't be processed because context is cancelled.
		`data: {"id":"chatcmpl-cancel-01","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}`,
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

	adapter := &OpenAISDKAdapter{
		apiKey:     "test-key-not-used",
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}
	emitter := &testEventEmitter{}
	scope := map[string]any{"projectId": "p", "threadId": "t", "runId": "r"}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately before parsing

	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, "gpt-5.5")
	if err == nil {
		t.Error("expected context cancellation error, got nil")
	}
	if err != context.Canceled {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}

// TestOpenAISDK_E2E_SSEStream_MalformedJSON verifies that malformed JSON
// data lines are silently skipped (via debug log) without failing the stream.
func TestOpenAISDK_E2E_SSEStream_MalformedJSON(t *testing.T) {
	sseBody := joinLines(
		// Valid first chunk
		`data: {"id":"chatcmpl-mal-01","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[{"index":0,"delta":{"role":"assistant","content":"Valid start."},"finish_reason":null}]}`,
		// Malformed JSON — should be skipped silently.
		`data: {this is not valid json at all!!!}`,
		// Valid second chunk after malformed line.
		`data: {"id":"chatcmpl-mal-01","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[{"index":0,"delta":{"content":" Still works."},"finish_reason":null}]}`,
		// Finish
		`data: {"id":"chatcmpl-mal-01","object":"chat.completion.chunk","created":1719000000,"model":"gpt-5.5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":4,"total_tokens":9}}`,
		`data: [DONE]`,
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

	adapter := &OpenAISDKAdapter{
		apiKey:     "test-key-not-used",
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}
	emitter := &testEventEmitter{}
	scope := map[string]any{"projectId": "p", "threadId": "t", "runId": "r"}

	ctx := context.Background()
	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, "gpt-5.5")
	if err != nil {
		t.Fatalf("parseSSEStream should not fail on malformed JSON: %v", err)
	}

	// Malformed line is skipped; valid events still processed.
	textDeltas := emitter.eventsOfType(BusEventTextDelta)
	if len(textDeltas) != 2 {
		t.Errorf("expected 2 text_deltas despite malformed line, got %d", len(textDeltas))
	}

	textBlocks := emitter.eventsOfType(BusEventTextBlock)
	if len(textBlocks) != 1 {
		t.Fatalf("expected 1 text_block despite malformed line, got %d", len(textBlocks))
	}
	if textBlocks[0].Payload["content"] != "Valid start. Still works." {
		t.Errorf("text_block content = %q, want %q", textBlocks[0].Payload["content"], "Valid start. Still works.")
	}

	// Verify stream completed successfully.
	results := emitter.eventsOfType(BusEventResult)
	if len(results) != 1 {
		t.Fatalf("expected 1 result event, got %d", len(results))
	}
	if results[0].Payload["success"] != true {
		t.Errorf("stream should have completed successfully despite malformed line")
	}
}

// TestOpenAISDK_E2E_SSEStream_EarlyDone verifies that a stream ending with
// [DONE] before any text content is handled gracefully.
func TestOpenAISDK_E2E_SSEStream_EarlyDone(t *testing.T) {
	sseBody := joinLines(
		`data: [DONE]`,
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

	adapter := &OpenAISDKAdapter{
		apiKey:     "test-key-not-used",
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}
	emitter := &testEventEmitter{}
	scope := map[string]any{"projectId": "p", "threadId": "t", "runId": "r"}

	ctx := context.Background()
	err = adapter.parseSSEStream(ctx, resp.Body, emitter, scope, "gpt-5.5")
	if err != nil {
		t.Fatalf("parseSSEStream returned unexpected error: %v", err)
	}

	// [DONE] immediately — no text, no usage. But context_usage + result always emitted.
	cu := emitter.eventsOfType(BusEventContextUsage)
	if len(cu) != 1 {
		t.Errorf("expected 1 context_usage even for early [DONE], got %d", len(cu))
	}
	results := emitter.eventsOfType(BusEventResult)
	if len(results) != 1 {
		t.Fatalf("expected 1 result event, got %d", len(results))
	}
	if results[0].Payload["success"] != true {
		t.Errorf("result success = %v, want true", results[0].Payload["success"])
	}
}

// =============================================================================
// buildMessages tests
// =============================================================================

// TestOpenAISDK_BuildMessages_SimpleConversion verifies basic message conversion
// from RunProcessContext to OpenAI Chat Completions message array format.
func TestOpenAISDK_BuildMessages_SimpleConversion(t *testing.T) {
	adapter := &OpenAISDKAdapter{
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}

	ctx := runnerctx.RunProcessContext{
		SystemPrompt: "You are a helpful assistant.",
		Prompt:       "What is the capital of France?",
	}

	messages := adapter.buildMessages(ctx)

	// Should have system + user message = 2 messages.
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(messages))
	}

	// First message: system.
	if messages[0].Role != "system" {
		t.Errorf("messages[0].Role = %q, want %q", messages[0].Role, "system")
	}
	if messages[0].Content != "You are a helpful assistant." {
		t.Errorf("messages[0].Content = %q, want %q", messages[0].Content, "You are a helpful assistant.")
	}

	// Second message: user.
	if messages[1].Role != "user" {
		t.Errorf("messages[1].Role = %q, want %q", messages[1].Role, "user")
	}
	if messages[1].Content != "What is the capital of France?" {
		t.Errorf("messages[1].Content = %q, want %q", messages[1].Content, "What is the capital of France?")
	}
}

// TestOpenAISDK_BuildMessages_SystemPromptCombined verifies that
// SystemPrompt, AppendSystemPrompt, and SkillsPrompt are concatenated.
func TestOpenAISDK_BuildMessages_SystemPromptCombined(t *testing.T) {
	adapter := &OpenAISDKAdapter{
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}

	ctx := runnerctx.RunProcessContext{
		SystemPrompt:       "You are a helpful assistant.",
		AppendSystemPrompt: "Always respond in JSON.",
		SkillsPrompt:       "Available tools: get_weather.",
		Prompt:             "Hi",
	}

	messages := adapter.buildMessages(ctx)

	if len(messages) < 1 {
		t.Fatal("expected at least 1 message")
	}

	sysMsg := messages[0]
	if sysMsg.Role != "system" {
		t.Fatalf("first message role = %q, want %q", sysMsg.Role, "system")
	}

	// All three prompts should be joined by "\n\n".
	expectedSys := "You are a helpful assistant.\n\nAlways respond in JSON.\n\nAvailable tools: get_weather."
	if sysMsg.Content != expectedSys {
		t.Errorf("system content = %q, want %q", sysMsg.Content, expectedSys)
	}
}

// TestOpenAISDK_BuildMessages_NoSystemPrompt verifies that when no system
// prompt is provided, no system message is prepended.
func TestOpenAISDK_BuildMessages_NoSystemPrompt(t *testing.T) {
	adapter := &OpenAISDKAdapter{
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}

	ctx := runnerctx.RunProcessContext{
		Prompt: "Hello",
	}

	messages := adapter.buildMessages(ctx)

	if len(messages) != 1 {
		t.Fatalf("expected 1 message (user only), got %d", len(messages))
	}
	if messages[0].Role != "user" {
		t.Errorf("messages[0].Role = %q, want %q", messages[0].Role, "user")
	}
	if messages[0].Content != "Hello" {
		t.Errorf("messages[0].Content = %q, want %q", messages[0].Content, "Hello")
	}
}

// TestOpenAISDK_BuildMessages_EmptyPromptDefaults verifies that an empty
// prompt defaults to "Continue."
func TestOpenAISDK_BuildMessages_EmptyPromptDefaults(t *testing.T) {
	adapter := &OpenAISDKAdapter{
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}

	ctx := runnerctx.RunProcessContext{
		SystemPrompt: "You are a helpful assistant.",
		// Prompt is empty — should default to "Continue."
	}

	messages := adapter.buildMessages(ctx)

	if len(messages) != 2 {
		t.Fatalf("expected 2 messages (system + default user), got %d", len(messages))
	}

	userMsg := messages[len(messages)-1]
	if userMsg.Role != "user" {
		t.Errorf("last message role = %q, want %q", userMsg.Role, "user")
	}
	if userMsg.Content != "Continue." {
		t.Errorf("last message content = %q, want %q", userMsg.Content, "Continue.")
	}
}

// TestOpenAISDK_BuildMessages_WithHistory verifies that thread history
// messages are included with role normalization.
func TestOpenAISDK_BuildMessages_WithHistory(t *testing.T) {
	adapter := &OpenAISDKAdapter{
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}

	ctx := runnerctx.RunProcessContext{
		SystemPrompt: "You are a helpful assistant.",
		Messages: []runnerctx.Message{
			{Role: "user", Content: "Hello"},
			{Role: "assistant", Content: "Hi there! How can I help?"},
			{Role: "user", Content: "Tell me a joke"},
			{Role: "assistant", Content: "Why did the chicken cross the road?"},
		},
		Prompt: "Another one please",
	}

	messages := adapter.buildMessages(ctx)

	// Expected: system + 4 history + 1 current prompt = 6 messages.
	if len(messages) != 6 {
		t.Fatalf("expected 6 messages, got %d", len(messages))
	}

	// Verify roles in order.
	expectedRoles := []string{"system", "user", "assistant", "user", "assistant", "user"}
	for i, expected := range expectedRoles {
		if messages[i].Role != expected {
			t.Errorf("messages[%d].Role = %q, want %q", i, messages[i].Role, expected)
		}
	}

	// Verify content of history messages.
	if messages[1].Content != "Hello" {
		t.Errorf("messages[1].Content = %q, want %q", messages[1].Content, "Hello")
	}
	if messages[3].Content != "Tell me a joke" {
		t.Errorf("messages[3].Content = %q, want %q", messages[3].Content, "Tell me a joke")
	}
	if messages[5].Content != "Another one please" {
		t.Errorf("messages[5].Content = %q, want %q", messages[5].Content, "Another one please")
	}
}

// TestOpenAISDK_BuildMessages_RoleNormalization verifies that history roles
// are sanitized against the runnerctx allowlist before conversion, matching
// the anthropic-sdk twin (#1349): roles outside {user, assistant, system,
// tool} are rewritten to "system" by SanitizeMessage and therefore dropped
// with the other system history messages; "tool" is kept because the OpenAI
// message shape supports it natively.
func TestOpenAISDK_BuildMessages_RoleNormalization(t *testing.T) {
	adapter := &OpenAISDKAdapter{
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}

	ctx := runnerctx.RunProcessContext{
		Messages: []runnerctx.Message{
			{Role: "agent", Content: "Agent says hello"},     // invalid → filtered to "system" → dropped
			{Role: "bot", Content: "Bot says hi"},            // invalid → filtered to "system" → dropped
			{Role: "system", Content: "Should be skipped"},   // system messages in history are skipped
			{Role: "tool", Content: "Tool result goes here"}, // "tool" stays "tool"
			{Role: "unknown", Content: "Unknown role"},       // invalid → filtered to "system" → dropped
		},
		Prompt: "Continue",
	}

	messages := adapter.buildMessages(ctx)

	// Expected: agent/bot/unknown are sanitized to "system" and skipped along
	// with the real system message, so only tool + current prompt remain
	// (no system prompt set).
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages (tool + prompt), got %d", len(messages))
	}

	expectedRoles := []string{"tool", "user"}
	for i, expected := range expectedRoles {
		if messages[i].Role != expected {
			t.Errorf("messages[%d].Role = %q, want %q", i, messages[i].Role, expected)
		}
	}
	if messages[0].Content != "Tool result goes here" {
		t.Errorf("messages[0].Content = %q, want %q", messages[0].Content, "Tool result goes here")
	}
}

// TestOpenAISDK_BuildMessages_ReturnType verifies that buildMessages returns
// a slice of openaiChatMessage (not a pointer or nil) even with no input.
func TestOpenAISDK_BuildMessages_ReturnType(t *testing.T) {
	adapter := &OpenAISDKAdapter{
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}

	// Completely empty context (no system prompt, no messages, no prompt).
	ctx := runnerctx.RunProcessContext{}

	messages := adapter.buildMessages(ctx)

	// Should always return at least one message (the default "Continue." prompt).
	if len(messages) != 1 {
		t.Fatalf("expected 1 message (default prompt), got %d", len(messages))
	}
	if messages[0].Role != "user" {
		t.Errorf("messages[0].Role = %q, want %q", messages[0].Role, "user")
	}
	if messages[0].Content != "Continue." {
		t.Errorf("messages[0].Content = %q, want %q", messages[0].Content, "Continue.")
	}
}

// TestOpenAISDK_BuildMessages_SanitizesHistoryAndPrompt verifies that history
// messages and the current prompt pass through runnerctx.SanitizeMessage
// before entering the outgoing payload, locking parity with the anthropic-sdk
// twin (#1349): ASCII control characters are stripped and invalid roles are
// filtered out.
func TestOpenAISDK_BuildMessages_SanitizesHistoryAndPrompt(t *testing.T) {
	adapter := &OpenAISDKAdapter{
		model:      "gpt-5.5",
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

// =============================================================================
// ParseStream error handling (HTTP-level)
// =============================================================================

// TestOpenAISDK_E2E_ParseStream_HTTPError verifies that a non-200 HTTP response
// from the upstream API results in a non-recoverable error and a failure result event.
// This exercises ParseStream (not parseSSEStream), which is where HTTP-level
// error handling lives. OpenAI errors come as HTTP status codes, not as in-stream events.
func TestOpenAISDK_E2E_ParseStream_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"Invalid API key","type":"invalid_request_error","code":"invalid_api_key"}}`))
	}))
	defer srv.Close()

	// Override baseURL to point at our mock server.
	adapter := &OpenAISDKAdapter{
		apiKey:     "bad-key",
		baseURL:    srv.URL, // point at mock server
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}

	emitter := &testEventEmitter{}

	run := store.Run{
		ID:        "run-err",
		ProjectID: "proj-err",
		ThreadID:  "thr-err",
	}

	runCtx := runnerctx.RunProcessContext{
		Run:    run,
		Prompt: "Hello",
	}

	ctx := adapters.SDKAdapterContext(context.Background(), runCtx)

	err := adapter.ParseStream(ctx, nil, nil, emitter, run)
	if err == nil {
		t.Fatal("expected error from HTTP 401, got nil")
	}

	// Verify a failure result event was emitted.
	results := emitter.eventsOfType(BusEventResult)
	if len(results) != 1 {
		t.Fatalf("expected 1 result event, got %d", len(results))
	}
	r := results[0]
	if r.Payload["success"] != false {
		t.Errorf("result success = %v, want false", r.Payload["success"])
	}
	if r.Payload["terminalReason"] != "error" {
		t.Errorf("result terminalReason = %q, want %q", r.Payload["terminalReason"], "error")
	}
	if r.Payload["provider"] != "openai" {
		t.Errorf("result provider = %q, want %q", r.Payload["provider"], "openai")
	}

	// Verify a session_init event was emitted (before the HTTP call).
	sessionInits := emitter.eventsOfType(BusEventSessionInit)
	if len(sessionInits) != 1 {
		t.Fatalf("expected 1 session_init event, got %d", len(sessionInits))
	}
}

// =============================================================================
// Retry behavior tests (doRequestWithRetry)
// =============================================================================
//
// These tests exercise doRequestWithRetry directly via httptest.NewServer,
// verifying the retry policy: 429 and 5xx are retried with exponential backoff;
// 4xx auth errors are NOT retried; exhausted retries return an error.
//
// Note: exponential backoff delays (1s, 2s, 4s) are incurred during these tests.
// Run with -run "TestOpenAISDK_Retry" to isolate.

// TestOpenAISDK_RetryOn429 verifies that the adapter retries on 429 Too Many
// Requests. The mock server returns 429 twice, then 200 on the third attempt.
func TestOpenAISDK_RetryOn429(t *testing.T) {
	var requestCount int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if requestCount <= 2 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("data: [DONE]\n"))
	}))
	defer srv.Close()

	adapter := &OpenAISDKAdapter{
		apiKey:     "test-key",
		baseURL:    srv.URL,
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}

	emitter := &testEventEmitter{}
	scope := map[string]any{"projectId": "p", "threadId": "t", "runId": "r"}

	ctx := context.Background()
	resp, err := adapter.doRequestWithRetry(ctx, []byte(`{"model":"gpt-5.5","messages":[{"role":"user","content":"hi"}]}`), emitter, scope)
	if err != nil {
		t.Fatalf("doRequestWithRetry returned error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	if requestCount != 3 {
		t.Errorf("expected 3 total requests (2 x 429 + 1 x 200), got %d", requestCount)
	}

	// Verify retry events were emitted for each retry attempt.
	retryEvents := emitter.eventsOfType(BusEventAPIRetry)
	if len(retryEvents) != 2 {
		t.Errorf("expected 2 retry events (attempts 1 and 2), got %d", len(retryEvents))
	}
	for i, re := range retryEvents {
		if re.Payload["provider"] != "openai" {
			t.Errorf("retry[%d] provider = %q, want %q", i, re.Payload["provider"], "openai")
		}
	}
}

// TestOpenAISDK_RetryOn503 verifies that the adapter retries on 503 Service
// Unavailable. The mock server returns 503 twice, then 200 on the third attempt.
func TestOpenAISDK_RetryOn503(t *testing.T) {
	var requestCount int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if requestCount <= 2 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("data: [DONE]\n"))
	}))
	defer srv.Close()

	adapter := &OpenAISDKAdapter{
		apiKey:     "test-key",
		baseURL:    srv.URL,
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}

	emitter := &testEventEmitter{}
	scope := map[string]any{"projectId": "p", "threadId": "t", "runId": "r"}

	ctx := context.Background()
	resp, err := adapter.doRequestWithRetry(ctx, []byte(`{}`), emitter, scope)
	if err != nil {
		t.Fatalf("doRequestWithRetry returned error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	if requestCount != 3 {
		t.Errorf("expected 3 total requests (2 x 503 + 1 x 200), got %d", requestCount)
	}

	// Verify retry events.
	retryEvents := emitter.eventsOfType(BusEventAPIRetry)
	if len(retryEvents) != 2 {
		t.Errorf("expected 2 retry events, got %d", len(retryEvents))
	}
}

// TestOpenAISDK_Retry_NotOn401 verifies that the adapter does NOT retry on
// authentication errors (401). Auth errors are non-retriable per the
// doRequestWithRetry policy: only 429 and >=500 are retried.
func TestOpenAISDK_Retry_NotOn401(t *testing.T) {
	var requestCount int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	adapter := &OpenAISDKAdapter{
		apiKey:     "bad-key",
		baseURL:    srv.URL,
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}

	emitter := &testEventEmitter{}
	scope := map[string]any{"projectId": "p", "threadId": "t", "runId": "r"}

	ctx := context.Background()
	resp, err := adapter.doRequestWithRetry(ctx, []byte(`{}`), emitter, scope)
	if err != nil {
		t.Fatalf("doRequestWithRetry returned unexpected error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
	if requestCount != 1 {
		t.Errorf("expected exactly 1 request (no retries on 401), got %d", requestCount)
	}

	// Verify no retry events were emitted.
	retryEvents := emitter.eventsOfType(BusEventAPIRetry)
	if len(retryEvents) != 0 {
		t.Errorf("expected 0 retry events for 401, got %d", len(retryEvents))
	}
}

// TestOpenAISDK_RetryExhausted verifies that after maxRetries (3) server errors
// (503), the adapter gives up and returns a non-recoverable error. The mock
// server returns 503 on all four attempts (1 initial + 3 retries).
func TestOpenAISDK_RetryExhausted(t *testing.T) {
	var requestCount int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	adapter := &OpenAISDKAdapter{
		apiKey:     "test-key",
		baseURL:    srv.URL,
		model:      "gpt-5.5",
		available:  true,
		httpClient: &http.Client{},
	}

	emitter := &testEventEmitter{}
	scope := map[string]any{"projectId": "p", "threadId": "t", "runId": "r"}

	ctx := context.Background()
	resp, err := adapter.doRequestWithRetry(ctx, []byte(`{}`), emitter, scope)
	if err == nil {
		resp.Body.Close()
		t.Fatal("expected error after exhausting retries, got nil")
	}
	if requestCount != 4 {
		t.Errorf("expected 4 total attempts (1 initial + 3 retries), got %d", requestCount)
	}

	// Verify a failure result event was emitted.
	results := emitter.eventsOfType(BusEventResult)
	if len(results) != 1 {
		t.Fatalf("expected 1 result event after exhausting retries, got %d", len(results))
	}
	if results[0].Payload["success"] != false {
		t.Errorf("result success = %v, want false", results[0].Payload["success"])
	}
	if results[0].Payload["provider"] != "openai" {
		t.Errorf("result provider = %q, want %q", results[0].Payload["provider"], "openai")
	}

	// Verify retry events for all 3 retry attempts.
	retryEvents := emitter.eventsOfType(BusEventAPIRetry)
	if len(retryEvents) != 3 {
		t.Errorf("expected 3 retry events (attempts 1, 2, 3), got %d", len(retryEvents))
	}
}
