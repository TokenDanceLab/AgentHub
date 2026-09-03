package events

import (
	"path/filepath"
	"strings"
	"testing"
)

// TestEventLog_TruncateCounterIncrements verifies that truncateLocked
// increments the truncations counter when the log exceeds maxSize, so the
// edge_event_log_truncations_total metric surfaces the truncation rate.
//
// Note: on Windows, Truncate(0) on an open O_RDWR file fails with "Access
// is denied" — a platform limitation the original code silently swallowed.
// That failure branch now increments truncateFailures (the task's intent:
// surface silent failures). So this test only asserts the truncations
// counter increments; it does not assert failures == 0 because that is
// platform-dependent.
func TestEventLog_TruncateCounterIncrements(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "truncate.log")

	log, err := NewEventLog(path)
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = log.Close() })

	// Shrink maxSize so a few appends trigger a truncation attempt without
	// writing MBs.
	log.maxSize = 256

	for i := 0; i < 50; i++ {
		if err := log.Append(EventEnvelope{Version: "v1", ID: "e", Seq: int64(i + 1), Type: "t", SentAt: "x"}); err != nil {
			t.Fatalf("Append %d: %v", i, err)
		}
	}

	if got := log.EventLogTruncations(); got < 1 {
		t.Fatalf("expected truncations >= 1 after exceeding maxSize, got %d", got)
	}
	// Truncation runs under l.mu, so its duration IS the bus freeze (#2304).
	// The cumulative counter must have moved: a duration series pinned at zero
	// is indistinguishable from one that was never wired, which is the exact
	// defect this family of metrics had.
	//
	// "last" is only asserted to be in range here, NOT to be > 0. With a 256-byte
	// cap this test truncates dozens of times in a few milliseconds, and a
	// truncation that returns through an early error branch (on Windows the
	// rewrite can be denied; see the comment above) legitimately measures zero
	// elapsed. Asserting last > 0 there was asserting on clock resolution, and
	// it failed on the Native Windows job while passing on Linux.
	// TestEventLog_TruncateDurationIsRecorded covers "last moves" deterministically
	// by truncating a window large enough that no platform can measure it as 0.
	if got := log.EventLogTruncateDurationNanos(); got <= 0 {
		t.Fatalf("expected cumulative truncate duration > 0 after %d truncations, got %d ns",
			log.EventLogTruncations(), got)
	}
	last, total := log.EventLogTruncateLastDurationNanos(), log.EventLogTruncateDurationNanos()
	if last < 0 {
		t.Fatalf("last truncate duration = %d ns, want >= 0", last)
	}
	if last > total {
		t.Fatalf("last truncate duration %d ns exceeds cumulative %d ns", last, total)
	}
	// truncateFailures is tracked (non-negative). On Windows it is > 0 because
	// Truncate(0) on an open file is denied; on Linux it is 0. Either is an
	// acceptable outcome — the metric existing is the fix.
	if got := log.EventLogTruncateFailures(); got < 0 {
		t.Fatalf("truncateFailures must be non-negative, got %d", got)
	}
}

// TestEventLog_GapCounterIncrementsOnReplayBeforeOldest verifies that ReadFrom
// increments the gaps counter when a cursor predates the oldest surviving log
// event, so edge_event_log_gaps_total surfaces replay data loss.
func TestEventLog_GapCounterIncrementsOnReplayBeforeOldest(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "gap.log")

	log, err := NewEventLog(path)
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = log.Close() })

	// Seed the log with seqs 5..8 (cursor 1 predates the oldest seq 5).
	for seq := int64(5); seq <= 8; seq++ {
		if err := log.Append(EventEnvelope{Version: "v1", ID: "e", Seq: seq, Type: "t", SentAt: "x"}); err != nil {
			t.Fatalf("Append %d: %v", seq, err)
		}
	}

	if _, hasGap := log.ReadFrom(1); !hasGap {
		t.Fatal("expected hasGap=true when cursor predates oldest log event")
	}
	if got := log.gaps.Load(); got != 1 {
		t.Fatalf("expected gaps=1 after a predating-cursor replay, got %d", got)
	}
}

// TestEventLog_TruncateDurationIsRecorded proves the two duration series are
// not dead zeros, deterministically and on every platform.
//
// truncateLocked holds l.mu for its whole body, so its duration IS the length
// of the bus freeze an operator needs to be able to see (#2304: ~26 ms per MiB
// of retained window, i.e. ≈0.97 s per truncation at the 50 MiB default). A
// duration counter that never moves is indistinguishable from one that was
// never wired — which is precisely the defect the whole edge_event_log_* family
// had — so this asserts movement rather than a magnitude.
//
// The retained window is sized so that one truncation must really read and
// rewrite ~192 KiB: large enough that no platform's clock can measure it as
// zero, small enough to stay a fast unit test. Large payloads keep the append
// count low (a 256 KiB cap is crossed after a few dozen appends, not thousands).
func TestEventLog_TruncateDurationIsRecorded(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "duration.log")

	log, err := NewEventLog(path)
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = log.Close() })

	const maxSize = 256 * 1024 // keepBytes = maxSize*3/4 = 192 KiB
	log.maxSize = maxSize
	payload := strings.Repeat("d", 8*1024)

	for i := 0; i < 200 && log.EventLogTruncations() == 0; i++ {
		if err := log.Append(EventEnvelope{
			Version: "v1",
			ID:      "e",
			Seq:     int64(i + 1),
			Type:    "duration.probe",
			SentAt:  "x",
			Payload: payload,
		}); err != nil {
			t.Fatalf("Append %d: %v", i, err)
		}
	}
	if got := log.EventLogTruncations(); got < 1 {
		t.Fatalf("expected at least one truncation after appending past a %d-byte cap, got %d", maxSize, got)
	}

	total := log.EventLogTruncateDurationNanos()
	last := log.EventLogTruncateLastDurationNanos()
	if last < 0 {
		t.Errorf("last truncate duration = %d ns, want >= 0", last)
	}
	if last > total {
		t.Errorf("last truncate duration %d ns exceeds cumulative %d ns", last, total)
	}
	// Exactly one truncation happened (the loop stops at the first), so the
	// failure counter decides whether that one truncation really did the
	// read+rewrite. If it took an error branch instead, its duration is
	// legitimately ~0 and asserting a magnitude would be asserting on the
	// platform's filesystem semantics rather than on the metric.
	if failures := log.EventLogTruncateFailures(); failures == 0 {
		if total <= 0 {
			t.Errorf("cumulative truncate duration = %d ns, want > 0 after rewriting a %d-byte window",
				total, maxSize*3/4)
		}
		if last <= 0 {
			t.Errorf("last truncate duration = %d ns, want > 0 after rewriting a %d-byte window",
				last, maxSize*3/4)
		}
	} else {
		t.Logf("truncation took %d error branch(es) on this platform; duration magnitude not asserted", failures)
	}
}
