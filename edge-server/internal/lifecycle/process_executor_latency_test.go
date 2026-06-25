package lifecycle

import (
	"fmt"
	"strings"
	"testing"
)

// =============================================================================
// Benchmark: SanitizeSubAgentResult with 10KB input
// =============================================================================
//
// Located in the lifecycle package (not adapters) because lifecycle imports
// adapters — creating a cycle if adapters_test imports lifecycle. The
// function under test (SanitizeSubAgentResult) is defined here.

// BenchmarkSanitizeSubAgentResult benchmarks the sanitization of sub-agent
// results with various payload shapes and sizes. This is a hot path in the
// orchestrator when collecting sub-agent outputs.
func BenchmarkSanitizeSubAgentResult(b *testing.B) {
	// Build a 10KB string payload.
	tenKBStr := strings.Repeat("The quick brown fox jumps over the lazy dog. ", 250)
	// ~250 * 43 = 10750 bytes ≈ 10KB

	b.Run("string_10KB", func(b *testing.B) {
		b.ReportAllocs()
		b.SetBytes(int64(len(tenKBStr)))
		for i := 0; i < b.N; i++ {
			_, _ = SanitizeSubAgentResult(tenKBStr)
		}
	})

	// Build a 10KB map payload with ~100 keys.
	mapPayload := make(map[string]any, 100)
	for i := 0; i < 100; i++ {
		mapPayload[fmt.Sprintf("key_%03d", i)] = fmt.Sprintf("value_%03d_%s", i, strings.Repeat("x", 90))
	}

	b.Run("map_10KB", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			_, _ = SanitizeSubAgentResult(mapPayload)
		}
	})

	// Build a 10KB slice payload with ~100 entries.
	slicePayload := make([]any, 100)
	for i := 0; i < 100; i++ {
		slicePayload[i] = fmt.Sprintf("item_%03d_%s", i, strings.Repeat("y", 90))
	}

	b.Run("slice_10KB", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			_, _ = SanitizeSubAgentResult(slicePayload)
		}
	})

	// Nested: map containing string + slice + sub-map.
	nestedPayload := map[string]any{
		"result":  tenKBStr[:5000],
		"items":   slicePayload[:50],
		"meta":    mapPayload,
		"summary": "All tests passed.",
	}

	b.Run("nested_10KB", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			_, _ = SanitizeSubAgentResult(nestedPayload)
		}
	})

	// Nil input (fast path).
	b.Run("nil", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			_, _ = SanitizeSubAgentResult(nil)
		}
	})
}
