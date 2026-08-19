package sdk

import (
	"net/http"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/runnerctx"
)

// =============================================================================
// Benchmark: SDK adapter creation + request building latency
// (随 anthropic/openai SDK 适配器归组迁入 package sdk，#1760)
// =============================================================================

// BenchmarkSDKAdapterLatency measures the wall-clock time for creating
// an AnthropicSDKAdapter and an OpenAISDKAdapter, calling BuildCommand,
// and building the outgoing messages array (buildMessages). These are the
// hot-path operations that run on every agent invocation before any HTTP
// request is made.
func BenchmarkSDKAdapterLatency(b *testing.B) {
	runCtx := runnerctx.RunProcessContext{
		SystemPrompt: "You are a helpful assistant.",
		Prompt:       "What is the capital of France?",
		Model:        "claude-sonnet-4-6",
	}

	b.Run("anthropic_sdk", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			adapter := NewAnthropicSDKAdapter("test-key-not-used", "claude-sonnet-4-6", &http.Client{})
			adapter.BuildCommand(runCtx)
			_ = adapter.buildMessages(runCtx)
		}
	})

	b.Run("openai_sdk", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			adapter := NewOpenAISDKAdapter("test-key-not-used", "gpt-5.5", &http.Client{})
			adapter.BuildCommand(runCtx)
			_ = adapter.buildMessages(runCtx)
		}
	})
}

// =============================================================================
// Test: adapter setup latency baseline (<100ms)
// =============================================================================

// TestSDKAdapterLatencyBaseline asserts that adapter creation, BuildCommand,
// and buildMessages complete in under 100ms. This is a generous baseline —
// typical times are well under 1ms. The test acts as a canary for accidental
// regressions (e.g. blocking I/O, expensive init, unbounded allocations).
func TestSDKAdapterLatencyBaseline(t *testing.T) {
	runCtx := runnerctx.RunProcessContext{
		SystemPrompt: "You are a helpful assistant.",
		Prompt:       "What is the capital of France?",
		Model:        "claude-sonnet-4-6",
	}

	const maxLatency = 100 * time.Millisecond

	t.Run("anthropic_sdk", func(t *testing.T) {
		start := time.Now()
		adapter := NewAnthropicSDKAdapter("test-key-not-used", "claude-sonnet-4-6", &http.Client{})
		adapter.BuildCommand(runCtx)
		_ = adapter.buildMessages(runCtx)
		elapsed := time.Since(start)

		if elapsed > maxLatency {
			t.Errorf("AnthropicSDK adapter setup took %v, want <= %v", elapsed, maxLatency)
		}
		t.Logf("AnthropicSDK setup: %v", elapsed)
	})

	t.Run("openai_sdk", func(t *testing.T) {
		start := time.Now()
		adapter := NewOpenAISDKAdapter("test-key-not-used", "gpt-5.5", &http.Client{})
		adapter.BuildCommand(runCtx)
		_ = adapter.buildMessages(runCtx)
		elapsed := time.Since(start)

		if elapsed > maxLatency {
			t.Errorf("OpenAISDK adapter setup took %v, want <= %v", elapsed, maxLatency)
		}
		t.Logf("OpenAISDK setup: %v", elapsed)
	})
}
