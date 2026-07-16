package deliveryoutbox

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestNextRetryDelay(t *testing.T) {
	tests := []struct {
		name    string
		attempt int
		want    time.Duration
	}{
		{name: "attempt 0", attempt: 0, want: 2 * time.Second},
		{name: "attempt 1", attempt: 1, want: 4 * time.Second},
		{name: "attempt 2", attempt: 2, want: 8 * time.Second},
		{name: "attempt 3", attempt: 3, want: 16 * time.Second},
		{name: "attempt 4 capped", attempt: 4, want: 30 * time.Second},
		{name: "attempt 10 capped", attempt: 10, want: RetryMaxInterval},
		// math.Pow(2, -1) == 0.5 → int64 cast truncates to 0 → zero delay.
		{name: "negative attempt", attempt: -1, want: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, NextRetryDelay(tt.attempt))
		})
	}
}

func TestNextRetryAt(t *testing.T) {
	now := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)
	assert.Equal(t, now.Add(2*time.Second), NextRetryAt(0, now))
	assert.Equal(t, now.Add(4*time.Second), NextRetryAt(1, now))
	assert.Equal(t, now.Add(RetryMaxInterval), NextRetryAt(10, now))
}

func TestRetryConstants(t *testing.T) {
	assert.Equal(t, 3, DefaultMaxAttempts)
	assert.Equal(t, 2*time.Second, RetryBaseInterval)
	assert.Equal(t, 30*time.Second, RetryMaxInterval)
	assert.Equal(t, 15*time.Second, RetryScanInterval)
	assert.Equal(t, 30*time.Second, PendingTimeout)
	assert.Equal(t, 60*time.Second, SentTimeout)
	assert.Equal(t, 100, MaxBatch)
}
