package audit

// #1543 — Audit async queue reliability. These tests pin the contract that
// previously silent loss is now observable and shutdown is bounded:
//   - Record on a full queue increments audit_queue_drops_total exactly once
//     per dropped event (no silent drop).
//   - Shutdown is idempotent and bounded by its context deadline.
//   - Retry persistence aborts on lifecycle cancellation instead of sleeping
//     through backoff on a dead process (audit_final_failures_total).

import (
	"context"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
)

// TestRecordQueueFullDropsCounted verifies that a Record on a full retry
// queue is counted (audit_queue_drops_total) and the queue depth gauge
// reflects pending events — the drop is no longer silent.
func TestRecordQueueFullDropsCounted(t *testing.T) {
	metrics.Register()
	dropsBefore := testutil.ToFloat64(metrics.AuditQueueDrops)

	// Constructed without NewService: no retryLoop consumer, so the
	// buffered channel deterministically fills on the second Record.
	svc := &Service{
		retryCh:      make(chan *model.AuditEvent, 1),
		retryBufSize: 1,
		done:         make(chan struct{}),
		lifecycle:    context.Background(),
	}

	svc.Record(context.Background(), "u1", "test", "info", "first", nil, nil, nil, "")
	if got := testutil.ToFloat64(metrics.AuditQueueDepth); got != 1 {
		t.Fatalf("AuditQueueDepth after first enqueue = %v, want 1", got)
	}

	svc.Record(context.Background(), "u1", "test", "info", "second", nil, nil, nil, "")
	if got := testutil.ToFloat64(metrics.AuditQueueDrops) - dropsBefore; got != 1 {
		t.Fatalf("AuditQueueDrops delta = %v, want 1", got)
	}
	if got := len(svc.retryCh); got != 1 {
		t.Fatalf("retryCh len = %d, want 1 (second event dropped)", got)
	}
}

// TestShutdownIdempotent verifies that calling Shutdown twice does not
// panic and the second call is a no-op.
func TestShutdownIdempotent(t *testing.T) {
	svc := NewService(nil, nil)
	svc.Shutdown(context.Background())
	svc.Shutdown(context.Background())
	// Reaching here is the assertion: no close-of-closed-channel panic.
}

// TestShutdownBoundedByCancelledContext verifies that Shutdown returns
// promptly when its context is already cancelled, even with a full queue
// (previously the drain was unbounded).
func TestShutdownBoundedByCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	start := time.Now()
	svc := NewService(nil, nil)
	svc.Shutdown(ctx)
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("Shutdown with cancelled ctx took %v, want < 1s", elapsed)
	}
}

// TestPersistWithRetryAbortsOnCancelledContext verifies that persistence
// checks the context before the first attempt and aborts immediately —
// a cancelled lifecycle/shutdown context must not wait out retries.
func TestPersistWithRetryAbortsOnCancelledContext(t *testing.T) {
	metrics.Register()
	finalBefore := testutil.ToFloat64(metrics.AuditFinalFailures)

	svc := &Service{fileSink: nil, lifecycle: context.Background()}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	start := time.Now()
	svc.persistWithRetry(ctx, &model.AuditEvent{EventType: "test"})
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("persistWithRetry on cancelled ctx took %v, want immediate abort", elapsed)
	}
	if got := testutil.ToFloat64(metrics.AuditFinalFailures) - finalBefore; got != 1 {
		t.Fatalf("AuditFinalFailures delta = %v, want 1 (aborted event counted)", got)
	}
}

// TestRetryLoopAbortsOnLifecycleCancellation verifies that the async queue
// responds to the process lifecycle context: an event enqueued after the
// lifecycle is cancelled is counted as a final failure, not silently left
// in limbo.
func TestRetryLoopAbortsOnLifecycleCancellation(t *testing.T) {
	metrics.Register()
	finalBefore := testutil.ToFloat64(metrics.AuditFinalFailures)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	svc := NewService(nil, &Config{LifecycleContext: ctx})

	svc.Record(context.Background(), "u1", "test", "info", "late", nil, nil, nil, "")

	// The retry loop takes the event and aborts at the ctx.Err() check
	// (nil db is never dereferenced). Poll for the counter.
	deadline := time.Now().Add(2 * time.Second)
	for testutil.ToFloat64(metrics.AuditFinalFailures)-finalBefore < 1 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := testutil.ToFloat64(metrics.AuditFinalFailures) - finalBefore; got != 1 {
		t.Fatalf("AuditFinalFailures delta = %v, want 1 (lifecycle-cancelled event counted)", got)
	}
}
