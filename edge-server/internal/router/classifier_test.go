package router

import (
	"strings"
	"testing"
)

func TestClassifyComplexity_Simple(t *testing.T) {
	tests := []string{
		"fix typo in README",
		"run npm install",
		"check status",
		"show me the config",
		"run test",
		"fix typo",
		"",
		"hello",
		"print version",
	}
	for _, prompt := range tests {
		got := ClassifyComplexity(prompt)
		if got != ComplexitySimple {
			t.Errorf("ClassifyComplexity(%q) = %s, want %s", prompt, got, ComplexitySimple)
		}
	}
}

func TestClassifyComplexity_Medium(t *testing.T) {
	tests := []string{
		"add auth middleware with JWT validation and integrate it into the existing request pipeline with proper error handling and logging support",
		"first update the schema, then modify the handler to accept the new fields and update all tests",
		"step 1: create the database migration step 2: add the model step 3: wire up the API handler",
		"update the user profile endpoint to return additional fields and also make sure the frontend displays them correctly and consistently",
		// Medium-length prompt with multi-step indicator (no complex keywords)
		"first review the existing error handling in the API layer, then add consistent error wrapping for all handlers and update the middleware to log structured errors",
	}
	for _, prompt := range tests {
		got := ClassifyComplexity(prompt)
		if got != ComplexityMedium {
			t.Errorf("ClassifyComplexity(%q) = %s, want %s", prompt, got, ComplexityMedium)
		}
	}
}

func TestClassifyComplexity_Complex(t *testing.T) {
	tests := []string{
		"refactor the entire authentication system to use RS256 instead of HS256",
		"migrate all database queries from raw SQL to the repository pattern with proper transaction support",
		"design and implement a real-time notification system with WebSocket architecture that supports fallback polling and works across all three platforms",
		"this task depends on the completion of the OIDC integration before the session management work can start because the token format will change",
		"the new feature requires that the API gateway be updated first to support the additional headers needed for multi-region routing",
		"this work is blocked by the migration of the user table which must happen before any schema changes can be applied to the profiles system",
		"restructure all files in the shared package to follow the new naming convention and update every module that imports them",
		"we need to overhaul the entire codebase to adopt the new architecture that was proposed in the design review last week",
		// >100 words triggers complex regardless of keywords
		longText(120),
	}
	for _, prompt := range tests {
		got := ClassifyComplexity(prompt)
		if got != ComplexityComplex {
			t.Errorf("ClassifyComplexity(%q) = %s, want %s", prompt, got, ComplexityComplex)
		}
	}
}

func TestClassifyComplexity_Priority(t *testing.T) {
	tests := []struct {
		prompt string
		want   ComplexityLevel
	}{
		{"fix typo, but also refactor the entire module structure to support the new plugin system", ComplexityComplex},
		{"run test to check status, but depends on the database migration being completed first", ComplexityComplex},
		{"first create the model, then add the handler, after that update the tests, finally deploy", ComplexityMedium},
		{"show me the status but step 1: check the logs, step 2: verify the database", ComplexityMedium},
	}
	for _, tt := range tests {
		got := ClassifyComplexity(tt.prompt)
		if got != tt.want {
			t.Errorf("ClassifyComplexity(%q) = %s, want %s", tt.prompt, got, tt.want)
		}
	}
}

func TestClassifyComplexity_WordCountBoundaries(t *testing.T) {
	// Exactly 19 words → Simple
	short := makeWords(19)
	if got := ClassifyComplexity(short); got != ComplexitySimple {
		t.Errorf("19 words → %s, want %s", got, ComplexitySimple)
	}

	// Exactly 20 words with no signals → Medium (default)
	medium := makeWords(20)
	if got := ClassifyComplexity(medium); got != ComplexityMedium {
		t.Errorf("20 words (no signal) → %s, want %s", got, ComplexityMedium)
	}

	// Exactly 101 words → Complex
	long := makeWords(101)
	if got := ClassifyComplexity(long); got != ComplexityComplex {
		t.Errorf("101 words → %s, want %s", got, ComplexityComplex)
	}
}

func TestCountWords(t *testing.T) {
	tests := []struct {
		input string
		want  int
	}{
		{"", 0},
		{"hello", 1},
		{"hello world", 2},
		{"a b c d e", 5},
		{"  leading and trailing  ", 3},
		{"tab\tseparated\twords", 3},
	}
	for _, tt := range tests {
		got := countWords(tt.input)
		if got != tt.want {
			t.Errorf("countWords(%q) = %d, want %d", tt.input, got, tt.want)
		}
	}
}

// makeWords returns a string with n space-separated words.
func makeWords(n int) string {
	var b []string
	for i := 0; i < n; i++ {
		b = append(b, "word")
	}
	return strings.Join(b, " ")
}

// longText returns a string with n words, all "data".
func longText(n int) string {
	var b []string
	for i := 0; i < n; i++ {
		b = append(b, "data")
	}
	return strings.Join(b, " ")
}

// ==================== T2-D14: table-driven enhancements ====================

func TestClassifyComplexity_ChineseSimple(t *testing.T) {
	tests := []struct {
		prompt string
		want   ComplexityLevel
	}{
		// Short Chinese prompts — should classify as Simple.
		{"修复 README 中的错字", ComplexitySimple},
		{"运行测试", ComplexitySimple},
		{"检查状态", ComplexitySimple},
		{"把配置发给我看看", ComplexitySimple},
		{"打印版本号", ComplexitySimple},
		// Single CJK sentence, short — note: "hello world" adds 2 whitespace words
		// but total runes <200, so not bumped to Medium.
		{"帮我写一个 hello world 程序", ComplexitySimple},
		// Empty and whitespace-only.
		{"", ComplexitySimple},
		{"   ", ComplexitySimple},
		// CJK exactly 200 runes (word count <20, runes not >200) → Simple.
		{makeCJKPrompt(200), ComplexitySimple},
		// CJK with refactor-like text: \brefactor\b does NOT match CJK "重构"
		// because \b is an ASCII word boundary and CJK chars are not \w in Go regex.
		{"需要重构整个支付模块的架构，将单体服务拆分为微服务架构", ComplexitySimple},
	}
	for _, tt := range tests {
		got := ClassifyComplexity(tt.prompt)
		if got != tt.want {
			t.Errorf("ClassifyComplexity(%q) = %s, want %s", tt.prompt, got, tt.want)
		}
	}
}

func TestClassifyComplexity_ChineseMedium(t *testing.T) {
	tests := []struct {
		prompt string
		want   ComplexityLevel
	}{
		// Pure CJK >200 runes but <20 words → bumped to Medium by rune fallback.
		{makeCJKPrompt(201), ComplexityMedium},
		// CJK 800 runes (exact boundary, still below >800 threshold) → Medium.
		{makeCJKPrompt(800), ComplexityMedium},
		// CJK 900 runes: the "runes > 800" check fires first (fixed ordering),
		// correctly classifying lengthy CJK prompts as Complex.
		{makeCJKPrompt(900), ComplexityComplex},
		// CJK with multi-step indicator "after that" (English keyword) → Medium.
		{"完成数据库迁移 after that 更新 API handler 和前端页面", ComplexityMedium},
	}
	for _, tt := range tests {
		got := ClassifyComplexity(tt.prompt)
		if got != tt.want {
			t.Errorf("ClassifyComplexity(%q) = %s, want %s", tt.prompt, got, tt.want)
		}
	}
}

func TestClassifyComplexity_ChineseComplex(t *testing.T) {
	tests := []struct {
		prompt string
		want   ComplexityLevel
	}{
		// CJK with "migrate" keyword in English (matches \b boundary in Go).
		{"需要 migrate 所有数据库查询从原始 SQL 改为 repository 模式", ComplexityComplex},
		// CJK with "refactor" keyword mixed in English → Complex.
		{"我们计划 refactor 整个认证系统，改用 RS256 替代 HS256", ComplexityComplex},
	}
	for _, tt := range tests {
		got := ClassifyComplexity(tt.prompt)
		if got != tt.want {
			t.Errorf("ClassifyComplexity(%q) = %s, want %s", tt.prompt, got, tt.want)
		}
	}
}

func TestClassifyComplexity_MixedLanguage(t *testing.T) {
	tests := []struct {
		name   string
		prompt string
		want   ComplexityLevel
	}{
		{
			name:   "short mixed en/zh simple request",
			prompt: "帮我 fix 这个 typo in README",
			want:   ComplexitySimple,
		},
		{
			name:   "mixed multi-step medium",
			prompt: "First 创建数据库 migration，then 添加 model 层，最后更新 API handler",
			want:   ComplexityMedium,
		},
		{
			name:   "mixed with refactor keyword → complex",
			prompt: "需要 refactor 整个 notification 模块，包括 WebSocket 和 fallback polling",
			want:   ComplexityComplex,
		},
		{
			name:   "mixed with dependency keyword → complex",
			prompt: "这个任务 depends on OIDC integration 完成后才能开始 session management 的工作",
			want:   ComplexityComplex,
		},
		{
			name:   "long mixed >100 english words → complex",
			prompt: longText(120) + " 额外中文描述",
			want:   ComplexityComplex,
		},
		{
			name:   "CJK with simple english command pattern → simple",
			prompt: "请帮我 run test 并 check status 然后 show me 结果",
			want:   ComplexitySimple,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ClassifyComplexity(tt.prompt)
			if got != tt.want {
				t.Errorf("ClassifyComplexity(%q) = %s, want %s", tt.prompt, got, tt.want)
			}
		})
	}
}

func TestClassifyComplexity_EdgeCases(t *testing.T) {
	tests := []struct {
		name   string
		prompt string
		want   ComplexityLevel
	}{
		{
			name:   "very long prompt >100 words", prompt: longText(200),
			want:   ComplexityComplex,
		},
		{
			name:   "exactly 100 words (boundary)",
			prompt: longText(100),
			want:   ComplexityMedium,
		},
		{
			name:   "exactly 101 words (crosses complex threshold)",
			prompt: longText(101),
			want:   ComplexityComplex,
		},
		{
			name:   "CJK exactly 200 runes (boundary, runes not >200) → simple",
			prompt: makeCJKPrompt(200),
			want:   ComplexitySimple,
		},
		{
			name:   "CJK exactly 201 runes (crosses >200, bumped to medium)",
			prompt: makeCJKPrompt(201),
			want:   ComplexityMedium,
		},
		{
			name: "CJK 800 runes (medium: runes>800 threshold not yet reached)",
			prompt: makeCJKPrompt(800),
			want:   ComplexityMedium,
		},
		{
			name: "CJK 900 runes (complex: runes>800 fires before words<20 fallback, fixed in critical 2.5)",
			prompt: makeCJKPrompt(900),
			want:   ComplexityComplex,
		},
		{
			name:   "only CJK with simple keyword → simple keyword wins",
			prompt: "修复typo",
			want:   ComplexitySimple,
		},
		{
			name:   "CJK with after that phrase → medium via multiStepRE",
			prompt: "完成数据库迁移 after that 更新 API handler",
			want:   ComplexityMedium,
		},
		{
			name: "CJK with first...then pattern → medium",
			prompt: "first 检查日志，then 验证数据库连接",
			want:   ComplexityMedium,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ClassifyComplexity(tt.prompt)
			if got != tt.want {
				t.Errorf("ClassifyComplexity(%q) = %s, want %s", tt.prompt, got, tt.want)
			}
		})
	}
}

func TestCountWords_CJK(t *testing.T) {
	tests := []struct {
		input string
		want  int
	}{
		// Pure CJK: no whitespace delimiters → 1 word (entire string).
		{"你好世界", 1},
		{"今天天气真好", 1},
		// Whitespace-delimited CJK tokens → each is a word.
		{"你好 世界", 2},
		{"今天 天气 真好", 3},
		// Mixed CJK and ASCII: whitespace delimits.
		{"hello 世界 test", 3},
		{"修复 typo in README", 4}, // "fix" in CJK context is not separated
	}
	for _, tt := range tests {
		got := countWords(tt.input)
		if got != tt.want {
			t.Errorf("countWords(%q) = %d, want %d", tt.input, got, tt.want)
		}
	}
}

// makeCJKPrompt returns a string with n CJK characters (each is 1 rune).
// Uses repeated "测" character which is the smallest viable CJK content unit.
func makeCJKPrompt(n int) string {
	var b strings.Builder
	b.Grow(n * 3) // UTF-8: each CJK char is 3 bytes
	for i := 0; i < n; i++ {
		b.WriteRune('测')
	}
	return b.String()
}
