//go:build integration

package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/agent"
	"github.com/agenthub/hub-server/internal/uuidv7"
)

func seedRetentionFixture(t *testing.T, status string, finishedAt *time.Time, eventCount int64) (taskID string) {
	t.Helper()
	user := &model.User{Username: "ret-" + uuidv7.Must(), Nickname: "ret"}
	require.NoError(t, repository.CreateUser(db, user))
	session := &model.Session{Type: model.SessionTypePrivate}
	require.NoError(t, db.Create(session).Error)
	require.NoError(t, repository.CreateSessionMember(db, &model.SessionMember{
		SessionID:  session.ID,
		MemberType: model.MemberTypeUser,
		MemberID:   user.ID,
		Role:       model.MemberRoleMember,
	}))
	msg := &model.Message{
		SessionID:   session.ID,
		SeqID:       1,
		ClientMsgID: uuidv7.Must(),
		SenderType:  model.SenderTypeUser,
		SenderID:    user.ID,
		ContentType: model.ContentTypeText,
		Content:     "{}",
	}
	require.NoError(t, repository.InsertMessage(db, msg))
	ai := &model.AgentInstance{AgentType: "ret-agent", SessionID: session.ID, InviterUserID: user.ID, DisplayName: "Ret"}
	require.NoError(t, repository.CreateAgentInstance(db, ai))
	task := &model.PendingAgentTask{
		AgentInstanceID:   ai.ID,
		TriggeredByUserID: user.ID,
		TriggerMessageID:  msg.ID,
		Status:            status,
		FinishedAt:        finishedAt,
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, repository.CreatePendingTask(db, task))
	for i := int64(1); i <= eventCount; i++ {
		require.NoError(t, db.Exec(`INSERT INTO agent_run_events (id, task_id, session_id, agent_instance_id, event_seq, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, 'run.output.batch', '{}', NOW())`,
			uuidv7.Must(), task.ID, session.ID, ai.ID, i).Error)
	}
	return task.ID
}

func TestAgentRunEventRetention_PurgesTerminalTail(t *testing.T) {
	CleanDB(t, db)
	now := time.Now().UTC()
	oldFinished := now.Add(-48 * time.Hour)
	recentFinished := now.Add(-1 * time.Hour)

	oldTermID := seedRetentionFixture(t, model.TaskStatusDone, &oldFinished, 800)
	runningID := seedRetentionFixture(t, model.TaskStatusRunning, nil, 800)
	recentTermID := seedRetentionFixture(t, model.TaskStatusFailed, &recentFinished, 800)

	cfg := agent.RetentionConfig{Window: 24 * time.Hour, KeepTail: 500}
	res, err := agent.RunEventsRetentionPass(t.Context(), db, cfg)
	require.NoError(t, err)
	assert.Equal(t, int64(300), res.DeletedRows, "only old terminal task should lose rows")
	assert.Equal(t, int64(1), res.AffectedTasks)

	countEvents := func(taskID string) int64 {
		var c int64
		require.NoError(t, db.Model(&model.AgentRunEvent{}).Where("task_id = ?", taskID).Count(&c).Error)
		return c
	}
	assert.Equal(t, int64(500), countEvents(oldTermID))
	var minSeq int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Where("task_id = ?", oldTermID).Select("MIN(event_seq)").Scan(&minSeq).Error)
	assert.Equal(t, int64(301), minSeq, "retained seqs should be 301..800")
	assert.Equal(t, int64(800), countEvents(runningID), "non-terminal must be untouched")
	assert.Equal(t, int64(800), countEvents(recentTermID), "in-window terminal must be untouched")
}

func TestAgentRunEventRetention_NonTerminalNegative(t *testing.T) {
	CleanDB(t, db)
	runningID := seedRetentionFixture(t, model.TaskStatusRunning, nil, 100)
	require.NoError(t, db.Exec(`UPDATE agent_run_events SET created_at = NOW() - INTERVAL '72 hours' WHERE task_id = ?`, runningID).Error)

	res, err := agent.RunEventsRetentionPass(t.Context(), db, agent.RetentionConfig{Window: 24 * time.Hour, KeepTail: 500})
	require.NoError(t, err)
	assert.Equal(t, int64(0), res.DeletedRows)
	assert.Equal(t, int64(0), res.AffectedTasks)

	var remaining int64
	require.NoError(t, db.Model(&model.AgentRunEvent{}).Where("task_id = ?", runningID).Count(&remaining).Error)
	assert.Equal(t, int64(100), remaining, "non-terminal events must survive regardless of age")
}
