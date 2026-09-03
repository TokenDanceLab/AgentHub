package events

// Append's post-write size bookkeeping (maxSize check + indexedSize) is
// arithmetic rather than a second and third Stat of the file: the log is opened
// O_APPEND, so a successful write of len(data) bytes at writeOffset leaves the
// file exactly writeOffset+len(data) long (#2256 E-P3-7).
//
// These tests pin the two ways that identity could break:
//
//  1. the derived size drifting from the real one on the ordinary path, which
//     would make ReadFrom's external-change check (fi.Size() != l.indexedSize)
//     fire on every replay and rescan the whole file for an index it already
//     has;
//  2. the truncating append, the one path where the size is NOT derivable
//     because truncateLocked rewrites the file. That branch must keep doing a
//     real Stat, and this is the test that says so.

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func sizeProbeEnvelope(seq int64) EventEnvelope {
	return EventEnvelope{
		Version: "1.0",
		ID:      fmt.Sprintf("evt-%d", seq),
		Seq:     seq,
		Type:    "run.output.batch",
		Scope:   map[string]any{"run_id": "run-size-probe"},
		TraceID: fmt.Sprintf("trace_%06d", seq),
		Payload: map[string]any{"text": "size bookkeeping probe"},
	}
}

func actualFileSize(t *testing.T, l *EventLog) int64 {
	t.Helper()
	fi, err := os.Stat(l.path)
	if err != nil {
		t.Fatalf("stat %s: %v", l.path, err)
	}
	return fi.Size()
}

func TestEventLogAppendKeepsIndexedSizeEqualToFileSize(t *testing.T) {
	l, err := NewEventLog(filepath.Join(t.TempDir(), "append-size.jsonl"))
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = l.Close() })

	for seq := int64(1); seq <= 25; seq++ {
		if err := l.Append(sizeProbeEnvelope(seq)); err != nil {
			t.Fatalf("append %d: %v", seq, err)
		}
		if got, want := l.indexedSize, actualFileSize(t, l); got != want {
			t.Fatalf("after append %d: indexedSize=%d but the file is %d bytes — the derived size drifted, so every ReadFrom would now rebuild the index",
				seq, got, want)
		}
	}

	// The index the derived offsets feed must still replay correctly.
	events, hasGap := l.ReadFrom(20)
	if hasGap {
		t.Fatal("unexpected gap on a log that was only appended to")
	}
	if len(events) != 6 {
		t.Fatalf("ReadFrom(20) returned %d events, want 6 (seq 20..25)", len(events))
	}
	if events[0].Seq != 20 || events[len(events)-1].Seq != 25 {
		t.Fatalf("replayed seq range %d..%d, want 20..25", events[0].Seq, events[len(events)-1].Seq)
	}
}

func TestEventLogTruncatingAppendKeepsIndexedSizeEqualToFileSize(t *testing.T) {
	l, err := NewEventLog(filepath.Join(t.TempDir(), "trunc-size.jsonl"))
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = l.Close() })

	// Small ceiling so truncation happens within the test; truncateLocked keeps
	// the trailing 75%, so each truncation rewrites the file and the derived
	// size would be wrong by the whole retained window if this branch stopped
	// doing a real Stat.
	l.SetMaxSize(64 * 1024)

	before := l.truncations.Load()
	for seq := int64(1); seq <= 4000; seq++ {
		if err := l.Append(sizeProbeEnvelope(seq)); err != nil {
			t.Fatalf("append %d: %v", seq, err)
		}
		if got, want := l.indexedSize, actualFileSize(t, l); got != want {
			t.Fatalf("after append %d: indexedSize=%d but the file is %d bytes (truncations so far: %d)",
				seq, got, want, l.truncations.Load()-before)
		}
		if l.truncations.Load()-before >= 3 {
			break
		}
	}
	if got := l.truncations.Load() - before; got < 3 {
		t.Fatalf("expected at least 3 truncations to exercise the rewrite path, got %d", got)
	}

	// Replay must still work off the post-truncation index.
	events, _ := l.ReadFrom(0)
	if len(events) == 0 {
		t.Fatal("post-truncation replay returned nothing")
	}
	for i := 1; i < len(events); i++ {
		if events[i].Seq <= events[i-1].Seq {
			t.Fatalf("post-truncation replay out of order at %d: %d then %d", i, events[i-1].Seq, events[i].Seq)
		}
	}
}

// benchProbeEnvelope is deliberately the same shape and size (~660 bytes of
// JSON: a 400-character text field plus scope/payload keys) as the envelope the
// before/after numbers below were measured with, so that anyone re-running this
// benchmark reproduces them. A smaller envelope shifts the absolute numbers
// (marshal cost dominates less) without changing the delta.
func benchProbeEnvelope(seq int64) EventEnvelope {
	return EventEnvelope{
		Version: "1.0",
		ID:      fmt.Sprintf("evt-%d", seq),
		Seq:     seq,
		Type:    "run.output.batch",
		Scope:   map[string]any{"run_id": "run-perf-probe", "session_id": "sess-perf-probe"},
		TraceID: fmt.Sprintf("trace_%06d", seq),
		SentAt:  "2026-09-04T00:00:00.000000000Z",
		Payload: map[string]any{
			"text":   strings.Repeat("x", 400),
			"kind":   "assistant",
			"run_id": "run-perf-probe",
		},
	}
}

// BenchmarkEventLogAppend keeps a number next to the hot path so the next
// change to Append's critical section can be measured instead of argued about.
//
// Reproduce with:
//
//	go test ./internal/events/ -run '^$' -bench 'BenchmarkEventLogAppend$' \
//	  -benchtime 2000x -count=3
//
// Measured on a 4-core ARM64 dev box (ext4, not tmpfs): median **11.8us/op** with
// the arithmetic size (two independent 3x2000 runs gave 11.75us and 11.87us),
// **13.53us/op** with the two extra Stat calls it replaces (-13%). Under contention (4-8 goroutines on the same log) the same
// change moves 14.8-15.8us/op to 13.1-13.8us/op (~-11%), because the saving is
// inside the l.mu critical section that every publisher and every replay waits
// on.
func BenchmarkEventLogAppend(b *testing.B) {
	l, err := NewEventLog(filepath.Join(b.TempDir(), "bench-append.jsonl"))
	if err != nil {
		b.Fatalf("NewEventLog: %v", err)
	}
	b.Cleanup(func() { _ = l.Close() })
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := l.Append(benchProbeEnvelope(int64(i + 1))); err != nil {
			b.Fatal(err)
		}
	}
}
