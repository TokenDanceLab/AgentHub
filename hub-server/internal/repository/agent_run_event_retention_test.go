package repository

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
)

// helper to insert a pending_agent_task row with the given status and
// finished_at. Uses raw SQL because model.BeforeCreate requires uuidv7 and
// we want deterministic IDs in tests.
func insertTask(t *testing.T, db interface{ Exec(string, ...interface{}) interface{ Error() error } }, id, status string, finishedAt *time.Time) {
	t.Helper()
	var fa interface{}
	if finishedAt != nil {
		fa = finishedAt.Format(time.RFC3339Nano)
	}
	sql := fmt.Sprintf(
		`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, expire_at, finished_at, created_at) VALUES ('%s', 'ai', 'tu', 'tm', '%s', datetime('now'), %v, datetime('now'))`,
		id, status, func() string {
			if fa == nil {
				return "NULL"
			}
			return fmt.Sprintf("'%s'", fa)
		}(),
	)
	require.NoError(t, db.Exec(sql).Error())
}

func TestPurgeTerminalRunEvents_TailAndWindow(t *testing.T) {
	db := setupSQLite(t)

	now := time.Now().UTC()
	oldFinished := now.Add(-48 * time.Hour)  // well past default 30d? no — use cutoff=24h below
	recentFinished := now.Add(-1 * time.Hour) // within cutoff

	// Terminal task A: finished 48h ago, 800 events → expect keep tail 500.
	taskAID := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, expire_at, finished_at, created_at) VALUES (?, 'ai', 'tu', 'tm', ?, datetime('now'), ?, datetime('now'))`,
		taskAID, model.TaskStatusDone, oldFinished).Error)
	for i := int64(1); i <= 800; i++ {
		require.NoError(t, db.Exec(`INSERT INTO agent_run_events (id, task_id, session_id, agent_instance_id, event_seq, event_type, payload, created_at) VALUES (?, ?, 'sess', 'ai', ?, 'run.output.batch', '{}', datetime('now'))`,
			fmt.Sprintf("evt-a-%d", i), taskAID, i).Error)
	}

	// Non-terminal task B: running, 800 events → must NOT be touched.
	taskBID := "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, expire_at, finished_at, created_at) VALUES (?, 'ai', 'tu', 'tm', ?, datetime('now'), NULL, datetime('now'))`,
		taskBID, model.TaskStatusRunning).Error)
	for i := int64(1); i <= 800; i++ {
		require.NoError(t, db.Exec(`INSERT INTO agent_run_events (id, task_id, session_id, agent_instance_id, event_seq, event_type, payload, created_at) VALUES (?, ?, 'sess', 'ai', ?, 'run.output.batch', '{}', datetime('now'))`,
			fmt.Sprintf("evt-b-%d", i), taskBID, i).Error)
	}

	// Terminal task C: finished recently (within cutoff) → must NOT be touched.
	taskCID := "cccccccc-cccc-cccc-cccc-cccccccccccc"
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, expire_at, finished_at, created_at) VALUES (?, 'ai', 'tu', 'tm', ?, datetime('now'), ?, datetime('now'))`,
		taskCID, model.TaskStatusFailed, recentFinished).Error)
	for i := int64(1); i <= 800; i++ {
		require.NoError(t, db.Exec(`INSERT INTO agent_run_events (id, task_id, session_id, agent_instance_id, event_seq, event_type, payload, created_at) VALUES (?, ?, 'sess', 'ai', ?, 'run.output.batch', '{}', datetime('now'))`,
			fmt.Sprintf("evt-c-%d", i), taskCID, i).Error)
	}

	cutoff := now.Add(-24 * time.Hour)
	res, err := PurgeTerminalRunEvents(db, cutoff, 500)
	require.NoError(t, err)
	assert.Equal(t, int64(300), res.DeletedRows, "should delete 800-500=300 rows from task A only")
	assert.Equal(t, int64(1), res.AffectedTasks)

	// Task A should retain exactly the highest 500 event_seq values.
	var remainingA int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Where("task_id = ?", taskAID).Count(&remainingA).Error)
	assert.Equal(t, int64(500), remainingA)

	var minSeqA int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Where("task_id = ?", taskAID).Select("MIN(event_seq)").Scan(&minSeqA).Error)
	assert.Equal(t, int64(301), minSeqA, "retained seqs should be 301..800")

	// Task B (non-terminal) untouched.
	var remainingB int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Where("task_id = ?", taskBID).Count(&remainingB).Error)
	assert.Equal(t, int64(800), remainingB)

	// Task C (terminal but within window) untouched.
	var remainingC int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Where("task_id = ?", taskCID).Count(&remainingC).Error)
	assert.Equal(t, int64(800), remainingC)
}

func TestPurgeTerminalRunEvents_NoopWhenNoneQualify(t *testing.T) {
	db := setupSQLite(t)
	cutoff := time.Now().Add(-24 * time.Hour)
	res, err := PurgeTerminalRunEvents(db, cutoff, 500)
	require.NoError(t, err)
	assert.Equal(t, int64(0), res.DeletedRows)
	assert.Equal(t, int64(0), res.AffectedTasks)
}

func TestPurgeTerminalRunEvents_KeepTailZeroDeletesAll(t *testing.T) {
	db := setupSQLite(t)
	oldFinished := time.Now().Add(-48 * time.Hour)
	taskID := "dddddddd-dddd-dddd-dddd-dddddddddddd"
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, expire_at, finished_at, created_at) VALUES (?, 'ai', 'tu', 'tm', ?, datetime('now'), ?, datetime('now'))`,
		taskID, model.TaskStatusCancelled, oldFinished).Error)
	for i := int64(1); i <= 10; i++ {
		require.NoError(t, db.Exec(`INSERT INTO agent_run_events (id, task_id, session_id, agent_instance_id, event_seq, event_type, payload, created_at) VALUES (?, ?, 'sess', 'ai', ?, 'run.output.batch', '{}', datetime('now'))`,
			fmt.Sprintf("evt-d-%d", i), taskID, i).Error)
	}
	res, err := PurgeTerminalRunEvents(db, time.Now().Add(-24*time.Hour), 0)
	require.NoError(t, err)
	assert.Equal(t, int64(10), res.DeletedRows)
	var remaining int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Where("task_id = ?", taskID).Count(&remaining).Error)
	assert.Equal(t, int64(0), remaining)
}

func TestPurgeTerminalRunEvents_NegativeKeepTailErrors(t *testing.T) {
	db := setupSQLite(t)
	_, err := PurgeTerminalRunEvents(db, time.Now(), -1)
	require.Error(t, err)
}
