package events

import (
	"sync/atomic"
	"testing"
	"time"
)

// newBusWithPersistForTest returns a Bus whose persistFn hook is set directly.
// The exported WithPersister option was removed (no production caller); the
// hook is still how WithEventLogPath wires durable persistence, so the retry
// machinery below is exercised through the same field.
func newBusWithPersistForTest(fn PersistFn) *Bus {
	b := NewBus(100)
	b.persistFn = fn
	return b
}

// TestBus_PersistRetryRecoversTransientFailure verifies that the synchronous
// retry loop recovers a persistFn failure that succeeds on a later attempt:
// the event is persisted, appended to history, and broadcast to subscribers
// (not dropped).
func TestBus_PersistRetryRecoversTransientFailure(t *testing.T) {
	var attempts atomic.Int64
	var failUntil atomic.Int64
	failUntil.Store(2) // fail attempts 0 and 1, succeed from attempt 2 onward

	b := newBusWithPersistForTest(func(evt EventEnvelope) error {
		n := attempts.Add(1)
		if n <= failUntil.Load() {
			return errAssert
		}
		return nil
	})
	// Default retry budget (3) is enough to reach the 3rd attempt.
	t.Cleanup(func() { _ = b.Close() })

	_, ch, _ := b.Subscribe(0)

	evt := b.Publish("retry.recover", nil, "payload")
	if evt.ID == "" {
		t.Fatalf("expected event recovered by retry (non-empty ID), got empty. attempts=%d", attempts.Load())
	}

	select {
	case received := <-ch:
		if received.Type != "retry.recover" {
			t.Fatalf("received Type = %q, want retry.recover", received.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for retry-recovered event")
	}

	if got := b.PersistFailures(); got != 0 {
		t.Fatalf("expected 0 persist failures (recovered), got %d", got)
	}
}

// TestBus_PersistRetryExhaustedDropsAndCounts verifies that when persistFn
// fails every attempt (including retries), the event is dropped AND the
// persistFailures counter is incremented exactly once.
func TestBus_PersistRetryExhaustedDropsAndCounts(t *testing.T) {
	var attempts atomic.Int64
	b := newBusWithPersistForTest(func(evt EventEnvelope) error {
		attempts.Add(1)
		return errAssert // always fails
	})
	t.Cleanup(func() { _ = b.Close() })

	_, ch, _ := b.Subscribe(0)

	evt := b.Publish("retry.exhaust", nil, "lost")
	if evt.ID != "" {
		t.Fatalf("expected event dropped after retries (empty ID), got %s", evt.ID)
	}

	select {
	case <-ch:
		t.Fatal("subscriber should not receive an event whose persist exhausted all retries")
	case <-time.After(100 * time.Millisecond):
		// expected
	}

	if got := b.PersistFailures(); got != 1 {
		t.Fatalf("expected PersistFailures=1, got %d", got)
	}
	// Default budget: 1 original + 3 retries = 4 attempts.
	if got := attempts.Load(); got != int64(persistDefaultMaxRetries+1) {
		t.Fatalf("expected %d persist attempts (1 original + %d retries), got %d",
			persistDefaultMaxRetries+1, persistDefaultMaxRetries, got)
	}
}

// TestBus_PersistFailuresAccumulatesAcrossDrops verifies the counter
// accumulates across multiple dropped events.
func TestBus_PersistFailuresAccumulatesAcrossDrops(t *testing.T) {
	b := newBusWithPersistForTest(func(evt EventEnvelope) error { return errAssert })
	t.Cleanup(func() { _ = b.Close() })

	for i := 0; i < 4; i++ {
		_ = b.Publish("drop", nil, i)
	}
	if got := b.PersistFailures(); got != 4 {
		t.Fatalf("expected PersistFailures=4 after 4 drops, got %d", got)
	}
}
