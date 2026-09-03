// Service-core tests (agent.go): AddAgentToSession, TimeoutExpiredTask and
// seq continuity recovery via allocateSeq.

package agent

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

func TestAddAgentToSessionReturnsCreatedInstance(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Session{}, &model.SessionMember{}, &model.AgentInstance{}))

	userID := "00000000-0000-0000-0000-00000000a101"
	session := &model.Session{
		Type:        model.SessionTypeGroup,
		OwnerUserID: &userID,
	}
	require.NoError(t, db.Create(session).Error)
	require.NoError(t, db.Create(&model.SessionMember{
		SessionID:   session.ID,
		MemberType:  model.MemberTypeUser,
		MemberID:    userID,
		Role:        model.MemberRoleOwner,
		LastReadSeq: 0,
	}).Error)

	svc := &Service{db: db}
	agent, err := svc.AddAgentToSession(context.Background(), userID, session.ID, "claude-code", "", "Hub Builder")

	require.NoError(t, err)
	require.NotNil(t, agent)
	require.NotEmpty(t, agent.ID)
	assert.Equal(t, "claude-code", agent.AgentType)
	assert.Equal(t, session.ID, agent.SessionID)
	assert.Equal(t, userID, agent.InviterUserID)
	assert.Equal(t, "Hub Builder", agent.DisplayName)

	var member model.SessionMember
	require.NoError(t, db.Where("session_id = ? AND member_type = ? AND member_id = ?", session.ID, model.MemberTypeAgent, agent.ID).First(&member).Error)
	assert.Equal(t, model.MemberRoleMember, member.Role)
}

func TestTimeoutExpiredTaskMarksScannedStatus(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	task := &model.PendingAgentTask{
		ID:                "task-timeout-running",
		AgentInstanceID:   "agent-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		Status:            model.TaskStatusRunning,
		EdgeDeviceID:      "dev-1",
		EdgeRunID:         "run-1",
		ExpireAt:          time.Now().Add(-time.Hour),
	}
	require.NoError(t, db.Create(task).Error)
	svc := &Service{db: db}

	timedOut, err := svc.TimeoutExpiredTask(task.ID, model.TaskStatusRunning)

	require.NoError(t, err)
	require.True(t, timedOut)
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, model.TaskStatusTimeout, stored.Status)
	require.NotNil(t, stored.FinishedAt)
}

func TestTimeoutExpiredTaskDoesNotOverwriteTerminalRace(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	task := &model.PendingAgentTask{
		ID:                "task-timeout-race",
		AgentInstanceID:   "agent-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		Status:            model.TaskStatusRunning,
		EdgeDeviceID:      "dev-1",
		EdgeRunID:         "run-1",
		ExpireAt:          time.Now().Add(-time.Hour),
	}
	require.NoError(t, db.Create(task).Error)
	finishedAt := time.Now()
	require.NoError(t, db.Model(&model.PendingAgentTask{}).
		Where("id = ?", task.ID).
		Updates(map[string]interface{}{"status": model.TaskStatusDone, "finished_at": &finishedAt}).Error)
	svc := &Service{db: db}

	timedOut, err := svc.TimeoutExpiredTask(task.ID, model.TaskStatusRunning)

	require.NoError(t, err)
	require.False(t, timedOut)
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, model.TaskStatusDone, stored.Status)
	require.NotNil(t, stored.FinishedAt)
}

func TestAllocateSeqRecoversFreshRedisKeyFromDB(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	// Redis key freshly recreated (INCR returns 1) while sessions.next_seq
	// already mirrors a higher value: allocation must recover continuity
	// instead of returning a colliding seq.
	mock.ExpectQuery(`SELECT next_seq FROM sessions`).
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(7))

	cache := &seqRecoveryCache{}
	svc := &Service{db: db, cacheClient: cache}

	seq, err := svc.allocateSeq(context.Background(), "sess-1")
	require.NoError(t, err)
	require.Equal(t, int64(8), seq)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestAllocateSeqFreshRedisKeyWithoutDBMirrorKeepsOne(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	// Fresh key but the DB mirror is empty (new session): seq 1 is correct.
	mock.ExpectQuery(`SELECT next_seq FROM sessions`).
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(0))

	cache := &seqRecoveryCache{}
	svc := &Service{db: db, cacheClient: cache}

	seq, err := svc.allocateSeq(context.Background(), "sess-1")
	require.NoError(t, err)
	require.Equal(t, int64(1), seq)
	require.NoError(t, mock.ExpectationsWereMet())
}
