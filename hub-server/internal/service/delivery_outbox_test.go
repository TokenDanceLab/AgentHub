package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/deliveryoutbox"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"github.com/agenthub/hub-server/internal/service/dispatchsvc"
)

// newOutboxDB creates an in-memory SQLite database with the delivery_outbox
// and related tables needed for outbox tests.
func newOutboxDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	for _, ddl := range []string{
		`CREATE TABLE delivery_outbox (
			id TEXT PRIMARY KEY,
			task_id TEXT NOT NULL,
			delivery_id TEXT NOT NULL UNIQUE,
			payload TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			attempt_count INTEGER NOT NULL DEFAULT 0,
			max_attempts INTEGER NOT NULL DEFAULT 3,
			next_retry_at DATETIME,
			last_error TEXT DEFAULT '',
			edge_device_id TEXT DEFAULT NULL,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL,
			delivered_at DATETIME
		)`,
		`CREATE INDEX idx_delivery_outbox_status_nr ON delivery_outbox(status, next_retry_at)`,
		`CREATE INDEX idx_delivery_outbox_task_id ON delivery_outbox(task_id)`,
		`CREATE INDEX idx_delivery_outbox_delivery_id ON delivery_outbox(delivery_id)`,

		// Minimal tables needed for HandleTaskAck tests.
		`CREATE TABLE agent_instances (
			id TEXT PRIMARY KEY,
			agent_type TEXT NOT NULL,
			custom_agent_id TEXT,
			session_id TEXT NOT NULL,
			inviter_user_id TEXT NOT NULL,
			display_name TEXT NOT NULL
		)`,
		`CREATE TABLE pending_agent_tasks (
			id TEXT PRIMARY KEY,
			agent_instance_id TEXT NOT NULL,
			triggered_by_user_id TEXT NOT NULL,
			trigger_message_id TEXT NOT NULL,
			target_id TEXT,
			status TEXT NOT NULL,
			edge_run_id TEXT DEFAULT '',
			edge_device_id TEXT DEFAULT '',
			error_message TEXT DEFAULT '',
			created_at DATETIME,
			dispatched_at DATETIME,
			finished_at DATETIME,
			expire_at DATETIME NOT NULL
		)`,
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			dissolved BOOLEAN DEFAULT FALSE,
			owner_user_id TEXT,
			workspace_id TEXT
		)`,
		`CREATE TABLE session_members (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			member_type TEXT NOT NULL,
			member_id TEXT NOT NULL,
			role TEXT NOT NULL,
			left_at DATETIME
		)`,
		`CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			sender_type TEXT NOT NULL,
			sender_id TEXT NOT NULL,
			content_type TEXT NOT NULL,
			content TEXT NOT NULL,
			seq_id INTEGER NOT NULL,
			client_msg_id TEXT NOT NULL,
			reply_to_message_id TEXT,
			recalled BOOLEAN NOT NULL DEFAULT FALSE,
			edited BOOLEAN NOT NULL DEFAULT FALSE,
			edited_at DATETIME,
			created_at DATETIME
		)`,
	} {
		require.NoError(t, db.Exec(ddl).Error)
	}
	return db
}

func newAgentServiceForOutbox(t *testing.T) *AgentService {
	t.Helper()
	db := newOutboxDB(t)
	return &AgentService{db: db}
}

// ==================== TestOutbox_RecordAndAck ====================

func TestOutbox_RecordAndAck(t *testing.T) {
	svc := newAgentServiceForOutbox(t)
	ctx := context.Background()

	// Record a delivery.
	deliveryID, err := svc.RecordDelivery(ctx, "task-1", `{"test":true}`, "dev-1")
	require.NoError(t, err)
	require.NotEmpty(t, deliveryID)

	// Verify it's in pending status.
	status, err := svc.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusPending, status)

	// Mark as sent.
	err = svc.MarkDeliverySent(ctx, deliveryID)
	require.NoError(t, err)

	status, err = svc.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusSent, status)

	// Ack the delivery.
	err = svc.AckDelivery(ctx, deliveryID)
	require.NoError(t, err)

	status, err = svc.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusDelivered, status)
}

// ==================== TestOutbox_IdempotentAck ====================

func TestOutbox_IdempotentAck(t *testing.T) {
	svc := newAgentServiceForOutbox(t)
	ctx := context.Background()

	deliveryID, err := svc.RecordDelivery(ctx, "task-1", `{}`, "")
	require.NoError(t, err)

	// First ack should succeed.
	err = svc.AckDelivery(ctx, deliveryID)
	require.NoError(t, err)

	// Second ack should be idempotent (no error).
	err = svc.AckDelivery(ctx, deliveryID)
	require.NoError(t, err)

	status, err := svc.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusDelivered, status)
}

// ==================== TestOutbox_MarkSentIdempotent ====================

func TestOutbox_MarkSentIdempotent(t *testing.T) {
	svc := newAgentServiceForOutbox(t)
	ctx := context.Background()

	deliveryID, err := svc.RecordDelivery(ctx, "task-1", `{}`, "")
	require.NoError(t, err)

	// First MarkDeliverySent should succeed.
	err = svc.MarkDeliverySent(ctx, deliveryID)
	require.NoError(t, err)

	// Second should be idempotent (no error).
	err = svc.MarkDeliverySent(ctx, deliveryID)
	require.NoError(t, err)

	status, err := svc.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusSent, status)
}

// ==================== TestOutbox_AckNotFound ====================

func TestOutbox_AckNotFound(t *testing.T) {
	svc := newAgentServiceForOutbox(t)
	ctx := context.Background()

	err := svc.AckDelivery(ctx, "nonexistent-delivery-id")
	require.Error(t, err)
}

// ==================== TestOutbox_RetryBackoff ====================

func TestOutbox_RetryBackoff(t *testing.T) {
	svc := newAgentServiceForOutbox(t)
	ctx := context.Background()

	deliveryID, err := svc.RecordDelivery(ctx, "task-retry", `{"test":true}`, "dev-retry")
	require.NoError(t, err)

	// Mark as sent first (to simulate a dispatch that needs retry).
	err = svc.MarkDeliverySent(ctx, deliveryID)
	require.NoError(t, err)

	// First retry: should succeed and schedule next retry.
	shouldRetry, err := svc.MarkDeliveryRetrying(ctx, deliveryID, "transient network error")
	require.NoError(t, err)
	require.True(t, shouldRetry)

	// Verify status is retrying and attempt count incremented.
	status, err := svc.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusRetrying, status)

	// Verify next_retry_at is set.
	var rec deliveryOutboxRecord
	err = svc.db.WithContext(ctx).Where("delivery_id = ?", deliveryID).First(&rec).Error
	require.NoError(t, err)
	assert.Equal(t, 1, rec.AttemptCount)
	assert.NotNil(t, rec.NextRetryAt)
	assert.True(t, rec.NextRetryAt.After(time.Now()))
	assert.Equal(t, "transient network error", rec.LastError)
}

// ==================== TestOutbox_DeadLetter ====================

func TestOutbox_DeadLetter(t *testing.T) {
	svc := newAgentServiceForOutbox(t)
	ctx := context.Background()

	deliveryID, err := svc.RecordDelivery(ctx, "task-dead", `{"test":true}`, "dev-dead")
	require.NoError(t, err)

	// Mark as sent.
	err = svc.MarkDeliverySent(ctx, deliveryID)
	require.NoError(t, err)

	// Retry 2 times (maxAttempts is 3, so attempt 0→1, 1→2, 2→3=dead).
	for i := 0; i < 2; i++ {
		shouldRetry, err := svc.MarkDeliveryRetrying(ctx, deliveryID, "error")
		require.NoError(t, err)
		require.True(t, shouldRetry, "retry %d should be allowed", i)
	}

	// Third retry should move to dead-letter.
	shouldRetry, err := svc.MarkDeliveryRetrying(ctx, deliveryID, "final error")
	require.NoError(t, err)
	require.False(t, shouldRetry, "third retry should move to dead-letter")

	// Verify status is dead.
	status, err := svc.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusDead, status)

	var rec deliveryOutboxRecord
	err = svc.db.WithContext(ctx).Where("delivery_id = ?", deliveryID).First(&rec).Error
	require.NoError(t, err)
	assert.Equal(t, 3, rec.AttemptCount)
	assert.Equal(t, DeliveryStatusDead, rec.Status)
	assert.Nil(t, rec.NextRetryAt)
}

// ==================== TestOutbox_DeadLetterExplicit ====================

func TestOutbox_DeadLetterExplicit(t *testing.T) {
	svc := newAgentServiceForOutbox(t)
	ctx := context.Background()

	deliveryID, err := svc.RecordDelivery(ctx, "task-explicit", `{}`, "")
	require.NoError(t, err)

	err = svc.MoveDeliveryToDeadLetter(ctx, deliveryID, "non-retryable error")
	require.NoError(t, err)

	status, err := svc.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusDead, status)
}

// ==================== TestOutbox_AutoAckOnTaskAck ====================

func TestOutbox_AutoAckOnTaskAck(t *testing.T) {
	db := newOutboxDB(t)
	svc := &AgentService{db: db}
	ctx := context.Background()

	// Setup: create agent instance, pending task, and delivery outbox entry.
	now := time.Now()
	require.NoError(t, db.Exec(`INSERT INTO sessions (id, type, dissolved, owner_user_id) VALUES (?, ?, ?, ?)`,
		"sess-outbox-ack", model.SessionTypeGroup, false, "user-1").Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name) VALUES (?, ?, ?, ?, ?)`,
		"agent-outbox", "codex", "sess-outbox-ack", "user-1", "TestAgent").Error)
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, edge_device_id, expire_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-outbox-ack", "agent-outbox", "user-1", "msg-1", model.TaskStatusDispatched, "dev-1", now.Add(time.Hour), now).Error)

	// Record a delivery for this task.
	deliveryID, err := svc.RecordDelivery(ctx, "task-outbox-ack", `{"test":true}`, "dev-1")
	require.NoError(t, err)
	_ = svc.MarkDeliverySent(ctx, deliveryID)

	// Call HandleTaskAck — this should auto-ack the delivery.
	err = svc.HandleTaskAck(ctx, "user-1", "dev-1", "task-outbox-ack", "run-001")
	require.NoError(t, err)

	// Verify delivery is now delivered.
	status, err := svc.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusDelivered, status)
}

// ==================== TestOutbox_ScanRetryable ====================

func TestOutbox_ScanRetryable(t *testing.T) {
	db := newOutboxDB(t)
	svc := &AgentService{db: db}
	ctx := context.Background()

	now := time.Now()
	rawDB, err := db.DB()
	require.NoError(t, err)

	// Use raw INSERTs to avoid GORM autoCreateTime overriding our timestamps.
	oldPendingTime := now.Add(-DeliveryPendingTimeout - time.Second)
	_, err = rawDB.Exec(
		`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"old-pending", "task-old-pending", "del-old-pending", `{}`, DeliveryStatusPending, DefaultMaxDeliveryAttempts, oldPendingTime, oldPendingTime,
	)
	require.NoError(t, err)

	// Create a recent pending delivery (not yet eligible) via ORM — uses current time.
	recentPending := deliveryOutboxRecord{
		ID:          "recent-pending",
		TaskID:      "task-recent",
		DeliveryID:  "del-recent",
		Payload:     `{}`,
		Status:      DeliveryStatusPending,
		MaxAttempts: DefaultMaxDeliveryAttempts,
	}
	require.NoError(t, db.Create(&recentPending).Error)

	// Create a sent delivery older than DeliverySentTimeout.
	oldSentTime := now.Add(-DeliverySentTimeout - time.Second)
	_, err = rawDB.Exec(
		`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"old-sent", "task-old-sent", "del-old-sent", `{}`, DeliveryStatusSent, DefaultMaxDeliveryAttempts, oldSentTime, oldSentTime,
	)
	require.NoError(t, err)

	// Create a retrying delivery past its next_retry_at.
	pastRetry := now.Add(-time.Second)
	_, err = rawDB.Exec(
		`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, attempt_count, max_attempts, next_retry_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"retrying-past", "task-retrying", "del-retrying", `{}`, DeliveryStatusRetrying, 1, DefaultMaxDeliveryAttempts, pastRetry, now, now,
	)
	require.NoError(t, err)

	// Create a delivered delivery (should not appear in scan).
	delivered := deliveryOutboxRecord{
		ID:          "delivered",
		TaskID:      "task-done",
		DeliveryID:  "del-done",
		Payload:     `{}`,
		Status:      DeliveryStatusDelivered,
		MaxAttempts: DefaultMaxDeliveryAttempts,
	}
	require.NoError(t, db.Create(&delivered).Error)

	records, err := svc.ScanRetryableDeliveries(ctx)
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
	base := DeliveryRetryBaseInterval
	max := DeliveryRetryMaxInterval

	// NextRetryAt takes an injectable clock, so use a fixed now to make the
	// assertion deterministic (no time.Now() drift between the computation
	// and the assertion). The ±25% jitter from applyRetryJitter still
	// applies, so the delay must land within [expected*0.75, expected*1.25].
	// A small slack of 100ms covers sub-millisecond rounding.
	const slack = 100 * time.Millisecond
	fixedNow := time.Unix(1_700_000_000, 0).UTC()

	// Attempt 0: base (2s) ± 25% jitter → [1.5s, 2.5s]
	next := deliveryoutbox.NextRetryAt(0, fixedNow)
	delay := next.Sub(fixedNow)
	assert.GreaterOrEqual(t, delay, base-base/4-slack)
	assert.LessOrEqual(t, delay, base+base/4+slack)

	// Attempt 1: base*2 (4s) ± 25% jitter → [3s, 5s]
	next = deliveryoutbox.NextRetryAt(1, fixedNow)
	delay = next.Sub(fixedNow)
	assert.GreaterOrEqual(t, delay, base*2-base*2/4-slack)
	assert.LessOrEqual(t, delay, base*2+base*2/4+slack)

	// Attempt 3: base*8 (16s) ± 25% jitter → [12s, 20s]
	next = deliveryoutbox.NextRetryAt(3, fixedNow)
	delay = next.Sub(fixedNow)
	assert.GreaterOrEqual(t, delay, base*8-base*8/4-slack)
	assert.LessOrEqual(t, delay, base*8+base*8/4+slack)

	// Attempt 10: capped at max (30s) ± 25% jitter → [22.5s, 37.5s]
	next = deliveryoutbox.NextRetryAt(10, fixedNow)
	delay = next.Sub(fixedNow)
	assert.GreaterOrEqual(t, delay, max-max/4-slack)
	assert.LessOrEqual(t, delay, max+max/4+slack)
}

// ==================== TestOutbox_CleanupOld ====================

func TestOutbox_CleanupOld(t *testing.T) {
	db := newOutboxDB(t)
	svc := &AgentService{db: db}
	ctx := context.Background()

	now := time.Now()

	// Create old delivered record.
	oldDelivered := deliveryOutboxRecord{
		ID:          "old-delivered",
		TaskID:      "task-old",
		DeliveryID:  "del-old-delivered",
		Payload:     `{}`,
		Status:      DeliveryStatusDelivered,
		MaxAttempts: DefaultMaxDeliveryAttempts,
		CreatedAt:   now.Add(-48 * time.Hour),
		UpdatedAt:   now.Add(-48 * time.Hour),
	}
	require.NoError(t, db.Create(&oldDelivered).Error)

	// Create recent delivered record.
	recentDelivered := deliveryOutboxRecord{
		ID:          "recent-delivered",
		TaskID:      "task-recent",
		DeliveryID:  "del-recent-delivered",
		Payload:     `{}`,
		Status:      DeliveryStatusDelivered,
		MaxAttempts: DefaultMaxDeliveryAttempts,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	require.NoError(t, db.Create(&recentDelivered).Error)

	// Create old dead-letter record.
	oldDead := deliveryOutboxRecord{
		ID:          "old-dead",
		TaskID:      "task-dead",
		DeliveryID:  "del-old-dead",
		Payload:     `{}`,
		Status:      DeliveryStatusDead,
		MaxAttempts: DefaultMaxDeliveryAttempts,
		CreatedAt:   now.Add(-48 * time.Hour),
		UpdatedAt:   now.Add(-48 * time.Hour),
	}
	require.NoError(t, db.Create(&oldDead).Error)

	// Create pending record (should not be cleaned up).
	pending := deliveryOutboxRecord{
		ID:          "pending-not-clean",
		TaskID:      "task-pending",
		DeliveryID:  "del-pending-clean",
		Payload:     `{}`,
		Status:      DeliveryStatusPending,
		MaxAttempts: DefaultMaxDeliveryAttempts,
		CreatedAt:   now.Add(-48 * time.Hour),
		UpdatedAt:   now.Add(-48 * time.Hour),
	}
	require.NoError(t, db.Create(&pending).Error)

	// Clean up records older than 24h.
	count, err := svc.CleanupOldDeliveries(ctx, 24*time.Hour)
	require.NoError(t, err)
	assert.Equal(t, int64(2), count) // old-delivered + old-dead

	// Verify old records are gone, recent and pending remain.
	var remaining []deliveryOutboxRecord
	err = db.Find(&remaining).Error
	require.NoError(t, err)
	assert.Len(t, remaining, 2) // recent-delivered + pending-not-clean
}

// ==================== TestOutbox_DeliveryStats ====================

func TestOutbox_DeliveryStats(t *testing.T) {
	db := newOutboxDB(t)
	svc := &AgentService{db: db}
	ctx := context.Background()

	// Create various status records.
	for i, status := range []string{DeliveryStatusPending, DeliveryStatusPending, DeliveryStatusSent, DeliveryStatusDelivered, DeliveryStatusDead} {
		rec := deliveryOutboxRecord{
			ID:          "stat-" + string(rune('a'+i)),
			TaskID:      "task-stat",
			DeliveryID:  "del-stat-" + string(rune('a'+i)),
			Payload:     `{}`,
			Status:      status,
			MaxAttempts: DefaultMaxDeliveryAttempts,
		}
		require.NoError(t, db.Create(&rec).Error)
	}

	stats, err := svc.GetDeliveryStats(ctx)
	require.NoError(t, err)
	assert.Equal(t, int64(2), stats[DeliveryStatusPending])
	assert.Equal(t, int64(1), stats[DeliveryStatusSent])
	assert.Equal(t, int64(1), stats[DeliveryStatusDelivered])
	assert.Equal(t, int64(1), stats[DeliveryStatusDead])
}

// ==================== TestOutbox_IntegrationRetry ====================

func TestOutbox_IntegrationRetry(t *testing.T) {
	db := newOutboxDB(t)
	svc := &AgentService{db: db, cacheClient: &mockAgentCache{}}
	ctx := context.Background()

	// Setup minimal task context.
	now := time.Now()
	require.NoError(t, db.Exec(`INSERT INTO sessions (id, type, dissolved, owner_user_id) VALUES (?, ?, ?, ?)`,
		"sess-int", model.SessionTypeGroup, false, "user-1").Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name) VALUES (?, ?, ?, ?, ?)`,
		"agent-int", "codex", "sess-int", "user-1", "TestAgent").Error)
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, edge_device_id, expire_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-int-retry", "agent-int", "user-1", "msg-1", model.TaskStatusDispatched, "dev-int", now.Add(time.Hour), now).Error)
	require.NoError(t, db.Exec(`INSERT INTO messages (id, session_id, sender_type, sender_id, content_type, content, seq_id, client_msg_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"msg-int", "sess-int", model.SenderTypeUser, "user-1", model.ContentTypeText, `{"text":"run"}`, int64(1), "client-1", now).Error)

	// Record a delivery (simulating dispatch happened but sent timeout expires).
	deliveryID, err := svc.RecordDelivery(ctx, "task-int-retry", `{"task_id":"task-int-retry"}`, "dev-int")
	require.NoError(t, err)
	_ = svc.MarkDeliverySent(ctx, deliveryID)

	// Manually set updated_at to be older than DeliverySentTimeout to make it scannable.
	err = db.Exec(`UPDATE delivery_outbox SET updated_at = ? WHERE delivery_id = ?`,
		now.Add(-DeliverySentTimeout-time.Second), deliveryID).Error
	require.NoError(t, err)

	// Scan should find this delivery.
	records, err := svc.ScanRetryableDeliveries(ctx)
	require.NoError(t, err)
	require.Len(t, records, 1)
	assert.Equal(t, deliveryID, records[0].DeliveryID)

	// Mark for retry.
	shouldRetry, err := svc.MarkDeliveryRetrying(ctx, deliveryID, "timeout")
	require.NoError(t, err)
	require.True(t, shouldRetry)

	// Verify retry state.
	status, err := svc.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusRetrying, status)

	// Now simulate ack arriving after retry.
	err = svc.AckDelivery(ctx, deliveryID)
	require.NoError(t, err)

	status, err = svc.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusDelivered, status)
}

// ==================== TestOutbox_RecordDeliverySerializesPayload ====================

func TestOutbox_RecordDeliverySerializesPayload(t *testing.T) {
	svc := newAgentServiceForOutbox(t)
	ctx := context.Background()

	payload := `{"task_id":"task-payload","agent_type":"codex","prompt":"hello"}`
	deliveryID, err := svc.RecordDelivery(ctx, "task-payload", payload, "dev-payload")
	require.NoError(t, err)
	require.NotEmpty(t, deliveryID)

	// Verify the payload is stored correctly.
	var rec deliveryOutboxRecord
	err = svc.db.WithContext(ctx).Where("delivery_id = ?", deliveryID).First(&rec).Error
	require.NoError(t, err)
	assert.Equal(t, payload, rec.Payload)
	assert.Equal(t, "task-payload", rec.TaskID)
	assert.Equal(t, "dev-payload", rec.EdgeDeviceID)
	assert.Equal(t, DeliveryStatusPending, rec.Status)
	assert.Equal(t, DefaultMaxDeliveryAttempts, rec.MaxAttempts)
}

// ==================== TestOutbox_HandleTaskAckWithMultipleDeliveries ====================

func TestOutbox_HandleTaskAckWithMultipleDeliveries(t *testing.T) {
	db := newOutboxDB(t)
	svc := &AgentService{db: db}
	ctx := context.Background()

	now := time.Now()
	require.NoError(t, db.Exec(`INSERT INTO sessions (id, type, dissolved, owner_user_id) VALUES (?, ?, ?, ?)`,
		"sess-multi", model.SessionTypeGroup, false, "user-1").Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name) VALUES (?, ?, ?, ?, ?)`,
		"agent-multi", "codex", "sess-multi", "user-1", "TestAgent").Error)
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, edge_device_id, expire_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-multi-ack", "agent-multi", "user-1", "msg-1", model.TaskStatusDispatched, "dev-multi", now.Add(time.Hour), now).Error)

	// Record multiple deliveries for the same task (simulating retries).
	del1, err := svc.RecordDelivery(ctx, "task-multi-ack", `{"attempt":1}`, "dev-multi")
	require.NoError(t, err)
	_ = svc.MarkDeliverySent(ctx, del1)

	del2, err := svc.RecordDelivery(ctx, "task-multi-ack", `{"attempt":2}`, "dev-multi")
	require.NoError(t, err)
	_ = svc.MarkDeliverySent(ctx, del2)

	// Mark del1 as retrying.
	_, err = svc.MarkDeliveryRetrying(ctx, del1, "timeout")
	require.NoError(t, err)

	// Call HandleTaskAck — should auto-ack ALL deliveries for the task.
	err = svc.HandleTaskAck(ctx, "user-1", "dev-multi", "task-multi-ack", "run-001")
	require.NoError(t, err)

	// Both deliveries should now be delivered.
	for _, del := range []string{del1, del2} {
		status, err := svc.GetDeliveryStatus(ctx, del)
		require.NoError(t, err)
		assert.Equal(t, DeliveryStatusDelivered, status, "delivery %s should be delivered", del)
	}
}

// ==================== TestOutbox_TruncateString ====================

func TestOutbox_TruncateString(t *testing.T) {
	assert.Equal(t, "hello", truncateString("hello", 10))
	assert.Equal(t, "hello world...", truncateString("hello world this is long", 14))
	assert.Equal(t, "", truncateString("", 10))
}

// ==================== TestDispatchIncludesDeliveryID ====================

func TestDispatchIncludesDeliveryID(t *testing.T) {
	db := newOutboxDB(t)
	require.NoError(t, db.Exec(`INSERT INTO sessions (id, type, dissolved, owner_user_id) VALUES (?, ?, ?, ?)`,
		"sess-did", model.SessionTypeGroup, false, "user-1").Error)
	require.NoError(t, db.Exec(`INSERT INTO messages (id, session_id, sender_type, sender_id, content_type, content, seq_id, client_msg_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"msg-did", "sess-did", model.SenderTypeUser, "user-1", model.ContentTypeText, `{"text":"run"}`, int64(1), "client-did", time.Now()).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name) VALUES (?, ?, ?, ?, ?)`,
		"agent-did", "claude-code", "sess-did", "user-1", "Claude").Error)
	require.NoError(t, db.Exec(`INSERT INTO session_members (id, session_id, member_type, member_id, role) VALUES (?, ?, ?, ?, ?)`,
		"member-did", "sess-did", model.MemberTypeUser, "user-1", model.MemberRoleMember).Error)

	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}
	t.Setenv("AGENTHUB_EDGE_URL", "http://127.0.0.1:1")

	task := &model.PendingAgentTask{
		ID:                "task-did",
		AgentInstanceID:   "agent-did",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-did",
		Status:            model.TaskStatusQueued,
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(task).Error)

	agent := &model.AgentInstance{
		ID:            "agent-did",
		AgentType:     "claude-code",
		SessionID:     "sess-did",
		InviterUserID: "user-1",
		DisplayName:   "Claude",
	}

	svc.dispatchService().DispatchTask(context.Background(), task, agent, "test prompt", "", "", nil)

	snapshot := cache.snapshot()
	require.Equal(t, "user-1", snapshot.pushedUser)
	require.Len(t, snapshot.pushed, 1)

	var payload dispatch.Payload
	require.NoError(t, json.Unmarshal([]byte(snapshot.pushed[0]), &payload))
	require.NotEmpty(t, payload.DeliveryID, "dispatch payload should include delivery_id")

	// Verify the outbox record was created.
	var rec deliveryOutboxRecord
	err := svc.db.Where("delivery_id = ?", payload.DeliveryID).First(&rec).Error
	require.NoError(t, err)
	assert.Equal(t, payload.DeliveryID, rec.DeliveryID)
	assert.Equal(t, task.ID, rec.TaskID)
	// Offline-only dispatch leaves outbox pending (#1031) so reconnect + outbox
	// redispatch do not dual-fire the same delivery_id.
	assert.Equal(t, DeliveryStatusPending, rec.Status,
		"offline queue acceptance must not MarkDeliverySent (#1031)")
}

// ==================== TestOutbox_RetryLoopInvokesRedispatcher ====================

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

func TestOutbox_RetryLoopInvokesRedispatcher(t *testing.T) {
	db := newOutboxDB(t)
	ctx := context.Background()
	fake := &fakeRedispatcher{}
	outbox := NewDeliveryOutbox(db, fake)

	now := time.Now()
	rawDB, err := db.DB()
	require.NoError(t, err)

	// Seed a sent delivery past DeliverySentTimeout so scan finds it.
	oldSentTime := now.Add(-DeliverySentTimeout - time.Second)
	payload := `{"task_id":"task-port","opaque":true}`
	_, err = rawDB.Exec(
		`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, attempt_count, max_attempts, edge_device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"port-sent", "task-port", "del-port", payload, DeliveryStatusSent, 0, DefaultMaxDeliveryAttempts, "dev-port", oldSentTime, oldSentTime,
	)
	require.NoError(t, err)

	// Drive one retry cycle (no ticker / no HTTP/WS).
	outbox.retryDeliveries(ctx)

	// Successful redispatch transitions retrying→sent and clears next_retry_at
	// so the ack-timeout window governs re-scan (not retry cadence).
	status, err := outbox.GetDeliveryStatus(ctx, "del-port")
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusSent, status)

	var rec deliveryOutboxRecord
	err = db.WithContext(ctx).Where("delivery_id = ?", "del-port").First(&rec).Error
	require.NoError(t, err)
	assert.Nil(t, rec.NextRetryAt)
	assert.Equal(t, 1, rec.AttemptCount)

	// Opaque redispatch port invoked with stored payload bytes.
	require.Len(t, fake.calls, 1)
	assert.Equal(t, "task-port", fake.calls[0].taskID)
	assert.Equal(t, "del-port", fake.calls[0].deliveryID)
	assert.Equal(t, payload, fake.calls[0].payloadJSON)
	assert.Equal(t, "dev-port", fake.calls[0].edgeDeviceID)
}

func TestOutbox_RetryLoopRedispatchFailureStaysRetrying(t *testing.T) {
	db := newOutboxDB(t)
	ctx := context.Background()
	fake := &fakeRedispatcher{fail: true}
	outbox := NewDeliveryOutbox(db, fake)

	now := time.Now()
	rawDB, err := db.DB()
	require.NoError(t, err)

	// Seed a retrying delivery past next_retry_at so scan finds it.
	pastRetry := now.Add(-time.Second)
	payload := `{"task_id":"task-fail","opaque":true}`
	_, err = rawDB.Exec(
		`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, attempt_count, max_attempts, next_retry_at, edge_device_id, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"fail-retry", "task-fail", "del-fail", payload, DeliveryStatusRetrying, 1, DefaultMaxDeliveryAttempts, pastRetry, "dev-fail", "prior", now, now,
	)
	require.NoError(t, err)

	outbox.retryDeliveries(ctx)

	// Failure branch: stays retrying with next_retry_at set for backoff.
	status, err := outbox.GetDeliveryStatus(ctx, "del-fail")
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusRetrying, status)

	var rec deliveryOutboxRecord
	err = db.WithContext(ctx).Where("delivery_id = ?", "del-fail").First(&rec).Error
	require.NoError(t, err)
	assert.NotNil(t, rec.NextRetryAt)
	assert.True(t, rec.NextRetryAt.After(now))
	assert.Equal(t, 2, rec.AttemptCount)

	require.Len(t, fake.calls, 1)
	assert.Equal(t, "del-fail", fake.calls[0].deliveryID)
}

func TestOutbox_MarkDeliverySentFromRetrying(t *testing.T) {
	db := newOutboxDB(t)
	ctx := context.Background()
	outbox := NewDeliveryOutbox(db, nil)

	now := time.Now()
	rawDB, err := db.DB()
	require.NoError(t, err)

	nextRetry := now.Add(5 * time.Second)
	_, err = rawDB.Exec(
		`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, attempt_count, max_attempts, next_retry_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"mark-retry", "task-mark", "del-mark", `{}`, DeliveryStatusRetrying, 1, DefaultMaxDeliveryAttempts, nextRetry, now, now,
	)
	require.NoError(t, err)

	// retrying→sent clears next_retry_at (idempotent RowsAffected==0 OK).
	require.NoError(t, outbox.MarkDeliverySent(ctx, "del-mark"))
	status, err := outbox.GetDeliveryStatus(ctx, "del-mark")
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusSent, status)

	var rec deliveryOutboxRecord
	err = db.WithContext(ctx).Where("delivery_id = ?", "del-mark").First(&rec).Error
	require.NoError(t, err)
	assert.Nil(t, rec.NextRetryAt)

	// Already sent: no-op.
	require.NoError(t, outbox.MarkDeliverySent(ctx, "del-mark"))
	status, err = outbox.GetDeliveryStatus(ctx, "del-mark")
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusSent, status)
}

func TestOutbox_RetryLoopNoRedispatcherSkipsDispatch(t *testing.T) {
	db := newOutboxDB(t)
	ctx := context.Background()
	// nil redispatcher: journal still advances; redispatch is a no-op.
	outbox := NewDeliveryOutbox(db, nil)

	now := time.Now()
	rawDB, err := db.DB()
	require.NoError(t, err)

	oldSentTime := now.Add(-DeliverySentTimeout - time.Second)
	_, err = rawDB.Exec(
		`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, attempt_count, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"nil-port", "task-nil", "del-nil", `{}`, DeliveryStatusSent, 0, DefaultMaxDeliveryAttempts, oldSentTime, oldSentTime,
	)
	require.NoError(t, err)

	outbox.retryDeliveries(ctx)

	status, err := outbox.GetDeliveryStatus(ctx, "del-nil")
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusRetrying, status)
}

// ==================== #999 redispatch soft-fail / MarkDeliverySent updated_at ====================

// failPushCache fails PushPendingTask so redispatch offline-queue soft-fails.
type failPushCache struct {
	mockAgentCache
	pushErr error
}

func (f *failPushCache) PushPendingTask(ctx context.Context, userID, taskJSON string) error {
	if f.pushErr != nil {
		return f.pushErr
	}
	return f.mockAgentCache.PushPendingTask(ctx, userID, taskJSON)
}

func seedRetryableTaskAndDelivery(t *testing.T, db *gorm.DB, taskID, deliveryID, payload string, status string, attempt int, updatedAt time.Time) {
	t.Helper()
	rawDB, err := db.DB()
	require.NoError(t, err)
	_, err = rawDB.Exec(
		`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, target_id, status, edge_run_id, edge_device_id, error_message, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		taskID, "agent-1", "user-1", "msg-1", "", model.TaskStatusQueued, "", "dev-1", "", time.Now().Add(time.Hour),
	)
	require.NoError(t, err)

	nextRetry := updatedAt.Add(-time.Second)
	if status == DeliveryStatusSent {
		nextRetry = time.Time{}
	}
	if status == DeliveryStatusRetrying {
		_, err = rawDB.Exec(
			`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, attempt_count, max_attempts, next_retry_at, edge_device_id, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			"id-"+deliveryID, taskID, deliveryID, payload, status, attempt, DefaultMaxDeliveryAttempts, nextRetry, "dev-1", "prior", updatedAt, updatedAt,
		)
	} else {
		_, err = rawDB.Exec(
			`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, attempt_count, max_attempts, edge_device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			"id-"+deliveryID, taskID, deliveryID, payload, status, attempt, DefaultMaxDeliveryAttempts, "dev-1", updatedAt, updatedAt,
		)
	}
	require.NoError(t, err)
}

func TestOutbox_MarkDeliverySentBumpsUpdatedAt(t *testing.T) {
	db := newOutboxDB(t)
	ctx := context.Background()
	outbox := NewDeliveryOutbox(db, nil)

	old := time.Now().Add(-2 * time.Hour).UTC().Truncate(time.Second)
	rawDB, err := db.DB()
	require.NoError(t, err)
	_, err = rawDB.Exec(
		`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, attempt_count, max_attempts, next_retry_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"upd-1", "task-upd", "del-upd", `{}`, DeliveryStatusRetrying, 1, DefaultMaxDeliveryAttempts, old.Add(time.Minute), old, old,
	)
	require.NoError(t, err)

	before := time.Now().UTC()
	require.NoError(t, outbox.MarkDeliverySent(ctx, "del-upd"))

	var rec deliveryOutboxRecord
	require.NoError(t, db.WithContext(ctx).Where("delivery_id = ?", "del-upd").First(&rec).Error)
	assert.Equal(t, DeliveryStatusSent, rec.Status)
	assert.Nil(t, rec.NextRetryAt)
	require.False(t, rec.UpdatedAt.IsZero())
	assert.True(t, !rec.UpdatedAt.Before(before), "updated_at should advance on MarkDeliverySent, got %v before %v", rec.UpdatedAt, before)
	assert.True(t, rec.UpdatedAt.After(old), "updated_at should be newer than seed, got %v old %v", rec.UpdatedAt, old)
}

func TestOutbox_RetryLoopAdapterSoftFailDoesNotMarkSent(t *testing.T) {
	db := newOutboxDB(t)
	ctx := context.Background()

	now := time.Now()
	payload := `{"task_id":"task-soft","agent_type":"claude-code","prompt":"hi"}`
	seedRetryableTaskAndDelivery(t, db, "task-soft", "del-soft", payload, DeliveryStatusRetrying, 1, now)

	cache := &failPushCache{pushErr: errors.New("redis unavailable")}
	ds := dispatchsvc.NewDispatchService(db, nil, nil, cache, nil, nil, config.EdgeDispatchConfig{}, nil, "")
	outbox := NewDeliveryOutbox(db, dispatchRedispatcher{d: ds})

	outbox.retryDeliveries(ctx)

	status, err := outbox.GetDeliveryStatus(ctx, "del-soft")
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusRetrying, status, "soft-fail must not MarkDeliverySent")

	var rec deliveryOutboxRecord
	require.NoError(t, db.WithContext(ctx).Where("delivery_id = ?", "del-soft").First(&rec).Error)
	assert.NotNil(t, rec.NextRetryAt)
	assert.Equal(t, 2, rec.AttemptCount)
}

func TestOutbox_RetryLoopAdapterSuccessMarksSentAndBumpsUpdatedAt(t *testing.T) {
	db := newOutboxDB(t)
	ctx := context.Background()

	old := time.Now().Add(-DeliverySentTimeout - time.Second)
	payload := `{"task_id":"task-ok","agent_type":"claude-code","prompt":"hi"}`
	seedRetryableTaskAndDelivery(t, db, "task-ok", "del-ok", payload, DeliveryStatusSent, 0, old)

	cache := &mockAgentCache{}
	ds := dispatchsvc.NewDispatchService(db, nil, nil, cache, nil, nil, config.EdgeDispatchConfig{}, nil, "")
	outbox := NewDeliveryOutbox(db, dispatchRedispatcher{d: ds})

	before := time.Now().UTC()
	outbox.retryDeliveries(ctx)

	status, err := outbox.GetDeliveryStatus(ctx, "del-ok")
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusSent, status, "successful redispatch should mark sent")

	var rec deliveryOutboxRecord
	require.NoError(t, db.WithContext(ctx).Where("delivery_id = ?", "del-ok").First(&rec).Error)
	assert.Nil(t, rec.NextRetryAt)
	assert.Equal(t, 1, rec.AttemptCount)
	assert.True(t, !rec.UpdatedAt.Before(before), "updated_at should advance on success MarkDeliverySent")
	assert.True(t, rec.UpdatedAt.After(old), "updated_at should be newer than pre-retry seed")

	// Offline queue received the payload (no WS/HTTP route available).
	snap := cache.snapshot()
	require.Len(t, snap.pushed, 1)
	assert.Equal(t, "user-1", snap.pushedUser)
}

// ==================== #1009 atomic outbox claim (CAS on attempt_count) ====================

func TestOutbox_ClaimRetryCASOnlyOneWins(t *testing.T) {
	db := newOutboxDB(t)
	ctx := context.Background()
	outbox := NewDeliveryOutbox(db, nil)

	now := time.Now()
	rawDB, err := db.DB()
	require.NoError(t, err)
	_, err = rawDB.Exec(
		`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, attempt_count, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"cas-1", "task-cas", "del-cas", `{}`, DeliveryStatusSent, 0, DefaultMaxDeliveryAttempts, now, now,
	)
	require.NoError(t, err)

	nextRetry := now.Add(time.Minute)
	fields := map[string]interface{}{
		"status":        DeliveryStatusRetrying,
		"attempt_count": 1,
		"last_error":    "timeout",
		"next_retry_at": &nextRetry,
	}

	// First claim at observed attempt=0 wins.
	rows, err := outbox.claimOutboxRetry(ctx, "del-cas", 0, fields)
	require.NoError(t, err)
	assert.Equal(t, int64(1), rows)

	// Second claim with the same expected attempt loses (CAS).
	rows, err = outbox.claimOutboxRetry(ctx, "del-cas", 0, fields)
	require.NoError(t, err)
	assert.Equal(t, int64(0), rows)

	var rec deliveryOutboxRecord
	require.NoError(t, db.WithContext(ctx).Where("delivery_id = ?", "del-cas").First(&rec).Error)
	assert.Equal(t, 1, rec.AttemptCount)
	assert.Equal(t, DeliveryStatusRetrying, rec.Status)
}

func TestOutbox_MarkDeliveryRetryingLostClaimSkips(t *testing.T) {
	db := newOutboxDB(t)
	ctx := context.Background()
	outbox := NewDeliveryOutbox(db, nil)

	now := time.Now()
	rawDB, err := db.DB()
	require.NoError(t, err)
	_, err = rawDB.Exec(
		`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, attempt_count, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"lost-1", "task-lost", "del-lost", `{}`, DeliveryStatusSent, 0, DefaultMaxDeliveryAttempts, now, now,
	)
	require.NoError(t, err)

	// Simulate another worker claiming first (attempt 0→1).
	nextRetry := now.Add(time.Minute)
	rows, err := outbox.claimOutboxRetry(ctx, "del-lost", 0, map[string]interface{}{
		"status":        DeliveryStatusRetrying,
		"attempt_count": 1,
		"last_error":    "other-worker",
		"next_retry_at": &nextRetry,
	})
	require.NoError(t, err)
	require.Equal(t, int64(1), rows)

	// Force a stale CAS path: claim again with expected attempt=0 (what a concurrent
	// worker that already observed attempt=0 would attempt). Must not redispatch.
	rows, err = outbox.claimOutboxRetry(ctx, "del-lost", 0, map[string]interface{}{
		"status":        DeliveryStatusRetrying,
		"attempt_count": 1,
		"last_error":    "stale",
		"next_retry_at": &nextRetry,
	})
	require.NoError(t, err)
	assert.Equal(t, int64(0), rows, "stale attempt_count CAS must lose")

	// Full MarkDeliveryRetrying after a real claim advances 1→2 (new cycle), not a double claim.
	shouldRetry, err := outbox.MarkDeliveryRetrying(ctx, "del-lost", "next-cycle")
	require.NoError(t, err)
	assert.True(t, shouldRetry)

	var rec deliveryOutboxRecord
	require.NoError(t, db.WithContext(ctx).Where("delivery_id = ?", "del-lost").First(&rec).Error)
	assert.Equal(t, 2, rec.AttemptCount)
	assert.Equal(t, "next-cycle", rec.LastError)
}

func TestOutbox_ConcurrentMarkDeliveryRetryingOnlyOneClaim(t *testing.T) {
	// Shared in-memory DB with multi-conn so concurrent claims can interleave.
	// CAS on attempt_count ensures only one worker owns redispatch for the same observation.
	// Unique DSN per invocation so -count=N / parallel packages do not collide on table create.
	dsn := fmt.Sprintf("file:outbox_claim_%s_%d?mode=memory&cache=shared", t.Name(), time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(16)
	require.NoError(t, db.Exec(`CREATE TABLE delivery_outbox (
		id TEXT PRIMARY KEY,
		task_id TEXT NOT NULL,
		delivery_id TEXT NOT NULL UNIQUE,
		payload TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		attempt_count INTEGER NOT NULL DEFAULT 0,
		max_attempts INTEGER NOT NULL DEFAULT 3,
		next_retry_at DATETIME,
		last_error TEXT DEFAULT '',
		edge_device_id TEXT DEFAULT NULL,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL,
		delivered_at DATETIME
	)`).Error)

	now := time.Now()
	require.NoError(t, db.Exec(
		`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, attempt_count, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"conc-1", "task-conc", "del-conc", `{}`, DeliveryStatusSent, 0, DefaultMaxDeliveryAttempts, now, now,
	).Error)

	outbox := NewDeliveryOutbox(db, nil)
	ctx := context.Background()

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
			rows, err := outbox.claimOutboxRetry(ctx, "del-conc", 0, map[string]interface{}{
				"status":        DeliveryStatusRetrying,
				"attempt_count": 1,
				"last_error":    "concurrent",
				"next_retry_at": &nextRetry,
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

	var rec deliveryOutboxRecord
	require.NoError(t, db.WithContext(ctx).Where("delivery_id = ?", "del-conc").First(&rec).Error)
	assert.Equal(t, 1, rec.AttemptCount)
	assert.Equal(t, DeliveryStatusRetrying, rec.Status)

	// MarkDeliveryRetrying concurrent path with scan-snapshot CAS (same attempt
	// observed by every worker — mirrors multi-replica retry ticks).
	require.NoError(t, db.Exec(
		`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, attempt_count, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"conc-2", "task-conc2", "del-conc2", `{}`, DeliveryStatusSent, 0, DefaultMaxDeliveryAttempts, now, now,
	).Error)

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
			should, err := outbox.claimDeliveryRetrying(ctx, "del-conc2", "task-conc2", 0, DefaultMaxDeliveryAttempts, "race")
			if err == nil && should {
				retryYes.Add(1)
			}
		}()
	}
	close(start2)
	wg2.Wait()

	assert.Equal(t, int64(1), retryYes.Load(), "exactly one snapshot claim may redispatch")

	var rec2 deliveryOutboxRecord
	require.NoError(t, db.WithContext(ctx).Where("delivery_id = ?", "del-conc2").First(&rec2).Error)
	assert.Equal(t, 1, rec2.AttemptCount)
	assert.Equal(t, DeliveryStatusRetrying, rec2.Status)
}

// ==================== #1000 stream/done auto-ack + running not redispatchable ====================

func ensureOutboxStreamTables(t *testing.T, db *gorm.DB) {
	t.Helper()
	// Stream callbacks need run-event + session seq columns beyond the base outbox fixture.
	require.NoError(t, db.Exec(`CREATE TABLE IF NOT EXISTS agent_run_events (
		id TEXT PRIMARY KEY,
		task_id TEXT NOT NULL,
		edge_run_id TEXT,
		session_id TEXT NOT NULL,
		agent_instance_id TEXT NOT NULL,
		event_seq INTEGER NOT NULL,
		event_type TEXT NOT NULL,
		payload TEXT NOT NULL,
		created_at DATETIME
	)`).Error)
	// SQLite allows adding columns only once; ignore if already present in schema variants.
	_ = db.Exec(`ALTER TABLE sessions ADD COLUMN next_seq INTEGER NOT NULL DEFAULT 0`).Error
	_ = db.Exec(`ALTER TABLE sessions ADD COLUMN last_message_at DATETIME`).Error
}

func TestOutbox_AutoAckOnTaskStream(t *testing.T) {
	db := newOutboxDB(t)
	ensureOutboxStreamTables(t, db)
	svc := &AgentService{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
	ctx := context.Background()

	now := time.Now()
	require.NoError(t, db.Exec(`INSERT INTO sessions (id, type, dissolved, owner_user_id) VALUES (?, ?, ?, ?)`,
		"sess-stream-ack", model.SessionTypeGroup, false, "user-1").Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name) VALUES (?, ?, ?, ?, ?)`,
		"agent-stream", "codex", "sess-stream-ack", "user-1", "TestAgent").Error)
	// Dispatched → stream transitions to running and must ack outbox (#1000).
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, edge_device_id, expire_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-stream-ack", "agent-stream", "user-1", "msg-1", model.TaskStatusDispatched, "dev-1", now.Add(time.Hour), now).Error)

	deliveryID, err := svc.RecordDelivery(ctx, "task-stream-ack", `{"test":true}`, "dev-1")
	require.NoError(t, err)
	require.NoError(t, svc.MarkDeliverySent(ctx, deliveryID))

	err = svc.HandleTaskStream(ctx, "user-1", "dev-1", "task-stream-ack", "run-stream", model.AgentRunEventInput{
		Payload: json.RawMessage(`{"type":"run.output.batch","content":"hello"}`),
	})
	require.NoError(t, err)

	status, err := svc.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusDelivered, status, "first authorized stream must auto-ack outbox")

	var task model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", "task-stream-ack").First(&task).Error)
	assert.Equal(t, model.TaskStatusRunning, task.Status)
}

func TestOutbox_AutoAckOnTaskDone(t *testing.T) {
	db := newOutboxDB(t)
	svc := &AgentService{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
	ctx := context.Background()

	now := time.Now()
	require.NoError(t, db.Exec(`INSERT INTO sessions (id, type, dissolved, owner_user_id) VALUES (?, ?, ?, ?)`,
		"sess-done-ack", model.SessionTypeGroup, false, "user-1").Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name) VALUES (?, ?, ?, ?, ?)`,
		"agent-done", "codex", "sess-done-ack", "user-1", "TestAgent").Error)
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, edge_device_id, edge_run_id, expire_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-done-ack", "agent-done", "user-1", "msg-1", model.TaskStatusRunning, "dev-1", "run-done", now.Add(time.Hour), now).Error)

	deliveryID, err := svc.RecordDelivery(ctx, "task-done-ack", `{"test":true}`, "dev-1")
	require.NoError(t, err)
	require.NoError(t, svc.MarkDeliverySent(ctx, deliveryID))

	// Empty final content avoids message insert / seq allocation.
	err = svc.HandleTaskDone(ctx, "user-1", "dev-1", "task-done-ack", "run-done", "")
	require.NoError(t, err)

	status, err := svc.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusDelivered, status, "done must auto-ack outbox when stream/ack were skipped")
}

func TestOutbox_RunningTaskNotRedispatched(t *testing.T) {
	db := newOutboxDB(t)
	ctx := context.Background()

	now := time.Now()
	payload := `{"task_id":"task-running","agent_type":"claude-code","prompt":"hi"}`
	// Due retrying row + running task: redispatch must dead-letter, never resend.
	rawDB, err := db.DB()
	require.NoError(t, err)
	_, err = rawDB.Exec(
		`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, target_id, status, edge_run_id, edge_device_id, error_message, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-running", "agent-1", "user-1", "msg-1", "", model.TaskStatusRunning, "run-1", "dev-1", "", now.Add(time.Hour),
	)
	require.NoError(t, err)
	pastRetry := now.Add(-time.Second)
	_, err = rawDB.Exec(
		`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, attempt_count, max_attempts, next_retry_at, edge_device_id, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"id-del-running", "task-running", "del-running", payload, DeliveryStatusRetrying, 1, DefaultMaxDeliveryAttempts, pastRetry, "dev-1", "prior", now, now,
	)
	require.NoError(t, err)

	cache := &mockAgentCache{}
	outbox := NewDeliveryOutbox(db, nil)
	ds := dispatchsvc.NewDispatchService(db, nil, nil, cache, nil, outbox, config.EdgeDispatchConfig{}, nil, "")
	outbox.SetRedispatcher(dispatchRedispatcher{d: ds})

	outbox.retryDeliveries(ctx)

	status, err := outbox.GetDeliveryStatus(ctx, "del-running")
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusDead, status, "running task deliveries must not be redispatched (#1000)")

	var rec deliveryOutboxRecord
	require.NoError(t, db.WithContext(ctx).Where("delivery_id = ?", "del-running").First(&rec).Error)
	assert.Contains(t, rec.LastError, "running")

	snap := cache.snapshot()
	assert.Empty(t, snap.pushed, "must not push a second delivery while task is running")
}

// ==================== #1031 offline vs outbox dual redelivery ownership ====================

func TestOutbox_OfflineDispatchDoesNotMarkSent(t *testing.T) {
	db := newOutboxDB(t)
	require.NoError(t, db.Exec(`INSERT INTO sessions (id, type, dissolved, owner_user_id) VALUES (?, ?, ?, ?)`,
		"sess-off", model.SessionTypeGroup, false, "user-1").Error)
	require.NoError(t, db.Exec(`INSERT INTO messages (id, session_id, sender_type, sender_id, content_type, content, seq_id, client_msg_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"msg-off", "sess-off", model.SenderTypeUser, "user-1", model.ContentTypeText, `{"text":"run"}`, int64(1), "client-off", time.Now()).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name) VALUES (?, ?, ?, ?, ?)`,
		"agent-off", "claude-code", "sess-off", "user-1", "Claude").Error)
	require.NoError(t, db.Exec(`INSERT INTO session_members (id, session_id, member_type, member_id, role) VALUES (?, ?, ?, ?, ?)`,
		"member-off", "sess-off", model.MemberTypeUser, "user-1", model.MemberRoleMember).Error)

	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}
	t.Setenv("AGENTHUB_EDGE_URL", "http://127.0.0.1:1")

	task := &model.PendingAgentTask{
		ID:                "task-off",
		AgentInstanceID:   "agent-off",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-off",
		Status:            model.TaskStatusQueued,
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(task).Error)
	agent := &model.AgentInstance{
		ID: "agent-off", AgentType: "claude-code", SessionID: "sess-off",
		InviterUserID: "user-1", DisplayName: "Claude",
	}
	svc.dispatchService().DispatchTask(context.Background(), task, agent, "test prompt", "", "", nil)

	snap := cache.snapshot()
	require.Len(t, snap.pushed, 1)

	var payload dispatch.Payload
	require.NoError(t, json.Unmarshal([]byte(snap.pushed[0]), &payload))
	require.NotEmpty(t, payload.DeliveryID)

	status, err := svc.GetDeliveryStatus(context.Background(), payload.DeliveryID)
	require.NoError(t, err)
	assert.Equal(t, DeliveryStatusPending, status, "must not mark sent solely because offline accepted")
}

func TestOutbox_ShouldReplayOfflinePayloadCoordination(t *testing.T) {
	// Pure ownership matrix for reconnect offline push vs outbox status (#1031).
	assert.True(t, dispatch.ShouldReplayOfflinePayload("d1", DeliveryStatusPending, true))
	assert.True(t, dispatch.ShouldReplayOfflinePayload("d1", DeliveryStatusRetrying, true))
	assert.False(t, dispatch.ShouldReplayOfflinePayload("d1", DeliveryStatusSent, true))
	assert.False(t, dispatch.ShouldReplayOfflinePayload("d1", DeliveryStatusDelivered, true))
	assert.False(t, dispatch.ShouldReplayOfflinePayload("d1", DeliveryStatusDead, true))
	assert.True(t, dispatch.ShouldReplayOfflinePayload("", DeliveryStatusSent, true))
	assert.True(t, dispatch.ShouldReplayOfflinePayload("d1", DeliveryStatusSent, false))
}
