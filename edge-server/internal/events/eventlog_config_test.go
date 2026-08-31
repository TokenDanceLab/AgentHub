package events

import (
	"path/filepath"
	"testing"
)

// TestEventLog_DefaultMaxSizeUnchanged ensures the default truncation
// threshold remains 50 MiB when no override is applied. This guards the
// zero-change contract for operators who do not set EventLogMaxSize.
func TestEventLog_DefaultMaxSizeUnchanged(t *testing.T) {
	dir := t.TempDir()
	log, err := NewEventLog(filepath.Join(dir, "default.log"))
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = log.Close() })

	if got := log.maxSize; got != defaultEventLogMaxSize {
		t.Fatalf("default maxSize = %d, want %d (50 MiB)", got, defaultEventLogMaxSize)
	}
}

// TestEventLog_SetMaxSizeTriggersEarlierTruncation verifies that lowering
// maxSize via SetMaxSize causes truncation to kick in sooner than the
// default, proving the override is honored end-to-end through Append.
func TestEventLog_SetMaxSizeTriggersEarlierTruncation(t *testing.T) {
	dir := t.TempDir()
	log, err := NewEventLog(filepath.Join(dir, "small.log"))
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = log.Close() })

	// 256 bytes is far below default 50 MiB; a handful of appends must trip
	// truncation.
	log.SetMaxSize(256)
	for i := 0; i < 50; i++ {
		if err := log.Append(EventEnvelope{Version: "v1", ID: "e", Seq: int64(i + 1), Type: "t", SentAt: "x"}); err != nil {
			t.Fatalf("Append %d: %v", i, err)
		}
	}
	if got := log.EventLogTruncations(); got < 1 {
		t.Fatalf("expected truncations >= 1 with small maxSize, got %d", got)
	}
}

// TestEventLog_SetMaxSizeZeroOrNegativeIgnored ensures non-positive values
// do not clobber the default threshold (the documented ignore semantics).
func TestEventLog_SetMaxSizeZeroOrNegativeIgnored(t *testing.T) {
	dir := t.TempDir()
	log, err := NewEventLog(filepath.Join(dir, "noop.log"))
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = log.Close() })

	log.SetMaxSize(0)
	log.SetMaxSize(-100)
	if got := log.maxSize; got != defaultEventLogMaxSize {
		t.Fatalf("maxSize after ignored SetMaxSize calls = %d, want default %d", got, defaultEventLogMaxSize)
	}
}

// TestBus_WithEventLogMaxSizeApplied verifies the BusOption wires through
// to the underlying EventLog regardless of option ordering with
// WithEventLogPath.
func TestBus_WithEventLogMaxSizeApplied(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bus.log")

	// Order A: path first, then size.
	busA := NewBus(100, WithEventLogPath(path+"a"), WithEventLogMaxSize(256))
	t.Cleanup(func() { _ = busA.Close() })
	if busA.eventLog == nil {
		t.Fatal("eventLog nil after WithEventLogPath")
	}
	if got := busA.eventLog.maxSize; got != 256 {
		t.Fatalf("order A maxSize = %d, want 256", got)
	}

	// Order B: size first, then path (pending value applied at open).
	busB := NewBus(100, WithEventLogMaxSize(512), WithEventLogPath(path+"b"))
	t.Cleanup(func() { _ = busB.Close() })
	if busB.eventLog == nil {
		t.Fatal("eventLog nil after WithEventLogPath (order B)")
	}
	if got := busB.eventLog.maxSize; got != 512 {
		t.Fatalf("order B maxSize = %d, want 512", got)
	}

	// Non-positive override is ignored; default preserved.
	busC := NewBus(100, WithEventLogMaxSize(0), WithEventLogPath(path+"c"))
	t.Cleanup(func() { _ = busC.Close() })
	if got := busC.eventLog.maxSize; got != defaultEventLogMaxSize {
		t.Fatalf("ignored override maxSize = %d, want default %d", got, defaultEventLogMaxSize)
	}
}
