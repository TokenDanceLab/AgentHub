// Package testkit re-exports the shared deterministic-test helpers owned by
// pkg/testkit (#1550). hub callers keep their existing testkit.* imports.
package testkit

import (
	"testing"
	"time"

	pkgtestkit "github.com/agenthub/pkg/testkit"
)

// WaitFor blocks until done closes or timeout expires, failing the test on
// timeout. Prefer this over time.Sleep when waiting for an event.
func WaitFor(t *testing.T, timeout time.Duration, done <-chan struct{}, msg string) {
	t.Helper()
	pkgtestkit.WaitFor(t, timeout, done, msg)
}

// Eventually polls cond every 5ms until it returns true or timeout expires.
// On timeout the test fails with msg; dump (optional) is appended to the
// failure message to show component state at the moment of failure.
func Eventually(t *testing.T, timeout time.Duration, cond func() bool, msg string, dump func() string) {
	t.Helper()
	pkgtestkit.Eventually(t, timeout, cond, msg, dump)
}
