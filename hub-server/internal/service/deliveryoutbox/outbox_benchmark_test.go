// Benchmarks for the delivery outbox journal paths. Uses the in-memory
// fakeStore from outbox_test.go (same package) so no real DB or network is
// involved. Numbers reflect Store-port + Outbox orchestration cost only;
// they do NOT represent gorm/postgres persistence latency.
package deliveryoutbox

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// BenchmarkRecordDelivery measures the insert path: UUID generation + store
// Insert. Represents the per-dispatch journal-write cost before Hub sends a
// task to Edge.
func BenchmarkRecordDelivery(b *testing.B) {
	store := newFakeStore()
	ob := NewOutbox(store, nil)
	ctx := context.Background()
	payload := `{"task_id":"t1","action":"run"}`

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = ob.RecordDelivery(ctx, fmt.Sprintf("task-%d", i), payload, "edge-dev-1")
	}
}

// BenchmarkMarkDeliverySent measures the pending→sent state transition,
// including the attempt_count reset and next_retry_at clear. Hot path on
// every successful dispatch confirmation.
func BenchmarkMarkDeliverySent(b *testing.B) {
	store := newFakeStore()
	ob := NewOutbox(store, nil)
	ctx := context.Background()

	// Pre-seed N pending entries so each iteration has a distinct row.
	ids := make([]string, b.N)
	for i := 0; i < b.N; i++ {
		id, err := ob.RecordDelivery(ctx, fmt.Sprintf("task-%d", i), "{}", "edge-dev-1")
		if err != nil {
			b.Fatalf("seed: %v", err)
		}
		ids[i] = id
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = ob.MarkDeliverySent(ctx, ids[i])
	}
}

// BenchmarkAckDelivery measures the sent→delivered transition triggered by
// an Edge ack callback. Covers the UpdateByDeliveryID CAS + delivered_at set.
func BenchmarkAckDelivery(b *testing.B) {
	store := newFakeStore()
	ob := NewOutbox(store, nil)
	ctx := context.Background()

	ids := make([]string, b.N)
	for i := 0; i < b.N; i++ {
		id, _ := ob.RecordDelivery(ctx, fmt.Sprintf("task-%d", i), "{}", "edge-dev-1")
		_ = ob.MarkDeliverySent(ctx, id)
		ids[i] = id
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = ob.AckDelivery(ctx, ids[i])
	}
}

// BenchmarkScanPending measures the retry-loop scan that finds overdue
// pending deliveries. Seeded with N backdated entries; limit matches the
// production batch size. Represents the periodic sweep cost.
func BenchmarkScanPending(b *testing.B) {
	const batchSize = 50
	store := newFakeStore()
	ctx := context.Background()

	now := time.Now()
	for i := 0; i < 200; i++ {
		store.putEntry(Entry{
			DeliveryID:   fmt.Sprintf("dlv-%d", i),
			TaskID:       fmt.Sprintf("task-%d", i),
			Payload:      "{}",
			Status:       StatusPending,
			MaxAttempts:  DefaultMaxAttempts,
			EdgeDeviceID: "edge-dev-1",
			CreatedAt:    now.Add(-time.Hour),
			UpdatedAt:    now.Add(-time.Hour),
		})
	}
	cutoff := now.Add(-time.Minute)

	ob := NewOutbox(store, nil)
	_ = ob // use ob to keep import; scan goes through store directly below

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = store.ScanPending(ctx, cutoff, batchSize)
	}
}
