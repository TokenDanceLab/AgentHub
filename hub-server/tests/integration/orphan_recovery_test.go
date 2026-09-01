//go:build integration

package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// TestOrphanRecovery_ClaimAndRedeliver verifies that a queued task with no
// delivery_outbox row and created_at older than the grace period is claimed
// by ClaimOrphanedTasks and transitions to dispatched status.
func TestOrphanRecovery_ClaimAndRedeliver(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })

	// Create a queued task older than grace with no outbox row.
	grace := time.Now().Add(-5 * time.Minute)
	taskID := insertOrphanTask(t, "claim", model.TaskStatusQueued, time.Now().Add(-10*time.Minute))

	ids, err := repository.ClaimOrphanedTasks(db, grace, 10)
	require.NoError(t, err)
	require.Contains(t, ids, taskID, "orphan task should be claimed")

	// Verify status changed to dispatched.
	task, err := repository.GetPendingTaskByID(db, taskID)
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusDispatched, task.Status)

	// Verify an outbox row now exists (created by the claim or subsequent dispatch).
	// Note: ClaimOrphanedTasks only changes status; the outbox row is created
	// when DispatchTask runs. For this integration test we verify the claim
	// transition; the full redelivery path requires a running DispatchService.
}

// TestOrphanRecovery_GraceWindowNotClaimed verifies that a queued task within
// the grace period is NOT claimed by the sweeper.
func TestOrphanRecovery_GraceWindowNotClaimed(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })

	grace := time.Now().Add(-5 * time.Minute)
	// Task created 1 minute ago — within grace window.
	insertOrphanTask(t, "young", model.TaskStatusQueued, time.Now().Add(-1*time.Minute))

	ids, err := repository.ClaimOrphanedTasks(db, grace, 10)
	require.NoError(t, err)
	require.Empty(t, ids, "young task should not be claimed")
}

// TestOrphanRecovery_TaskWithOutboxNotClaimed verifies that a queued task with
// an existing delivery_outbox row is NOT claimed (it's already being delivered).
func TestOrphanRecovery_TaskWithOutboxNotClaimed(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })

	grace := time.Now().Add(-5 * time.Minute)
	taskID := insertOrphanTask(t, "with-outbox", model.TaskStatusQueued, time.Now().Add(-10*time.Minute))

	// Insert a delivery_outbox row for this task.
	err := db.Exec(`INSERT INTO delivery_outbox (id, task_id, delivery_id, payload, status, created_at, updated_at)
		VALUES (gen_random_uuid(), ?, 'del-1', '{}', 'pending', NOW(), NOW())`, taskID).Error
	require.NoError(t, err)

	ids, err := repository.ClaimOrphanedTasks(db, grace, 10)
	require.NoError(t, err)
	require.Empty(t, ids, "task with outbox row should not be claimed")
}

// insertOrphanTask creates a minimal pending_agent_task row via raw SQL to
// avoid GORM hooks (BeforeCreate UUID generation). Returns the task ID.
func insertOrphanTask(t *testing.T, label, status string, createdAt time.Time) string {
	t.Helper()
	// Disable FK checks so we can insert orphan tasks without creating full
	// parent records (agent_instances, messages, users). Re-enabled after insert.
	require.NoError(t, db.Exec(`SET session_replication_role = 'replica'`).Error)
	defer func() {
		require.NoError(t, db.Exec(`SET session_replication_role = 'origin'`).Error)
	}()
	var id string
	err := db.Raw(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, created_at, expire_at, model_params)
		VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), ?, ?, NOW() + INTERVAL '24 hours', '{}')
		RETURNING id`, status, createdAt).Scan(&id).Error
	require.NoError(t, err, "insert orphan task %s", label)
	return id
}

// TestOrphanRecovery_RequeueClaim_DispatchedRolledBack verifies that a task
// stuck in dispatched by a failed redelivery rebuild is returned to queued by
// RequeueClaimedOrphanTask, making it re-claimable by the next sweep.
func TestOrphanRecovery_RequeueClaim_DispatchedRolledBack(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })

	taskID := insertOrphanTask(t, "requeue", model.TaskStatusDispatched, time.Now().Add(-10*time.Minute))

	ok, err := repository.RequeueClaimedOrphanTask(db, taskID)
	require.NoError(t, err)
	require.True(t, ok, "dispatched claim must be rolled back")

	task, err := repository.GetPendingTaskByID(db, taskID)
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusQueued, task.Status)

	// Re-claimable by the next sweep.
	grace := time.Now().Add(-5 * time.Minute)
	ids, err := repository.ClaimOrphanedTasks(db, grace, 10)
	require.NoError(t, err)
	require.Contains(t, ids, taskID, "rolled-back task must be re-claimable")
}

// TestOrphanRecovery_RequeueClaim_RunningNotClobbered verifies the CAS guard:
// a task that moved on to running is never rolled back.
func TestOrphanRecovery_RequeueClaim_RunningNotClobbered(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })

	taskID := insertOrphanTask(t, "running", model.TaskStatusRunning, time.Now().Add(-10*time.Minute))

	ok, err := repository.RequeueClaimedOrphanTask(db, taskID)
	require.NoError(t, err)
	require.False(t, ok, "running task must not be touched")

	task, err := repository.GetPendingTaskByID(db, taskID)
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusRunning, task.Status)
}
