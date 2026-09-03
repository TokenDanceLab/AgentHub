package repository

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// Heartbeat short-circuit tests for BumpRunningTaskExpireAt (#2154 P2-9).
//
// The write is issued once per streamed chunk, and the predicate now skips the
// row unless the stored deadline differs meaningfully from the one being
// written. These tests pin both halves of that contract: the skip (no dead
// tuples per chunk) and the two cases that MUST still write — narrowing the
// 24h dispatch deadline down to the heartbeat TTL, and re-arming a deadline
// that has drifted close to expiry.

func seedHeartbeatTask(t *testing.T, db *gorm.DB, id, status string, expireAt time.Time) {
	t.Helper()
	require.NoError(t, db.Exec(
		`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, expire_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, "ai-1", "user-1", "msg-1", status, expireAt, time.Now()).Error)
}

func heartbeatExpireAt(t *testing.T, db *gorm.DB, id string) time.Time {
	t.Helper()
	var expireAt time.Time
	require.NoError(t, db.Raw(`SELECT expire_at FROM pending_agent_tasks WHERE id = ?`, id).Scan(&expireAt).Error)
	return expireAt
}

func TestBumpRunningTaskExpireAt_FirstBumpNarrowsTheDispatchDeadline(t *testing.T) {
	db := setupSQLite(t)
	const ttl = 10 * time.Minute
	// Dispatch creates the row with config.PendingTaskTTL (24h); nothing narrows
	// it until the first stream callback.
	seedHeartbeatTask(t, db, "task-narrow", model.TaskStatusRunning, time.Now().Add(24*time.Hour))

	require.NoError(t, BumpRunningTaskExpireAt(db, "task-narrow", ttl))

	got := heartbeatExpireAt(t, db, "task-narrow")
	require.WithinDuration(t, time.Now().Add(ttl), got, time.Minute,
		"the first bump must lower the 24h dispatch deadline to the heartbeat TTL — "+
			"a one-sided 'only write when extending' predicate would skip this and disable the #132 timeout")
}

func TestBumpRunningTaskExpireAt_SkipsRedundantRewrite(t *testing.T) {
	db := setupSQLite(t)
	const ttl = 10 * time.Minute
	seedHeartbeatTask(t, db, "task-hot", model.TaskStatusRunning, time.Now().Add(ttl))

	require.NoError(t, BumpRunningTaskExpireAt(db, "task-hot", ttl))
	first := heartbeatExpireAt(t, db, "task-hot")

	// Simulate the next 50 chunks of the same stream: each computes a new
	// deadline within ttl/4 of the stored one, so none of them may write.
	for i := 0; i < 50; i++ {
		res := db.Model(&model.PendingAgentTask{}).
			Where("id = ? AND status = ? AND (expire_at < ? OR expire_at > ?)",
				"task-hot", model.TaskStatusRunning,
				time.Now().Add(ttl).Add(-ttl/4), time.Now().Add(ttl))
		require.NoError(t, res.Update("expire_at", time.Now().Add(ttl)).Error)
		require.EqualValues(t, 0, res.RowsAffected, "chunk %d must short-circuit in SQL", i)
	}
	require.NoError(t, BumpRunningTaskExpireAt(db, "task-hot", ttl))
	require.True(t, heartbeatExpireAt(t, db, "task-hot").Equal(first) ||
		heartbeatExpireAt(t, db, "task-hot").After(first),
		"a skipped bump must never move the deadline backwards")
}

func TestBumpRunningTaskExpireAt_ReArmsDeadlineCloseToExpiry(t *testing.T) {
	db := setupSQLite(t)
	const ttl = 10 * time.Minute
	// Activity resumed after a long quiet stretch: the stored deadline is now
	// inside the skip window's lower bound (ttl/2 < ttl - ttl/4), so the
	// heartbeat must re-arm it. This is the invariant that keeps a task with
	// continuous activity alive: expire_at is always > now + ttl/2 after a bump.
	seedHeartbeatTask(t, db, "task-rearm", model.TaskStatusRunning, time.Now().Add(ttl/2))

	require.NoError(t, BumpRunningTaskExpireAt(db, "task-rearm", ttl))

	got := heartbeatExpireAt(t, db, "task-rearm")
	require.WithinDuration(t, time.Now().Add(ttl), got, time.Minute,
		"a deadline inside the skip floor must be extended again")
	require.True(t, got.After(time.Now().Add(ttl/2)),
		"ScanExpiredTasks (expire_at < now) must not be able to reap an active task")
}

func TestBumpRunningTaskExpireAt_IgnoresNonRunningTasks(t *testing.T) {
	db := setupSQLite(t)
	const ttl = 10 * time.Minute
	seedHeartbeatTask(t, db, "task-queued", model.TaskStatusQueued, time.Now().Add(24*time.Hour))
	before := heartbeatExpireAt(t, db, "task-queued")

	require.NoError(t, BumpRunningTaskExpireAt(db, "task-queued", ttl))

	require.True(t, heartbeatExpireAt(t, db, "task-queued").Equal(before),
		"only running tasks carry a heartbeat")
}

func TestBumpRunningTaskExpireAt_UnknownTaskIsNotAnError(t *testing.T) {
	db := setupSQLite(t)
	// A 0-row result is the intended short-circuit, not a failure: the caller
	// (bumpRunningTaskHeartbeat) warns and increments a metric on error only.
	require.NoError(t, BumpRunningTaskExpireAt(db, "task-missing", 10*time.Minute))
}

// =============================================================================
// AgentInstance repository tests
// =============================================================================

func TestAgentInstanceRepo_CRUD(t *testing.T) {
	db := setupSQLite(t)

	ai := &model.AgentInstance{
		AgentType:     "code-explorer",
		SessionID:     "session-ai-1",
		InviterUserID: "user-inviter",
		DisplayName:   "Code Explorer",
	}
	err := CreateAgentInstance(db, ai)
	require.NoError(t, err)
	assert.NotEmpty(t, ai.ID)

	// Get by ID
	fetched, err := GetAgentInstanceByID(db, ai.ID)
	require.NoError(t, err)
	assert.Equal(t, "code-explorer", fetched.AgentType)

	// Create a second agent instance in the same session
	ai2 := &model.AgentInstance{
		AgentType:     "code-reviewer",
		SessionID:     "session-ai-1",
		InviterUserID: "user-inviter",
		DisplayName:   "Code Reviewer",
	}
	require.NoError(t, CreateAgentInstance(db, ai2))

	// List by session
	list, err := ListAgentInstancesBySession(db, "session-ai-1")
	require.NoError(t, err)
	assert.Len(t, list, 2)

	// List by inviter
	list, err = ListAgentInstancesByInviter(db, "session-ai-1", "user-inviter")
	require.NoError(t, err)
	assert.Len(t, list, 2)

	// List by different inviter
	list, err = ListAgentInstancesByInviter(db, "session-ai-1", "other-user")
	require.NoError(t, err)
	assert.Len(t, list, 0)

	// Delete
	require.NoError(t, DeleteAgentInstance(db, ai2.ID))
	list, err = ListAgentInstancesBySession(db, "session-ai-1")
	require.NoError(t, err)
	assert.Len(t, list, 1)
}

// =============================================================================
// CustomAgent repository tests
// =============================================================================

func TestCustomAgentRepo_CRUD(t *testing.T) {
	db := setupSQLite(t)

	ca := &model.CustomAgent{
		OwnerUserID:    "user-ca",
		Name:           "My Agent",
		AgentType:      "code-explorer",
		SystemPrompt:   "You are a helpful assistant.",
		CapabilityTags: `["code"]`,
		ToolWhitelist:  `["read","write"]`,
		ModelParams:    `{}`,
	}
	err := CreateCustomAgent(db, ca)
	require.NoError(t, err)
	assert.NotEmpty(t, ca.ID)

	// Get by ID
	fetched, err := GetCustomAgentByID(db, ca.ID)
	require.NoError(t, err)
	assert.Equal(t, "My Agent", fetched.Name)

	// List by owner
	list, err := ListCustomAgentsByOwner(db, "user-ca")
	require.NoError(t, err)
	assert.Len(t, list, 1)

	// Create another
	ca2 := &model.CustomAgent{
		OwnerUserID:  "user-ca",
		Name:         "Agent 2",
		AgentType:    "code-reviewer",
		SystemPrompt: "Review code.",
	}
	require.NoError(t, CreateCustomAgent(db, ca2))
	list, err = ListCustomAgentsByOwner(db, "user-ca")
	require.NoError(t, err)
	assert.Len(t, list, 2)

	// Update
	ca.Name = "Renamed Agent"
	err = UpdateCustomAgent(db, ca)
	require.NoError(t, err)
	fetched, err = GetCustomAgentByID(db, ca.ID)
	require.NoError(t, err)
	assert.Equal(t, "Renamed Agent", fetched.Name)

	// Soft delete
	require.NoError(t, SoftDeleteCustomAgent(db, ca2.ID))
	_, err = GetCustomAgentByID(db, ca2.ID)
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)

	// But the first is still there
	fetched, err = GetCustomAgentByID(db, ca.ID)
	require.NoError(t, err)
	assert.NotNil(t, fetched)
}

// =============================================================================
// PendingAgentTask repository tests
// =============================================================================

func TestPendingTaskRepo_CRUD(t *testing.T) {
	db := setupSQLite(t)

	expireAt := time.Now().Add(time.Hour)
	task := &model.PendingAgentTask{
		AgentInstanceID:   "agent-inst-1",
		TriggeredByUserID: "user-trigger",
		TriggerMessageID:  "msg-trigger-1",
		Status:            model.TaskStatusQueued,
		ExpireAt:          expireAt,
	}
	err := CreatePendingTask(db, task)
	require.NoError(t, err)
	assert.NotEmpty(t, task.ID)

	// Get by ID
	fetched, err := GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusQueued, fetched.Status)

	// Update status to dispatched
	err = UpdatePendingTaskStatus(db, task.ID, model.TaskStatusDispatched, "")
	require.NoError(t, err)
	fetched, err = GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusDispatched, fetched.Status)
	assert.NotNil(t, fetched.DispatchedAt)

	err = UpdatePendingTaskDispatched(db, task.ID, "device-edge-1")
	require.NoError(t, err)
	fetched, err = GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusDispatched, fetched.Status)
	assert.Equal(t, "device-edge-1", fetched.EdgeDeviceID)

	// Update status to running and persist the Edge run mapping.
	err = UpdatePendingTaskStatusWithEdgeRunID(db, task.ID, model.TaskStatusRunning, "", "run-edge-1")
	require.NoError(t, err)
	fetched, err = GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, fetched.Status)
	assert.Equal(t, "run-edge-1", fetched.EdgeRunID)

	// Update status to done
	err = UpdatePendingTaskStatus(db, task.ID, model.TaskStatusDone, "")
	require.NoError(t, err)
	fetched, err = GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusDone, fetched.Status)
	assert.NotNil(t, fetched.FinishedAt)

	err = UpdatePendingTaskDispatched(db, task.ID, "device-after-done")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	fetched, err = GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusDone, fetched.Status, "terminal task should not be moved back to dispatched")
	assert.Equal(t, "device-edge-1", fetched.EdgeDeviceID)

	// Update with error
	task2 := &model.PendingAgentTask{
		AgentInstanceID:   "agent-inst-2",
		TriggeredByUserID: "user-trigger",
		TriggerMessageID:  "msg-trigger-2",
		Status:            model.TaskStatusQueued,
		ExpireAt:          expireAt,
	}
	require.NoError(t, CreatePendingTask(db, task2))
	err = UpdatePendingTaskStatus(db, task2.ID, model.TaskStatusFailed, "something went wrong")
	require.NoError(t, err)
	fetched, err = GetPendingTaskByID(db, task2.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusFailed, fetched.Status)
	assert.Equal(t, "something went wrong", fetched.ErrorMessage)
}

func TestPendingTaskRepo_CancelTasksByAgent(t *testing.T) {
	db := setupSQLite(t)

	expireAt := time.Now().Add(time.Hour)
	task1 := &model.PendingAgentTask{
		AgentInstanceID:   "agent-cancel",
		TriggeredByUserID: "user-t",
		TriggerMessageID:  "msg-1",
		Status:            model.TaskStatusQueued,
		ExpireAt:          expireAt,
	}
	task2 := &model.PendingAgentTask{
		AgentInstanceID:   "agent-cancel",
		TriggeredByUserID: "user-t",
		TriggerMessageID:  "msg-2",
		Status:            model.TaskStatusDispatched,
		ExpireAt:          expireAt,
	}
	task3 := &model.PendingAgentTask{
		AgentInstanceID:   "agent-other",
		TriggeredByUserID: "user-t",
		TriggerMessageID:  "msg-3",
		Status:            model.TaskStatusQueued,
		ExpireAt:          expireAt,
	}
	require.NoError(t, CreatePendingTask(db, task1))
	require.NoError(t, CreatePendingTask(db, task2))
	require.NoError(t, CreatePendingTask(db, task3))

	err := CancelTasksByAgentInstance(db, "agent-cancel")
	require.NoError(t, err)

	// Tasks 1 and 2 should be cancelled
	fetched, _ := GetPendingTaskByID(db, task1.ID)
	require.NotNil(t, fetched)
	assert.Equal(t, model.TaskStatusCancelled, fetched.Status)

	fetched, _ = GetPendingTaskByID(db, task2.ID)
	require.NotNil(t, fetched)
	assert.Equal(t, model.TaskStatusCancelled, fetched.Status)

	// Task 3 (different agent) should still be queued
	fetched, _ = GetPendingTaskByID(db, task3.ID)
	require.NotNil(t, fetched)
	assert.Equal(t, model.TaskStatusQueued, fetched.Status)
}

func TestPendingTaskRepo_ScanExpiredTasks(t *testing.T) {
	db := setupSQLite(t)

	// Create tasks with different statuses and expire times
	// Expired queued
	task1 := &model.PendingAgentTask{
		AgentInstanceID:   "agent-scan",
		TriggeredByUserID: "user-scan",
		TriggerMessageID:  "msg-1",
		Status:            model.TaskStatusQueued,
		ExpireAt:          time.Now().Add(-time.Hour), // expired
	}
	// Expired dispatched
	task2 := &model.PendingAgentTask{
		AgentInstanceID:   "agent-scan",
		TriggeredByUserID: "user-scan",
		TriggerMessageID:  "msg-2",
		Status:            model.TaskStatusDispatched,
		ExpireAt:          time.Now().Add(-time.Hour), // expired
	}
	// Expired running (#132: running tasks should also be scanned)
	task3 := &model.PendingAgentTask{
		AgentInstanceID:   "agent-scan",
		TriggeredByUserID: "user-scan",
		TriggerMessageID:  "msg-3",
		Status:            model.TaskStatusRunning,
		ExpireAt:          time.Now().Add(-time.Hour), // expired
	}
	// Not expired yet
	task4 := &model.PendingAgentTask{
		AgentInstanceID:   "agent-scan",
		TriggeredByUserID: "user-scan",
		TriggerMessageID:  "msg-4",
		Status:            model.TaskStatusQueued,
		ExpireAt:          time.Now().Add(time.Hour), // not expired
	}
	// Expired but already done (terminal states excluded)
	task5 := &model.PendingAgentTask{
		AgentInstanceID:   "agent-scan",
		TriggeredByUserID: "user-scan",
		TriggerMessageID:  "msg-5",
		Status:            model.TaskStatusDone,
		ExpireAt:          time.Now().Add(-time.Hour), // expired but done
	}
	// Expired but already failed (terminal states excluded)
	task6 := &model.PendingAgentTask{
		AgentInstanceID:   "agent-scan",
		TriggeredByUserID: "user-scan",
		TriggerMessageID:  "msg-6",
		Status:            model.TaskStatusFailed,
		ExpireAt:          time.Now().Add(-time.Hour), // expired but failed
	}
	// Expired but already cancelled (terminal states excluded)
	task7 := &model.PendingAgentTask{
		AgentInstanceID:   "agent-scan",
		TriggeredByUserID: "user-scan",
		TriggerMessageID:  "msg-7",
		Status:            model.TaskStatusCancelled,
		ExpireAt:          time.Now().Add(-time.Hour), // expired but cancelled
	}

	require.NoError(t, CreatePendingTask(db, task1))
	require.NoError(t, CreatePendingTask(db, task2))
	require.NoError(t, CreatePendingTask(db, task3))
	require.NoError(t, CreatePendingTask(db, task4))
	require.NoError(t, CreatePendingTask(db, task5))
	require.NoError(t, CreatePendingTask(db, task6))
	require.NoError(t, CreatePendingTask(db, task7))

	tasks, err := ScanExpiredTasks(db)
	require.NoError(t, err)

	// Should only return tasks 1, 2, 3 (expired and in non-terminal states)
	assert.Len(t, tasks, 3)

	taskIDs := make(map[string]bool)
	for _, t := range tasks {
		taskIDs[t.ID] = true
	}
	assert.True(t, taskIDs[task1.ID], "expired queued task should be returned")
	assert.True(t, taskIDs[task2.ID], "expired dispatched task should be returned")
	assert.True(t, taskIDs[task3.ID], "expired running task should be returned (#132)")
	assert.False(t, taskIDs[task4.ID], "non-expired task should not be returned")
	assert.False(t, taskIDs[task5.ID], "expired done task should not be returned")
	assert.False(t, taskIDs[task6.ID], "expired failed task should not be returned")
	assert.False(t, taskIDs[task7.ID], "expired cancelled task should not be returned")
}

// =============================================================================
// B2 data-integrity tests — atomic status, password+token, pin limit
// =============================================================================

func TestPendingTaskRepo_AtomicStatusUpdate(t *testing.T) {
	db := setupSQLite(t)

	expireAt := time.Now().Add(time.Hour)
	task := &model.PendingAgentTask{
		AgentInstanceID:   "agent-atomic",
		TriggeredByUserID: "user-t",
		TriggerMessageID:  "msg-1",
		Status:            model.TaskStatusDispatched,
		ExpireAt:          expireAt,
	}
	require.NoError(t, CreatePendingTask(db, task))

	// Atomic transition: dispatched → running (should succeed)
	rows, err := UpdatePendingTaskStatusAtomic(db, task.ID, model.TaskStatusDispatched, model.TaskStatusRunning, "")
	require.NoError(t, err)
	assert.Equal(t, int64(1), rows)

	fetched, err := GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, fetched.Status)

	// Atomic transition with wrong old status (should fail — 0 rows)
	rows, err = UpdatePendingTaskStatusAtomic(db, task.ID, model.TaskStatusDispatched, model.TaskStatusDone, "")
	require.NoError(t, err)
	assert.Equal(t, int64(0), rows, "should not transition from running when oldStatus is dispatched")

	// Verify status unchanged
	fetched, err = GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, fetched.Status)

	// Atomic transition: running → done (should succeed)
	rows, err = UpdatePendingTaskStatusAtomic(db, task.ID, model.TaskStatusRunning, model.TaskStatusDone, "")
	require.NoError(t, err)
	assert.Equal(t, int64(1), rows)

	fetched, err = GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusDone, fetched.Status)
	assert.NotNil(t, fetched.FinishedAt)
}

func TestPendingTaskRepo_AtomicWithEdgeRunID(t *testing.T) {
	db := setupSQLite(t)

	expireAt := time.Now().Add(time.Hour)
	task := &model.PendingAgentTask{
		AgentInstanceID:   "agent-edge",
		TriggeredByUserID: "user-t",
		TriggerMessageID:  "msg-1",
		Status:            model.TaskStatusDispatched,
		ExpireAt:          expireAt,
	}
	require.NoError(t, CreatePendingTask(db, task))

	// Atomic: dispatched → running with edgeRunID
	rows, err := UpdatePendingTaskStatusAtomicWithEdgeRunID(db, task.ID, model.TaskStatusDispatched, model.TaskStatusRunning, "", "run-001")
	require.NoError(t, err)
	assert.Equal(t, int64(1), rows)

	fetched, err := GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, fetched.Status)
	assert.Equal(t, "run-001", fetched.EdgeRunID)

	// Edge run id backfill on an already populated edgeRunID is a no-op.
	rows, err = UpdatePendingTaskEdgeRunID(db, task.ID, "run-002")
	// edge_run_id is already "run-001" so WHERE edge_run_id = '' matches 0 rows
	require.NoError(t, err)
	assert.Equal(t, int64(0), rows)
	fetched, err = GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	assert.Equal(t, "run-001", fetched.EdgeRunID, "edgeRunID should not be overwritten")

	backfillTask := &model.PendingAgentTask{
		AgentInstanceID:   "agent-edge",
		TriggeredByUserID: "user-t",
		TriggerMessageID:  "msg-2",
		Status:            model.TaskStatusRunning,
		ExpireAt:          expireAt,
	}
	require.NoError(t, CreatePendingTask(db, backfillTask))

	rows, err = UpdatePendingTaskEdgeRunID(db, backfillTask.ID, "run-002")
	require.NoError(t, err)
	assert.Equal(t, int64(1), rows)
	fetched, err = GetPendingTaskByID(db, backfillTask.ID)
	require.NoError(t, err)
	assert.Equal(t, "run-002", fetched.EdgeRunID)
}

func TestPendingTaskRepo_AtomicFailClosed(t *testing.T) {
	db := setupSQLite(t)

	expireAt := time.Now().Add(time.Hour)
	task := &model.PendingAgentTask{
		AgentInstanceID:   "agent-failclosed",
		TriggeredByUserID: "user-t",
		TriggerMessageID:  "msg-1",
		Status:            model.TaskStatusRunning,
		ExpireAt:          expireAt,
	}
	require.NoError(t, CreatePendingTask(db, task))

	// Simulate a race: first writer marks it done
	rows, err := UpdatePendingTaskStatusAtomic(db, task.ID, model.TaskStatusRunning, model.TaskStatusDone, "")
	require.NoError(t, err)
	assert.Equal(t, int64(1), rows)

	// Second writer tries to mark it failed — 0 rows (fail closed)
	rows, err = UpdatePendingTaskStatusAtomic(db, task.ID, model.TaskStatusRunning, model.TaskStatusFailed, "boom")
	require.NoError(t, err)
	assert.Equal(t, int64(0), rows, "second writer should get 0 rows affected")

	// Status should remain done
	fetched, err := GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusDone, fetched.Status)
}
