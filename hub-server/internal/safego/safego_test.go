package safego

import "testing"

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
