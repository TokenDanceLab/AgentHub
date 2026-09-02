package events

import (
	"fmt"
	"path/filepath"
	"runtime"
	"slices"
	"sync"
	"testing"
	"time"
)

// This file pins the in-memory counterpart of the EventLog ordering invariant
// (#2154 lane B): the order in which envelopes reach a subscriber channel must
// equal their seq order.
//
// Why it matters downstream: app/shared/src/eventClient.ts:202 does
// `if (envelope.seq <= lastSeq) return;` — an envelope that arrives after a
// larger seq is treated as a replay duplicate and dropped permanently, with no
// system.gap emitted, so the client silently loses a state change. api/events.md:67
// promises "`seq` 同 stream 单调". hub-server/internal/ws/fanout.go:92-101 is the
// in-repo correct precedent: it stamps `frame.SeqID = c.seq.Add(1)` INSIDE the
// `sendMu` critical section, and its comment states that queue order — and
// therefore wire order — always equals seq order.
//
// Bus.Publish does the opposite: it hands out the seq with a lock-free
// atomic.AddInt64, then runs persistFn (a file write, with up to 14ms of retry
// backoff on failure), and only afterwards takes b.mu and fans out. Everything
// between the seq stamp and the channel push is preemptible, so a larger seq can
// reach the wire first.

// orderingWriters picks a publisher count that leaves at least one P for the
// drainer goroutine. subscriberChannelBufferSize is 256, so if the publishers
// saturate GOMAXPROCS the drainer starves, the channel fills, and the run
// measures channel-full drops instead of fanout ordering. Sizing off GOMAXPROCS
// keeps that from happening on a 4-core dev box and on a 2-core CI runner alike.
func orderingWriters() int {
	w := runtime.GOMAXPROCS(0) - 1
	if w < 2 {
		w = 2
	}
	if w > 8 {
		w = 8
	}
	return w
}

// wireSeqs publishes total events from writers concurrent goroutines and returns
// the seqs in the order the subscriber channel actually delivered them, plus any
// gap control events seen. The subscriber is registered before the first publish
// so it sees the whole stream from seq 1.
func wireSeqs(t *testing.T, bus *Bus, writers, perWriter int) (got []int64, gaps []EventEnvelope) {
	t.Helper()
	total := writers * perWriter

	id, ch, _ := bus.Subscribe(0)

	// Drain concurrently with publishing. subscriberChannelBufferSize is 256, so
	// draining only after wg.Wait() fills the buffer and turns the run into a
	// drop test instead of an ordering test — the first version of this fixture
	// did exactly that and collected 256 of 1000 events.
	got = make([]int64, 0, total)
	drained := make(chan struct{})
	go func() {
		defer close(drained)
		for evt := range ch {
			if evt.Type == GapEventType {
				gaps = append(gaps, evt)
				continue
			}
			got = append(got, evt.Seq)
		}
	}()

	var wg sync.WaitGroup
	start := make(chan struct{})
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			<-start
			for i := 0; i < perWriter; i++ {
				bus.Publish(fmt.Sprintf("wire.%d.%d", w, i), nil, i)
			}
		}(w)
	}
	close(start)
	wg.Wait()

	// No publisher is left, so Unsubscribe cannot race with a send; it closes the
	// channel, which ends the drain loop after the buffered envelopes are read.
	bus.Unsubscribe(id)
	<-drained
	return got, gaps
}

// assertStrictlyIncreasingNoHoles is the wire contract: delivery order equals seq
// order, starting at 1, with no gaps. A drop (channel full) would also show up
// here, so the fixture reports drops separately to keep the two failure modes
// distinguishable.
func assertStrictlyIncreasingNoHoles(t *testing.T, label string, got []int64, gaps []EventEnvelope, total int) {
	t.Helper()
	// Strict monotonicity is the contract under test and holds independently of
	// drops, so it is asserted unconditionally.
	inversions := make([]string, 0, 8)
	n := 0
	for i, seq := range got {
		if i > 0 && seq <= got[i-1] {
			n++
			if len(inversions) < 8 {
				inversions = append(inversions, fmt.Sprintf("pos %d: seq %d after %d", i, seq, got[i-1]))
			}
		}
	}
	if n > 0 {
		t.Errorf("%s: wire order is NOT seq order — %d inversion(s) in %d delivered events; first few: %v. "+
			"A client applying eventClient.ts's `seq <= lastSeq` dedup would permanently drop the "+
			"out-of-order envelope with no system.gap, violating api/events.md's monotonic-seq contract",
			label, n, len(got), inversions)
	}

	// "No holes" is only assertable when nothing was dropped: a full subscriber
	// channel legitimately drops events and reports them via system.gap, which
	// is pre-existing behaviour and not what this test is about. orderingWriters
	// sizes the fixture so drops do not happen; when they nonetheless do (loaded
	// machine), report it and skip the hole assertion rather than fail spuriously.
	dropped := len(gaps) > 0 || len(got) != total
	if dropped {
		t.Logf("%s: fixture dropped events (%d system.gap, received %d/%d) — asserting monotonicity only",
			label, len(gaps), len(got), total)
		return
	}
	holes := make([]string, 0, 8)
	for i, seq := range got {
		if seq != int64(i+1) && len(holes) < 8 {
			holes = append(holes, fmt.Sprintf("pos %d: seq %d, want %d", i, seq, i+1))
		}
	}
	if len(holes) > 0 {
		t.Errorf("%s: delivered seqs are not 1..%d without holes; first few mismatches: %v", label, total, holes)
	}
}

// TestFanoutWireOrderMatchesSeqOrderWithEventLog is the production-shaped red:
// a Bus with WithEventLogPath (so persistFn does a real file write inside the
// seq-stamp→fanout window), published to concurrently.
func TestFanoutWireOrderMatchesSeqOrderWithEventLog(t *testing.T) {
	const perWriter = 250
	writers := orderingWriters()
	path := filepath.Join(t.TempDir(), "wire-order.jsonl")
	bus := NewBus(writers*perWriter+16, WithEventLogPath(path))
	t.Cleanup(func() { _ = bus.Close() })

	got, gaps := wireSeqs(t, bus, writers, perWriter)
	assertStrictlyIncreasingNoHoles(t, "with event log", got, gaps, writers*perWriter)
}

// TestFanoutWireOrderMatchesSeqOrderWithoutEventLog shows the window is not only
// about disk I/O: even with no persister configured, genID + time.Now().UTC().
// Format + the scope fixup sit between the lock-free seq stamp and b.mu, which
// is enough for the scheduler to invert delivery order.
func TestFanoutWireOrderMatchesSeqOrderWithoutEventLog(t *testing.T) {
	const perWriter = 250
	writers := orderingWriters()
	bus := NewBus(writers*perWriter + 16)
	t.Cleanup(func() { _ = bus.Close() })

	got, gaps := wireSeqs(t, bus, writers, perWriter)
	assertStrictlyIncreasingNoHoles(t, "without event log", got, gaps, writers*perWriter)
}

// TestSubscribeZeroCursorReplayIsSeqOrdered pins the replay side of the same
// bug. b.history is appended in fanout order, which is not seq order, and
// Subscribe only sorts when it also merges from the event log (cursor > 0 and a
// log configured). A cursor=0 subscribe — the initial full-replay connect — is
// therefore returned in history order.
func TestSubscribeZeroCursorReplayIsSeqOrdered(t *testing.T) {
	const perWriter = 250
	writers := orderingWriters()
	path := filepath.Join(t.TempDir(), "replay-order.jsonl")
	bus := NewBus(writers*perWriter+16, WithEventLogPath(path))
	t.Cleanup(func() { _ = bus.Close() })

	// Publish concurrently, with no live subscriber, so history fills in fanout
	// order; then subscribe with cursor=0 and inspect the replay.
	var wg sync.WaitGroup
	start := make(chan struct{})
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			<-start
			for i := 0; i < perWriter; i++ {
				bus.Publish(fmt.Sprintf("replay.%d.%d", w, i), nil, i)
			}
		}(w)
	}
	close(start)
	wg.Wait()

	_, _, replay := bus.Subscribe(0)
	got := make([]int64, 0, len(replay))
	for _, evt := range replay {
		got = append(got, evt.Seq)
	}
	if !slices.IsSorted(got) {
		inv := 0
		for i := 1; i < len(got); i++ {
			if got[i] < got[i-1] {
				inv++
			}
		}
		t.Errorf("Subscribe(cursor=0) replay is not seq-ordered: %d inversion(s) in %d events; first 24 delivered seqs = %v",
			inv, len(got), got[:min(len(got), 24)])
	}
}

// TestPublishAndSubscribeWithCursorDoNotDeadlock is the canary for the lock
// ordering the seq-stamp move depends on. Publish now holds b.mu while calling
// persistFn (→ EventLog.mu); Subscribe takes EventLog.mu inside ReadFrom and
// releases it before taking b.mu. That is not an AB-BA cycle, but it is one
// edit away from becoming one — if Subscribe ever held EventLog.mu across the
// b.mu acquisition, every concurrent Publish+Subscribe pair would wedge. The
// watchdog turns that into a failure with goroutine context instead of a hung
// test binary.
func TestPublishAndSubscribeWithCursorDoNotDeadlock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "lock-order.jsonl")
	bus := NewBus(1<<16, WithEventLogPath(path))
	t.Cleanup(func() { _ = bus.Close() })

	const (
		publishers      = 4
		publishesEach   = 200
		subscribers     = 4
		subscribeCycles = 60
		watchdog        = 30 * time.Second
	)

	done := make(chan struct{})
	go func() {
		defer close(done)
		var wg sync.WaitGroup

		for w := 0; w < publishers; w++ {
			wg.Add(1)
			go func(w int) {
				defer wg.Done()
				for i := 0; i < publishesEach; i++ {
					bus.Publish(fmt.Sprintf("lockorder.%d.%d", w, i), nil, i)
				}
			}(w)
		}

		// cursor > 0 forces the ReadFrom path, i.e. the EventLog.mu acquisition
		// that precedes b.mu in Subscribe.
		for r := 0; r < subscribers; r++ {
			wg.Add(1)
			go func(r int) {
				defer wg.Done()
				for n := 0; n < subscribeCycles; n++ {
					id, ch, _ := bus.Subscribe(int64(n%publishers*publishesEach + 1))
					// Drain a little so the subscriber channel does not simply
					// fill up and make the cycle trivial.
					deadline := time.After(2 * time.Millisecond)
				drain:
					for {
						select {
						case _, ok := <-ch:
							if !ok {
								break drain
							}
						case <-deadline:
							break drain
						}
					}
					bus.Unsubscribe(id)
				}
			}(r)
		}

		wg.Wait()
	}()

	select {
	case <-done:
	case <-time.After(watchdog):
		t.Fatalf("deadlock: %d concurrent Publish + %d concurrent Subscribe(cursor>0) did not finish within %s — "+
			"b.mu / EventLog.mu acquisition order inverted", publishers, subscribers, watchdog)
	}
}
