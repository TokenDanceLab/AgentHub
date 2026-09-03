package bus

// #2246 slice 1: Publish's handler closure recovered panics with a private,
// bare recover() that incremented metrics.EventBusPanics and logged its own
// debug.Stack(). It is now the single recovery path, pkg/safego, and the
// bus-specific counter is fed by the Hub's name-dispatching PanicObserver
// (internal/metrics.hubPanicObserver) instead of by the bus package.
//
// These tests pin the three things that convergence could silently have
// broken: the pending accounting across the panic, the *order* of the two
// defers that replaced the single one, and the counter's new producer.
//
// No time.Sleep in this file: the test-sleep ratchet
// (scripts/verify/verify-test-sleep-ratchet.py) budgets sleeps per file and a
// newly added file has no baseline entry, so every wait here is channel- or
// ticker-driven.

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/pkg/safego"
)

// observerRecord is what a test-installed PanicObserver captures: the safego
// name the panic was recovered under, and the bus's Pending() value *at the
// instant the observer ran*.
type observerRecord struct {
	name    string
	pending int64
}

// awaitPendingZero waits for the bus to report itself drained. Deliberately
// ticker-driven rather than time.Sleep-driven (see the file comment).
func awaitPendingZero(t *testing.T, b *Bus) {
	t.Helper()
	deadline := time.After(3 * time.Second)
	tick := time.NewTicker(time.Millisecond)
	defer tick.Stop()
	for b.Pending() > 0 {
		select {
		case <-tick.C:
		case <-deadline:
			t.Fatalf("Pending() = %d, want 0: the bus never drained", b.Pending())
		}
	}
}

// publishOnePanickingHandler subscribes a handler that panics and publishes a
// single event to it. The panic is recovered on the pool worker, so Publish
// itself must return nil.
func publishOnePanickingHandler(t *testing.T, b *Bus) {
	t.Helper()
	b.Subscribe("safego.probe", func(context.Context, Event) {
		panic("induced panic for the safego convergence test")
	})
	require.NoError(t, b.Publish(context.Background(), Event{Type: "safego.probe"}),
		"Publish must accept the handler; the panic happens asynchronously")
}

// installRecordingObserver swaps the process-global safego hook for one that
// reports (name, Pending()) and restores the Hub's real dispatch on cleanup.
// pkg/safego keeps exactly one slot, so a test that borrows it must give it
// back rather than leave the rest of the package with a foreign or nil hook.
func installRecordingObserver(t *testing.T, b *Bus) <-chan observerRecord {
	t.Helper()
	recorded := make(chan observerRecord, 4)
	safego.SetPanicObserver(func(name string, _ any, _ string) {
		select {
		case recorded <- observerRecord{name: name, pending: b.Pending()}:
		default:
		}
	})
	t.Cleanup(metrics.InstallPanicObserver)
	return recorded
}

// TestPublish_HandlerPanic_RecoverRunsBeforePendingDecrement is the load-bearing
// one. Replacing the closure's single defer with two changed *when* the pending
// decrement happens relative to the recovery, and Go unwinds deferred calls
// LIFO: Publish registers `defer func(){ b.pending.Add(-1) }()` first and
// `defer safego.Recover(...)` second, so recovery runs first and the decrement
// runs after it.
//
// The observable consequence — and the reason the order is worth a test rather
// than a comment — is that while the PanicObserver is running, the panicking
// handler is still counted as pending. Swap the two defers and the observer
// instead sees a bus that already looks drained: Pending() hits 0 *before* the
// panic has been logged or counted, so a Close()/drain that waits on Pending()
// can race ahead of the metric and an operator polling Pending() sees an idle
// bus whose panic has not been recorded yet.
//
// Note what this is NOT: swapping the defers does not leak the pending count.
// A deferred call registered during unwinding still runs to completion, so
// b.pending.Add(-1) happens either way and Pending() still returns to 0 (see
// TestPublish_HandlerPanic_PendingReturnsToZero, which passes in both orders).
// The invariant pinned here is the accounting-before-drain ordering, which is
// the only difference the two orders actually make.
func TestPublish_HandlerPanic_RecoverRunsBeforePendingDecrement(t *testing.T) {
	b := newTestBus(t)
	recorded := installRecordingObserver(t, b)
	publishOnePanickingHandler(t, b)

	// Read the record before draining: the observer fires while the worker is
	// still unwinding, so this is the deterministic observation point. Waiting
	// on Pending() first would make the reversed-defer regression fail only
	// sometimes (empty channel) instead of always (pending == 0).
	var rec observerRecord
	select {
	case rec = <-recorded:
	case <-time.After(3 * time.Second):
		t.Fatal("the handler panic never reached a safego PanicObserver: Publish's closure is not recovering through pkg/safego")
	}

	assert.Equal(t, "eventbus.handler", rec.name,
		"bus handler panics must be recovered under the stable safego name eventbus.handler, "+
			"which is what routes them to eventbus_panics_total (#2246)")
	assert.Equal(t, int64(1), rec.pending,
		"safego.Recover must run BEFORE b.pending.Add(-1). Publish registers the decrement "+
			"first and the recover second so LIFO unwinding recovers-then-decrements; reading 0 "+
			"here means the two defers were swapped, which reports the bus as drained before the "+
			"panic has been logged or counted")

	// And the accounting itself still balances.
	awaitPendingZero(t, b)
	assert.Equal(t, int64(0), b.Pending(), "pending must return to 0 after a recovered handler panic")
}

// TestPublish_HandlerPanic_PendingReturnsToZero pins the plain accounting
// guarantee the brief asks for: a handler panic must not leak the pending
// counter, or Pending() over-reports forever and Close() spins to its deadline
// on every shutdown.
func TestPublish_HandlerPanic_PendingReturnsToZero(t *testing.T) {
	b := newTestBus(t)
	recorded := installRecordingObserver(t, b)
	publishOnePanickingHandler(t, b)

	select {
	case <-recorded:
	case <-time.After(3 * time.Second):
		t.Fatal("the handler panic never reached a safego PanicObserver")
	}

	awaitPendingZero(t, b)
	assert.Equal(t, int64(0), b.Pending(),
		"a recovered handler panic must leave Pending() at 0; a leak means the decrement "+
			"was lost when the single defer was split in two (#2246)")

	// The bus must still be usable afterwards.
	var ran sync.WaitGroup
	ran.Add(1)
	b.Subscribe("safego.after", func(context.Context, Event) { ran.Done() })
	require.NoError(t, b.Publish(context.Background(), Event{Type: "safego.after"}))
	waitDone(t, &ran)
}

// TestPublish_HandlerPanic_CountedByHubObserverNotByBus pins the metric's new
// producer: the bus package no longer calls metrics.EventBusPanics.Inc() on the
// handler path, yet eventbus_panics_total still moves, because the Hub's
// safego PanicObserver dispatches on the "eventbus." name prefix. This is the
// assertion that would catch someone converging the recover() and quietly
// dropping the bus-specific counter with it.
func TestPublish_HandlerPanic_CountedByHubObserverNotByBus(t *testing.T) {
	// The real hub observer, installed by package metrics' init(); make sure no
	// sibling test left a recording one behind.
	metrics.InstallPanicObserver()
	metrics.Register()

	busBefore := testutil.ToFloat64(metrics.EventBusPanics)
	goroutineBefore := testutil.ToFloat64(metrics.GoroutinePanicRecoveries)

	b := newTestBus(t)
	done := make(chan struct{}, 1)
	b.Subscribe("safego.metric", func(context.Context, Event) {
		done <- struct{}{}
		panic("induced panic for the metric dispatch test")
	})
	require.NoError(t, b.Publish(context.Background(), Event{Type: "safego.metric"}))

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("the handler never ran")
	}
	awaitPendingZero(t, b)

	// The observer runs synchronously inside safego.Recover, which completes
	// before the pending decrement, so by the time Pending() is 0 both counters
	// have already moved. No polling needed.
	assert.Equal(t, float64(1), testutil.ToFloat64(metrics.EventBusPanics)-busBefore,
		"a panic recovered under eventbus.handler must add exactly 1 to eventbus_panics_total "+
			"via the Hub observer's name dispatch — 0 means the counter was dropped with the "+
			"private Inc, 2 means the ants pool handler also fired for the same panic")
	assert.Equal(t, float64(1), testutil.ToFloat64(metrics.GoroutinePanicRecoveries)-goroutineBefore,
		"every safego-recovered panic must also count once in goroutine_panic_recoveries_total")
}

// waitDone waits on a WaitGroup without time.Sleep (see the file comment).
func waitDone(t *testing.T, wg *sync.WaitGroup) {
	t.Helper()
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for the follow-up handler to run")
	}
}
