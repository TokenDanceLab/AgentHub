package dispatchsvc

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
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
