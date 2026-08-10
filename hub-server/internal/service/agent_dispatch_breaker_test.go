package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// TestEdgeCircuitBreaker_NilAllowsAll pins the nil-safe passthrough contract:
// partial test constructions that build &DispatchService{} leave edgeBreaker
// nil, and a nil breaker must allow every dispatch (no-op).
func TestEdgeCircuitBreaker_NilAllowsAll(t *testing.T) {
	var nilBreaker *edgeCircuitBreaker
	assert.True(t, nilBreaker.Allow(), "nil breaker must allow")
	nilBreaker.RecordFailure()
	nilBreaker.RecordSuccess()
	assert.Equal(t, edgeBreakerClosed, nilBreaker.State(), "nil breaker reports closed")
}

// TestEdgeCircuitBreaker_OpensAfterThresholdFailures pins the core fix: after
// edgeBreakerFailureThreshold consecutive edge failures the breaker opens and
// fails fast so subsequent dispatches do not block for the HTTP timeout.
func TestEdgeCircuitBreaker_OpensAfterThresholdFailures(t *testing.T) {
	b := &edgeCircuitBreaker{}
	assert.Equal(t, edgeBreakerClosed, b.State())

	for i := 0; i < edgeBreakerFailureThreshold; i++ {
		assert.True(t, b.Allow(), "closed breaker allows attempt %d", i+1)
		b.RecordFailure()
	}
	assert.Equal(t, edgeBreakerOpen, b.State(), "breaker must open after %d failures", edgeBreakerFailureThreshold)
	assert.False(t, b.Allow(), "open breaker must deny the next attempt")
}

// TestEdgeCircuitBreaker_HalfOpenProbeClosesOnSuccess pins the recovery path:
// after openDuration elapses the breaker admits a single probe, and a
// successful probe closes the breaker so normal traffic resumes.
func TestEdgeCircuitBreaker_HalfOpenProbeClosesOnSuccess(t *testing.T) {
	b := &edgeCircuitBreaker{}
	// Force open by recording threshold failures.
	for i := 0; i < edgeBreakerFailureThreshold; i++ {
		b.RecordFailure()
	}
	assert.Equal(t, edgeBreakerOpen, b.State())

	// Simulate openDuration elapsing by rewinding openUntil into the past.
	b.mu.Lock()
	b.openUntil = time.Now().Add(-time.Second)
	b.mu.Unlock()
	assert.Equal(t, edgeBreakerHalfOpen, b.State(), "effective state is half-open after open window elapses")

	assert.True(t, b.Allow(), "half-open breaker must admit exactly one probe")
	assert.False(t, b.Allow(), "second probe while one is in-flight must be denied")

	b.RecordSuccess()
	assert.Equal(t, edgeBreakerClosed, b.State(), "successful probe closes the breaker")
	assert.True(t, b.Allow(), "closed breaker allows all traffic again")
}

// TestEdgeCircuitBreaker_HalfOpenProbeReopensOnFailure pins that a failed
// probe reopens the breaker for another openDuration window instead of
// letting traffic through to a still-broken Edge.
func TestEdgeCircuitBreaker_HalfOpenProbeReopensOnFailure(t *testing.T) {
	b := &edgeCircuitBreaker{}
	for i := 0; i < edgeBreakerFailureThreshold; i++ {
		b.RecordFailure()
	}
	b.mu.Lock()
	b.openUntil = time.Now().Add(-time.Second)
	b.mu.Unlock()

	assert.True(t, b.Allow(), "half-open breaker admits one probe")
	b.RecordFailure()
	assert.Equal(t, edgeBreakerOpen, b.State(), "failed probe reopens the breaker")
	assert.False(t, b.Allow(), "reopened breaker denies traffic")
}

// TestEdgeCircuitBreaker_SuccessResetsFailureCount pins that a success in the
// closed state resets the consecutive-failure counter so transient single
// failures do not accumulate toward the threshold across recovered intervals.
func TestEdgeCircuitBreaker_SuccessResetsFailureCount(t *testing.T) {
	b := &edgeCircuitBreaker{}
	b.RecordFailure()
	b.RecordFailure()
	b.RecordSuccess()
	for i := 0; i < edgeBreakerFailureThreshold-1; i++ {
		b.RecordFailure()
	}
	assert.Equal(t, edgeBreakerClosed, b.State(), "success must reset the counter so threshold-1 failures stay closed")
}
