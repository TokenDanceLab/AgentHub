package runnerctx

import (
	"strings"
	"sync"
	"testing"
	"time"
)

func TestNewContextBudgetWithPositiveMaxTokens(t *testing.T) {
	b := NewContextBudget(100_000)
	if b.MaxTokens != 100_000 {
		t.Fatalf("MaxTokens = %d, want 100000", b.MaxTokens)
	}
	if b.ReservedTokens != 10_000 {
		t.Fatalf("ReservedTokens = %d, want 10000", b.ReservedTokens)
	}
}

func TestNewContextBudgetWithZeroMaxTokens(t *testing.T) {
	b := NewContextBudget(0)
	if b.MaxTokens != 200_000 {
		t.Fatalf("MaxTokens = %d, want 200000 (default)", b.MaxTokens)
	}
}

func TestNewContextBudgetWithNegativeMaxTokens(t *testing.T) {
	b := NewContextBudget(-1)
	if b.MaxTokens != 200_000 {
		t.Fatalf("MaxTokens = %d, want 200000 (default for negative)", b.MaxTokens)
	}
}

func TestNewContextBudgetReservedTokensDefault(t *testing.T) {
	b := NewContextBudget(50_000)
	if b.ReservedTokens != 10_000 {
		t.Fatalf("ReservedTokens = %d, want 10000", b.ReservedTokens)
	}
}

func TestTrackAddsTokensCorrectly(t *testing.T) {
	b := NewContextBudget(100_000)
	b.Track(500)
	b.Track(300)
	b.Track(200)
	used := b.UsedTokens.Load()
	if used != 1000 {
		t.Fatalf("UsedTokens = %d, want 1000", used)
	}
}

func TestTrackZeroDoesNothing(t *testing.T) {
	b := NewContextBudget(100_000)
	b.Track(0)
	if b.UsedTokens.Load() != 0 {
		t.Fatalf("UsedTokens = %d, want 0", b.UsedTokens.Load())
	}
}

func TestIsExhaustedWhenBelowLimit(t *testing.T) {
	b := NewContextBudget(100_000)
	// Usable: 100000 - 10000 = 90000
	b.Track(89999)
	if b.IsExhausted() {
		t.Fatal("IsExhausted = true, want false (one below limit)")
	}
}

func TestIsExhaustedExactlyAtLimit(t *testing.T) {
	b := NewContextBudget(100_000)
	// Usable: 100000 - 10000 = 90000
	b.Track(90000)
	if !b.IsExhausted() {
		t.Fatal("IsExhausted = false, want true (exactly at limit)")
	}
}

func TestIsExhaustedWhenExceeded(t *testing.T) {
	b := NewContextBudget(100_000)
	b.Track(100_000) // well past usable budget
	if !b.IsExhausted() {
		t.Fatal("IsExhausted = false, want true (exceeded)")
	}
}

func TestRemainingWhenBudgetNotExhausted(t *testing.T) {
	b := NewContextBudget(100_000)
	// usable = 90000, used = 50000, remaining = 40000
	b.Track(50000)
	rem := b.Remaining()
	if rem != 40000 {
		t.Fatalf("Remaining = %d, want 40000", rem)
	}
}

func TestRemainingWhenExactlyAtLimit(t *testing.T) {
	b := NewContextBudget(100_000)
	b.Track(90000) // exactly at the limit
	rem := b.Remaining()
	if rem != 0 {
		t.Fatalf("Remaining = %d, want 0", rem)
	}
}

func TestRemainingNeverNegative(t *testing.T) {
	b := NewContextBudget(100_000)
	b.Track(200_000) // way over
	rem := b.Remaining()
	if rem != 0 {
		t.Fatalf("Remaining = %d, want 0 (clamped)", rem)
	}
}

func TestRemainingWithSmallBudget(t *testing.T) {
	// Edge case: budget smaller than reserved
	b := NewContextBudget(5_000)
	// usable = 5000-10000 = -5000, so used(0) >= -5000 → already exhausted
	if !b.IsExhausted() {
		t.Fatal("IsExhausted should be true when MaxTokens < ReservedTokens")
	}
	rem := b.Remaining()
	if rem != 0 {
		t.Fatalf("Remaining = %d, want 0 for exhausted small budget", rem)
	}
}

func TestConcurrentTrack(t *testing.T) {
	b := NewContextBudget(100_000)
	const goroutines = 100
	const tokensPerGoroutine = 1

	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			b.Track(tokensPerGoroutine)
		}()
	}
	wg.Wait()

	used := b.UsedTokens.Load()
	if used != goroutines*tokensPerGoroutine {
		t.Fatalf("UsedTokens = %d, want %d after concurrent tracks", used, goroutines*tokensPerGoroutine)
	}
}

func TestConcurrentTrackAndRead(t *testing.T) {
	b := NewContextBudget(200_000)
	const goroutines = 50
	const tokensPerTrack = 10

	var wg sync.WaitGroup
	wg.Add(goroutines * 2)

	// Writers
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				b.Track(tokensPerTrack)
			}
		}()
	}

	// Readers
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				_ = b.IsExhausted()
				_ = b.Remaining()
			}
		}()
	}

	wg.Wait()

	expected := int64(goroutines * 100 * tokensPerTrack)
	used := b.UsedTokens.Load()
	if used != expected {
		t.Fatalf("UsedTokens = %d, want %d", used, expected)
	}
}

// --- ShouldCompact tests ---

func TestShouldCompactWhenBelowThreshold(t *testing.T) {
	b := NewContextBudget(100_000)
	// usable = 90000; 84% = 75600, below 85% threshold
	b.Track(75600)
	if b.ShouldCompact() {
		t.Fatal("ShouldCompact = true, want false (below 85% threshold)")
	}
}

func TestShouldCompactExactlyAtThreshold(t *testing.T) {
	b := NewContextBudget(100_000)
	// usable = 90000; 85% = 76500
	b.Track(76500)
	if !b.ShouldCompact() {
		t.Fatal("ShouldCompact = false, want true (exactly at 85% threshold)")
	}
}

func TestShouldCompactWhenAboveThreshold(t *testing.T) {
	b := NewContextBudget(100_000)
	// 90% of usable
	b.Track(81000)
	if !b.ShouldCompact() {
		t.Fatal("ShouldCompact = false, want true (above 85% threshold)")
	}
}

func TestShouldCompactWhenExhausted(t *testing.T) {
	b := NewContextBudget(100_000)
	b.Track(90000) // exactly at limit
	if !b.ShouldCompact() {
		t.Fatal("ShouldCompact = false, want true (exhausted implies compact)")
	}
}

func TestShouldCompactWithSmallBudget(t *testing.T) {
	// Budget smaller than reserved -> usable <= 0 -> ShouldCompact always true
	b := NewContextBudget(5_000)
	if !b.ShouldCompact() {
		t.Fatal("ShouldCompact = false, want true when usable <= 0")
	}
}

// --- UsagePercent tests ---

func TestUsagePercentZero(t *testing.T) {
	b := NewContextBudget(100_000)
	pct := b.UsagePercent()
	if pct != 0.0 {
		t.Fatalf("UsagePercent = %f, want 0.0", pct)
	}
}

func TestUsagePercentHalf(t *testing.T) {
	b := NewContextBudget(100_000)
	// usable = 90000; 50% = 45000
	b.Track(45000)
	pct := b.UsagePercent()
	if pct != 50.0 {
		t.Fatalf("UsagePercent = %f, want 50.0", pct)
	}
}

func TestUsagePercentHundred(t *testing.T) {
	b := NewContextBudget(100_000)
	b.Track(90000) // exactly at limit
	pct := b.UsagePercent()
	if pct != 100.0 {
		t.Fatalf("UsagePercent = %f, want 100.0", pct)
	}
}

func TestUsagePercentOverHundred(t *testing.T) {
	b := NewContextBudget(100_000)
	b.Track(200_000) // way over
	pct := b.UsagePercent()
	if pct != 100.0 {
		t.Fatalf("UsagePercent = %f, want 100.0 (clamped)", pct)
	}
}

func TestUsagePercentSmallBudget(t *testing.T) {
	b := NewContextBudget(5_000)
	// usable <= 0 -> returns 100
	pct := b.UsagePercent()
	if pct != 100.0 {
		t.Fatalf("UsagePercent = %f, want 100.0 when usable <= 0", pct)
	}
}

// --- EstimateTokens tests ---

func TestEstimateTokens(t *testing.T) {
	tests := []struct {
		name string
		text string
		want int
	}{
		{"empty string", "", 0},
		{"one char", "a", 1},
		{"four chars", "abcd", 1},
		{"five chars", "abcde", 2},
		{"eight chars", "abcdefgh", 2},
		{"twenty chars", "12345678901234567890", 5},
		{"english sentence", "Hello, world! This is a test.", 8},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := EstimateTokens(tt.text)
			if got != tt.want {
				t.Fatalf("EstimateTokens(%q) = %d, want %d", tt.text, got, tt.want)
			}
		})
	}
}

// --- CheckTokenBudget tests ---

func TestCheckTokenBudget_OkBelow80Percent(t *testing.T) {
	// 79% of 200000 = 158000 → ok
	ok, level := CheckTokenBudget(158000, 200000)
	if !ok {
		t.Fatal("ok = false, want true")
	}
	if level != "ok" {
		t.Fatalf("level = %q, want ok", level)
	}
}

func TestCheckTokenBudget_OkZeroTokens(t *testing.T) {
	ok, level := CheckTokenBudget(0, 200000)
	if !ok {
		t.Fatal("ok = false, want true")
	}
	if level != "ok" {
		t.Fatalf("level = %q, want ok", level)
	}
}

func TestCheckTokenBudget_WarnAt80Percent(t *testing.T) {
	// Exactly 80% of 200000 = 160000 → warn
	ok, level := CheckTokenBudget(160000, 200000)
	if !ok {
		t.Fatal("ok = false, want true")
	}
	if level != "warn" {
		t.Fatalf("level = %q, want warn", level)
	}
}

func TestCheckTokenBudget_WarnAt95Percent(t *testing.T) {
	// Exactly 95% of 200000 = 190000 → warn
	ok, level := CheckTokenBudget(190000, 200000)
	if !ok {
		t.Fatal("ok = false, want true")
	}
	if level != "warn" {
		t.Fatalf("level = %q, want warn", level)
	}
}

func TestCheckTokenBudget_WarnInMiddle(t *testing.T) {
	// 90% of 100000 = 90000 → warn
	ok, level := CheckTokenBudget(90000, 100000)
	if !ok {
		t.Fatal("ok = false, want true")
	}
	if level != "warn" {
		t.Fatalf("level = %q, want warn", level)
	}
}

func TestCheckTokenBudget_CriticalAbove95Percent(t *testing.T) {
	// 96% of 200000 = 192000 → critical
	ok, level := CheckTokenBudget(192000, 200000)
	if ok {
		t.Fatal("ok = true, want false")
	}
	if level != "critical" {
		t.Fatalf("level = %q, want critical", level)
	}
}

func TestCheckTokenBudget_CriticalFull(t *testing.T) {
	// 200000 / 200000 = 100% → critical
	ok, level := CheckTokenBudget(200000, 200000)
	if ok {
		t.Fatal("ok = true, want false")
	}
	if level != "critical" {
		t.Fatalf("level = %q, want critical", level)
	}
}

func TestCheckTokenBudget_CriticalExceeded(t *testing.T) {
	// 250000 / 200000 = 125% → critical
	ok, level := CheckTokenBudget(250000, 200000)
	if ok {
		t.Fatal("ok = true, want false")
	}
	if level != "critical" {
		t.Fatalf("level = %q, want critical", level)
	}
}

func TestCheckTokenBudget_ZeroMaxTokens(t *testing.T) {
	// Zero maxTokens means no budget constraint → always ok.
	ok, level := CheckTokenBudget(999999, 0)
	if !ok {
		t.Fatal("ok = false, want true (zero max tokens = no constraint)")
	}
	if level != "ok" {
		t.Fatalf("level = %q, want ok", level)
	}
}

func TestCheckTokenBudget_NegativeMaxTokens(t *testing.T) {
	// Negative maxTokens is treated as no constraint → always ok.
	ok, level := CheckTokenBudget(999999, -1)
	if !ok {
		t.Fatal("ok = false, want true (negative max tokens = no constraint)")
	}
	if level != "ok" {
		t.Fatalf("level = %q, want ok", level)
	}
}

func TestCheckTokenBudget_SmallBudget(t *testing.T) {
	// 90 tokens / 100 max = 90% → warn
	ok, level := CheckTokenBudget(90, 100)
	if !ok {
		t.Fatal("ok = false, want true")
	}
	if level != "warn" {
		t.Fatalf("level = %q, want warn", level)
	}
}

func TestCheckTokenBudget_ClaudeOpusDefault(t *testing.T) {
	// Typical usage: 150K tokens in a 200K context.
	// 150000/200000 = 75% → ok
	ok, level := CheckTokenBudget(150000, DefaultMaxTokens)
	if !ok {
		t.Fatal("ok = false, want true")
	}
	if level != "ok" {
		t.Fatalf("level = %q, want ok", level)
	}

	// 170000/200000 = 85% → warn
	ok, level = CheckTokenBudget(170000, DefaultMaxTokens)
	if !ok {
		t.Fatal("ok = false, want true")
	}
	if level != "warn" {
		t.Fatalf("level = %q, want warn", level)
	}

	// 195000/200000 = 97.5% → critical
	ok, level = CheckTokenBudget(195000, DefaultMaxTokens)
	if ok {
		t.Fatal("ok = true, want false")
	}
	if level != "critical" {
		t.Fatalf("level = %q, want critical", level)
	}
}

// --- AllocateChild tests ---

func TestAllocateChildNilParent(t *testing.T) {
	var b *ContextBudget = nil
	child := b.AllocateChild(0.5)
	if child != nil {
		t.Fatal("AllocateChild on nil parent should return nil")
	}
}

func TestAllocateChildDefaultRatio(t *testing.T) {
	parent := NewContextBudget(100_000)
	// usable = 90000, 40% = 36000
	child := parent.AllocateChild(0.4)
	if child.MaxTokens != 36000 {
		t.Fatalf("MaxTokens = %d, want 36000", child.MaxTokens)
	}
	// Reserved scaled proportionally: 10000 * 0.4 = 4000
	if child.ReservedTokens != 4000 {
		t.Fatalf("ReservedTokens = %d, want 4000", child.ReservedTokens)
	}
}

func TestAllocateChildCustomRatio(t *testing.T) {
	parent := NewContextBudget(100_000)
	// usable = 90000, 60% = 54000
	child := parent.AllocateChild(0.6)
	if child.MaxTokens != 54000 {
		t.Fatalf("MaxTokens = %d, want 54000", child.MaxTokens)
	}
	// Reserved: 10000 * 0.6 = 6000
	if child.ReservedTokens != 6000 {
		t.Fatalf("ReservedTokens = %d, want 6000", child.ReservedTokens)
	}
}

func TestAllocateChildRatioClampedZero(t *testing.T) {
	parent := NewContextBudget(100_000)
	child := parent.AllocateChild(0) // should clamp to 0.4
	if child.MaxTokens != 36000 {
		t.Fatalf("MaxTokens = %d, want 36000 (clamped to 0.4)", child.MaxTokens)
	}
}

func TestAllocateChildRatioClampedNegative(t *testing.T) {
	parent := NewContextBudget(100_000)
	child := parent.AllocateChild(-0.5) // should clamp to 0.4
	if child.MaxTokens != 36000 {
		t.Fatalf("MaxTokens = %d, want 36000 (clamped to 0.4)", child.MaxTokens)
	}
}

func TestAllocateChildRatioClampedAboveOne(t *testing.T) {
	parent := NewContextBudget(100_000)
	child := parent.AllocateChild(1.5) // should clamp to 1.0
	// usable = 90000, 100% = 90000
	if child.MaxTokens != 90000 {
		t.Fatalf("MaxTokens = %d, want 90000", child.MaxTokens)
	}
	if child.ReservedTokens != 10000 {
		t.Fatalf("ReservedTokens = %d, want 10000", child.ReservedTokens)
	}
}

func TestAllocateChildWithAlreadyUsedTokens(t *testing.T) {
	parent := NewContextBudget(100_000)
	parent.Track(45000) // used half of usable (90000)
	// remaining = 45000, 40% = 18000
	child := parent.AllocateChild(0.4)
	if child.MaxTokens != 18000 {
		t.Fatalf("MaxTokens = %d, want 18000", child.MaxTokens)
	}
	// Reserved: 10000 * 0.4 = 4000
	if child.ReservedTokens != 4000 {
		t.Fatalf("ReservedTokens = %d, want 4000", child.ReservedTokens)
	}
}

func TestAllocateChildMinimumBudget(t *testing.T) {
	// Almost exhausted parent - remaining < 0 after ratio
	parent := NewContextBudget(100_000)
	parent.Track(89500) // remaining = 500, 40% = 200
	child := parent.AllocateChild(0.4)
	// Still valid since 200 > 0
	if child.MaxTokens != 200 {
		t.Fatalf("MaxTokens = %d, want 200", child.MaxTokens)
	}

	// Fully exhausted parent with small budget
	parent2 := NewContextBudget(100_000)
	parent2.Track(90000) // remaining = 0
	child2 := parent2.AllocateChild(0.4)
	// remaining * ratio = 0, falls back to minimum 10000
	if child2.MaxTokens != 10000 {
		t.Fatalf("MaxTokens = %d, want 10000 (minimum)", child2.MaxTokens)
	}
}

func TestAllocateChildIndependentTracking(t *testing.T) {
	parent := NewContextBudget(100_000)
	child := parent.AllocateChild(0.4) // child MaxTokens = 36000

	// Track tokens in child
	child.Track(10000)
	if child.UsedTokens.Load() != 10000 {
		t.Fatalf("child.UsedTokens = %d, want 10000", child.UsedTokens.Load())
	}

	// Parent's used tokens should be unchanged
	if parent.UsedTokens.Load() != 0 {
		t.Fatalf("parent.UsedTokens = %d, want 0 (independent)", parent.UsedTokens.Load())
	}

	// Child exhaustion should be independent
	if child.IsExhausted() {
		t.Fatal("child should not be exhausted yet")
	}
	child.Track(26000) // 36000 used = child.MaxTokens, usable = 36000-4000=32000
	// usable for child = 36000 - 4000 = 32000, used = 36000 >= 32000
	if !child.IsExhausted() {
		t.Fatal("child should be exhausted")
	}
	// Parent should still not be exhausted
	if parent.IsExhausted() {
		t.Fatal("parent should not be exhausted")
	}
}

func TestAllocateChildFullRatio(t *testing.T) {
	parent := NewContextBudget(100_000)
	child := parent.AllocateChild(1.0)
	// usable = 100000 - 10000 = 90000
	if child.MaxTokens != 90000 {
		t.Fatalf("MaxTokens = %d, want 90000", child.MaxTokens)
	}
	if child.ReservedTokens != 10000 {
		t.Fatalf("ReservedTokens = %d, want 10000", child.ReservedTokens)
	}
}

// ============================================================================
// Compaction Tests
// ============================================================================

// TestCompactHistoryBelowThreshold_NoTrigger verifies that when the message
// count is below keepRecent, no compaction is triggered.
func TestCompactHistoryBelowThreshold_NoTrigger(t *testing.T) {
	messages := []Message{
		{Role: "user", Content: "Hello"},
		{Role: "assistant", Content: "Hi there!"},
		{Role: "user", Content: "What is Go?"},
	}
	compacted, result := CompactHistory(messages, 10)
	if result != nil {
		t.Fatal("expected nil result when messages <= keepRecent")
	}
	if len(compacted) != 3 {
		t.Fatalf("len(compacted) = %d, want 3", len(compacted))
	}
}

// TestCompactHistoryAboveThreshold_Triggered verifies compaction is triggered
// when message count exceeds keepRecent.
func TestCompactHistoryAboveThreshold_Triggered(t *testing.T) {
	messages := make([]Message, 20)
	for i := range messages {
		messages[i] = Message{
			Role:    "user",
			Content: "Message number " + strings.Repeat("x", 100),
		}
	}
	// Add a decision in the older messages.
	messages[2] = Message{Role: "assistant", Content: "I decided to use PostgreSQL for the database."}

	compacted, result := CompactHistory(messages, 10)
	if result == nil {
		t.Fatal("expected non-nil result when messages > keepRecent")
	}
	if result.OriginalCount != 20 {
		t.Fatalf("OriginalCount = %d, want 20", result.OriginalCount)
	}
	// After compaction: 1 system summary + 10 recent = 11 messages.
	if result.CompactedCount != 11 {
		t.Fatalf("CompactedCount = %d, want 11", result.CompactedCount)
	}
	if len(compacted) != 11 {
		t.Fatalf("len(compacted) = %d, want 11", len(compacted))
	}
	// First message should be a system summary.
	if compacted[0].Role != "system" {
		t.Fatalf("compacted[0].Role = %q, want system", compacted[0].Role)
	}
	// TokensSaved should be positive.
	if result.TokensSaved <= 0 {
		t.Fatalf("TokensSaved = %d, want > 0", result.TokensSaved)
	}
}

// TestEstimateTokens_Accuracy verifies token estimation with various inputs.
func TestEstimateTokens_Accuracy(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		minWant  int
		maxWant  int
	}{
		{"empty", "", 0, 0},
		{"single", "a", 1, 1},
		{"four chars", "abcd", 1, 1},
		{"eight chars", "abcdefgh", 2, 2},
		{"long text", strings.Repeat("hello world ", 100), 300, 400},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := EstimateTokens(tt.text)
			if got < tt.minWant || got > tt.maxWant {
				t.Fatalf("EstimateTokens = %d, want in [%d, %d]", got, tt.minWant, tt.maxWant)
			}
		})
	}
}

// TestCompactHistory_SummaryContainsKeyInfo verifies that the generated
// summary contains information about decisions, errors, and file changes.
func TestCompactHistory_SummaryContainsKeyInfo(t *testing.T) {
	messages := []Message{
		{Role: "user", Content: "Build a REST API."},
		{Role: "assistant", Content: "I decided to use the Gin framework. I will create a main.go file."},
		{Role: "user", Content: "It failed."},
		{Role: "assistant", Content: "The error was a missing import. I fixed it by adding the package."},
		{Role: "user", Content: "Add tests."},
		{Role: "assistant", Content: "I created test files and modified the existing ones. The code compiles now."},
		// Filler messages to push above keepRecent=3.
		{Role: "user", Content: "Check 1"},
		{Role: "assistant", Content: "OK 1"},
		{Role: "user", Content: "Check 2"},
		{Role: "assistant", Content: "OK 2"},
		{Role: "user", Content: "Check 3"},
		{Role: "assistant", Content: "OK 3"},
		{Role: "user", Content: "Check 4"},
		{Role: "assistant", Content: "OK 4"},
		{Role: "user", Content: "Check 5"},
		{Role: "assistant", Content: "OK 5"},
		{Role: "user", Content: "Check 6"},
		{Role: "assistant", Content: "OK 6"},
		{Role: "user", Content: "Check 7"},
		{Role: "assistant", Content: "OK 7"},
	}
	compacted, result := CompactHistory(messages, 3)
	if result == nil {
		t.Fatal("expected non-nil compaction result")
	}
	if len(compacted) == 0 {
		t.Fatal("compacted should not be empty")
	}

	summary := result.Summary
	// Summary should mention the decision.
	if !strings.Contains(summary, "decided") && !strings.Contains(summary, "Decision") {
		t.Logf("summary: %s", summary)
		t.Error("summary should contain decision-related content")
	}
	// Summary should mention the error.
	if !strings.Contains(summary, "error") && !strings.Contains(summary, "Error") {
		t.Logf("summary: %s", summary)
		t.Error("summary should contain error-related content")
	}
	// Summary should mention file changes.
	if !strings.Contains(summary, "File") && !strings.Contains(summary, "created") {
		t.Logf("summary: %s", summary)
		t.Error("summary should contain file-change-related content")
	}
}

// TestEvictToBudget_BelowThreshold verifies that eviction reduces the token
// count below the specified budget.
func TestEvictToBudget_BelowThreshold(t *testing.T) {
	// Create messages where each is ~100 estimated tokens (400 chars).
	messages := make([]Message, 20)
	for i := range messages {
		messages[i] = Message{
			Role:    "user",
			Content: strings.Repeat("x", 400),
		}
	}

	// Each message is ~100 tokens, 20 messages = ~2000 tokens.
	// Set budget to 800 tokens: should keep ~8 messages.
	evicted := EvictToBudget(messages, 800)

	// Calculate actual tokens.
	totalTokens := 0
	for _, m := range evicted {
		totalTokens += EstimateTokens(m.Content)
	}
	if totalTokens > 800 {
		t.Fatalf("totalTokens after eviction = %d, want <= 800", totalTokens)
	}
	// Should have fewer messages than original.
	if len(evicted) >= len(messages) {
		t.Fatalf("len(evicted) = %d, want < %d", len(evicted), len(messages))
	}
	// Should have at least 1 message.
	if len(evicted) == 0 {
		t.Fatal("evicted should retain at least 1 message")
	}
}

// TestCompactHistory_EmptyHistory_NoPanic verifies that compacting an empty
// history does not panic.
func TestCompactHistory_EmptyHistory_NoPanic(t *testing.T) {
	// Empty messages should return empty without panic.
	compacted, result := CompactHistory(nil, 10)
	if result != nil {
		t.Fatal("expected nil result for nil messages")
	}
	if compacted != nil {
		t.Fatalf("expected nil compacted for nil messages, got %d items", len(compacted))
	}

	// Empty slice should also work.
	compacted, result = CompactHistory([]Message{}, 10)
	if result != nil {
		t.Fatal("expected nil result for empty messages")
	}
	if len(compacted) != 0 {
		t.Fatalf("len(compacted) = %d, want 0", len(compacted))
	}
}

// TestEvictToBudget_EmptyHistory_NoPanic verifies eviction on empty history.
func TestEvictToBudget_EmptyHistory_NoPanic(t *testing.T) {
	result := EvictToBudget(nil, 100)
	if result != nil {
		t.Fatalf("expected nil from EvictToBudget(nil), got %d items", len(result))
	}

	result = EvictToBudget([]Message{}, 100)
	if len(result) != 0 {
		t.Fatalf("len(result) = %d, want 0", len(result))
	}
}

// TestCompactHistory_DefaultKeepRecent verifies the default keepRecent of 10.
func TestCompactHistory_DefaultKeepRecent(t *testing.T) {
	messages := make([]Message, 25)
	for i := range messages {
		messages[i] = Message{Role: "user", Content: "msg " + strings.Repeat("x", 40)}
	}

	// keepRecent = 0 should default to 10.
	compacted, result := CompactHistory(messages, 0)
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	// After compaction: 1 system summary + 10 recent = 11 messages.
	if result.CompactedCount != 11 {
		t.Fatalf("CompactedCount = %d, want 11", result.CompactedCount)
	}
	if len(compacted) != 11 {
		t.Fatalf("len(compacted) = %d, want 11", len(compacted))
	}
}

// TestEvictToBudget_PreservesSystemSummary verifies that the first system
// message (compaction summary) is preserved during eviction.
func TestEvictToBudget_PreservesSystemSummary(t *testing.T) {
	messages := []Message{
		{Role: "system", Content: "[Compaction summary] Important context from earlier."},
		{Role: "user", Content: strings.Repeat("a", 400)},
		{Role: "assistant", Content: strings.Repeat("b", 400)},
		{Role: "user", Content: strings.Repeat("c", 400)},
		{Role: "assistant", Content: strings.Repeat("d", 400)},
	}

	// Set budget to only fit ~2 messages + the summary.
	evicted := EvictToBudget(messages, 300)

	// The system message should be preserved.
	if len(evicted) == 0 || evicted[0].Role != "system" {
		t.Fatal("first system message (compaction summary) should be preserved")
	}
}

// TestCompactHistory_KeepRecentNegative verifies negative keepRecent defaults to 10.
func TestCompactHistory_KeepRecentNegative(t *testing.T) {
	messages := make([]Message, 15)
	for i := range messages {
		messages[i] = Message{Role: "user", Content: "msg"}
	}
	compacted, result := CompactHistory(messages, -5)
	if result == nil {
		t.Fatal("expected non-nil result with 15 messages and keepRecent=-5 (defaults to 10)")
	}
	if result.CompactedCount != 11 {
		t.Fatalf("CompactedCount = %d, want 11", result.CompactedCount)
	}
	if len(compacted) != 11 {
		t.Fatalf("len(compacted) = %d, want 11", len(compacted))
	}
}

// TestEvictToBudget_ZeroBudget_NoChange verifies zero maxTokens is a no-op.
func TestEvictToBudget_ZeroBudget_NoChange(t *testing.T) {
	messages := []Message{
		{Role: "user", Content: "hello world"},
	}
	result := EvictToBudget(messages, 0)
	if len(result) != 1 {
		t.Fatalf("len(result) = %d, want 1 (no change for zero budget)", len(result))
	}
}

// TestEstimateTokens_LongText verifies estimation is proportional for long text.
func TestEstimateTokens_LongText(t *testing.T) {
	text := strings.Repeat("The quick brown fox jumps over the lazy dog. ", 1000)
	got := EstimateTokens(text)
	// 45 chars per repetition * 1000 = 45000 chars; 45000/4 = 11250 tokens (ceil).
	expected := 11250
	if got != expected {
		t.Fatalf("EstimateTokens(long) = %d, want %d", got, expected)
	}
}

// ============================================================================
// SanitizeMessage Tests
// ============================================================================

// TestSanitizeMessage_Normal verifies that a valid message passes through
// unchanged when no sanitization is needed.
func TestSanitizeMessage_Normal(t *testing.T) {
	m := Message{
		Role:    "user",
		Content: "Hello, world! This is a normal message.",
	}
	sanitized, filtered := SanitizeMessage(m)
	if filtered {
		t.Fatal("filtered = true, want false for normal message")
	}
	if sanitized.Role != "user" {
		t.Fatalf("Role = %q, want user", sanitized.Role)
	}
	if sanitized.Content != m.Content {
		t.Fatalf("Content = %q, want %q", sanitized.Content, m.Content)
	}
}

// TestSanitizeMessage_Empty verifies that an empty message is handled without
// error and still returns the original empty role/content.
func TestSanitizeMessage_Empty(t *testing.T) {
	m := Message{
		Role:    "",
		Content: "",
	}
	sanitized, filtered := SanitizeMessage(m)
	// Empty content has no control chars; empty role is invalid (not in allowlist),
	// so role gets replaced with "system" and content prefixed with "[Filtered]".
	if !filtered {
		t.Fatal("filtered = false, want true (empty role is invalid)")
	}
	if sanitized.Role != "system" {
		t.Fatalf("Role = %q, want system", sanitized.Role)
	}
	if sanitized.Content != "[Filtered] " {
		t.Fatalf("Content = %q, want '[Filtered] '", sanitized.Content)
	}
}

// TestSanitizeMessage_ControlChars verifies that ASCII control characters
// (except \t, \n, \r) are stripped and that DEL (0x7F) is removed.
func TestSanitizeMessage_ControlChars(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		want     string
		filtered bool
	}{
		{
			name:     "null byte",
			content:  "hello\x00world",
			want:     "helloworld",
			filtered: true,
		},
		{
			name:     "bell character",
			content:  "alert\x07here",
			want:     "alerthere",
			filtered: true,
		},
		{
			name:     "DEL character",
			content:  "delete\x7Fme",
			want:     "deleteme",
			filtered: true,
		},
		{
			name:     "tab is preserved",
			content:  "col1\tcol2",
			want:     "col1\tcol2",
			filtered: false,
		},
		{
			name:     "newline is preserved",
			content:  "line1\nline2",
			want:     "line1\nline2",
			filtered: false,
		},
		{
			name:     "carriage return is preserved",
			content:  "line1\rline2",
			want:     "line1\rline2",
			filtered: false,
		},
		{
			name:     "mixed control and printable",
			content:  "\x00Start\x01Middle\x02End",
			want:     "StartMiddleEnd",
			filtered: true,
		},
		{
			name:     "all printable",
			content:  "ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789",
			want:     "ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789",
			filtered: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := Message{Role: "user", Content: tt.content}
			sanitized, filtered := SanitizeMessage(m)
			if filtered != tt.filtered {
				t.Fatalf("filtered = %v, want %v", filtered, tt.filtered)
			}
			if sanitized.Content != tt.want {
				t.Fatalf("Content = %q, want %q", sanitized.Content, tt.want)
			}
			if sanitized.Role != "user" {
				t.Fatalf("Role = %q, want user", sanitized.Role)
			}
		})
	}
}

// TestSanitizeMessage_InvalidRole verifies that roles outside the allowlist
// {user, assistant, system, tool} are replaced with "system" and the content
// is prefixed with "[Filtered] ".
func TestSanitizeMessage_InvalidRole(t *testing.T) {
	tests := []struct {
		name string
		role string
	}{
		{"empty role", ""},
		{"unknown role", "moderator"},
		{"injection attempt", "admin"},
		{"malicious role", "<script>"},
		{"SQL injection", "user' OR '1'='1"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := Message{Role: tt.role, Content: "original content"}
			sanitized, filtered := SanitizeMessage(m)
			if !filtered {
				t.Fatal("filtered = false, want true for invalid role")
			}
			if sanitized.Role != "system" {
				t.Fatalf("Role = %q, want system", sanitized.Role)
			}
			expectedContent := "[Filtered] original content"
			if sanitized.Content != expectedContent {
				t.Fatalf("Content = %q, want %q", sanitized.Content, expectedContent)
			}
		})
	}
}

// TestSanitizeMessage_AllValidRoles verifies that all four allowed roles
// pass through without filtering.
func TestSanitizeMessage_AllValidRoles(t *testing.T) {
	for _, role := range []string{"user", "assistant", "system", "tool"} {
		t.Run(role, func(t *testing.T) {
			m := Message{Role: role, Content: "valid content"}
			sanitized, filtered := SanitizeMessage(m)
			if filtered {
				t.Fatalf("filtered = true, want false for valid role %q", role)
			}
			if sanitized.Role != role {
				t.Fatalf("Role = %q, want %q", sanitized.Role, role)
			}
		})
	}
}

// TestSanitizeMessage_Over32KB verifies that content exceeding
// MaxMessageContentSize (32KB) is truncated at a rune boundary without
// splitting multi-byte UTF-8 characters.
func TestSanitizeMessage_Over32KB(t *testing.T) {
	// Build content that exceeds 32KB.
	baseContent := strings.Repeat("a", MaxMessageContentSize+1000)
	m := Message{Role: "user", Content: baseContent}
	sanitized, filtered := SanitizeMessage(m)
	if !filtered {
		t.Fatal("filtered = false, want true for oversize content")
	}
	if len(sanitized.Content) > MaxMessageContentSize {
		t.Fatalf("Content length = %d, want <= %d", len(sanitized.Content), MaxMessageContentSize)
	}
	if sanitized.Content != baseContent[:MaxMessageContentSize] {
		t.Fatal("truncation should preserve the first MaxMessageContentSize bytes for ASCII content")
	}
}

// TestSanitizeMessage_Over32KB_RuneBoundary verifies that truncation at the
// 32KB boundary does not split a multi-byte UTF-8 character. The test places
// a 3-byte CJK character exactly at the cutoff.
func TestSanitizeMessage_Over32KB_RuneBoundary(t *testing.T) {
	// Fill with ASCII so we can precisely place a CJK character at the cutoff.
	prefix := strings.Repeat("A", MaxMessageContentSize-2)
	// Place a 3-byte CJK character (中 = 0xE4 0xB8 0xAD) that straddles the boundary.
	// prefix length = 32766, then "中" at bytes 32766-32768, then more content.
	content := prefix + "中" + strings.Repeat("B", 500)
	m := Message{Role: "user", Content: content}
	sanitized, filtered := SanitizeMessage(m)
	if !filtered {
		t.Fatal("filtered = false, want true for oversize content")
	}
	if len(sanitized.Content) > MaxMessageContentSize {
		t.Fatalf("Content length = %d, want <= %d", len(sanitized.Content), MaxMessageContentSize)
	}
	// The CJK character (3 bytes at position 32766-32768) crosses the 32768 boundary.
	// The truncation should stop at the last complete rune before 32768,
	// which is at position 32766 (the end of the prefix).
	// So sanitized content should be just the prefix (len 32766), not include the
	// split CJK character.
	if !strings.HasPrefix(sanitized.Content, prefix) {
		t.Fatal("truncated content should start with the ASCII prefix")
	}
	if strings.Contains(sanitized.Content, "中") {
		t.Fatal("truncated content should not contain the CJK character that straddles the boundary")
	}
	if strings.Contains(sanitized.Content, "B") {
		t.Fatal("truncated content should not contain the trailing content")
	}
}

// TestSanitizeMessage_Over32KB_CJK verifies that CJK text near the 32KB
// boundary is truncated cleanly at rune boundaries.
func TestSanitizeMessage_Over32KB_CJK(t *testing.T) {
	// Build content entirely of 3-byte CJK characters that exceeds 32KB.
	// Each "中" is 3 bytes in UTF-8.
	// 32KB = 32768 bytes. Floor(32768 / 3) = 10922 complete runes = 32766 bytes.
	// With 10923 runes, that's 32769 bytes, exceeding the limit.
	content := strings.Repeat("中", 11000) // 33KB
	m := Message{Role: "user", Content: content}
	sanitized, filtered := SanitizeMessage(m)
	if !filtered {
		t.Fatal("filtered = false, want true for oversize CJK content")
	}
	if len(sanitized.Content) > MaxMessageContentSize {
		t.Fatalf("Content length = %d, want <= %d", len(sanitized.Content), MaxMessageContentSize)
	}
	// Verify all runes are complete CJK characters (each 3 bytes).
	contentLen := len(sanitized.Content)
	if contentLen%3 != 0 {
		t.Fatalf("Content length %d is not a multiple of 3; CJK characters may be split", contentLen)
	}
}

// TestSanitizeMessage_Combined verifies that multiple sanitization steps
// are applied in the correct order: control chars stripped first, then
// truncation, then role validation.
func TestSanitizeMessage_Combined(t *testing.T) {
	// Content with control chars, exceeding 32KB, and an invalid role.
	oversizeContent := "Hello\x00" + strings.Repeat("A", MaxMessageContentSize) + " suffix"
	m := Message{Role: "invalid_role", Content: oversizeContent}
	sanitized, filtered := SanitizeMessage(m)
	if !filtered {
		t.Fatal("filtered = false, want true (multiple issues detected)")
	}
	// Role should be replaced.
	if sanitized.Role != "system" {
		t.Fatalf("Role = %q, want system", sanitized.Role)
	}
	// Content should be prefixed with "[Filtered] " because of invalid role.
	if !strings.HasPrefix(sanitized.Content, "[Filtered] ") {
		t.Fatalf("Content does not start with '[Filtered] ': %q", sanitized.Content[:40])
	}
	// Content should not contain the null byte.
	if strings.Contains(sanitized.Content, "\x00") {
		t.Fatal("content should not contain null byte after sanitization")
	}
	// Content should be truncated.
	if len(sanitized.Content) > MaxMessageContentSize+len("[Filtered] ") {
		t.Fatalf("Content length = %d, want <= %d", len(sanitized.Content), MaxMessageContentSize+len("[Filtered] "))
	}
}

// TestSanitizeMessage_PreservesTimestamp verifies that the original timestamp
// is preserved through sanitization.
func TestSanitizeMessage_PreservesTimestamp(t *testing.T) {
	now := time.Now()
	m := Message{Role: "user", Content: "hello", Timestamp: now}
	sanitized, _ := SanitizeMessage(m)
	if !sanitized.Timestamp.Equal(now) {
		t.Fatalf("Timestamp = %v, want %v", sanitized.Timestamp, now)
	}
}

// ============================================================================
// CheckTokenBudget: negative promptTokens
// ============================================================================

// TestCheckTokenBudget_NegativePromptTokens verifies that negative token counts
// are treated as critical (invalid input — suggests a bug upstream).
func TestCheckTokenBudget_NegativePromptTokens(t *testing.T) {
	ok, level := CheckTokenBudget(-1, 200000)
	if ok {
		t.Fatal("ok = true, want false for negative promptTokens")
	}
	if level != "critical" {
		t.Fatalf("level = %q, want critical", level)
	}
}

// TestCheckTokenBudget_NegativePromptTokensZeroMax verifies the edge case
// where promptTokens is negative but maxTokens is 0. Since maxTokens <= 0
// means "no budget constraint", the function short-circuits and returns ok.
// The negative promptTokens check is only reached when maxTokens > 0.
func TestCheckTokenBudget_NegativePromptTokensZeroMax(t *testing.T) {
	ok, level := CheckTokenBudget(-5, 0)
	if !ok {
		t.Fatal("ok = false, want true (zero maxTokens = no constraint)")
	}
	if level != "ok" {
		t.Fatalf("level = %q, want ok", level)
	}
}
