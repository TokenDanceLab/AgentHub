package repository

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
)

func TestBatchCancelTasksByAgentInstance_Empty(t *testing.T) {
	db := setupSQLite(t)
	assert.NoError(t, BatchCancelTasksByAgentInstance(db, nil))
	assert.NoError(t, BatchCancelTasksByAgentInstance(db, []string{}))
}

func TestBatchCancelTasksByAgentInstance_Multiple(t *testing.T) {
	db := setupSQLite(t)
	for _, id := range []string{"a1", "a2", "a3"} {
		require.NoError(t, CreateAgentInstance(db, &model.AgentInstance{ID: id, SessionID: "s1", InviterUserID: "u1", DisplayName: "x"}))
	}
	// Insert via raw SQL to preserve fixed IDs (BeforeCreate hook would overwrite).
	for _, row := range []struct{ id, agent, status string }{
		{"t1", "a1", model.TaskStatusQueued},
		{"t2", "a1", model.TaskStatusDispatched},
		{"t3", "a2", model.TaskStatusRunning},
		{"t4", "a3", model.TaskStatusQueued},
		{"t5", "a1", model.TaskStatusCancelled},
	} {
		require.NoError(t, db.Exec(
			`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, expire_at, created_at) VALUES (?, ?, 'u1', 'm1', ?, datetime('now','+1 hour'), datetime('now'))`,
			row.id, row.agent, row.status,
		).Error)
	}

	require.NoError(t, BatchCancelTasksByAgentInstance(db, []string{"a1", "a2"}))

	var remaining []model.PendingAgentTask
	require.NoError(t, db.Where("status IN ?", []string{model.TaskStatusQueued, model.TaskStatusDispatched, model.TaskStatusRunning}).Find(&remaining).Error)
	assert.Len(t, remaining, 1)
	assert.Equal(t, "t4", remaining[0].ID)

	var cancelledCount int64
	require.NoError(t, db.Model(&model.PendingAgentTask{}).Where("status = ? AND agent_instance_id IN ?", model.TaskStatusCancelled, []string{"a1", "a2"}).Count(&cancelledCount).Error)
	assert.Equal(t, int64(4), cancelledCount) // t1, t2, t3 newly cancelled + t5 pre-existing cancelled row (all match WHERE status=cancelled AND agent_instance_id IN (a1,a2))
}

func TestBatchDeleteAgentInstances_Empty(t *testing.T) {
	db := setupSQLite(t)
	assert.NoError(t, BatchDeleteAgentInstances(db, nil))
	assert.NoError(t, BatchDeleteAgentInstances(db, []string{}))
}

func TestBatchDeleteAgentInstances_Multiple(t *testing.T) {
	db := setupSQLite(t)
	a1 := &model.AgentInstance{SessionID: "s1", InviterUserID: "u1", DisplayName: "x"}
	a2 := &model.AgentInstance{SessionID: "s1", InviterUserID: "u1", DisplayName: "y"}
	a3 := &model.AgentInstance{SessionID: "s1", InviterUserID: "u1", DisplayName: "z"}
	require.NoError(t, CreateAgentInstance(db, a1))
	require.NoError(t, CreateAgentInstance(db, a2))
	require.NoError(t, CreateAgentInstance(db, a3))

	require.NoError(t, BatchDeleteAgentInstances(db, []string{a1.ID, a2.ID}))

	var count int64
	require.NoError(t, db.Model(&model.AgentInstance{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)

	var remaining model.AgentInstance
	require.NoError(t, db.First(&remaining).Error)
	assert.Equal(t, a3.ID, remaining.ID)
}
