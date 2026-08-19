package adapters

import (
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/router"
)

// =============================================================================
// Benchmark: ClassifyComplexity with various prompt sizes
// (SDK 适配器延迟基准已随 #1760 归组迁入 internal/adapters/sdk)
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
