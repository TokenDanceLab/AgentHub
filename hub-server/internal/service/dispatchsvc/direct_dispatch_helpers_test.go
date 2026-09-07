package dispatchsvc

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

func newDirectDispatchDB(t *testing.T, task *model.PendingAgentTask) *gorm.DB {
	t.Helper()
	db := newTestDB(t)
	require.NoError(t, db.Exec("CREATE TABLE agent_instances (id TEXT PRIMARY KEY, inviter_user_id TEXT NOT NULL)").Error)
	require.NoError(t, db.Exec("CREATE TABLE devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)").Error)
	if task.AgentInstanceID == "" {
		task.AgentInstanceID = "fixture-agent"
	}
	require.NoError(t, db.Exec("INSERT INTO agent_instances(id, inviter_user_id) VALUES (?, ?)", task.AgentInstanceID, "fixture-user").Error)
	require.NoError(t, db.Exec("INSERT INTO devices(id, user_id) VALUES (?, ?)", "fixture-edge-device", "fixture-user").Error)
	if task.Status == "" {
		task.Status = model.TaskStatusQueued
	}
	if task.ExpireAt.IsZero() {
		task.ExpireAt = time.Now().Add(time.Hour)
	}
	require.NoError(t, db.Create(task).Error)
	return db
}

// Timestamp decoding is exercised by the real PostgreSQL contract test. This
// SQLite fixture only reads the routing state involved in the transport test.
func readDirectDispatchTask(db *gorm.DB, id string) (*model.PendingAgentTask, error) {
	var task model.PendingAgentTask
	err := db.Select("id", "status", "edge_device_id", "edge_run_id").Where("id = ?", id).First(&task).Error
	return &task, err
}
