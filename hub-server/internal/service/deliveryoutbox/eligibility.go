package deliveryoutbox

import "time"

// PendingRetryCutoff returns the created_at upper bound for pending scan
// eligibility (created_at <= now - PendingTimeout).
func PendingRetryCutoff(now time.Time) time.Time {
	return now.Add(-PendingTimeout)
}

// SentRetryCutoff returns the updated_at upper bound for sent scan
// eligibility (updated_at <= now - SentTimeout).
func SentRetryCutoff(now time.Time) time.Time {
	return now.Add(-SentTimeout)
}

// IsRetryingDue reports whether a retrying row is due for another attempt at now.
// nextRetryAt nil is never due.
func IsRetryingDue(nextRetryAt *time.Time, now time.Time) bool {
	return nextRetryAt != nil && !nextRetryAt.After(now)
}

// NextAttempt returns the attempt counter after one more try.
func NextAttempt(attemptCount int) int {
	return attemptCount + 1
}

// ShouldDeadLetter reports whether the next attempt would exhaust maxAttempts.
// Matches historical MarkDeliveryRetrying: newAttempt >= MaxAttempts → dead.
func ShouldDeadLetter(attemptCount, maxAttempts int) bool {
	return NextAttempt(attemptCount) >= maxAttempts
}
