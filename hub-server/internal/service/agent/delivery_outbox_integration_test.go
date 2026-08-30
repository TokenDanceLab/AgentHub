package agent

// Cross-domain outbox tests: Service / dispatchsvc composition over the
// gorm-backed DeliveryOutboxStore. Pure journal + retry-loop behavior is
// covered in internal/service/deliveryoutbox/outbox_test.go; this file keeps
// the tests that need gorm seeding (agent instances, tasks, sessions) and the
// dispatch service wiring.

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
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
			model_params TEXT DEFAULT '{}',
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

// ==================== TestOutbox_AutoAckOnTaskAck ====================

func TestOutbox_AutoAckOnTaskAck(t *testing.T) {
	db := newOutboxDB(t)
	svc := &Service{db: db}
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
	assert.Equal(t, deliveryoutbox.StatusDelivered, status)
}

// ==================== TestOutbox_IntegrationRetry ====================

func TestOutbox_IntegrationRetry(t *testing.T) {
	db := newOutboxDB(t)
	svc := &Service{db: db, cacheClient: &mockAgentCache{}}
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

	// Manually set updated_at to be older than deliveryoutbox.SentTimeout to make it scannable.
	err = db.Exec(`UPDATE delivery_outbox SET updated_at = ? WHERE delivery_id = ?`,
		now.Add(-deliveryoutbox.SentTimeout-time.Second), deliveryID).Error
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
	assert.Equal(t, deliveryoutbox.StatusRetrying, status)

	// Now simulate ack arriving after retry.
	err = svc.AckDelivery(ctx, deliveryID)
	require.NoError(t, err)

	status, err = svc.GetDeliveryStatus(ctx, deliveryID)
	require.NoError(t, err)
	assert.Equal(t, deliveryoutbox.StatusDelivered, status)
}

// ==================== TestOutbox_HandleTaskAckWithMultipleDeliveries ====================

func TestOutbox_HandleTaskAckWithMultipleDeliveries(t *testing.T) {
	db := newOutboxDB(t)
	svc := &Service{db: db}
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
		assert.Equal(t, deliveryoutbox.StatusDelivered, status, "delivery %s should be delivered", del)
	}
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
	svc := &Service{db: db, cacheClient: cache}
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

	// Verify the outbox record was created. deliveryOutboxRecord is owned by
	// the flat service package, so this test reads the row through a local view.
	var rec struct {
		DeliveryID string
		TaskID     string
		Status     string
	}
	err := svc.db.Table("delivery_outbox").Where("delivery_id = ?", payload.DeliveryID).First(&rec).Error
	require.NoError(t, err)
	assert.Equal(t, payload.DeliveryID, rec.DeliveryID)
	assert.Equal(t, task.ID, rec.TaskID)
	// Offline-only dispatch leaves outbox pending (#1031) so reconnect + outbox
	// redispatch do not dual-fire the same delivery_id.
	assert.Equal(t, deliveryoutbox.StatusPending, rec.Status,
		"offline queue acceptance must not MarkDeliverySent (#1031)")
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
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
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
	assert.Equal(t, deliveryoutbox.StatusDelivered, status, "first authorized stream must auto-ack outbox")

	var task model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", "task-stream-ack").First(&task).Error)
	assert.Equal(t, model.TaskStatusRunning, task.Status)
}

func TestOutbox_AutoAckOnTaskDone(t *testing.T) {
	db := newOutboxDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockAgentCache{}}
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
	assert.Equal(t, deliveryoutbox.StatusDelivered, status, "done must auto-ack outbox when stream/ack were skipped")
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
		"id-del-running", "task-running", "del-running", payload, deliveryoutbox.StatusRetrying, 1, deliveryoutbox.DefaultMaxAttempts, pastRetry, "dev-1", "prior", now, now,
	)
	require.NoError(t, err)

	cache := &mockAgentCache{}
	outbox := deliveryoutbox.NewOutbox(service.NewDeliveryOutboxStore(db), nil)
	ds := dispatchsvc.NewDispatchService(db, nil, nil, cache, nil, outbox, config.EdgeDispatchConfig{}, nil, "")
	outbox.SetRedispatcher(dispatchRedispatcher{d: ds})

	driveDeliveryRetryCycle(ctx, outbox, dispatchRedispatcher{d: ds})

	status, err := outbox.GetDeliveryStatus(ctx, "del-running")
	require.NoError(t, err)
	assert.Equal(t, deliveryoutbox.StatusDead, status, "running task deliveries must not be redispatched (#1000)")

	var rec struct {
		LastError string
	}
	require.NoError(t, db.WithContext(ctx).Table("delivery_outbox").Where("delivery_id = ?", "del-running").First(&rec).Error)
	assert.Contains(t, rec.LastError, "running")

	snap := cache.snapshot()
	assert.Empty(t, snap.pushed, "must not push a second delivery while task is running")
}

// driveDeliveryRetryCycle replicates one retryDeliveries pass through the
// exported Outbox surface. retryDeliveries is unexported in the pure package
// (its loop is covered by outbox_test.go over a fake store); this helper keeps
// the service-side integration path on the real gorm store + dispatch adapter.
func driveDeliveryRetryCycle(ctx context.Context, outbox *service.DeliveryOutbox, redispatcher deliveryoutbox.Redispatcher) {
	records, err := outbox.ScanRetryableDeliveries(ctx)
	if err != nil {
		return
	}
	for _, rec := range records {
		shouldRetry, err := outbox.MarkDeliveryRetrying(ctx, rec.DeliveryID, rec.LastError)
		if err != nil || !shouldRetry {
			continue
		}
		if redispatcher == nil {
			continue
		}
		if err := redispatcher.RedispatchDelivery(ctx, rec.TaskID, rec.DeliveryID, rec.Payload, rec.EdgeDeviceID); err != nil {
			continue
		}
		_ = outbox.MarkDeliverySent(ctx, rec.DeliveryID)
	}
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
	svc := &Service{db: db, cacheClient: cache}
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
	assert.Equal(t, deliveryoutbox.StatusPending, status, "must not mark sent solely because offline accepted")
}

func TestOutbox_ShouldReplayOfflinePayloadCoordination(t *testing.T) {
	// Pure ownership matrix for reconnect offline push vs outbox status (#1031).
	assert.True(t, dispatch.ShouldReplayOfflinePayload("d1", deliveryoutbox.StatusPending, true))
	assert.True(t, dispatch.ShouldReplayOfflinePayload("d1", deliveryoutbox.StatusRetrying, true))
	assert.True(t, dispatch.ShouldReplayOfflinePayload("d1", deliveryoutbox.StatusSent, true), "alive sent rows must replay on reconnect")
	assert.False(t, dispatch.ShouldReplayOfflinePayload("d1", deliveryoutbox.StatusDelivered, true))
	assert.False(t, dispatch.ShouldReplayOfflinePayload("d1", deliveryoutbox.StatusDead, true))
	assert.True(t, dispatch.ShouldReplayOfflinePayload("", deliveryoutbox.StatusSent, true))
	assert.True(t, dispatch.ShouldReplayOfflinePayload("d1", deliveryoutbox.StatusSent, false))
}
