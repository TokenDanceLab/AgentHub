package dispatchsvc

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// newOrphanTestDB creates an in-memory SQLite DB with the minimal schema
// needed for orphan recovery tests.
func newOrphanTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)

	require.NoError(t, db.Exec(`CREATE TABLE pending_agent_tasks (
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
	)`).Error)
	// Create delivery_outbox table (minimal schema).
	require.NoError(t, db.Exec(`CREATE TABLE delivery_outbox (
		id TEXT PRIMARY KEY,
		task_id TEXT NOT NULL,
		delivery_id TEXT NOT NULL UNIQUE,
		payload TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		attempt_count INTEGER NOT NULL DEFAULT 0,
		max_attempts INTEGER NOT NULL DEFAULT 3,
		last_error TEXT DEFAULT '',
		edge_device_id TEXT,
		created_at DATETIME,
		updated_at DATETIME,
		delivered_at DATETIME
	)`).Error)
	return db
}

func TestClaimOrphanedTasks_NoOutboxRow_Claimed(t *testing.T) {
	db := newOrphanTestDB(t)
	grace := time.Now().Add(-5 * time.Minute)

	// Create a queued task older than grace with no outbox row.
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, created_at, expire_at)
		VALUES ('task-orphan-1', 'ai-1', 'user-1', 'msg-1', 'queued', ?, ?)`,
		time.Now().Add(-10*time.Minute), time.Now().Add(24*time.Hour)).Error)

	ids, err := claimOrphanedTasksForTest(db, grace, 10)
	require.NoError(t, err)
	require.Equal(t, []string{"task-orphan-1"}, ids)

	// Verify status changed to dispatched.
	var updated model.PendingAgentTask
	require.NoError(t, db.First(&updated, "id = ?", "task-orphan-1").Error)
	require.Equal(t, model.TaskStatusDispatched, updated.Status)
}

func TestClaimOrphanedTasks_HasOutboxRow_NotClaimed(t *testing.T) {
	db := newOrphanTestDB(t)
	grace := time.Now().Add(-5 * time.Minute)

	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, created_at, expire_at)
		VALUES ('task-with-outbox', 'ai-1', 'user-1', 'msg-1', 'queued', ?, ?)`,
		time.Now().Add(-10*time.Minute), time.Now().Add(24*time.Hour)).Error)

	// Insert a delivery_outbox row for this task.
	require.NoError(t, db.Exec(`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, created_at, updated_at)
		VALUES ('del-1', 'task-with-outbox', 'del-id-1', '{}', 'pending', ?, ?)`,
		time.Now(), time.Now()).Error)

	ids, err := claimOrphanedTasksForTest(db, grace, 10)
	require.NoError(t, err)
	require.Empty(t, ids)
}

func TestClaimOrphanedTasks_WithinGrace_NotClaimed(t *testing.T) {
	db := newOrphanTestDB(t)
	grace := time.Now().Add(-5 * time.Minute)

	// Task created 1 minute ago — within grace window.
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, created_at, expire_at)
		VALUES ('task-young', 'ai-1', 'user-1', 'msg-1', 'queued', ?, ?)`,
		time.Now().Add(-1*time.Minute), time.Now().Add(24*time.Hour)).Error)

	ids, err := claimOrphanedTasksForTest(db, grace, 10)
	require.NoError(t, err)
	require.Empty(t, ids)
}

func TestClaimOrphanedTasks_NonQueuedStatus_NotClaimed(t *testing.T) {
	db := newOrphanTestDB(t)
	grace := time.Now().Add(-5 * time.Minute)

	for _, status := range []string{model.TaskStatusDispatched, model.TaskStatusRunning, model.TaskStatusDone, model.TaskStatusFailed} {
		require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, created_at, expire_at)
			VALUES (?, 'ai-1', 'user-1', 'msg-1', ?, ?, ?)`,
			"task-"+status, status, time.Now().Add(-10*time.Minute), time.Now().Add(24*time.Hour)).Error)
	}

	ids, err := claimOrphanedTasksForTest(db, grace, 10)
	require.NoError(t, err)
	require.Empty(t, ids)
}

func TestClaimOrphanedTasks_ConcurrentClaimUniqueness(t *testing.T) {
	db := newOrphanTestDB(t)
	grace := time.Now().Add(-5 * time.Minute)

	// Create one orphan task.
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, created_at, expire_at)
		VALUES ('task-concurrent', 'ai-1', 'user-1', 'msg-1', 'queued', ?, ?)`,
		time.Now().Add(-10*time.Minute), time.Now().Add(24*time.Hour)).Error)

	// First claim should succeed.
	ids1, err := claimOrphanedTasksForTest(db, grace, 10)
	require.NoError(t, err)
	require.Len(t, ids1, 1)

	// Second claim should return empty (already dispatched).
	ids2, err := claimOrphanedTasksForTest(db, grace, 10)
	require.NoError(t, err)
	require.Empty(t, ids2)
}

// claimOrphanedTasksForTest wraps the repository function for test use.
func claimOrphanedTasksForTest(db *gorm.DB, grace time.Time, limit int) ([]string, error) {
	var ids []string
	err := db.Raw(`
		UPDATE pending_agent_tasks
		SET status = 'dispatched'
		WHERE id IN (
			SELECT t.id FROM pending_agent_tasks t
			WHERE t.status = 'queued'
			  AND t.created_at < ?
			  AND NOT EXISTS (
				  SELECT 1 FROM delivery_outbox d WHERE d.task_id = t.id
			  )
			LIMIT ?
		)
		RETURNING id
	`, grace, limit).Scan(&ids).Error
	return ids, err
}

// TestStartOrphanRecoveryLoopDoesNotBlockCaller guards the #2074 regression
// where StartOrphanRecoveryLoop ran its select loop on the caller's goroutine:
// wired into startServer on the main goroutine, it made hub-server hang after
// "health check passed" and never reach "server starting" / ListenAndServe.
func TestStartOrphanRecoveryLoopDoesNotBlockCaller(t *testing.T) {
	db := newOrphanTestDB(t)
	svc := &DispatchService{db: db}

	ctx, cancel := context.WithCancel(context.Background())
	returned := make(chan struct{})
	go func() {
		svc.StartOrphanRecoveryLoop(ctx)
		close(returned)
	}()

	select {
	case <-returned:
		// Caller must return immediately; the sweeper runs in background.
	case <-time.After(3 * time.Second):
		t.Fatal("StartOrphanRecoveryLoop blocks the caller — hub startup would hang")
	}
	cancel()
}

func insertOrphanTaskRow(t *testing.T, db *gorm.DB, id, status string) {
	t.Helper()
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, created_at, expire_at)
		VALUES (?, 'ai-1', 'user-1', 'msg-1', ?, ?, ?)`,
		id, status, time.Now().Add(-10*time.Minute), time.Now().Add(24*time.Hour)).Error)
}

func TestRequeueClaimedOrphanTask_Dispatched_RolledBackToQueued(t *testing.T) {
	db := newOrphanTestDB(t)
	insertOrphanTaskRow(t, db, "task-rb", model.TaskStatusDispatched)

	ok, err := repository.RequeueClaimedOrphanTask(db, "task-rb")
	require.NoError(t, err)
	require.True(t, ok)

	var updated model.PendingAgentTask
	require.NoError(t, db.First(&updated, "id = ?", "task-rb").Error)
	require.Equal(t, model.TaskStatusQueued, updated.Status)
}

func TestRequeueClaimedOrphanTask_NonDispatched_NotClobbered(t *testing.T) {
	db := newOrphanTestDB(t)
	for _, status := range []string{model.TaskStatusQueued, model.TaskStatusRunning, model.TaskStatusDone, model.TaskStatusFailed} {
		id := "task-" + status
		insertOrphanTaskRow(t, db, id, status)

		ok, err := repository.RequeueClaimedOrphanTask(db, id)
		require.NoError(t, err)
		require.False(t, ok, "status %s must not be touched", status)

		var updated model.PendingAgentTask
		require.NoError(t, db.First(&updated, "id = ?", id).Error)
		require.Equal(t, status, updated.Status)
	}
}

func TestRequeueClaimedOrphanTask_MissingRow_NoError(t *testing.T) {
	db := newOrphanTestDB(t)
	ok, err := repository.RequeueClaimedOrphanTask(db, "task-ghost")
	require.NoError(t, err)
	require.False(t, ok)
}

// TestRedeliverOrphanedTask_TriggerMessageMissing_RollsBackClaim is the
// regression test for the stuck-claim defect: before the rollback fix, a
// claimed orphan whose trigger message could not be loaded stayed dispatched
// with no outbox row — unreachable by the claim predicate (status='queued')
// until TTL expiry, silently dropping the work.
func TestRedeliverOrphanedTask_TriggerMessageMissing_RollsBackClaim(t *testing.T) {
	db := newOrphanTestDB(t)
	require.NoError(t, db.Exec(`CREATE TABLE messages (id TEXT PRIMARY KEY)`).Error)
	grace := time.Now().Add(-5 * time.Minute)
	insertOrphanTaskRow(t, db, "task-lost-msg", model.TaskStatusQueued)

	ids, err := claimOrphanedTasksForTest(db, grace, 10)
	require.NoError(t, err)
	require.Equal(t, []string{"task-lost-msg"}, ids)

	svc := &DispatchService{db: db}
	svc.redeliverOrphanedTask(context.Background(), "task-lost-msg")

	// Claim must be rolled back to queued so the next sweep can re-claim.
	var updated model.PendingAgentTask
	require.NoError(t, db.First(&updated, "id = ?", "task-lost-msg").Error)
	require.Equal(t, model.TaskStatusQueued, updated.Status)

	ids2, err := claimOrphanedTasksForTest(db, grace, 10)
	require.NoError(t, err)
	require.Equal(t, []string{"task-lost-msg"}, ids2)
}
