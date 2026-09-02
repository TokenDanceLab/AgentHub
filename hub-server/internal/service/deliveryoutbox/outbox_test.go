// Outbox journal + retry-loop tests over an in-memory fake Store.
// Split from the gorm-backed service tests (delivery_outbox_integration_test.go)
// so this package's tests stay import-clean (pure-package gate).
package deliveryoutbox

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ── fakeStore ────────────────────────────────────────────────────────────────

// fakeStore is a mutex-protected in-memory Store. It mirrors
// DeliveryOutboxStore semantics: pointer fields apply, ClearNextRetryAt nulls
// NextRetryAt, ClaimRetry is CAS on (delivery_id, status, attempt_count), and
// FindByDeliveryID returns ErrNotFound for missing rows.
type fakeStore struct {
	mu      sync.Mutex
	entries map[string]Entry // keyed by delivery_id
}

var _ Store = (*fakeStore)(nil)

func newFakeStore() *fakeStore {
	return &fakeStore{entries: make(map[string]Entry)}
}

// putEntry writes an entry through the fake store bypassing Insert semantics so
// tests can seed backdated rows with explicit timestamps.
func (s *fakeStore) putEntry(e Entry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[e.DeliveryID] = e
}

// getEntry reads one entry for assertions.
func (s *fakeStore) getEntry(deliveryID string) (Entry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[deliveryID]
	return e, ok
}

func (s *fakeStore) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.entries)
}

// ── Store implementation ─────────────────────────────────────────────────────

func (s *fakeStore) Insert(ctx context.Context, e Entry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now()
	}
	if e.UpdatedAt.IsZero() {
		e.UpdatedAt = time.Now()
	}
	s.entries[e.DeliveryID] = e
	return nil
}

func (s *fakeStore) FindByDeliveryID(ctx context.Context, deliveryID string) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[deliveryID]
	if !ok {
		return Entry{}, ErrNotFound
	}
	return e, nil
}

func (s *fakeStore) UpdateByDeliveryID(ctx context.Context, deliveryID string, statusIn []string, patch Patch) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[deliveryID]
	if !ok || !statusAllowed(e.Status, statusIn) {
		return 0, nil
	}
	applyPatch(&e, patch)
	s.entries[deliveryID] = e
	return 1, nil
}

func (s *fakeStore) ClaimRetry(ctx context.Context, deliveryID string, statusIn []string, expectedAttempt int, patch Patch) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[deliveryID]
	if !ok || !statusAllowed(e.Status, statusIn) || e.AttemptCount != expectedAttempt {
		return 0, nil
	}
	applyPatch(&e, patch)
	s.entries[deliveryID] = e
	return 1, nil
}

func (s *fakeStore) UpdateByTaskID(ctx context.Context, taskID string, statusIn []string, patch Patch) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var rows int64
	for id, e := range s.entries {
		if e.TaskID != taskID || !statusAllowed(e.Status, statusIn) {
			continue
		}
		applyPatch(&e, patch)
		s.entries[id] = e
		rows++
	}
	return rows, nil
}

func (s *fakeStore) ScanPending(ctx context.Context, createdBefore time.Time, limit int) ([]Entry, error) {
	return s.scan(func(e Entry) bool {
		return e.Status == StatusPending && !e.CreatedAt.After(createdBefore)
	}, limit)
}

func (s *fakeStore) ScanSent(ctx context.Context, updatedBefore time.Time, limit int) ([]Entry, error) {
	return s.scan(func(e Entry) bool {
		return e.Status == StatusSent && !e.UpdatedAt.After(updatedBefore)
	}, limit)
}

func (s *fakeStore) ScanRetrying(ctx context.Context, dueAt time.Time, limit int) ([]Entry, error) {
	return s.scan(func(e Entry) bool {
		return e.Status == StatusRetrying && IsRetryingDue(e.NextRetryAt, dueAt)
	}, limit)
}

func (s *fakeStore) scan(match func(Entry) bool, limit int) ([]Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Entry
	for _, e := range s.entries {
		if !match(e) {
			continue
		}
		out = append(out, e)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (s *fakeStore) CountByStatus(ctx context.Context) (map[string]int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	stats := make(map[string]int64)
	for _, e := range s.entries {
		stats[e.Status]++
	}
	return stats, nil
}

func (s *fakeStore) DeleteTerminal(ctx context.Context, statusIn []string, updatedBefore time.Time) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var removed int64
	for id, e := range s.entries {
		if !statusAllowed(e.Status, statusIn) || e.UpdatedAt.After(updatedBefore) {
			continue
		}
		delete(s.entries, id)
		removed++
	}
	return removed, nil
}

// ── patch / seed helpers ─────────────────────────────────────────────────────

func statusAllowed(status string, statusIn []string) bool {
	if len(statusIn) == 0 {
		return true
	}
	for _, s := range statusIn {
		if status == s {
			return true
		}
	}
	return false
}

func applyPatch(e *Entry, patch Patch) {
	if patch.Status != nil {
		e.Status = *patch.Status
	}
	if patch.AttemptCount != nil {
		e.AttemptCount = *patch.AttemptCount
	}
	if patch.LastError != nil {
		e.LastError = *patch.LastError
	}
	if patch.NextRetryAt != nil {
		e.NextRetryAt = patch.NextRetryAt
	}
	if patch.ClearNextRetryAt {
		e.NextRetryAt = nil
	}
	if patch.DeliveredAt != nil {
		e.DeliveredAt = patch.DeliveredAt
	}
	if patch.UpdatedAt != nil {
		e.UpdatedAt = *patch.UpdatedAt
	}
}

// fakeRedispatcher records RedispatchDelivery calls without HTTP/WS.
// When fail is true, RedispatchDelivery returns an error (failure branch).
type fakeRedispatcher struct {
	calls []redispatchCall
	fail  bool
}

type redispatchCall struct {
	taskID       string
	deliveryID   string
	payloadJSON  string
	edgeDeviceID string
}

func (f *fakeRedispatcher) RedispatchDelivery(ctx context.Context, taskID, deliveryID, payloadJSON, edgeDeviceID string) error {
	f.calls = append(f.calls, redispatchCall{
		taskID:       taskID,
		deliveryID:   deliveryID,
		payloadJSON:  payloadJSON,
		edgeDeviceID: edgeDeviceID,
	})
	if f.fail {
		return errors.New("redispatch failed")
	}
	return nil
}

// ==================== TestOutbox_RecordAndAck ====================

func TestOutbox_RecordAndAck(t *testing.T) {
	store := newFakeStore()
	outbox := NewOutbox(store, nil)
	ctx := context.Background()

	// Record a delivery.
	deliveryID, err := outbox.RecordDelivery(ctx, "task-1", `{"test":true}`, "dev-1")
	require.NoError(t, err)
	require.NotEmpty(t, deliveryID)

	// Verify it's in pending status.
	status, err := outbox.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, StatusPending, status)

	// Mark as sent.
	err = outbox.MarkDeliverySent(ctx, deliveryID)
	require.NoError(t, err)

	status, err = outbox.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, StatusSent, status)

	// Ack the delivery.
	err = outbox.AckDelivery(ctx, deliveryID)
	require.NoError(t, err)

	status, err = outbox.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, StatusDelivered, status)
}

// ==================== TestOutbox_IdempotentAck ====================

func TestOutbox_IdempotentAck(t *testing.T) {
	store := newFakeStore()
	outbox := NewOutbox(store, nil)
	ctx := context.Background()

	deliveryID, err := outbox.RecordDelivery(ctx, "task-1", `{}`, "")
	require.NoError(t, err)

	// First ack should succeed.
	err = outbox.AckDelivery(ctx, deliveryID)
	require.NoError(t, err)

	// Second ack should be idempotent (no error).
	err = outbox.AckDelivery(ctx, deliveryID)
	require.NoError(t, err)

	status, err := outbox.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, StatusDelivered, status)
}

// ==================== TestOutbox_MarkSentIdempotent ====================

func TestOutbox_MarkSentIdempotent(t *testing.T) {
	store := newFakeStore()
	outbox := NewOutbox(store, nil)
	ctx := context.Background()

	deliveryID, err := outbox.RecordDelivery(ctx, "task-1", `{}`, "")
	require.NoError(t, err)

	// First MarkDeliverySent should succeed.
	err = outbox.MarkDeliverySent(ctx, deliveryID)
	require.NoError(t, err)

	// Second should be idempotent (no error).
	err = outbox.MarkDeliverySent(ctx, deliveryID)
	require.NoError(t, err)

	status, err := outbox.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, StatusSent, status)
}

func TestOutbox_MarkSentOnAlreadySentRestartsAckWindow(t *testing.T) {
	store := newFakeStore()
	outbox := NewOutbox(store, nil)
	ctx := context.Background()

	deliveryID, err := outbox.RecordDelivery(ctx, "task-sent-bump", `{}`, "")
	require.NoError(t, err)
	require.NoError(t, outbox.MarkDeliverySent(ctx, deliveryID))

	// Age the row so it would be eligible for the ack-window rescan.
	oldTime := time.Now().Add(-2 * SentTimeout)
	rec, ok := store.getEntry(deliveryID)
	require.True(t, ok)
	rec.UpdatedAt = oldTime
	store.putEntry(rec)

	// A replay push to a live desktop re-marks sent → the ack window restarts.
	require.NoError(t, outbox.MarkDeliverySent(ctx, deliveryID))

	status, err := outbox.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, StatusSent, status)

	rec, ok = store.getEntry(deliveryID)
	require.True(t, ok)
	assert.True(t, rec.UpdatedAt.After(oldTime), "ack window must restart after replay re-mark")
	assert.Equal(t, 0, rec.AttemptCount)
}

// ==================== TestOutbox_AckNotFound ====================

func TestOutbox_AckNotFound(t *testing.T) {
	store := newFakeStore()
	outbox := NewOutbox(store, nil)
	ctx := context.Background()

	err := outbox.AckDelivery(ctx, "nonexistent-delivery-id")
	require.Error(t, err)
}

// ==================== TestOutbox_RetryBackoff ====================

func TestOutbox_RetryBackoff(t *testing.T) {
	store := newFakeStore()
	outbox := NewOutbox(store, nil)
	ctx := context.Background()

	deliveryID, err := outbox.RecordDelivery(ctx, "task-retry", `{"test":true}`, "dev-retry")
	require.NoError(t, err)

	// Mark as sent first (to simulate a dispatch that needs retry).
	err = outbox.MarkDeliverySent(ctx, deliveryID)
	require.NoError(t, err)

	// First retry: should succeed and schedule next retry.
	shouldRetry, err := outbox.MarkDeliveryRetrying(ctx, deliveryID, "transient network error")
	require.NoError(t, err)
	require.True(t, shouldRetry)

	// Verify status is retrying and attempt count incremented.
	status, err := outbox.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, StatusRetrying, status)

	// Verify next_retry_at is set.
	rec, ok := store.getEntry(deliveryID)
	require.True(t, ok)
	assert.Equal(t, 1, rec.AttemptCount)
	assert.NotNil(t, rec.NextRetryAt)
	assert.True(t, rec.NextRetryAt.After(time.Now()))
	assert.Equal(t, "transient network error", rec.LastError)
}

// ==================== TestOutbox_DeadLetter ====================

func TestOutbox_DeadLetter(t *testing.T) {
	store := newFakeStore()
	outbox := NewOutbox(store, nil)
	ctx := context.Background()

	deliveryID, err := outbox.RecordDelivery(ctx, "task-dead", `{"test":true}`, "dev-dead")
	require.NoError(t, err)

	// Mark as sent.
	err = outbox.MarkDeliverySent(ctx, deliveryID)
	require.NoError(t, err)

	// Retry 2 times (maxAttempts is 3, so attempt 0→1, 1→2, 2→3=dead).
	for i := 0; i < 2; i++ {
		shouldRetry, err := outbox.MarkDeliveryRetrying(ctx, deliveryID, "error")
		require.NoError(t, err)
		require.True(t, shouldRetry, "retry %d should be allowed", i)
	}

	// Third retry should move to dead-letter.
	shouldRetry, err := outbox.MarkDeliveryRetrying(ctx, deliveryID, "final error")
	require.NoError(t, err)
	require.False(t, shouldRetry, "third retry should move to dead-letter")

	// Verify status is dead.
	status, err := outbox.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, StatusDead, status)

	rec, ok := store.getEntry(deliveryID)
	require.True(t, ok)
	assert.Equal(t, 3, rec.AttemptCount)
	assert.Equal(t, StatusDead, rec.Status)
	assert.Nil(t, rec.NextRetryAt)
}

// ==================== TestOutbox_DeadLetterExplicit ====================

func TestOutbox_DeadLetterExplicit(t *testing.T) {
	store := newFakeStore()
	outbox := NewOutbox(store, nil)
	ctx := context.Background()

	deliveryID, err := outbox.RecordDelivery(ctx, "task-explicit", `{}`, "")
	require.NoError(t, err)

	err = outbox.MoveDeliveryToDeadLetter(ctx, deliveryID, "non-retryable error")
	require.NoError(t, err)

	status, err := outbox.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, StatusDead, status)
}

// ==================== TestOutbox_ScanRetryable ====================

func TestOutbox_ScanRetryable(t *testing.T) {
	store := newFakeStore()
	outbox := NewOutbox(store, nil)
	ctx := context.Background()

	now := time.Now()

	// Seed rows with explicit timestamps (fake store has no auto-create time).
	oldPendingTime := now.Add(-PendingTimeout - time.Second)
	store.putEntry(Entry{
		ID: "old-pending", TaskID: "task-old-pending", DeliveryID: "del-old-pending",
		Payload: `{}`, Status: StatusPending, MaxAttempts: DefaultMaxAttempts,
		CreatedAt: oldPendingTime, UpdatedAt: oldPendingTime,
	})

	// A recent pending delivery (not yet eligible) — uses current time.
	store.putEntry(Entry{
		ID: "recent-pending", TaskID: "task-recent", DeliveryID: "del-recent",
		Payload: `{}`, Status: StatusPending, MaxAttempts: DefaultMaxAttempts,
		CreatedAt: now, UpdatedAt: now,
	})

	// A sent delivery older than SentTimeout.
	oldSentTime := now.Add(-SentTimeout - time.Second)
	store.putEntry(Entry{
		ID: "old-sent", TaskID: "task-old-sent", DeliveryID: "del-old-sent",
		Payload: `{}`, Status: StatusSent, MaxAttempts: DefaultMaxAttempts,
		CreatedAt: oldSentTime, UpdatedAt: oldSentTime,
	})

	// A retrying delivery past its next_retry_at.
	pastRetry := now.Add(-time.Second)
	store.putEntry(Entry{
		ID: "retrying-past", TaskID: "task-retrying", DeliveryID: "del-retrying",
		Payload: `{}`, Status: StatusRetrying, AttemptCount: 1,
		MaxAttempts: DefaultMaxAttempts, NextRetryAt: &pastRetry,
		CreatedAt: now, UpdatedAt: now,
	})

	// A delivered delivery (should not appear in scan).
	store.putEntry(Entry{
		ID: "delivered", TaskID: "task-done", DeliveryID: "del-done",
		Payload: `{}`, Status: StatusDelivered, MaxAttempts: DefaultMaxAttempts,
		CreatedAt: now, UpdatedAt: now,
	})

	records, err := outbox.ScanRetryableDeliveries(ctx)
	require.NoError(t, err)
	// Should find: old-pending, old-sent, retrying-past (3 records)
	assert.Len(t, records, 3)

	ids := make(map[string]bool)
	for _, r := range records {
		ids[r.ID] = true
	}
	assert.True(t, ids["old-pending"])
	assert.True(t, ids["old-sent"])
	assert.True(t, ids["retrying-past"])
	assert.False(t, ids["recent-pending"], "recent pending should not be retryable")
	assert.False(t, ids["delivered"], "delivered should not be retryable")
}

// ==================== TestOutbox_ComputeBackoff ====================

func TestOutbox_ComputeBackoff(t *testing.T) {
	base := RetryBaseInterval
	max := RetryMaxInterval

	// NextRetryAt takes an injectable clock, so use a fixed now to make the
	// assertion deterministic (no time.Now() drift between the computation
	// and the assertion). The ±25% jitter from applyRetryJitter still
	// applies, so the delay must land within [expected*0.75, expected*1.25].
	// A small slack of 100ms covers sub-millisecond rounding.
	const slack = 100 * time.Millisecond
	fixedNow := time.Unix(1_700_000_000, 0).UTC()

	// Attempt 0: base (2s) ± 25% jitter → [1.5s, 2.5s]
	next := NextRetryAt(0, fixedNow)
	delay := next.Sub(fixedNow)
	assert.GreaterOrEqual(t, delay, base-base/4-slack)
	assert.LessOrEqual(t, delay, base+base/4+slack)

	// Attempt 1: base*2 (4s) ± 25% jitter → [3s, 5s]
	next = NextRetryAt(1, fixedNow)
	delay = next.Sub(fixedNow)
	assert.GreaterOrEqual(t, delay, base*2-base*2/4-slack)
	assert.LessOrEqual(t, delay, base*2+base*2/4+slack)

	// Attempt 3: base*8 (16s) ± 25% jitter → [12s, 20s]
	next = NextRetryAt(3, fixedNow)
	delay = next.Sub(fixedNow)
	assert.GreaterOrEqual(t, delay, base*8-base*8/4-slack)
	assert.LessOrEqual(t, delay, base*8+base*8/4+slack)

	// Attempt 10: capped at max (30s) ± 25% jitter → [22.5s, 37.5s]
	next = NextRetryAt(10, fixedNow)
	delay = next.Sub(fixedNow)
	assert.GreaterOrEqual(t, delay, max-max/4-slack)
	assert.LessOrEqual(t, delay, max+max/4+slack)
}

// ==================== TestOutbox_CleanupOld ====================

func TestOutbox_CleanupOld(t *testing.T) {
	store := newFakeStore()
	outbox := NewOutbox(store, nil)
	ctx := context.Background()

	now := time.Now()

	// Create old delivered record.
	store.putEntry(Entry{
		ID: "old-delivered", TaskID: "task-old", DeliveryID: "del-old-delivered",
		Payload: `{}`, Status: StatusDelivered, MaxAttempts: DefaultMaxAttempts,
		CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-48 * time.Hour),
	})

	// Create recent delivered record.
	store.putEntry(Entry{
		ID: "recent-delivered", TaskID: "task-recent", DeliveryID: "del-recent-delivered",
		Payload: `{}`, Status: StatusDelivered, MaxAttempts: DefaultMaxAttempts,
		CreatedAt: now, UpdatedAt: now,
	})

	// Create old dead-letter record.
	store.putEntry(Entry{
		ID: "old-dead", TaskID: "task-dead", DeliveryID: "del-old-dead",
		Payload: `{}`, Status: StatusDead, MaxAttempts: DefaultMaxAttempts,
		CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-48 * time.Hour),
	})

	// Create pending record (should not be cleaned up).
	store.putEntry(Entry{
		ID: "pending-not-clean", TaskID: "task-pending", DeliveryID: "del-pending-clean",
		Payload: `{}`, Status: StatusPending, MaxAttempts: DefaultMaxAttempts,
		CreatedAt: now.Add(-48 * time.Hour), UpdatedAt: now.Add(-48 * time.Hour),
	})

	// Clean up records older than 24h.
	count, err := outbox.CleanupOldDeliveries(ctx, 24*time.Hour)
	require.NoError(t, err)
	assert.Equal(t, int64(2), count) // old-delivered + old-dead

	// Verify old records are gone, recent and pending remain.
	assert.Equal(t, 2, store.count()) // recent-delivered + pending-not-clean
	_, ok := store.getEntry("del-old-delivered")
	assert.False(t, ok, "old delivered row must be purged")
	_, ok = store.getEntry("del-old-dead")
	assert.False(t, ok, "old dead row must be purged")
	_, ok = store.getEntry("del-recent-delivered")
	assert.True(t, ok, "recent delivered row must remain")
	_, ok = store.getEntry("del-pending-clean")
	assert.True(t, ok, "pending row must remain")
}

// ==================== TestOutbox_DeliveryStats ====================

func TestOutbox_DeliveryStats(t *testing.T) {
	store := newFakeStore()
	outbox := NewOutbox(store, nil)
	ctx := context.Background()

	// Create various status records.
	now := time.Now()
	for i, status := range []string{StatusPending, StatusPending, StatusSent, StatusDelivered, StatusDead} {
		suffix := string(rune('a' + i))
		store.putEntry(Entry{
			ID: "stat-" + suffix, TaskID: "task-stat", DeliveryID: "del-stat-" + suffix,
			Payload: `{}`, Status: status, MaxAttempts: DefaultMaxAttempts,
			CreatedAt: now, UpdatedAt: now,
		})
	}

	stats, err := outbox.GetDeliveryStats(ctx)
	require.NoError(t, err)
	assert.Equal(t, int64(2), stats[StatusPending])
	assert.Equal(t, int64(1), stats[StatusSent])
	assert.Equal(t, int64(1), stats[StatusDelivered])
	assert.Equal(t, int64(1), stats[StatusDead])
}

// ==================== TestOutbox_RecordDeliverySerializesPayload ====================

func TestOutbox_RecordDeliverySerializesPayload(t *testing.T) {
	store := newFakeStore()
	outbox := NewOutbox(store, nil)
	ctx := context.Background()

	payload := `{"task_id":"task-payload","agent_type":"codex","prompt":"hello"}`
	deliveryID, err := outbox.RecordDelivery(ctx, "task-payload", payload, "dev-payload")
	require.NoError(t, err)
	require.NotEmpty(t, deliveryID)

	// Verify the payload is stored correctly.
	rec, ok := store.getEntry(deliveryID)
	require.True(t, ok)
	assert.Equal(t, payload, rec.Payload)
	assert.Equal(t, "task-payload", rec.TaskID)
	assert.Equal(t, "dev-payload", rec.EdgeDeviceID)
	assert.Equal(t, StatusPending, rec.Status)
	assert.Equal(t, DefaultMaxAttempts, rec.MaxAttempts)
}

// ==================== TestOutbox_RetryLoopInvokesRedispatcher ====================

func TestOutbox_RetryLoopInvokesRedispatcher(t *testing.T) {
	store := newFakeStore()
	ctx := context.Background()
	fake := &fakeRedispatcher{}
	outbox := NewOutbox(store, fake)

	now := time.Now()

	// Seed a sent delivery past SentTimeout so scan finds it.
	oldSentTime := now.Add(-SentTimeout - time.Second)
	payload := `{"task_id":"task-port","opaque":true}`
	store.putEntry(Entry{
		ID: "port-sent", TaskID: "task-port", DeliveryID: "del-port",
		Payload: payload, Status: StatusSent, AttemptCount: 0,
		MaxAttempts: DefaultMaxAttempts, EdgeDeviceID: "dev-port",
		CreatedAt: oldSentTime, UpdatedAt: oldSentTime,
	})

	// Drive one retry cycle (no ticker / no HTTP/WS).
	outbox.retryDeliveries(ctx)

	// Successful redispatch transitions retrying→sent and clears next_retry_at
	// so the ack-timeout window governs re-scan (not retry cadence).
	status, err := outbox.GetDeliveryStatus(ctx, "del-port")
	require.NoError(t, err)
	assert.Equal(t, StatusSent, status)

	rec, ok := store.getEntry("del-port")
	require.True(t, ok)
	assert.Nil(t, rec.NextRetryAt)
	// Successful redispatch resets the attempt budget — the dead-letter
	// counter counts consecutive FAILED attempts, not successful requeues.
	assert.Equal(t, 0, rec.AttemptCount)

	// Opaque redispatch port invoked with stored payload bytes.
	require.Len(t, fake.calls, 1)
	assert.Equal(t, "task-port", fake.calls[0].taskID)
	assert.Equal(t, "del-port", fake.calls[0].deliveryID)
	assert.Equal(t, payload, fake.calls[0].payloadJSON)
	assert.Equal(t, "dev-port", fake.calls[0].edgeDeviceID)
}

func TestOutbox_RetryLoopSuccessfulRedispatchDoesNotDeadLetter(t *testing.T) {
	store := newFakeStore()
	ctx := context.Background()
	fake := &fakeRedispatcher{}
	outbox := NewOutbox(store, fake)

	now := time.Now()

	// Seed a sent delivery past SentTimeout. This models an
	// offline-queued task: every redispatch succeeds (the offline queue keeps
	// accepting), and no edge has acked yet.
	oldSentTime := now.Add(-SentTimeout - time.Second)
	payload := `{"task_id":"task-live-queue","opaque":true}`
	store.putEntry(Entry{
		ID: "live-sent", TaskID: "task-live-queue", DeliveryID: "del-live",
		Payload: payload, Status: StatusSent, AttemptCount: 0,
		MaxAttempts: DefaultMaxAttempts, EdgeDeviceID: "dev-live",
		CreatedAt: oldSentTime, UpdatedAt: oldSentTime,
	})

	// Drive far more retry cycles than the dead-letter budget (max 3).
	// A successful redispatch proves the payload is still durably queued, so
	// the delivery must stay alive — otherwise the reconnect replay gate
	// refuses dead rows and a desktop reconnecting later misses the task.
	for i := 0; i < 6; i++ {
		outbox.retryDeliveries(ctx)
		// Re-age updated_at so the sent row is eligible for the next scan
		// (simulates the ack-window elapsing again).
		rec, ok := store.getEntry("del-live")
		require.True(t, ok)
		rec.UpdatedAt = oldSentTime
		store.putEntry(rec)
	}

	status, err := outbox.GetDeliveryStatus(ctx, "del-live")
	require.NoError(t, err)
	assert.Equal(t, StatusSent, status, "successful redispatch cycles must not dead-letter")

	rec, ok := store.getEntry("del-live")
	require.True(t, ok)
	// Each successful redispatch resets the failure budget.
	assert.Equal(t, 0, rec.AttemptCount)

	require.Len(t, fake.calls, 6)
}

func TestOutbox_RetryLoopRedispatchFailureStaysRetrying(t *testing.T) {
	store := newFakeStore()
	ctx := context.Background()
	fake := &fakeRedispatcher{fail: true}
	outbox := NewOutbox(store, fake)

	now := time.Now()

	// Seed a retrying delivery past next_retry_at so scan finds it.
	pastRetry := now.Add(-time.Second)
	payload := `{"task_id":"task-fail","opaque":true}`
	store.putEntry(Entry{
		ID: "fail-retry", TaskID: "task-fail", DeliveryID: "del-fail",
		Payload: payload, Status: StatusRetrying, AttemptCount: 1,
		MaxAttempts: DefaultMaxAttempts, NextRetryAt: &pastRetry,
		EdgeDeviceID: "dev-fail", LastError: "prior",
		CreatedAt: now, UpdatedAt: now,
	})

	outbox.retryDeliveries(ctx)

	// Failure branch: stays retrying with next_retry_at set for backoff.
	status, err := outbox.GetDeliveryStatus(ctx, "del-fail")
	require.NoError(t, err)
	assert.Equal(t, StatusRetrying, status)

	rec, ok := store.getEntry("del-fail")
	require.True(t, ok)
	assert.NotNil(t, rec.NextRetryAt)
	assert.True(t, rec.NextRetryAt.After(now))
	assert.Equal(t, 2, rec.AttemptCount)

	require.Len(t, fake.calls, 1)
	assert.Equal(t, "del-fail", fake.calls[0].deliveryID)
}

func TestOutbox_MarkDeliverySentFromRetrying(t *testing.T) {
	store := newFakeStore()
	ctx := context.Background()
	outbox := NewOutbox(store, nil)

	now := time.Now()

	nextRetry := now.Add(5 * time.Second)
	store.putEntry(Entry{
		ID: "mark-retry", TaskID: "task-mark", DeliveryID: "del-mark",
		Payload: `{}`, Status: StatusRetrying, AttemptCount: 1,
		MaxAttempts: DefaultMaxAttempts, NextRetryAt: &nextRetry,
		CreatedAt: now, UpdatedAt: now,
	})

	// retrying→sent clears next_retry_at (idempotent RowsAffected==0 OK).
	require.NoError(t, outbox.MarkDeliverySent(ctx, "del-mark"))
	status, err := outbox.GetDeliveryStatus(ctx, "del-mark")
	require.NoError(t, err)
	assert.Equal(t, StatusSent, status)

	rec, ok := store.getEntry("del-mark")
	require.True(t, ok)
	assert.Nil(t, rec.NextRetryAt)

	// Already sent: no-op.
	require.NoError(t, outbox.MarkDeliverySent(ctx, "del-mark"))
	status, err = outbox.GetDeliveryStatus(ctx, "del-mark")
	require.NoError(t, err)
	assert.Equal(t, StatusSent, status)
}

func TestOutbox_RetryLoopNoRedispatcherSkipsDispatch(t *testing.T) {
	store := newFakeStore()
	ctx := context.Background()
	// nil redispatcher: journal still advances; redispatch is a no-op.
	outbox := NewOutbox(store, nil)

	now := time.Now()

	oldSentTime := now.Add(-SentTimeout - time.Second)
	store.putEntry(Entry{
		ID: "nil-port", TaskID: "task-nil", DeliveryID: "del-nil",
		Payload: `{}`, Status: StatusSent, AttemptCount: 0,
		MaxAttempts: DefaultMaxAttempts,
		CreatedAt:   oldSentTime, UpdatedAt: oldSentTime,
	})

	outbox.retryDeliveries(ctx)

	status, err := outbox.GetDeliveryStatus(ctx, "del-nil")
	require.NoError(t, err)
	assert.Equal(t, StatusRetrying, status)
}

func TestOutbox_MarkDeliverySentBumpsUpdatedAt(t *testing.T) {
	store := newFakeStore()
	ctx := context.Background()
	outbox := NewOutbox(store, nil)

	old := time.Now().Add(-2 * time.Hour).UTC().Truncate(time.Second)
	nextRetry := old.Add(time.Minute)
	store.putEntry(Entry{
		ID: "upd-1", TaskID: "task-upd", DeliveryID: "del-upd",
		Payload: `{}`, Status: StatusRetrying, AttemptCount: 1,
		MaxAttempts: DefaultMaxAttempts, NextRetryAt: &nextRetry,
		CreatedAt: old, UpdatedAt: old,
	})

	before := time.Now().UTC()
	require.NoError(t, outbox.MarkDeliverySent(ctx, "del-upd"))

	rec, ok := store.getEntry("del-upd")
	require.True(t, ok)
	assert.Equal(t, StatusSent, rec.Status)
	assert.Nil(t, rec.NextRetryAt)
	require.False(t, rec.UpdatedAt.IsZero())
	assert.True(t, !rec.UpdatedAt.Before(before), "updated_at should advance on MarkDeliverySent, got %v before %v", rec.UpdatedAt, before)
	assert.True(t, rec.UpdatedAt.After(old), "updated_at should be newer than seed, got %v old %v", rec.UpdatedAt, old)
}

func TestOutbox_RetryLoopAdapterSoftFailDoesNotMarkSent(t *testing.T) {
	store := newFakeStore()
	ctx := context.Background()

	now := time.Now()
	payload := `{"task_id":"task-soft","agent_type":"claude-code","prompt":"hi"}`
	pastRetry := now.Add(-time.Second)
	store.putEntry(Entry{
		ID: "id-del-soft", TaskID: "task-soft", DeliveryID: "del-soft",
		Payload: payload, Status: StatusRetrying, AttemptCount: 1,
		MaxAttempts: DefaultMaxAttempts, NextRetryAt: &pastRetry,
		EdgeDeviceID: "dev-1", LastError: "prior",
		CreatedAt: now, UpdatedAt: now,
	})

	fake := &fakeRedispatcher{fail: true}
	outbox := NewOutbox(store, fake)

	outbox.retryDeliveries(ctx)

	status, err := outbox.GetDeliveryStatus(ctx, "del-soft")
	require.NoError(t, err)
	assert.Equal(t, StatusRetrying, status, "soft-fail must not MarkDeliverySent")

	rec, ok := store.getEntry("del-soft")
	require.True(t, ok)
	assert.NotNil(t, rec.NextRetryAt)
	assert.Equal(t, 2, rec.AttemptCount)
}

func TestOutbox_RetryLoopAdapterSuccessMarksSentAndBumpsUpdatedAt(t *testing.T) {
	store := newFakeStore()
	ctx := context.Background()

	old := time.Now().Add(-SentTimeout - time.Second)
	payload := `{"task_id":"task-ok","agent_type":"claude-code","prompt":"hi"}`
	store.putEntry(Entry{
		ID: "id-del-ok", TaskID: "task-ok", DeliveryID: "del-ok",
		Payload: payload, Status: StatusSent, AttemptCount: 0,
		MaxAttempts: DefaultMaxAttempts, EdgeDeviceID: "dev-1",
		CreatedAt: old, UpdatedAt: old,
	})

	fake := &fakeRedispatcher{}
	outbox := NewOutbox(store, fake)

	before := time.Now().UTC()
	outbox.retryDeliveries(ctx)

	status, err := outbox.GetDeliveryStatus(ctx, "del-ok")
	require.NoError(t, err)
	assert.Equal(t, StatusSent, status, "successful redispatch should mark sent")

	rec, ok := store.getEntry("del-ok")
	require.True(t, ok)
	assert.Nil(t, rec.NextRetryAt)
	// Successful redispatch resets the failure budget (see MarkDeliverySent).
	assert.Equal(t, 0, rec.AttemptCount)
	assert.True(t, !rec.UpdatedAt.Before(before), "updated_at should advance on success MarkDeliverySent")
	assert.True(t, rec.UpdatedAt.After(old), "updated_at should be newer than pre-retry seed")

	// The redispatcher received the stored payload (offline queue / route port).
	require.Len(t, fake.calls, 1)
	assert.Equal(t, payload, fake.calls[0].payloadJSON)
	assert.Equal(t, "task-ok", fake.calls[0].taskID)
	assert.Equal(t, "dev-1", fake.calls[0].edgeDeviceID)
}

// ==================== #1009 atomic outbox claim (CAS on attempt_count) ====================

func TestOutbox_ClaimRetryCASOnlyOneWins(t *testing.T) {
	store := newFakeStore()
	ctx := context.Background()
	outbox := NewOutbox(store, nil)

	now := time.Now()
	store.putEntry(Entry{
		ID: "cas-1", TaskID: "task-cas", DeliveryID: "del-cas",
		Payload: `{}`, Status: StatusSent, AttemptCount: 0,
		MaxAttempts: DefaultMaxAttempts,
		CreatedAt:   now, UpdatedAt: now,
	})

	nextRetry := now.Add(time.Minute)
	patch := Patch{
		Status:       strPtr(StatusRetrying),
		AttemptCount: intPtr(1),
		LastError:    strPtr("timeout"),
		NextRetryAt:  &nextRetry,
	}

	// First claim at observed attempt=0 wins.
	rows, err := outbox.store.ClaimRetry(ctx, "del-cas", ActiveStatuses(), 0, patch)
	require.NoError(t, err)
	assert.Equal(t, int64(1), rows)

	// Second claim with the same expected attempt loses (CAS).
	rows, err = outbox.store.ClaimRetry(ctx, "del-cas", ActiveStatuses(), 0, patch)
	require.NoError(t, err)
	assert.Equal(t, int64(0), rows)

	rec, ok := store.getEntry("del-cas")
	require.True(t, ok)
	assert.Equal(t, 1, rec.AttemptCount)
	assert.Equal(t, StatusRetrying, rec.Status)
}

func TestOutbox_MarkDeliveryRetryingLostClaimSkips(t *testing.T) {
	store := newFakeStore()
	ctx := context.Background()
	outbox := NewOutbox(store, nil)

	now := time.Now()
	store.putEntry(Entry{
		ID: "lost-1", TaskID: "task-lost", DeliveryID: "del-lost",
		Payload: `{}`, Status: StatusSent, AttemptCount: 0,
		MaxAttempts: DefaultMaxAttempts,
		CreatedAt:   now, UpdatedAt: now,
	})

	// Simulate another worker claiming first (attempt 0→1).
	nextRetry := now.Add(time.Minute)
	rows, err := outbox.store.ClaimRetry(ctx, "del-lost", ActiveStatuses(), 0, Patch{
		Status:       strPtr(StatusRetrying),
		AttemptCount: intPtr(1),
		LastError:    strPtr("other-worker"),
		NextRetryAt:  &nextRetry,
	})
	require.NoError(t, err)
	require.Equal(t, int64(1), rows)

	// Force a stale CAS path: claim again with expected attempt=0 (what a concurrent
	// worker that already observed attempt=0 would attempt). Must not redispatch.
	rows, err = outbox.store.ClaimRetry(ctx, "del-lost", ActiveStatuses(), 0, Patch{
		Status:       strPtr(StatusRetrying),
		AttemptCount: intPtr(1),
		LastError:    strPtr("stale"),
		NextRetryAt:  &nextRetry,
	})
	require.NoError(t, err)
	assert.Equal(t, int64(0), rows, "stale attempt_count CAS must lose")

	// Full MarkDeliveryRetrying after a real claim advances 1→2 (new cycle), not a double claim.
	shouldRetry, err := outbox.MarkDeliveryRetrying(ctx, "del-lost", "next-cycle")
	require.NoError(t, err)
	assert.True(t, shouldRetry)

	rec, ok := store.getEntry("del-lost")
	require.True(t, ok)
	assert.Equal(t, 2, rec.AttemptCount)
	assert.Equal(t, "next-cycle", rec.LastError)
}

func TestOutbox_ConcurrentMarkDeliveryRetryingOnlyOneClaim(t *testing.T) {
	// The fake store's mutex-guarded CAS on attempt_count ensures only one
	// worker owns redispatch for the same observation, mirroring the SQL CAS.
	store := newFakeStore()
	outbox := NewOutbox(store, nil)
	ctx := context.Background()

	now := time.Now()
	store.putEntry(Entry{
		ID: "conc-1", TaskID: "task-conc", DeliveryID: "del-conc",
		Payload: `{}`, Status: StatusSent, AttemptCount: 0,
		MaxAttempts: DefaultMaxAttempts,
		CreatedAt:   now, UpdatedAt: now,
	})

	const workers = 16
	var (
		wg      sync.WaitGroup
		start   = make(chan struct{})
		success atomic.Int64
		fails   atomic.Int64
	)
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			<-start
			// Direct CAS claim with the same expected attempt (scan snapshot).
			// Mirrors multi-worker retry ticks that all observed attempt_count=0.
			nextRetry := time.Now().Add(time.Minute)
			rows, err := outbox.store.ClaimRetry(ctx, "del-conc", ActiveStatuses(), 0, Patch{
				Status:       strPtr(StatusRetrying),
				AttemptCount: intPtr(1),
				LastError:    strPtr("concurrent"),
				NextRetryAt:  &nextRetry,
			})
			if err != nil {
				fails.Add(1)
				return
			}
			if rows == 1 {
				success.Add(1)
			}
		}()
	}
	close(start)
	wg.Wait()

	require.Equal(t, int64(0), fails.Load(), "claim must not error under contention")
	assert.Equal(t, int64(1), success.Load(), "exactly one worker must win the atomic claim")

	rec, ok := store.getEntry("del-conc")
	require.True(t, ok)
	assert.Equal(t, 1, rec.AttemptCount)
	assert.Equal(t, StatusRetrying, rec.Status)

	// MarkDeliveryRetrying concurrent path with scan-snapshot CAS (same attempt
	// observed by every worker — mirrors multi-replica retry ticks).
	store.putEntry(Entry{
		ID: "conc-2", TaskID: "task-conc2", DeliveryID: "del-conc2",
		Payload: `{}`, Status: StatusSent, AttemptCount: 0,
		MaxAttempts: DefaultMaxAttempts,
		CreatedAt:   now, UpdatedAt: now,
	})

	var (
		wg2      sync.WaitGroup
		start2   = make(chan struct{})
		retryYes atomic.Int64
	)
	wg2.Add(workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg2.Done()
			<-start2
			// Fixed expectedAttempt=0 matches ScanRetryableDeliveries snapshot;
			// re-find is intentionally skipped so losers cannot chain-claim.
			should, err := outbox.claimDeliveryRetrying(ctx, "del-conc2", "task-conc2", 0, DefaultMaxAttempts, "race")
			if err == nil && should {
				retryYes.Add(1)
			}
		}()
	}
	close(start2)
	wg2.Wait()

	assert.Equal(t, int64(1), retryYes.Load(), "exactly one snapshot claim may redispatch")

	rec2, ok := store.getEntry("del-conc2")
	require.True(t, ok)
	assert.Equal(t, 1, rec2.AttemptCount)
	assert.Equal(t, StatusRetrying, rec2.Status)
}

// ── AutoAckDeliveriesForTask (#2154 P2-9) ─────────────────────────────────
//
// The Edge stream callback now dedupes this call per task in process memory, so
// the operation's idempotency is what makes the dedupe (and a process restart
// that empties it) safe. These tests pin that idempotency plus the error
// propagation the caller uses to decide whether to record the dedupe entry.

// failingTaskUpdateStore injects a Store failure for UpdateByTaskID only.
type failingTaskUpdateStore struct {
	*fakeStore
	err   error
	calls atomic.Int32
}

func (s *failingTaskUpdateStore) UpdateByTaskID(ctx context.Context, taskID string, statusIn []string, patch Patch) (int64, error) {
	s.calls.Add(1)
	if s.err != nil {
		return 0, s.err
	}
	return s.fakeStore.UpdateByTaskID(ctx, taskID, statusIn, patch)
}

func seedAutoAckEntries(store *fakeStore, taskID string) {
	now := time.Now()
	store.putEntry(Entry{DeliveryID: "del-pending", TaskID: taskID, Status: StatusPending, CreatedAt: now, UpdatedAt: now})
	store.putEntry(Entry{DeliveryID: "del-sent", TaskID: taskID, Status: StatusSent, CreatedAt: now, UpdatedAt: now})
	store.putEntry(Entry{DeliveryID: "del-retrying", TaskID: taskID, Status: StatusRetrying, CreatedAt: now, UpdatedAt: now})
	store.putEntry(Entry{DeliveryID: "del-dead", TaskID: taskID, Status: StatusDead, CreatedAt: now, UpdatedAt: now})
	store.putEntry(Entry{DeliveryID: "del-other-task", TaskID: "task-other", Status: StatusSent, CreatedAt: now, UpdatedAt: now})
}

func TestAutoAckDeliveriesForTask_AcksActiveRowsOnly(t *testing.T) {
	store := newFakeStore()
	seedAutoAckEntries(store, "task-1")
	outbox := NewOutbox(store, nil)

	require.NoError(t, outbox.AutoAckDeliveriesForTask(context.Background(), "task-1"))

	for _, deliveryID := range []string{"del-pending", "del-sent", "del-retrying"} {
		e, ok := store.getEntry(deliveryID)
		require.True(t, ok)
		assert.Equal(t, StatusDelivered, e.Status, "%s must be acked", deliveryID)
		assert.NotNil(t, e.DeliveredAt, "%s must stamp delivered_at", deliveryID)
	}
	e, _ := store.getEntry("del-dead")
	assert.Equal(t, StatusDead, e.Status, "a terminal row is not active and must not be resurrected")
	e, _ = store.getEntry("del-other-task")
	assert.Equal(t, StatusSent, e.Status, "another task's rows must be untouched")
}

// TestAutoAckDeliveriesForTask_IsIdempotent is the property the per-task dedupe
// in service/agent relies on: repeating the ack — after a Hub restart emptied
// its in-process set, or for a task with no outbox row at all — matches 0 rows
// and changes nothing.
func TestAutoAckDeliveriesForTask_IsIdempotent(t *testing.T) {
	store := newFakeStore()
	seedAutoAckEntries(store, "task-1")
	outbox := NewOutbox(store, nil)

	require.NoError(t, outbox.AutoAckDeliveriesForTask(context.Background(), "task-1"))
	first, _ := store.getEntry("del-sent")

	require.NoError(t, outbox.AutoAckDeliveriesForTask(context.Background(), "task-1"))
	require.NoError(t, outbox.AutoAckDeliveriesForTask(context.Background(), "task-1"))

	second, _ := store.getEntry("del-sent")
	assert.Equal(t, first.Status, second.Status)
	assert.Equal(t, first.DeliveredAt, second.DeliveredAt,
		"a repeated ack must not move delivered_at — 0 active rows match")

	// A task with no rows at all is likewise a clean no-op, not an error.
	require.NoError(t, outbox.AutoAckDeliveriesForTask(context.Background(), "task-unknown"))
}

func TestAutoAckDeliveriesForTask_PropagatesStoreError(t *testing.T) {
	base := newFakeStore()
	store := &failingTaskUpdateStore{fakeStore: base, err: errors.New("store unavailable")}
	outbox := NewOutbox(store, nil)

	err := outbox.AutoAckDeliveriesForTask(context.Background(), "task-1")
	require.Error(t, err, "the caller must be able to tell a failed ack from a successful one")
	assert.Contains(t, err.Error(), "auto-ack deliveries for task")

	store.err = nil
	require.NoError(t, outbox.AutoAckDeliveriesForTask(context.Background(), "task-1"))
	assert.EqualValues(t, 2, store.calls.Load())
}

func TestAutoAckDeliveriesForTask_NilOutboxIsNoop(t *testing.T) {
	var outbox *Outbox
	require.NoError(t, outbox.AutoAckDeliveriesForTask(context.Background(), "task-1"))

	empty := &Outbox{}
	require.NoError(t, empty.AutoAckDeliveriesForTask(context.Background(), "task-1"))
}
