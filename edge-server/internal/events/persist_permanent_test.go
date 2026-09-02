package events

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

// TestPersistWithRetry_DeterministicFailureFailsFast pins the retry policy's
// boundary: a failure that cannot succeed on retry must not burn the backoff
// ladder. json.Marshal rejecting an unencodable payload is exactly that — the
// envelope does not change between attempts — and the ladder (2+4+8 = 14ms) is
// pure latency. Since the wire gate (#2154) serialises delivery behind the
// slowest in-flight persist, that latency is bus-wide, not this publisher's.
func TestPersistWithRetry_DeterministicFailureFailsFast(t *testing.T) {
	log, err := NewEventLog(filepath.Join(t.TempDir(), "events.jsonl"))
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = log.Close() })

	b := NewBus(16)
	b.persistFn = log.Append

	evt := EventEnvelope{
		Version: "v1", ID: "evt-unpersistable", Seq: 1, Type: "test.unpersistable",
		Payload: map[string]any{"ch": make(chan int)}, // json.Marshal: unsupported type
	}

	start := time.Now()
	err = b.persistWithRetry(evt)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("an unencodable payload must fail to persist")
	}
	if !errors.Is(err, errUnpersistableEvent) {
		t.Fatalf("error = %v, want it classified as errUnpersistableEvent so the retry loop can fail fast", err)
	}
	if elapsed >= 10*time.Millisecond {
		t.Fatalf("a deterministic persist failure burned %v: the 2+4+8ms ladder is pure latency when the error can never change, and the wire gate turns it into a bus-wide stall", elapsed)
	}
}

// TestPersistWithRetry_TransientFailureStillRetries is the other half of the
// boundary: classifying permanent failures must not turn into "never retry".
func TestPersistWithRetry_TransientFailureStillRetries(t *testing.T) {
	b := NewBus(16)
	attempts := 0
	b.persistFn = func(EventEnvelope) error {
		attempts++
		if attempts < 3 {
			return errors.New("transient write failure")
		}
		return nil
	}

	if err := b.persistWithRetry(EventEnvelope{Version: "v1", Seq: 1, Type: "test.transient"}); err != nil {
		t.Fatalf("a transient failure that clears on the third attempt must succeed, got %v", err)
	}
	if attempts != 3 {
		t.Fatalf("attempts = %d, want 3: transient persist errors must still be retried", attempts)
	}
}

// TestPersistWithRetry_PermanentFailureIsNotRetried counts the attempts directly,
// so the policy does not depend on wall-clock thresholds on a loaded machine.
func TestPersistWithRetry_PermanentFailureIsNotRetried(t *testing.T) {
	log, err := NewEventLog(filepath.Join(t.TempDir(), "events.jsonl"))
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = log.Close() })

	attempts := 0
	b := NewBus(16)
	b.persistFn = func(evt EventEnvelope) error {
		attempts++
		return log.Append(evt)
	}
	evt := EventEnvelope{Version: "v1", ID: "evt-unpersistable-2", Seq: 1, Type: "test.unpersistable", Payload: make(chan int)}

	if err := b.persistWithRetry(evt); err == nil {
		t.Fatal("an unencodable payload must fail to persist")
	}
	if attempts != 1 {
		t.Fatalf("persistFn was called %d times, want exactly 1: a deterministic failure must not be retried", attempts)
	}
}
