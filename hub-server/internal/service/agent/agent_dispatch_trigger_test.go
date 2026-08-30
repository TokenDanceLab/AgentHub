package agent

import (
	"context"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// agent_dispatch_trigger_test.go covers the DB-backed success path and key
// error paths for DispatchService.TriggerAgentTask (audit T-M1, the highest
// remaining ROI coverage gap from the 2026-07-29 comprehensive audit).
//
// The success path asserts the real TriggerAgentTask orchestration against an
// in-memory SQLite DB: message lookup → session dissolved check → inviter
// agent list → agent selection → member-active check → (empty targetID skips
// validateDispatchTarget) → NewQueuedPendingTask → CreatePendingTaskUnlessActive
// (#1430 per-agent_instance TurnInProgress gate) → returned task. The
// dispatch goroutine is allowed to run against nil ports; see the race note
// below.
//
// Error paths covered (each a subtest, no goroutine concern — they return
// before dispatchTask fires):
//   - dissolved session       → errcode.SessionDissolved  (#116)
//   - no agent instances       → errcode.AgentNotFound
//   - inactive member         → errcode.SessionNotMember
//   - message not found       → errcode.MsgNotFound
//
// Race note (#1430): TriggerAgentTask launches `go s.dispatchTask(...)` after
// CreatePendingTaskUnlessActive commits the pending_agent_task row
// synchronously. The success-path assertions read the committed DB row and
// the returned task — both are set before the goroutine starts, so the
// assertions are race-free without a sync primitive. The dispatch goroutine
// is nil-safe with the partial service constructed below: the nil outbox port
// returns ErrOutboxUnavailable (logged, continues with empty deliveryID), a
// dead AGENTHUB_EDGE_URL routes the unbound task to the mock cache offline
// queue (no status transition), and resolveDispatchTeamContext short-circuits
// to EmptyTeamContext because the agent has no CustomAgentID. The task
// therefore stays queued, which is also what makes the second-call
// TurnInProgress assertion deterministic.

// newTriggerAgentTaskDB opens an in-memory SQLite DB with the tables
// TriggerAgentTask touches on the trigger path. Explicit DDL (matching the
// newAgentTaskTargetContractDB pattern in agent_test.go) keeps DATETIME
// columns scannable into time.Time — AutoMigrate maps `type:timestamptz` to
// TEXT on sqlite, which the driver cannot scan back into time.Time.
// SetMaxOpenConns(1) serializes sqlite writes so the #1430 transactional lock
// (a no-op UpdateColumn on sqlite) plus the active-status check serialize
// concurrent triggers in-process, matching the production postgres FOR UPDATE
// semantics closely enough for the gate to fire.
func newTriggerAgentTaskDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	for _, ddl := range []string{
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			name TEXT,
			avatar_url TEXT,
			announcement TEXT,
			owner_user_id TEXT,
			workspace_id TEXT,
			next_seq INTEGER NOT NULL DEFAULT 0,
			last_message_at DATETIME,
			dissolved BOOLEAN NOT NULL DEFAULT FALSE,
			created_at DATETIME
		)`,
		`CREATE TABLE session_members (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			member_type TEXT NOT NULL,
			member_id TEXT NOT NULL,
			role TEXT NOT NULL,
			pinned BOOLEAN NOT NULL DEFAULT FALSE,
			archived BOOLEAN NOT NULL DEFAULT FALSE,
			muted BOOLEAN NOT NULL DEFAULT FALSE,
			last_read_seq INTEGER NOT NULL DEFAULT 0,
			joined_at DATETIME,
			left_at DATETIME
		)`,
		`CREATE TABLE agent_instances (
			id TEXT PRIMARY KEY,
			agent_type TEXT NOT NULL,
			custom_agent_id TEXT,
			session_id TEXT NOT NULL,
			inviter_user_id TEXT NOT NULL,
			workspace_id TEXT,
			display_name TEXT NOT NULL,
			created_at DATETIME
		)`,
		`CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			seq_id INTEGER NOT NULL,
			client_msg_id TEXT NOT NULL,
			sender_type TEXT NOT NULL,
			sender_id TEXT NOT NULL,
			content_type TEXT NOT NULL,
			content TEXT NOT NULL,
			reply_to_message_id TEXT,
			recalled BOOLEAN NOT NULL DEFAULT FALSE,
			edited BOOLEAN NOT NULL DEFAULT FALSE,
			edited_at DATETIME,
			created_at DATETIME
		)`,
		`CREATE TABLE pending_agent_tasks (
			id TEXT PRIMARY KEY,
			agent_instance_id TEXT NOT NULL,
			triggered_by_user_id TEXT NOT NULL,
			trigger_message_id TEXT NOT NULL,
			target_id TEXT,
			status TEXT NOT NULL,
			edge_run_id TEXT DEFAULT '',
			edge_device_id TEXT DEFAULT '',
			error_message TEXT DEFAULT '',
			model_params TEXT DEFAULT '{}',
			created_at DATETIME,
			dispatched_at DATETIME,
			finished_at DATETIME,
			expire_at DATETIME NOT NULL
		)`,
	} {
		require.NoError(t, db.Exec(ddl).Error)
	}
	return db
}

// seedSessionUserMessage seeds a live (not dissolved) group session, an active
// user SessionMember (left_at nil), and a text trigger message in that
// session. It does NOT seed an agent instance so callers can exercise the
// "no agents available" error path. Returns the userID, sessionID, and
// triggerMessageID needed to call TriggerAgentTask.
func seedSessionUserMessage(t *testing.T, db *gorm.DB) (userID, sessionID, triggerMessageID string) {
	t.Helper()
	userID = "00000000-0000-0000-0000-00000000a101"
	session := &model.Session{
		Type:        model.SessionTypeGroup,
		OwnerUserID: &userID,
	}
	require.NoError(t, db.Create(session).Error)
	sessionID = session.ID

	require.NoError(t, db.Create(&model.SessionMember{
		SessionID:  sessionID,
		MemberType: model.MemberTypeUser,
		MemberID:   userID,
		Role:       model.MemberRoleOwner,
	}).Error)

	msg := &model.Message{
		SessionID:   sessionID,
		SeqID:       1,
		ClientMsgID: "client-trigger-1",
		SenderType:  model.SenderTypeUser,
		SenderID:    userID,
		ContentType: model.ContentTypeText,
		Content:     `{"text":"run the agent"}`,
	}
	require.NoError(t, db.Create(msg).Error)
	triggerMessageID = msg.ID
	return userID, sessionID, triggerMessageID
}

// seedTriggerFixture seeds a live session + active user member + a trigger
// message + one AgentInstance invited by that user. Returns the four IDs
// needed to call TriggerAgentTask on the success path.
func seedTriggerFixture(t *testing.T, db *gorm.DB) (userID, sessionID, agentInstanceID, triggerMessageID string) {
	t.Helper()
	userID, sessionID, triggerMessageID = seedSessionUserMessage(t, db)
	agent := &model.AgentInstance{
		AgentType:     "claude-code",
		SessionID:     sessionID,
		InviterUserID: userID,
		DisplayName:   "Claude",
	}
	require.NoError(t, db.Create(agent).Error)
	agentInstanceID = agent.ID
	return userID, sessionID, agentInstanceID, triggerMessageID
}

// TestTriggerAgentTask_SuccessAndTurnInProgressGate is the T-M1 success path:
// empty targetID (skips validateDispatchTarget) returns a queued task whose
// row is committed synchronously, and a second trigger for the same
// agent_instance is rejected with errcode.TurnInProgress (HTTP 409) by the
// #1430 per-agent_instance gate.
func TestTriggerAgentTask_SuccessAndTurnInProgressGate(t *testing.T) {
	db := newTriggerAgentTaskDB(t)
	userID, _, agentInstanceID, triggerMessageID := seedTriggerFixture(t, db)

	cache := &mockAgentCache{}
	svc := &Service{db: db, cacheClient: cache}
	// Dead Edge URL so the dispatch goroutine's HTTP attempt fails fast and
	// falls through to the mock cache offline queue without a status
	// transition — this keeps the first task queued so the second trigger
	// deterministically hits the TurnInProgress gate.
	t.Setenv("AGENTHUB_EDGE_URL", "http://127.0.0.1:1")

	task, err := svc.TriggerAgentTask(context.Background(), userID, triggerMessageID, agentInstanceID, "", "", "", "")

	require.NoError(t, err)
	require.NotNil(t, task)
	require.Equal(t, agentInstanceID, task.AgentInstanceID, "returned task must target the seeded agent_instance")
	require.Equal(t, model.TaskStatusQueued, task.Status, "dispatch.NewQueuedPendingTask sets queued status")
	require.Equal(t, userID, task.TriggeredByUserID)
	require.Equal(t, triggerMessageID, task.TriggerMessageID)
	require.Empty(t, task.TargetID, "empty targetID skips validateDispatchTarget (no execution target)")
	require.Empty(t, task.EdgeDeviceID, "empty targetID yields no edge device binding")
	require.NotEmpty(t, task.ID, "BeforeCreate hook assigns a uuidv7 id")
	require.False(t, task.ExpireAt.IsZero(), "TTL injected by TriggerAgentTask")

	// The pending_agent_task row is committed synchronously by
	// CreatePendingTaskUnlessActive BEFORE `go s.dispatchTask(...)` fires, so
	// reading it here is race-free without syncing with the goroutine.
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, model.TaskStatusQueued, stored.Status, "persisted row must be non-terminal (queued)")
	require.Equal(t, agentInstanceID, stored.AgentInstanceID)
	require.Equal(t, userID, stored.TriggeredByUserID)
	require.Equal(t, triggerMessageID, stored.TriggerMessageID)

	// #1430: a second concurrent trigger for the same agent_instance must be
	// rejected with errcode.TurnInProgress (HTTP 409) while the first task is
	// non-terminal. The first task stays queued because the dead Edge URL +
	// mock cache route the dispatch to the offline queue without a status
	// transition, so FindActivePendingTaskByAgentInstance still observes it.
	secondTask, err := svc.TriggerAgentTask(context.Background(), userID, triggerMessageID, agentInstanceID, "", "", "", "")

	require.ErrorIs(t, err, errcode.TurnInProgress)
	require.Nil(t, secondTask, "rejected trigger must not return a task")

	// Anti-cheat: the gate must not create a duplicate row. The first task
	// remains the only pending_agent_tasks row for this agent_instance.
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").
		Where("agent_instance_id = ?", agentInstanceID).Count(&count).Error)
	require.Equal(t, int64(1), count, "TurnInProgress gate must not create a duplicate task")
}

// TestTriggerAgentTask_ErrorPaths covers the cheap error paths that return
// before dispatchTask fires (#116, #100). Each subtest builds its own
// in-memory DB so failures are isolated.
func TestTriggerAgentTask_ErrorPaths(t *testing.T) {
	t.Run("DissolvedSession_returnsSessionDissolved", func(t *testing.T) {
		// #116: reject new agent tasks for dissolved sessions.
		db := newTriggerAgentTaskDB(t)
		userID, sessionID, agentInstanceID, triggerMessageID := seedTriggerFixture(t, db)
		require.NoError(t, db.Model(&model.Session{}).
			Where("id = ?", sessionID).Update("dissolved", true).Error)

		svc := &Service{db: db, cacheClient: &mockAgentCache{}}
		task, err := svc.TriggerAgentTask(context.Background(), userID, triggerMessageID, agentInstanceID, "", "", "", "")

		require.ErrorIs(t, err, errcode.SessionDissolved)
		require.Nil(t, task)
		var count int64
		require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
		require.Equal(t, int64(0), count, "no task must be created for a dissolved session")
	})

	t.Run("NoAgentInstances_returnsAgentNotFound", func(t *testing.T) {
		// Inviter has no agent instances in the session → TriggerAgentsAvailableError
		// collapses the empty list into errcode.AgentNotFound.
		db := newTriggerAgentTaskDB(t)
		userID, _, triggerMessageID := seedSessionUserMessage(t, db)

		svc := &Service{db: db, cacheClient: &mockAgentCache{}}
		task, err := svc.TriggerAgentTask(context.Background(), userID, triggerMessageID, "", "", "", "", "")

		require.ErrorIs(t, err, errcode.AgentNotFound)
		require.Nil(t, task)
		var count int64
		require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
		require.Equal(t, int64(0), count, "no task must be created when no agent instances are available")
	})

	t.Run("InactiveMember_returnsSessionNotMember", func(t *testing.T) {
		// left_at set on the user member → IsMemberActive returns false →
		// TriggerMemberActiveError surfaces errcode.SessionNotMember. A lookup
		// failure must NOT be misread as inactive (audit T-M1 honest-error
		// guarantee, pinned by TestTriggerAgentTask_MemberActiveLookupErrorSurfaces).
		db := newTriggerAgentTaskDB(t)
		userID, sessionID, agentInstanceID, triggerMessageID := seedTriggerFixture(t, db)
		require.NoError(t, db.Model(&model.SessionMember{}).
			Where("session_id = ? AND member_type = ? AND member_id = ?", sessionID, model.MemberTypeUser, userID).
			Update("left_at", "2030-01-01T00:00:00Z").Error)

		svc := &Service{db: db, cacheClient: &mockAgentCache{}}
		task, err := svc.TriggerAgentTask(context.Background(), userID, triggerMessageID, agentInstanceID, "", "", "", "")

		require.ErrorIs(t, err, errcode.SessionNotMember)
		require.Nil(t, task)
		var count int64
		require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
		require.Equal(t, int64(0), count, "no task must be created for an inactive member")
	})

	t.Run("MessageNotFound_returnsMsgNotFound", func(t *testing.T) {
		// MapTriggerMessageLookupError collapses any GetMessageByID failure
		// (including gorm.ErrRecordNotFound) into errcode.MsgNotFound.
		db := newTriggerAgentTaskDB(t)
		userID, _, agentInstanceID, _ := seedTriggerFixture(t, db)

		svc := &Service{db: db, cacheClient: &mockAgentCache{}}
		task, err := svc.TriggerAgentTask(context.Background(), userID, "nonexistent-trigger-message-id", agentInstanceID, "", "", "", "")

		require.ErrorIs(t, err, errcode.MsgNotFound)
		require.Nil(t, task)
		var count int64
		require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
		assert.Equal(t, int64(0), count, "no task must be created when the trigger message is not found")
	})
}
