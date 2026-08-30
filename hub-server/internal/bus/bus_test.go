package bus

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// init registers the prometheus counters exercised by the bus panic/failure
// branches (EventBusPanics, EventBusSubmitFailures). Register is guarded by
// sync.Once so it is safe to call from each test binary.
func init() {
	metrics.Register()
}

// newTestBus returns a fresh Bus whose pool is released on test cleanup.
func newTestBus(t *testing.T) *Bus {
	t.Helper()
	b, err := New()
	require.NoError(t, err, "New() must not error")
	t.Cleanup(func() { b.Close(context.Background()) })
	return b
}

// drainBus waits until the bus reports no pending work, failing the test if
// that does not happen within a generous deadline. It deliberately waits on
// Pending() (the bus's own completion counter, decremented in each handler's
// defer) rather than Running() (ants pool worker occupancy): an idle ants
// worker does not exit immediately after a handler returns, so gating on
// Running()==0 would add a ~1-3s purge wait per publish with no correctness
// benefit — Pending()==0 is the true "all dispatched handlers have finished"
// signal (P1: bus drain 语义).
func drainBus(t *testing.T, b *Bus) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && b.Pending() > 0 {
		time.Sleep(time.Millisecond)
	}
	if got := b.Pending(); got != 0 {
		t.Fatalf("drain: Pending=%d, want 0", got)
	}
}

// ── Construction ────────────────────────────────────────────────────────

func TestNew_CreatesUsableBus(t *testing.T) {
	b := newTestBus(t)
	assert.False(t, b.IsClosed(), "fresh bus must not be closed")
	assert.Equal(t, int64(0), b.Pending(), "fresh bus pending must be 0")
	assert.Equal(t, 0, b.Running(), "fresh bus running must be 0")
}

// ── Basic delivery ───────────────────────────────────────────────────────

// TestPublish_SingleSubscriberReceives: Publish one event → the single
// registered handler for that type receives the exact event.
func TestPublish_SingleSubscriberReceives(t *testing.T) {
	b := newTestBus(t)

	var got atomic.Value
	b.Subscribe("user.created", func(ctx context.Context, e Event) {
		assert.Equal(t, "user.created", e.Type)
		assert.Equal(t, "alice", e.Payload)
		got.Store(e.Payload)
	})

	b.Publish(context.Background(), Event{Type: "user.created", Payload: "alice"})

	drainBus(t, b)
	val, ok := got.Load().(string)
	require.True(t, ok, "handler must have stored payload")
	assert.Equal(t, "alice", val)
}

// ── Fan-out (broadcast) ─────────────────────────────────────────────────

// TestPublish_FanOutBroadcast: Publish one event → every handler registered
// for that type receives it independently (broadcast semantics).
func TestPublish_FanOutBroadcast(t *testing.T) {
	b := newTestBus(t)

	const n = 5
	var hits atomic.Int64
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		b.Subscribe("broadcast", func(ctx context.Context, e Event) {
			hits.Add(1)
			wg.Done()
		})
	}

	b.Publish(context.Background(), Event{Type: "broadcast", Payload: nil})
	wg.Wait()
	drainBus(t, b)

	assert.Equal(t, int64(n), hits.Load(), "all handlers must be invoked for a single publish")
}

// ── Wildcard ─────────────────────────────────────────────────────────────

// TestPublish_WildcardMatchesAnyType: a "*" handler fires regardless of the
// published event type.
func TestPublish_WildcardMatchesAnyType(t *testing.T) {
	b := newTestBus(t)

	var hit atomic.Bool
	b.Subscribe("*", func(ctx context.Context, e Event) {
		hit.Store(true)
	})

	b.Publish(context.Background(), Event{Type: "arbitrary.thing", Payload: nil})
	drainBus(t, b)
	assert.True(t, hit.Load(), "wildcard handler must fire for any event type")
}

// TestPublish_SpecificAndWildcardBothFire: for a matching type the specific
// handler(s) AND the wildcard handler all fire; for a type with no specific
// handler only the wildcard fires.
func TestPublish_SpecificAndWildcardBothFire(t *testing.T) {
	b := newTestBus(t)

	var specific, wildcard atomic.Int64
	b.Subscribe("match", func(ctx context.Context, e Event) { specific.Add(1) })
	b.Subscribe("*", func(ctx context.Context, e Event) { wildcard.Add(1) })

	// Matching type: both specific and wildcard fire (2 handlers).
	b.Publish(context.Background(), Event{Type: "match"})
	drainBus(t, b)
	assert.Equal(t, int64(1), specific.Load(), "specific fires once for matching type")
	assert.Equal(t, int64(1), wildcard.Load(), "wildcard fires once for matching type")

	// Non-matching type: only wildcard fires.
	b.Publish(context.Background(), Event{Type: "no.specific.handler"})
	drainBus(t, b)
	assert.Equal(t, int64(1), specific.Load(), "specific must NOT fire for unrelated type")
	assert.Equal(t, int64(2), wildcard.Load(), "wildcard fires for every event")
}

// ── Boundary: zero subscribers ───────────────────────────────────────────

// TestPublish_NoHandlers_DoesNotPanicOrBlock: publishing an event for which
// no handler is registered returns immediately without panicking and leaves
// the pending counter at zero.
func TestPublish_NoHandlers_DoesNotPanicOrBlock(t *testing.T) {
	b := newTestBus(t)

	done := make(chan struct{})
	go func() {
		b.Publish(context.Background(), Event{Type: "nobody.listening", Payload: nil})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Publish with zero handlers must not block")
	}
	drainBus(t, b)
	assert.Equal(t, int64(0), b.Pending(), "no work submitted → pending stays 0")
}

// ── Panic recovery ───────────────────────────────────────────────────────

// TestPublish_PanicRecoveryOthersSurvive: if one handler panics, sibling
// handlers for the same type still execute and the bus remains usable. The
// pending counter must not leak despite the panic.
func TestPublish_PanicRecoveryOthersSurvive(t *testing.T) {
	b := newTestBus(t)

	var survivor atomic.Bool
	b.Subscribe("danger", func(ctx context.Context, e Event) { panic("boom") })
	b.Subscribe("danger", func(ctx context.Context, e Event) { survivor.Store(true) })

	b.Publish(context.Background(), Event{Type: "danger", Payload: nil})
	drainBus(t, b)

	assert.True(t, survivor.Load(), "second handler must run despite first panicking")
	assert.Equal(t, int64(0), b.Pending(), "pending must return to 0 after a recovered panic")

	// Bus must still be usable after a recovered panic.
	var after atomic.Bool
	b.Subscribe("after", func(ctx context.Context, e Event) { after.Store(true) })
	b.Publish(context.Background(), Event{Type: "after"})
	drainBus(t, b)
	assert.True(t, after.Load(), "bus must remain usable after a handler panic")
}

// ── Payload fidelity ─────────────────────────────────────────────────────

// TestPublish_PayloadPreserved: a structured payload round-trips unchanged.
func TestPublish_PayloadPreserved(t *testing.T) {
	type order struct{ ID int }
	b := newTestBus(t)

	var got atomic.Value
	b.Subscribe("order.placed", func(ctx context.Context, e Event) { got.Store(e.Payload) })

	want := &order{ID: 42}
	b.Publish(context.Background(), Event{Type: "order.placed", Payload: want})
	drainBus(t, b)

	gotVal, ok := got.Load().(*order)
	require.True(t, ok, "payload must survive with its concrete type")
	assert.Equal(t, 42, gotVal.ID)
}

// ── Counters ─────────────────────────────────────────────────────────────

// TestPendingCounter_ReturnsToZero: after a burst of events each fanning out
// to multiple handlers, pending must settle back to exactly zero.
func TestPendingCounter_ReturnsToZero(t *testing.T) {
	b := newTestBus(t)

	const handlers = 3
	const events = 10
	var wg sync.WaitGroup
	wg.Add(handlers * events)
	for i := 0; i < handlers; i++ {
		b.Subscribe("burst", func(ctx context.Context, e Event) { wg.Done() })
	}
	for i := 0; i < events; i++ {
		b.Publish(context.Background(), Event{Type: "burst"})
	}

	wg.Wait()
	drainBus(t, b)
	assert.Equal(t, int64(0), b.Pending(), "pending must return to 0 once all handlers complete")
}

// TestRunningCounter_NonzeroWhileHandlerBlocked: while a handler is blocked,
// Running reports > 0; after it unblocks, Running returns to 0.
func TestRunningCounter_NonzeroWhileHandlerBlocked(t *testing.T) {
	b := newTestBus(t)

	started := make(chan struct{})
	release := make(chan struct{})
	b.Subscribe("block", func(ctx context.Context, e Event) {
		close(started)
		<-release
	})

	b.Publish(context.Background(), Event{Type: "block"})

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		close(release)
		t.Fatal("handler never started")
	}
	assert.Greater(t, b.Running(), 0, "Running must be > 0 while a handler is executing")

	close(release)
	drainBus(t, b)
	// Running reflects ants worker occupancy, which can lag the handler's
	// defer (Pending) by a short worker-purge window, so poll for the settle
	// instead of asserting an instantaneous zero (drainBus now gates on
	// Pending only — see its doc comment).
	// 10s ceiling: Windows CI runners can exceed the ants worker-purge window
	// by far more than 2s under load; Eventually polls at 1ms so fast runners
	// still settle immediately.
	require.Eventually(t, func() bool { return b.Running() == 0 },
		10*time.Second, time.Millisecond,
		"Running must return to 0 after handler completes")
}

// ── Snapshot semantics ───────────────────────────────────────────────────

// TestSubscribe_SnapshotSemantics: Publish snapshots the handler list at call
// time. A handler subscribed AFTER a Publish call does not receive that event.
// This documents the non-durability guarantee: the bus is live-only.
func TestSubscribe_SnapshotSemantics(t *testing.T) {
	b := newTestBus(t)

	var first atomic.Bool
	b.Subscribe("snap", func(ctx context.Context, e Event) { first.Store(true) })

	// Publish first — snapshot captures exactly one handler.
	b.Publish(context.Background(), Event{Type: "snap"})

	// Subscribe a second handler AFTER the snapshot was taken.
	var second atomic.Bool
	b.Subscribe("snap", func(ctx context.Context, e Event) { second.Store(true) })

	drainBus(t, b)
	assert.True(t, first.Load(), "pre-existing handler receives the event")
	assert.False(t, second.Load(), "handler subscribed after Publish must NOT receive that event")
}

// ── Close ─────────────────────────────────────────────────────────────────

// TestClose_MarksClosed: Close releases the pool and IsClosed reports true.
func TestClose_MarksClosed(t *testing.T) {
	b, err := New()
	require.NoError(t, err)
	require.False(t, b.IsClosed(), "fresh bus not closed")
	b.Close(context.Background())
	assert.True(t, b.IsClosed(), "bus must be closed after Close")
}

// TestPublish_AfterClose_SubmitFailurePath: publishing after Close drives the
// submit-error branch (pool.Submit returns ErrPoolClosed). The handler must
// NOT run, pending must not leak, and Publish must not panic.
//
// This is the only reachable path that exercises bus.go:93-99 — the pool is
// created with ants.WithNonblocking(false), so a saturated pool blocks rather
// than returning an error; only a closed pool yields a Submit error.
func TestPublish_AfterClose_SubmitFailurePath(t *testing.T) {
	b, err := New()
	require.NoError(t, err)

	var called atomic.Bool
	b.Subscribe("post.close", func(ctx context.Context, e Event) { called.Store(true) })

	b.Close(context.Background())
	require.True(t, b.IsClosed())

	// Must not panic and must not block.
	done := make(chan struct{})
	go func() {
		b.Publish(context.Background(), Event{Type: "post.close"})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Publish after Close must not block")
	}

	assert.False(t, called.Load(), "handler must NOT run when pool is closed")
	assert.Equal(t, int64(0), b.Pending(), "submit failure must decrement pending back to 0")
}

// ── Concurrency (-race) ──────────────────────────────────────────────────

// TestConcurrent_SubscribeAndPublish_NoRace: concurrent Subscribe + Publish
// across many goroutines must not race (guarded by sync.RWMutex). We do not
// assert exact delivery counts here because a handler subscribed after a
// given Publish snapshot legitimately does not receive that event; the -race
// detector and a clean drain are the correctness signal.
func TestConcurrent_SubscribeAndPublish_NoRace(t *testing.T) {
	b := newTestBus(t)

	pubDone := make(chan struct{})
	go func() {
		for i := 0; i < 60; i++ {
			b.Publish(context.Background(), Event{Type: "race", Payload: i})
		}
		close(pubDone)
	}()

	var subWg sync.WaitGroup
	for i := 0; i < 20; i++ {
		subWg.Add(1)
		go func() {
			defer subWg.Done()
			for j := 0; j < 5; j++ {
				b.Subscribe("race", func(ctx context.Context, e Event) {})
			}
		}()
	}
	subWg.Wait()
	<-pubDone
	drainBus(t, b)
}

// TestConcurrent_HighVolumePublish_AllDelivered: a single handler subscribed
// once must receive every event published concurrently. The subscribes
// complete before any publish, so the snapshot is deterministic; this
// verifies fan-out completeness under contention and is -race clean.
func TestConcurrent_HighVolumePublish_AllDelivered(t *testing.T) {
	b := newTestBus(t)

	var delivered atomic.Int64
	var wg sync.WaitGroup
	const events = 200
	wg.Add(events)
	b.Subscribe("pressure", func(ctx context.Context, e Event) {
		delivered.Add(1)
		wg.Done()
	})

	// Barrier so all publishers fire near-simultaneously.
	var barrier sync.WaitGroup
	barrier.Add(events)
	for i := 0; i < events; i++ {
		go func() {
			barrier.Done()
			barrier.Wait()
			b.Publish(context.Background(), Event{Type: "pressure"})
		}()
	}

	wg.Wait()
	drainBus(t, b)
	assert.Equal(t, int64(events), delivered.Load(), "every published event must be delivered")
}

// TestConcurrent_WildcardAndSpecific_ExactCounts: with all subscribes done
// before any publish, the fan-out is deterministic: each publish fires exactly
// (1 wildcard + N specific) handlers. Concurrent publishes must not race and
// must deliver the exact expected totals.
func TestConcurrent_WildcardAndSpecific_ExactCounts(t *testing.T) {
	b := newTestBus(t)

	var wildcard, specific atomic.Int64
	var wg sync.WaitGroup

	b.Subscribe("*", func(ctx context.Context, e Event) {
		wildcard.Add(1)
		wg.Done()
	})
	const specificN = 5
	for i := 0; i < specificN; i++ {
		b.Subscribe("evt", func(ctx context.Context, e Event) {
			specific.Add(1)
			wg.Done()
		})
	}

	const events = 25
	wg.Add(events * (1 + specificN)) // 1 wildcard + 5 specific per event
	for i := 0; i < events; i++ {
		go func() {
			b.Publish(context.Background(), Event{Type: "evt"})
		}()
	}

	wg.Wait()
	drainBus(t, b)
	assert.Equal(t, int64(events), wildcard.Load(), "wildcard fires once per event")
	assert.Equal(t, int64(events*specificN), specific.Load(), "each specific handler fires once per event")
}
