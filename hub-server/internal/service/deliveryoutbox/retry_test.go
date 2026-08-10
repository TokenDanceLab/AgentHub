package deliveryoutbox

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// retryJitterTolerance bounds the ±25% jitter envelope around the base delay.
const retryJitterTolerance = 0.25

// baseRetryDelay is the pure exponential backoff (pre-jitter) used as the
// reference center for jitter-range assertions. It mirrors the historical
// NextRetryDelay formula so tests assert the jitter envelope, not a pin.
func baseRetryDelay(attempt int) time.Duration {
	delay := RetryBaseInterval * time.Duration(int64(exp2(attempt)))
	if delay > RetryMaxInterval {
		delay = RetryMaxInterval
	}
	return delay
}

func exp2(attempt int) float64 {
	// math.Pow(2, attempt); inlined to avoid importing math in the test body.
	out := 1.0
	for i := 0; i < attempt; i++ {
		out *= 2
	}
	if attempt < 0 {
		// mirror math.Pow truncation behavior for negative attempts (→ 0.5, 0.25…)
		out = 1.0
		for i := 0; i < -attempt; i++ {
			out /= 2
		}
	}
	return out
}

// assertJittered asserts d lies within ±25% of center (and is non-negative).
func assertJittered(t *testing.T, center, d time.Duration) {
	t.Helper()
	lower := time.Duration(float64(center) * (1 - retryJitterTolerance))
	upper := time.Duration(float64(center) * (1 + retryJitterTolerance))
	assert.GreaterOrEqual(t, d, lower, "delay below jitter envelope: center=%s got=%s", center, d)
	assert.LessOrEqual(t, d, upper, "delay above jitter envelope: center=%s got=%s", center, d)
}

func TestNextRetryDelay(t *testing.T) {
	tests := []struct {
		name    string
		attempt int
		center  time.Duration
	}{
		{name: "attempt 0", attempt: 0, center: 2 * time.Second},
		{name: "attempt 1", attempt: 1, center: 4 * time.Second},
		{name: "attempt 2", attempt: 2, center: 8 * time.Second},
		{name: "attempt 3", attempt: 3, center: 16 * time.Second},
		{name: "attempt 4 capped", attempt: 4, center: RetryMaxInterval},
		{name: "attempt 10 capped", attempt: 10, center: RetryMaxInterval},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assertJittered(t, tt.center, NextRetryDelay(tt.attempt))
		})
	}

	// Negative attempt → math.Pow truncates to 0 → zero base → zero delay.
	t.Run("negative attempt is zero", func(t *testing.T) {
		assert.Equal(t, time.Duration(0), NextRetryDelay(-1))
	})

	// Jitter must actually vary the delay across calls (thundering-herd guard).
	// With ±25% on a 2s base, a large sample cannot be all-equal.
	t.Run("jitter produces variation", func(t *testing.T) {
		seen := make(map[time.Duration]struct{})
		for i := 0; i < 50; i++ {
			seen[NextRetryDelay(1)] = struct{}{}
		}
		assert.Greater(t, len(seen), 1, "NextRetryDelay produced no jitter variation across 50 calls")
	})

	// Center formula sanity: baseRetryDelay matches the documented exponential.
	t.Run("base center matches exponential", func(t *testing.T) {
		assert.Equal(t, 2*time.Second, baseRetryDelay(0))
		assert.Equal(t, 4*time.Second, baseRetryDelay(1))
		assert.Equal(t, RetryMaxInterval, baseRetryDelay(4))
	})
}

func TestNextRetryAt(t *testing.T) {
	now := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)
	// Jittered: assert the delay component (scheduled - now) lands within the
	// envelope of the base delay.
	assertJittered(t, 2*time.Second, NextRetryAt(0, now).Sub(now))
	assertJittered(t, 4*time.Second, NextRetryAt(1, now).Sub(now))
	// Capped attempt: center is RetryMaxInterval; jitter envelope around it.
	assertJittered(t, RetryMaxInterval, NextRetryAt(10, now).Sub(now))
}

func TestRetryConstants(t *testing.T) {
	assert.Equal(t, 3, DefaultMaxAttempts)
	assert.Equal(t, 2*time.Second, RetryBaseInterval)
	assert.Equal(t, 30*time.Second, RetryMaxInterval)
	assert.Equal(t, 15*time.Second, RetryScanInterval)
	assert.Equal(t, 30*time.Second, PendingTimeout)
	assert.Equal(t, 60*time.Second, SentTimeout)
	assert.Equal(t, 100, MaxBatch)
	assert.Equal(t, 0.25, RetryJitterFraction)
}
