package agent

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/model"
)

// setupRetentionDB creates an in-memory SQLite with the two tables retention
// touches. Mirrors repository.setupSQLite but scoped to this package so we
// don't reach into another package's test helpers.
func setupRetentionDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`CREATE TABLE pending_agent_tasks (
		id TEXT PRIMARY KEY,
		agent_instance_id TEXT NOT NULL,
		triggered_by_user_id TEXT NOT NULL,
		trigger_message_id TEXT NOT NULL,
		status TEXT NOT NULL,
		expire_at DATETIME NOT NULL,
		finished_at DATETIME,
		created_at DATETIME
	)`).Error)
	require.NoError(t, db.Exec(`CREATE TABLE agent_run_events (
		id TEXT PRIMARY KEY,
		task_id TEXT NOT NULL,
		session_id TEXT NOT NULL,
		agent_instance_id TEXT NOT NULL,
		event_seq INTEGER NOT NULL,
		event_type TEXT NOT NULL,
		payload TEXT NOT NULL DEFAULT '',
		created_at DATETIME
	)`).Error)
	return db
}

func TestRunEventsRetentionPass_Integration(t *testing.T) {
	db := setupRetentionDB(t)
	now := time.Now().UTC()
	oldFinished := now.Add(-48 * time.Hour)

	taskID := "tttttttt-tttt-tttt-tttt-tttttttttttt"
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, expire_at, finished_at, created_at) VALUES (?, 'ai', 'tu', 'tm', ?, datetime('now'), ?, datetime('now'))`,
		taskID, model.TaskStatusDone, oldFinished).Error)
	for i := int64(1); i <= 800; i++ {
		require.NoError(t, db.Exec(`INSERT INTO agent_run_events (id, task_id, session_id, agent_instance_id, event_seq, event_type, payload, created_at) VALUES (?, ?, 'sess', 'ai', ?, 'run.output.batch', '{}', datetime('now'))`,
			fmt.Sprintf("evt-%d", i), taskID, i).Error)
	}

	cfg := RetentionConfig{Window: 24 * time.Hour, KeepTail: 500}
	res, err := RunEventsRetentionPass(context.Background(), db, cfg)
	require.NoError(t, err)
	assert.Equal(t, int64(300), res.DeletedRows)
	assert.Equal(t, int64(1), res.AffectedTasks)

	var remaining int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Where("task_id = ?", taskID).Count(&remaining).Error)
	assert.Equal(t, int64(500), remaining)

	var minSeq int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Where("task_id = ?", taskID).Select("MIN(event_seq)").Scan(&minSeq).Error)
	assert.Equal(t, int64(301), minSeq)
}

func TestRunEventsRetentionPass_NilDBSafe(t *testing.T) {
	res, err := RunEventsRetentionPass(context.Background(), nil, DefaultRetentionConfig())
	require.NoError(t, err)
	assert.Equal(t, RetentionResult{}, res)
}

func TestStartRunEventRetentionLoop_CancelStops(t *testing.T) {
	db := setupRetentionDB(t)
	ctx, cancel := context.WithCancel(context.Background())
	StartRunEventRetentionLoop(ctx, db, RetentionConfig{Window: 24 * time.Hour, KeepTail: 500})
	// Give the startup pass a moment to run.
	time.Sleep(200 * time.Millisecond)
	cancel()
	// After cancel, the goroutine should exit promptly. We can't directly
	// assert goroutine count without race, but no panic / hang is the contract.
	time.Sleep(100 * time.Millisecond)
}
