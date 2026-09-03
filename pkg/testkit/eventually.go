// Package testkit provides shared deterministic-test helpers (#1550):
// channel/condition waits with explicit deadlines instead of fixed sleeps or
// unbounded polling. Tests that need "eventually" use these; tests that
// assert a fixed delay (heartbeat, TTL, backoff) belong to clock-injectable
// seams, not sleeps.
//
// The verbatim copies in hub-server/internal/testkit and
// edge-server/internal/testkit (and the forwarding shims that replaced them)
// are gone: callers import this package directly. hub-server/internal/testkit
// keeps only Hub-specific fixtures.
package testkit

import (
	"testing"
	"time"
)

// pollInterval is the default condition poll cadence.
const pollInterval = 5 * time.Millisecond

// WaitFor blocks until done closes or timeout expires, failing the test on
// timeout. Prefer this over time.Sleep when waiting for an event.
func WaitFor(t *testing.T, timeout time.Duration, done <-chan struct{}, msg string) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(timeout):
		t.Fatalf("%s (timed out after %v)", msg, timeout)
	}
}

// Eventually polls cond every pollInterval until it returns true or timeout
// expires. On timeout the test fails with msg; dump (optional) is appended to
// the failure message to show component state at the moment of failure.
// Prefer this over unbounded or silent polling loops.
func Eventually(t *testing.T, timeout time.Duration, cond func() bool, msg string, dump func() string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(pollInterval)
	}
	extra := ""
	if dump != nil {
		extra = "\n" + dump()
	}
	t.Fatalf("%s (timed out after %v)%s", msg, timeout, extra)
}
