package deliveryoutbox

import (
	"context"
	"fmt"
	"testing"
)

// BenchmarkRecordDelivery measures the hot-path insert of a new outbox row.
// The fakeStore is in-memory (map+mutex) so this benchmarks the Outbox logic
// plus uuidv7 generation, not SQLite I/O — see PR notes for evidence boundary.
func BenchmarkRecordDelivery(b *testing.B) {
	store := newFakeStore()
	o := NewOutbox(store, nil)
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		id, err := o.RecordDelivery(ctx, "task-bench", `{"k":"v"}`, "edge-1")
		if err != nil {
			b.Fatalf("RecordDelivery: %v", err)
		}
		if id == "" {
			b.Fatal("RecordDelivery returned empty id")
		}
	}
	b.StopTimer()
	if got := store.count(); got != b.N {
		b.Fatalf("store count=%d, want %d", got, b.N)
	}
}

// BenchmarkMarkDeliverySent measures the pending→sent transition including
// the updated_at bump path. Pre-populates the store so each iteration hits
// the happy path without depending on RecordDelivery's uuid cost.
func BenchmarkMarkDeliverySent(b *testing.B) {
	ctx := context.Background()

	// Pre-seed entries outside the timed region.
	store := newFakeStore()
	ids := make([]string, b.N)
	for i := 0; i < b.N; i++ {
		id := fmt.Sprintf("del-sent-%d", i)
		if err := store.Insert(ctx, Entry{
			DeliveryID:   id,
			TaskID:       "task-bench",
			Payload:      `{"k":"v"}`,
			Status:       StatusPending,
			MaxAttempts:  DefaultMaxAttempts,
			EdgeDeviceID: "edge-1",
		}); err != nil {
			b.Fatalf("seed insert: %v", err)
		}
		ids[i] = id
	}

	o := NewOutbox(store, nil)
	b.ResetTimer()
	var ok int
	for i := 0; i < b.N; i++ {
		if err := o.MarkDeliverySent(ctx, ids[i]); err != nil {
			b.Fatalf("MarkDeliverySent: %v", err)
		}
		ok++
	}
	b.StopTimer()
	if ok != b.N {
		b.Fatalf("marked=%d, want %d", ok, b.N)
	}
}

// BenchmarkClaimRetry measures the atomic CAS claim on the retry path.
// Each iteration claims a distinct pre-seeded entry at attempt 0 → 1.
func BenchmarkClaimRetry(b *testing.B) {
	ctx := context.Background()
	store := newFakeStore()
	ids := make([]string, b.N)
	for i := 0; i < b.N; i++ {
		id := fmt.Sprintf("del-claim-%d", i)
		if err := store.Insert(ctx, Entry{
			DeliveryID:   id,
			TaskID:       "task-bench",
			Payload:      `{"k":"v"}`,
			Status:       StatusPending,
			MaxAttempts:  DefaultMaxAttempts,
			EdgeDeviceID: "edge-1",
		}); err != nil {
			b.Fatalf("seed insert: %v", err)
		}
		ids[i] = id
	}

	patch := Patch{
		Status:       strPtr(StatusRetrying),
		AttemptCount: intPtr(1),
		LastError:    strPtr("bench-error"),
	}

	b.ResetTimer()
	var claimed int64
	for i := 0; i < b.N; i++ {
		rows, err := store.ClaimRetry(ctx, ids[i], ActiveStatuses(), 0, patch)
		if err != nil {
			b.Fatalf("ClaimRetry: %v", err)
		}
		claimed += rows
	}
	b.StopTimer()
	if claimed != int64(b.N) {
		b.Fatalf("claimed=%d, want %d", claimed, b.N)
	}
}
