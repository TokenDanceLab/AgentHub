package events

import (
	"testing"
	"time"
)

// The wire gate (#2154) hands each publisher a seq under b.mu and then requires
// that same publisher to consume the turn in deliverInSeqOrder. Everything
// between the two — persistWithRetry over caller-influenced payloads, the
// persist-failure slog.Error — runs *outside* any guard, and Publish is reached
// from safego-guarded goroutines (orchestrator dispatch, the lifecycle callback
// queue), so a panic there is recovered by the launcher and the process lives.
//
// A recovered panic that never consumed its turn leaves wireNext below that seq
// forever: every later publisher parks in `for b.wireNext < seq { Wait() }` and
// nothing can ever broadcast it awake. That converts one dropped event into
// total, silent event loss until the process restarts — strictly worse than the
// out-of-order delivery the gate was added to fix.

// TestPublish_PanicBeforeGateDoesNotWedgeBus is the minimal shape: the panicking
// publisher holds the gate's current turn, so without a guard the next Publish
// blocks forever.
func TestPublish_PanicBeforeGateDoesNotWedgeBus(t *testing.T) {
	b := NewBus(16)
	_, ch, _ := b.Subscribe(0)
	drained := make(chan EventEnvelope, 16)
	go func() {
		for evt := range ch {
			drained <- evt
		}
	}()

	// A persist hook that panics instead of returning an error. EventLog.Append
	// is the production hook; the point is that the panic happens after the seq
	// was assigned and before the gate consumed it.
	b.persistFn = func(EventEnvelope) error { panic("induced panic in the persist path") }
	func() {
		// Mirrors safego.SafeGo: the launcher recovers, the process survives.
		defer func() { _ = recover() }()
		b.Publish("test.panicking", nil, nil)
	}()

	b.persistFn = nil
	// Publish off the test goroutine: on the unfixed bus this is the call that
	// parks forever in the gate, and a parked *test* goroutine turns the
	// assertion into a hung binary instead of a failure.
	published := make(chan struct{})
	go func() {
		defer close(published)
		b.Publish("test.afterPanic", nil, nil)
	}()

	select {
	case <-published:
	case <-time.After(2 * time.Second):
		t.Fatal("bus wedged after a recovered panic between seq assignment and the wire gate: wireNext never advanced, so every later publisher parks forever in sync.Cond.Wait")
	}
	select {
	case evt := <-drained:
		if evt.Type != "test.afterPanic" {
			t.Fatalf("delivered %q, want the post-panic event", evt.Type)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the post-panic event was published but never delivered")
	}
}

// TestPublish_PanicBeforeGateDoesNotWedgeBusWhenTurnNotYetReached covers the
// harder branch: the panicking publisher's seq is *not* the gate's current turn
// yet (a lower seq is still persisting), so consuming the turn immediately would
// be wrong and the abandonment has to be remembered until the gate arrives.
func TestPublish_PanicBeforeGateDoesNotWedgeBusWhenTurnNotYetReached(t *testing.T) {
	b := NewBus(16)
	_, ch, _ := b.Subscribe(0)
	drained := make(chan EventEnvelope, 16)
	go func() {
		for evt := range ch {
			drained <- evt
		}
	}()

	release := make(chan struct{})
	slowEntered := make(chan struct{})
	// Keyed on the event type, not on evt.Seq: which publisher gets which seq is
	// exactly what this test must not assume (the first version switched on Seq
	// and deadlocked whenever the slow publisher lost the assignment race).
	b.persistFn = func(evt EventEnvelope) error {
		switch evt.Type {
		case "test.slow":
			// Announce that the gate's current turn is held, then keep holding it
			// until the panicking publisher behind us has already been recovered.
			// Signal-then-block, not block-then-signal: the first version of this
			// test waited on a channel that only the *next* statement could close,
			// which deadlocked the test itself.
			close(slowEntered)
			<-release
		case "test.panicking":
			panic("induced panic while a lower seq holds the gate")
		}
		return nil
	}

	first := make(chan struct{})
	go func() {
		defer close(first)
		b.Publish("test.slow", nil, nil) // seq 1, blocks in persist
	}()
	// Wait until the slow publisher is inside persistFn. Its seq was assigned
	// before persistFn ran, so the panicking publish below is guaranteed to get a
	// higher seq and therefore to find the gate sitting on someone else's turn.
	<-slowEntered
	func() {
		defer func() { _ = recover() }()
		b.Publish("test.panicking", nil, nil) // seq 2, panics and is recovered
	}()

	b.persistFn = nil
	close(release)
	<-first
	published := make(chan struct{})
	go func() {
		defer close(published)
		b.Publish("test.last", nil, nil) // seq 3
	}()
	select {
	case <-published:
	case <-time.After(2 * time.Second):
		t.Fatal("bus wedged on an abandoned gate turn: seq 2 panicked before reaching the gate and nothing recorded that its turn must be skipped")
	}

	// Both surviving events must arrive, in seq order, with the abandoned seq 2
	// skipped rather than blocking the wire.
	seen := make([]string, 0, 2)
	deadline := time.After(3 * time.Second)
	for len(seen) < 2 {
		select {
		case evt := <-drained:
			seen = append(seen, evt.Type)
		case <-deadline:
			t.Fatalf("bus wedged with an abandoned gate turn: delivered %v, want [test.slow test.last]", seen)
		}
	}
	if seen[0] != "test.slow" || seen[1] != "test.last" {
		t.Fatalf("delivery order = %v, want [test.slow test.last]", seen)
	}
}
