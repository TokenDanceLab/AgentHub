package deliveryoutbox

import (
	"math"
	"time"
)

// Retry / TTL constants for the delivery outbox scan and backoff paths.
const (
	// DefaultMaxAttempts is the default retry budget before dead-letter.
	DefaultMaxAttempts = 3

	// RetryBaseInterval is the base backoff interval (multiplied by 2^attempt).
	RetryBaseInterval = 2 * time.Second

	// RetryMaxInterval caps the exponential backoff ceiling.
	RetryMaxInterval = 30 * time.Second

	// RetryScanInterval controls how often retryable deliveries are scanned.
	RetryScanInterval = 15 * time.Second

	// PendingTimeout is the time after which a pending (never sent) delivery
	// is eligible for retry.
	PendingTimeout = 30 * time.Second

	// SentTimeout is the time after which a sent (unacked) delivery
	// is eligible for retry.
	SentTimeout = 60 * time.Second

	// MaxBatch caps the number of deliveries scanned per retry cycle.
	MaxBatch = 100
)

// NextRetryDelay calculates the exponential backoff delay for a retry attempt.
// Formula: RetryBaseInterval * 2^attempt, capped at RetryMaxInterval.
// Negative attempts use the same math.Pow behavior as the historical helper.
func NextRetryDelay(attempt int) time.Duration {
	delay := RetryBaseInterval * time.Duration(int64(math.Pow(2, float64(attempt))))
	if delay > RetryMaxInterval {
		delay = RetryMaxInterval
	}
	return delay
}

// NextRetryAt returns now + NextRetryDelay(attempt). The clock is injectable
// so unit tests can stay deterministic.
func NextRetryAt(attempt int, now time.Time) time.Time {
	return now.Add(NextRetryDelay(attempt))
}
