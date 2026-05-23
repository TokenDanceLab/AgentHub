package runnerctx

import (
	"sync"
	"testing"
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
		name  string
		chars int
		want  int
	}{
		{"zero", 0, 0},
		{"one", 1, 1},
		{"four", 4, 1},
		{"five", 5, 2},
		{"hundred", 100, 25},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := EstimateTokens(tt.chars)
			if got != tt.want {
				t.Fatalf("EstimateTokens(%d) = %d, want %d", tt.chars, got, tt.want)
			}
		})
	}
}

