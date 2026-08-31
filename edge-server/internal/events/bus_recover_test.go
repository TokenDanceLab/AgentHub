package events

import (
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// TestEventLogRecoverReplaysAfterRestart pins the core fix: when a Bus
// restarts with an empty in-memory history but has an on-disk event log, a
// cursor-bearing subscriber must still receive a replay from disk. Without the
// fix, a cursor > 0 subscriber would receive an empty replay after restart
// because the in-memory ring is empty.
func TestEventLogRecoverReplaysAfterRestart(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "recover-replay.jsonl")

	// Phase 1: a Bus with an event log publishes events, then closes (simulating
	// a process restart). The in-memory history is lost; the on-disk log
	// survives.
	bus1 := NewBus(100, WithEventLogPath(logPath))
	bus1.Publish("e1", nil, "v1") // seq=1
	bus1.Publish("e2", nil, "v2") // seq=2
	bus1.Publish("e3", nil, "v3") // seq=3
	if err := bus1.Close(); err != nil {
		t.Fatalf("bus1 close: %v", err)
	}

	// Phase 2: a fresh Bus opens the same event log. In-memory history is empty
	// but the on-disk log has 3 events. A subscriber with cursor=2 must replay
	// seq 2 and 3 from disk.
	bus2 := NewBus(100, WithEventLogPath(logPath))
	t.Cleanup(func() { _ = bus2.Close() })

	_, _, replay := bus2.Subscribe(2)
	if len(replay) != 2 {
		t.Fatalf("replay length after restart = %d, want 2 (events from disk log)", len(replay))
	}
	if replay[0].Seq != 2 || replay[1].Seq != 3 {
		t.Errorf("replay seqs after restart = %d, %d; want 2, 3", replay[0].Seq, replay[1].Seq)
	}
}

// TestEventLogRecoverInjectsGapWhenCursorPredatesLog pins that when the cursor
// is below the first seq in the log (events were lost to truncation or predate
// the log), the replay includes a GapPayload so the subscriber knows it must
// resync from scratch.
func TestEventLogRecoverInjectsGapWhenCursorPredatesLog(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "gap-replay.jsonl")

	bus1 := NewBus(100, WithEventLogPath(logPath))
	// Start the seq counter at 4 so the first publish gets seq=5, simulating
	// a log that starts partway through a run (early events were truncated).
	bus1.seq = 4
	bus1.Publish("e5", nil, "v5") // seq=5
	bus1.Publish("e6", nil, "v6") // seq=6
	if err := bus1.Close(); err != nil {
		t.Fatalf("bus1 close: %v", err)
	}

	bus2 := NewBus(100, WithEventLogPath(logPath))
	t.Cleanup(func() { _ = bus2.Close() })

	// cursor=2 is below the first log seq (5): gap must be injected, plus the
	// surviving events 5 and 6.
	_, _, replay := bus2.Subscribe(2)

	var hasGap bool
	var realEvents []EventEnvelope
	for _, evt := range replay {
		if evt.Type == GapEventType {
			hasGap = true
		} else {
			realEvents = append(realEvents, evt)
		}
	}
	if !hasGap {
		t.Fatal("expected a gap event when cursor predates the log, got none")
	}
	if len(realEvents) != 2 {
		t.Fatalf("expected 2 real events from the log, got %d", len(realEvents))
	}
	if realEvents[0].Seq != 5 || realEvents[1].Seq != 6 {
		t.Errorf("real event seqs = %d, %d; want 5, 6", realEvents[0].Seq, realEvents[1].Seq)
	}
}

// TestEventLogRecoverMergesHistoryAndLog pins that when both the in-memory
// history and the on-disk log have events, the replay merges them with history
// taking priority (freshest copy wins) and deduplicates by seq.
func TestEventLogRecoverMergesHistoryAndLog(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "merge-replay.jsonl")

	bus1 := NewBus(100, WithEventLogPath(logPath))
	bus1.Publish("e1", nil, "v1") // seq=1 (persisted to log, then history lost on restart)
	bus1.Publish("e2", nil, "v2") // seq=2
	if err := bus1.Close(); err != nil {
		t.Fatalf("bus1 close: %v", err)
	}

	bus2 := NewBus(100, WithEventLogPath(logPath))
	t.Cleanup(func() { _ = bus2.Close() })
	// After restart, publish a new event so in-memory history has seq=3.
	bus2.Publish("e3", nil, "v3") // seq=3 (in history AND persisted to log)

	// cursor=1: replay must include log events 1,2 (from disk) AND history
	// event 3, merged and sorted by seq, with no duplicates.
	_, _, replay := bus2.Subscribe(1)

	if len(replay) != 3 {
		t.Fatalf("replay length = %d, want 3 (2 from log + 1 from history)", len(replay))
	}
	if replay[0].Seq != 1 || replay[1].Seq != 2 || replay[2].Seq != 3 {
		t.Errorf("replay seqs = %d, %d, %d; want 1, 2, 3", replay[0].Seq, replay[1].Seq, replay[2].Seq)
	}
}

// TestEventLogReadFromNilLogIsSafe pins that a nil EventLog (no
// WithEventLogPath configured) does not panic and returns empty replay; the
// caller falls back to in-memory history only.
func TestEventLogReadFromNilLogIsSafe(t *testing.T) {
	b := NewBus(10)
	b.Publish("e1", nil, "v1") // seq=1
	_, _, replay := b.Subscribe(1)
	if len(replay) != 1 {
		t.Fatalf("replay length = %d, want 1 (in-memory history only, no log)", len(replay))
	}
}

// TestEventLogIndexSurvivesTruncation pins that after the log is truncated
// (exceeding maxSize), the index is rebuilt and replay still returns the
// surviving events with correct offsets (no corruption from stale offsets).
func TestEventLogIndexSurvivesTruncation(t *testing.T) {
	// Use a very small maxSize so truncation triggers quickly.
	logPath := filepath.Join(t.TempDir(), "truncate-replay.jsonl")

	log, err := NewEventLog(logPath)
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = log.Close() })
	// Force a small maxSize so truncation triggers after a few events.
	log.mu.Lock()
	log.maxSize = 200
	log.mu.Unlock()

	// Publish enough events to exceed the tiny maxSize and trigger truncation.
	for i := int64(1); i <= 20; i++ {
		if err := log.Append(EventEnvelope{Version: "v1", ID: "evt", Seq: i, Type: "test", SentAt: time.Now().UTC().Format(time.RFC3339), Payload: "data"}); err != nil {
			t.Fatalf("Append %d: %v", i, err)
		}
	}

	// After truncation, ReadFrom must return events without panicking and with
	// offsets that point at valid JSON lines.
	events, hasGap := log.ReadFrom(1)
	if hasGap {
		t.Log("gap reported (expected: cursor=1 may predate the truncated log)")
	}
	// Every returned event must be parseable (already parsed by ReadFrom) and
	// have a non-zero seq.
	for _, evt := range events {
		if evt.Seq == 0 {
			t.Fatal("truncation produced an event with seq=0 (corrupt line)")
		}
	}
	if len(events) == 0 {
		t.Fatal("expected at least one surviving event after truncation, got empty replay")
	}
}

// TestEventLogConcurrentAppendAndRead is a smoke test for the concurrency
// contract: Append (from Publish, outside the bus lock) and ReadFrom (from
// Subscribe, under the bus lock) must not race or deadlock.
func TestEventLogConcurrentAppendAndRead(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "concurrent-replay.jsonl")
	log, err := NewEventLog(logPath)
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = log.Close() })

	var wg sync.WaitGroup
	stop := make(chan struct{})

	// Writer goroutine — bounded: an unbounded writer makes the log grow
	// without limit, so each reader pass (ReadFrom(1) replays the whole log)
	// gets progressively slower and can trip the 5s deadline on slow CI IO.
	// 2000 entries are plenty to exercise the append/read race.
	const maxEntries = 2000
	wg.Add(1)
	go func() {
		defer wg.Done()
		for seq := int64(1); seq <= maxEntries; seq++ {
			select {
			case <-stop:
				return
			default:
				_ = log.Append(EventEnvelope{Version: "v1", ID: "evt", Seq: seq, Type: "test", SentAt: "now", Payload: "data"})
			}
		}
	}()

	// Reader goroutine. 25 passes are enough to smoke append/read races;
	// 50 passes tripped the old 5s deadline on loaded 2-core CI runners
	// under -race (each ReadFrom(1) replays the whole log).
	const readerPasses = 25
	readerDone := make(chan struct{})
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer close(readerDone)
		for i := 0; i < readerPasses; i++ {
			_, _ = log.ReadFrom(1)
		}
	}()

	// Let the writer and reader run concurrently until the reader finishes
	// its passes, then stop the writer and drain both. Generous deadline:
	// under -race on slow CI IO a full-log replay pass can take >100ms.
	select {
	case <-readerDone:
	case <-time.After(15 * time.Second):
		t.Fatal("reader did not finish concurrent append/read pass")
	}
	close(stop)
	wg.Wait()
}
