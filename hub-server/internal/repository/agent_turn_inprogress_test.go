package repository

import (
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// seedAgentInstanceForTurn inserts a session + agent_instance row with a fixed
// id, bypassing the model BeforeCreate UUID hook (which would overwrite id).
func seedAgentInstanceForTurn(t *testing.T, db *gorm.DB, id, sessionID, inviterID string) {
	t.Helper()
	require.NoError(t, db.Exec(`INSERT OR IGNORE INTO sessions (id, type, dissolved) VALUES (?, ?, 0)`, sessionID, "group").Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name) VALUES (?, ?, ?, ?, ?)`,
		id, "codex", sessionID, inviterID, "Agent").Error)
}

func newQueuedTurnTask(agentInstanceID, triggerMessageID string) *model.PendingAgentTask {
	return &model.PendingAgentTask{
		AgentInstanceID:   agentInstanceID,
		TriggeredByUserID: "user-1",
		TriggerMessageID:  triggerMessageID,
		Status:            model.TaskStatusQueued,
		ExpireAt:          time.Now().Add(time.Hour),
	}
}

func TestCreatePendingTaskUnlessActive_FirstSucceeds(t *testing.T) {
	db := setupSQLite(t)
	seedAgentInstanceForTurn(t, db, "ai-1", "sess-1", "user-1")

	created, err := CreatePendingTaskUnlessActive(db, newQueuedTurnTask("ai-1", "msg-1"))
	require.NoError(t, err)
	assert.NotEmpty(t, created.ID)
	assert.Equal(t, model.TaskStatusQueued, created.Status)

	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", created.ID).First(&stored).Error)
	assert.Equal(t, "ai-1", stored.AgentInstanceID)
}

func TestCreatePendingTaskUnlessActive_SecondActiveReturnsConflict(t *testing.T) {
	db := setupSQLite(t)
	seedAgentInstanceForTurn(t, db, "ai-1", "sess-1", "user-1")

	first, err := CreatePendingTaskUnlessActive(db, newQueuedTurnTask("ai-1", "msg-1"))
	require.NoError(t, err)

	// Second trigger for the same agent_instance is rejected with the sentinel.
	existing, err := CreatePendingTaskUnlessActive(db, newQueuedTurnTask("ai-1", "msg-2"))
	require.ErrorIs(t, err, ErrTurnInProgressActive)
	assert.Equal(t, first.ID, existing.ID, "should return the existing active task id")

	// No second row created.
	var count int64
	require.NoError(t, db.Model(&model.PendingAgentTask{}).Where("agent_instance_id = ?", "ai-1").Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

func TestCreatePendingTaskUnlessActive_DifferentAgentInstanceNotBlocked(t *testing.T) {
	db := setupSQLite(t)
	seedAgentInstanceForTurn(t, db, "ai-1", "sess-1", "user-1")
	seedAgentInstanceForTurn(t, db, "ai-2", "sess-1", "user-1")

	_, err := CreatePendingTaskUnlessActive(db, newQueuedTurnTask("ai-1", "msg-1"))
	require.NoError(t, err)

	// Different agent_instance: succeeds (per-agent_instance granularity, #1430).
	created, err := CreatePendingTaskUnlessActive(db, newQueuedTurnTask("ai-2", "msg-2"))
	require.NoError(t, err)
	assert.NotEmpty(t, created.ID)
}

func TestCreatePendingTaskUnlessActive_TerminalTaskDoesNotBlock(t *testing.T) {
	db := setupSQLite(t)
	seedAgentInstanceForTurn(t, db, "ai-1", "sess-1", "user-1")

	// A terminal (done) task must not block a new trigger.
	done := &model.PendingAgentTask{
		AgentInstanceID:   "ai-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-done",
		Status:            model.TaskStatusDone,
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(done).Error)

	created, err := CreatePendingTaskUnlessActive(db, newQueuedTurnTask("ai-1", "msg-2"))
	require.NoError(t, err)
	assert.NotEqual(t, done.ID, created.ID)
}

func TestCreatePendingTaskUnlessActive_DispatchedAndRunningBlock(t *testing.T) {
	db := setupSQLite(t)
	seedAgentInstanceForTurn(t, db, "ai-1", "sess-1", "user-1")

	for _, status := range []string{model.TaskStatusDispatched, model.TaskStatusRunning} {
		existing := &model.PendingAgentTask{
			AgentInstanceID:   "ai-1",
			TriggeredByUserID: "user-1",
			TriggerMessageID:  "msg-" + status,
			Status:            status,
			ExpireAt:          time.Now().Add(time.Hour),
		}
		require.NoError(t, db.Create(existing).Error)

		_, err := CreatePendingTaskUnlessActive(db, newQueuedTurnTask("ai-1", "msg-next-"+status))
		require.ErrorIs(t, err, ErrTurnInProgressActive, "status %s should block", status)

		// Clean up so the next iteration only sees its own active task.
		require.NoError(t, db.Where("id = ?", existing.ID).Unscoped().Delete(&model.PendingAgentTask{}).Error)
	}
}

func TestCreatePendingTaskUnlessActive_UnknownAgentInstanceReturnsNotFound(t *testing.T) {
	db := setupSQLite(t)
	_, err := CreatePendingTaskUnlessActive(db, newQueuedTurnTask("ai-missing", "msg-1"))
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
}

func TestFindActivePendingTaskByAgentInstance_ReturnsMostRecent(t *testing.T) {
	db := setupSQLite(t)
	seedAgentInstanceForTurn(t, db, "ai-1", "sess-1", "user-1")

	base := time.Now().UTC()
	older := &model.PendingAgentTask{
		AgentInstanceID:   "ai-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-old",
		Status:            model.TaskStatusRunning,
		ExpireAt:          time.Now().Add(time.Hour),
		CreatedAt:         base,
	}
	require.NoError(t, db.Create(older).Error)
	newer := &model.PendingAgentTask{
		AgentInstanceID:   "ai-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-new",
		Status:            model.TaskStatusDispatched,
		ExpireAt:          time.Now().Add(time.Hour),
		CreatedAt:         base.Add(time.Second),
	}
	require.NoError(t, db.Create(newer).Error)

	active, err := FindActivePendingTaskByAgentInstance(db, "ai-1")
	require.NoError(t, err)
	assert.Equal(t, newer.ID, active.ID, "should return the most recent active task")
}

func TestFindActivePendingTaskByAgentInstance_NoneActiveReturnsNotFound(t *testing.T) {
	db := setupSQLite(t)
	seedAgentInstanceForTurn(t, db, "ai-1", "sess-1", "user-1")

	_, err := FindActivePendingTaskByAgentInstance(db, "ai-1")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
}
