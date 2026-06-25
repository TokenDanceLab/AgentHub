package adapters

import (
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/router"
	"github.com/agenthub/edge-server/internal/runnerctx"
)

// =============================================================================
// Benchmark: SDK adapter creation + request building latency
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
			adapter := NewAnthropicSDKAdapter("test-key-not-used", "claude-sonnet-4-6")
			adapter.BuildCommand(runCtx)
			_ = adapter.buildMessages(runCtx)
		}
	})

	b.Run("openai_sdk", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			adapter := NewOpenAISDKAdapter("test-key-not-used", "gpt-5.5")
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
		adapter := NewAnthropicSDKAdapter("test-key-not-used", "claude-sonnet-4-6")
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
		adapter := NewOpenAISDKAdapter("test-key-not-used", "gpt-5.5")
		adapter.BuildCommand(runCtx)
		_ = adapter.buildMessages(runCtx)
		elapsed := time.Since(start)

		if elapsed > maxLatency {
			t.Errorf("OpenAISDK adapter setup took %v, want <= %v", elapsed, maxLatency)
		}
		t.Logf("OpenAISDK setup: %v", elapsed)
	})
}

// =============================================================================
// Benchmark: ClassifyComplexity with various prompt sizes
// =============================================================================

// BenchmarkClassifyComplexity benchmarks the deterministic prompt complexity
// classifier (regex + keyword matching, zero LLM) across a range of prompt
// sizes and languages. This runs on every /v1/runs request before the
// lifecycle executor starts.
func BenchmarkClassifyComplexity(b *testing.B) {
	shortSimple := "fix typo in README"

	mediumPrompt := strings.Repeat(
		"Implement a JWT authentication middleware that validates tokens, "+
			"checks expiration, and injects user context into request headers. ",
		10,
	) // ~30 words

	longComplex := strings.Repeat(
		"step 1: refactor the database layer, step 2: migrate user schema, "+
			"step 3: restructure API gateway, step 4: redesign auth flow, "+
			"step 5: overhaul frontend state management. ",
		10,
	) // ~100+ words with complex keywords

	cjkMedium := strings.Repeat("请帮我重构数据库层的用户认证模块，并迁移旧版架构到新的微服务架构。", 5)

	cjkComplex := strings.Repeat(
		"第一步：重构整个数据库层，第二步：迁移用户表结构，第三步：重新设计API网关，第四步：改造前端状态管理，第五步：重建缓存层。",
		15,
	)

	benchmarks := []struct {
		name   string
		prompt string
	}{
		{"simple_short", shortSimple},
		{"medium_30words", mediumPrompt},
		{"complex_100words", longComplex},
		{"cjk_medium", cjkMedium},
		{"cjk_complex", cjkComplex},
	}

	for _, bm := range benchmarks {
		b.Run(bm.name, func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(int64(len(bm.prompt)))
			for i := 0; i < b.N; i++ {
				_ = router.ClassifyComplexity(bm.prompt)
			}
		})
	}
}
