package deliveryoutbox

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestPendingRetryCutoff(t *testing.T) {
	now := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)
	assert.Equal(t, now.Add(-PendingTimeout), PendingRetryCutoff(now))
}

func TestSentRetryCutoff(t *testing.T) {
	now := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)
	assert.Equal(t, now.Add(-SentTimeout), SentRetryCutoff(now))
}

func TestIsRetryingDue(t *testing.T) {
	now := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)
	past := now.Add(-time.Second)
	future := now.Add(time.Second)

	assert.False(t, IsRetryingDue(nil, now))
	assert.True(t, IsRetryingDue(&past, now))
	assert.True(t, IsRetryingDue(&now, now))
	assert.False(t, IsRetryingDue(&future, now))
}

func TestNextAttempt(t *testing.T) {
	assert.Equal(t, 1, NextAttempt(0))
	assert.Equal(t, 3, NextAttempt(2))
}

func TestShouldDeadLetter(t *testing.T) {
	// maxAttempts=3 → attempts 0→1, 1→2 allowed; 2→3 dead.
	assert.False(t, ShouldDeadLetter(0, 3))
	assert.False(t, ShouldDeadLetter(1, 3))
	assert.True(t, ShouldDeadLetter(2, 3))
	assert.True(t, ShouldDeadLetter(3, 3))
}
