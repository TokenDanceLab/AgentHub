package dispatchsvc

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// A lookup failure that is not gorm.ErrRecordNotFound (here: a missing table,
// standing in for a DB outage) must surface unchanged instead of being
// reclassified as msg_not_found / session_not_found.
func TestTriggerAgentTaskSurfacesMessageLookupErrors(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	svc := &DispatchService{db: db}

	_, err = svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "", "", "", "")
	require.Error(t, err)
	require.NotErrorIs(t, err, errcode.MsgNotFound, "a DB error must not be reported as a missing message")
	require.Contains(t, err.Error(), "no such table")
}

func TestTriggerAgentTaskSurfacesSessionLookupErrors(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO messages (id, session_id) VALUES ('msg-1', 'session-1')`).Error)
	svc := &DispatchService{db: db}

	_, err = svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "", "", "", "")
	require.Error(t, err)
	require.NotErrorIs(t, err, errcode.SessionNotFound, "a DB error must not be reported as a missing session")
	require.Contains(t, err.Error(), "no such table")
}

// The custom-agent lookup is best-effort only for a missing row. Any other DB
// error must surface unchanged and must not create a queued task.
func TestTriggerAgentTaskSurfacesCustomAgentLookupErrors(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&model.Session{},
		&model.Message{},
		&model.AgentInstance{},
		&model.SessionMember{},
		&model.PendingAgentTask{},
	))

	const userID = "11111111-1111-1111-1111-111111111111"
	session := &model.Session{Type: model.SessionTypeGroup}
	require.NoError(t, db.Create(session).Error)
	msg := &model.Message{
		SessionID:   session.ID,
		SeqID:       1,
		ClientMsgID: "client-msg-1",
		SenderType:  model.SenderTypeUser,
		SenderID:    userID,
		ContentType: model.ContentTypeText,
		Content:     "{}",
	}
	require.NoError(t, db.Create(msg).Error)
	customAgentID := "custom-agent-1"
	agent := &model.AgentInstance{
		AgentType:     "codex",
		CustomAgentID: &customAgentID,
		SessionID:     session.ID,
		InviterUserID: userID,
		DisplayName:   "agent",
	}
	require.NoError(t, db.Create(agent).Error)
	require.NoError(t, db.Create(&model.SessionMember{
		SessionID:  session.ID,
		MemberType: model.MemberTypeUser,
		MemberID:   userID,
		Role:       model.MemberRoleOwner,
	}).Error)

	svc := &DispatchService{db: db}
	_, err = svc.TriggerAgentTask(context.Background(), userID, msg.ID, agent.ID, "", "", "", "")
	require.Error(t, err)
	require.NotErrorIs(t, err, errcode.MsgNotFound, "a DB error must not be reported as a missing custom agent")
	require.Contains(t, err.Error(), "no such table: custom_agents")

	var count int64
	require.NoError(t, db.Model(&model.PendingAgentTask{}).Count(&count).Error)
	require.Zero(t, count, "a failed custom-agent lookup must not queue a task")
}
