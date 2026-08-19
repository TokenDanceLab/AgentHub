package deliveryoutbox

import (
	"math"
	"math/rand"
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

	// RetryJitterFraction is the symmetric jitter applied to each backoff as a
	// fraction of the computed delay (±25%). Spreading retries avoids a
	// thundering herd when many deliveries become eligible simultaneously
	// after a Hub outage recovery.
	RetryJitterFraction = 0.25

	// Retention is how long a delivered or dead-letter outbox row is kept
	// before CleanupOldDeliveries purges it. 7 days balances operator audit
	// window against unbounded table growth.
	Retention = 7 * 24 * time.Hour

	// CleanupInterval is how often the background cleanup loop fires. 24h
	// keeps the purge off the hot path; the retention window (not the
	// cadence) governs how old a row must be to qualify.
	CleanupInterval = 24 * time.Hour
)

// NextRetryDelay calculates the exponential backoff delay for a retry attempt
// with ±25% jitter. Formula: RetryBaseInterval * 2^attempt, capped at
// RetryMaxInterval, then multiplied by (1 + rand(±25%)). Jitter prevents
// thundering-herd retries when many deliveries recover at once. Negative
// attempts use the same math.Pow behavior as the historical helper (→ 0).
func NextRetryDelay(attempt int) time.Duration {
	base := RetryBaseInterval * time.Duration(int64(math.Pow(2, float64(attempt))))
	if base > RetryMaxInterval {
		base = RetryMaxInterval
	}
	return applyRetryJitter(base)
}

// NextRetryAt returns now + NextRetryDelay(attempt). The clock is injectable
// so unit tests can stay deterministic.
func NextRetryAt(attempt int, now time.Time) time.Time {
	return now.Add(NextRetryDelay(attempt))
}

// applyRetryJitter applies a symmetric ±RetryJitterFraction jitter to delay.
// A zero/negative delay stays zero (no negative backoff).
func applyRetryJitter(delay time.Duration) time.Duration {
	if delay <= 0 {
		return delay
	}
	jitter := int64(float64(delay) * RetryJitterFraction)
	if jitter <= 0 {
		return delay
	}
	// rand.Int63n(2*jitter+1) ∈ [0, 2*jitter]; shift to [-jitter, +jitter].
	// #nosec G404 -- backoff jitter only; randomness is not security-sensitive.
	delta := rand.Int63n(2*jitter+1) - jitter
	return delay + time.Duration(delta)
}
