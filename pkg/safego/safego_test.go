package safego

import (
	"sync/atomic"
	"testing"
)

// TestSafeGoRecoversPanic verifies the panic-recovering goroutine launcher:
// without the recover, this test would crash the whole test process.
func TestSafeGoRecoversPanic(t *testing.T) {
	done := make(chan struct{})
	SafeGo("test.panic", func() {
		defer close(done)
		panic("boom")
	})
	<-done
}

// TestSafeGoRunsFunctionNormally verifies the success path completes.
func TestSafeGoRunsFunctionNormally(t *testing.T) {
	done := make(chan struct{})
	SafeGo("test.ok", func() {
		close(done)
	})
	<-done
}

// TestSafeGoForwardsPanicToObserver verifies the registered observer receives
// the panic value (the Hub wires a metrics counter here).
func TestSafeGoForwardsPanicToObserver(t *testing.T) {
	var calls atomic.Int64
	var seenName atomic.Value
	observed := make(chan struct{})
	// The observer is process-global: earlier tests in this package launch
	// fire-and-forget goroutines whose recover may run after those tests
	// return, so filter on this test's goroutine name to avoid cross-test
	// interference (and a double close of observed).
	SetPanicObserver(func(name string, panicValue any, stack string) {
		if name != "test.observed" {
			return
		}
		calls.Add(1)
		seenName.Store(name)
		close(observed)
	})
	defer SetPanicObserver(nil)

	done := make(chan struct{})
	SafeGo("test.observed", func() {
		defer close(done)
		panic("observed-boom")
	})
	<-done
	// The observer runs in the recovering defer AFTER fn's own defers, so wait
	// for the observer to signal rather than racing on fn completion.
	<-observed

	if calls.Load() != 1 {
		t.Fatalf("observer calls = %d, want 1", calls.Load())
	}
	if name, _ := seenName.Load().(string); name != "test.observed" {
		t.Fatalf("observer name = %q, want test.observed", name)
	}
}
