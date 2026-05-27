package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/ws"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

func newMockDBAgent(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, *sql.DB) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(
		sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(
			func(expectedSQL, actualSQL string) error {
				if strings.Contains(actualSQL, expectedSQL) {
					return nil
				}
				return fmt.Errorf("expected SQL to contain %q, but got %q", expectedSQL, actualSQL)
			},
		)),
	)
	require.NoError(t, err)
	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		SkipDefaultTransaction: true,
		PrepareStmt:            false,
	})
	require.NoError(t, err)
	return gormDB, mock, sqlDB
}

type mockAgentCache struct {
	routeID        string
	deviceRoutes   map[string]string
	pushedUser     string
	pushed         []string
	pushedTarget   []string
	pushedDeviceID string
	pushedTargetID string
}

func (m *mockAgentCache) GetRoute(ctx context.Context, userID, deviceType string) (string, error) {
	return m.routeID, nil
}

func (m *mockAgentCache) GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error) {
	if m.deviceRoutes == nil {
		return "", gorm.ErrRecordNotFound
	}
	connID, ok := m.deviceRoutes[userID+"|"+deviceType+"|"+deviceID]
	if !ok {
		return "", gorm.ErrRecordNotFound
	}
	return connID, nil
}

func (m *mockAgentCache) PushPendingTask(ctx context.Context, userID, taskJSON string) error {
	m.pushedUser = userID
	m.pushed = append(m.pushed, taskJSON)
	return nil
}

func (m *mockAgentCache) PushPendingTargetTask(ctx context.Context, userID, targetID, deviceID, taskJSON string) error {
	m.pushedUser = userID
	m.pushedTargetID = targetID
	m.pushedDeviceID = deviceID
	m.pushedTarget = append(m.pushedTarget, taskJSON)
	return nil
}

func (m *mockAgentCache) AllocateSeq(ctx context.Context, sessionID string) (int64, error) {
	return 0, nil
}

const (
	sqlmTaskByID   = `FROM "pending_agent_tasks" WHERE id =`
	sqlmAgentByID  = `FROM "agent_instances" WHERE id =`
	sqlmUpdateTask = `UPDATE "pending_agent_tasks" SET`
)

func TestPromptFromMessage_TextPayload(t *testing.T) {
	msg := &model.Message{
		ContentType: model.ContentTypeText,
		Content:     `{"text":"Run real Codex against this repo"}`,
	}

	require.Equal(t, "Run real Codex against this repo", promptFromMessage(msg))
}

func TestDispatchTaskIncludesPrompt(t *testing.T) {
	db, _, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "claude-code",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Claude",
	}

	svc.dispatchTask(context.Background(), task, agent, "Run the real runtime", `{"model":"claude-sonnet-4-6"}`)

	require.Equal(t, "user-1", cache.pushedUser)
	require.Len(t, cache.pushed, 1)
	var payload dispatchPayload
	require.NoError(t, json.Unmarshal([]byte(cache.pushed[0]), &payload))
	require.Equal(t, "Run the real runtime", payload.Prompt)
	require.Equal(t, "claude-code", payload.AgentType)
	require.Equal(t, `{"model":"claude-sonnet-4-6"}`, payload.ModelParams)
	require.Equal(t, "sess-1", payload.SessionID)
}

func TestDispatchTaskIncludesTargetID(t *testing.T) {
	db, _, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		TargetID:          "target-1",
		EdgeDeviceID:      "dev-1",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchTask(context.Background(), task, agent, "Run the selected target", "")

	require.Equal(t, "user-1", cache.pushedUser)
	require.Len(t, cache.pushedTarget, 1)
	var payload dispatchPayload
	require.NoError(t, json.Unmarshal([]byte(cache.pushedTarget[0]), &payload))
	require.Equal(t, "target-1", payload.TargetID)
}

func TestDispatchTaskIncludesTeamRunContext(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	for _, ddl := range []string{
		`CREATE TABLE custom_agents (
			id TEXT PRIMARY KEY,
			owner_user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			avatar_url TEXT DEFAULT '',
			agent_type TEXT NOT NULL,
			system_prompt TEXT NOT NULL,
			capability_tags TEXT DEFAULT '[]',
			tool_whitelist TEXT DEFAULT '[]',
			model_params TEXT DEFAULT '{}',
			deleted_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_teams (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			avatar_url TEXT DEFAULT '',
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_members (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			agent_profile_id TEXT,
			role TEXT NOT NULL,
			position INTEGER DEFAULT 0,
			created_at DATETIME
		)`,
		`CREATE TABLE agent_team_runs (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			session_id TEXT NOT NULL,
			trigger_user_id TEXT NOT NULL,
			trigger_message TEXT DEFAULT '',
			status TEXT NOT NULL,
			created_at DATETIME,
			updated_at DATETIME
		)`,
	} {
		require.NoError(t, db.Exec(ddl).Error)
	}
	now := time.Now()
	require.NoError(t, db.Exec(`INSERT INTO custom_agents (id, owner_user_id, name, agent_type, system_prompt, capability_tags, tool_whitelist, model_params, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"profile-supervisor", "user-1", "Supervisor", "claude-code", "Coordinate the team", "[]", "[]", `{"model":"claude-sonnet-4-6"}`, now, now).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_teams (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		"team-1", "user-1", "Backend Team", now, now).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_team_members (id, team_id, agent_profile_id, role, position, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"member-supervisor", "team-1", "profile-supervisor", model.TeamMemberRoleSupervisor, 0, now).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_team_runs (id, team_id, session_id, trigger_user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"run-team-1", "team-1", "sess-1", "user-1", model.TeamRunStatusRunning, now, now).Error)

	profileID := "profile-supervisor"
	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "claude-code",
		CustomAgentID: &profileID,
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Supervisor",
	}

	svc.dispatchTask(context.Background(), task, agent, "Route this team run", "")

	require.Len(t, cache.pushed, 1)
	var payload dispatchPayload
	require.NoError(t, json.Unmarshal([]byte(cache.pushed[0]), &payload))
	require.Equal(t, "team-1", payload.TeamID)
	require.Equal(t, "run-team-1", payload.TeamRunID)
	require.Equal(t, "member-supervisor", payload.TeamMemberID)
	require.Equal(t, model.TeamMemberRoleSupervisor, payload.TeamMemberRole)
	require.Equal(t, "profile-supervisor", payload.CustomAgentID)
	require.JSONEq(t, `{"model":"claude-sonnet-4-6"}`, payload.ModelParams)
}

func TestDispatchTaskWithTargetIDButNoDeviceFailsClosed(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	mgr := ws.NewManager()
	connA := ws.NewConn(nil)
	require.NoError(t, mgr.Register(connA))
	mgr.SetAuth(connA.ID, "user-1", "desktop", "dev-a")

	cache := &mockAgentCache{routeID: connA.ID}
	svc := &AgentService{db: db, mgr: mgr, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-target-no-device",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		TargetID:          "target-no-device",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchTask(context.Background(), task, agent, "Run invalid target", "")

	select {
	case <-connA.Send:
		t.Fatal("target task without edge device fell back to online desktop")
	default:
	}
	require.Empty(t, cache.pushed)
	require.Empty(t, cache.pushedTarget)
}

func TestDispatchTaskDoesNotPushWhenDispatchedStateMissing(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	mgr := ws.NewManager()
	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-1", "desktop", "dev-a")

	cache := &mockAgentCache{routeID: conn.ID}
	svc := &AgentService{db: db, mgr: mgr, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "missing-dispatch-task",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchTask(context.Background(), task, agent, "Run missing task", "")

	select {
	case <-conn.Send:
		t.Fatal("dispatch was pushed before task dispatch state was persisted")
	case <-time.After(100 * time.Millisecond):
	}
}

func TestDispatchTaskRoutesTargetBoundTaskToBoundDevice(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, target_id, status, edge_device_id, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-target", "agent-1", "user-1", "msg-1", "target-dev-b", model.TaskStatusQueued, "dev-b", "2030-01-01T00:00:00Z").Error)

	mgr := ws.NewManager()
	connA := ws.NewConn(nil)
	connB := ws.NewConn(nil)
	require.NoError(t, mgr.Register(connA))
	require.NoError(t, mgr.Register(connB))
	mgr.SetAuth(connA.ID, "user-1", "desktop", "dev-a")
	mgr.SetAuth(connB.ID, "user-1", "desktop", "dev-b")

	cache := &mockAgentCache{
		routeID: connA.ID,
		deviceRoutes: map[string]string{
			"user-1|desktop|dev-b": connB.ID,
		},
	}
	svc := &AgentService{db: db, mgr: mgr, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-target",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		TargetID:          "target-dev-b",
		EdgeDeviceID:      "dev-b",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchTask(context.Background(), task, agent, "Run on B", "")

	select {
	case data := <-connB.Send:
		var frame struct {
			Type    string          `json:"type"`
			Payload dispatchPayload `json:"payload"`
		}
		require.NoError(t, json.Unmarshal(data, &frame))
		require.Equal(t, ws.TypeAgentDispatch, frame.Type)
		require.Equal(t, "target-dev-b", frame.Payload.TargetID)
	default:
		t.Fatal("target-bound dispatch was not sent to device B")
	}
	select {
	case <-connA.Send:
		t.Fatal("target-bound dispatch fell back to device A")
	default:
	}

	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", "task-target").First(&stored).Error)
	require.Equal(t, model.TaskStatusDispatched, stored.Status)
	require.Equal(t, "dev-b", stored.EdgeDeviceID)
	require.Empty(t, cache.pushedTarget)
}

func TestDispatchTaskDoesNotPushTargetWhenDispatchedStateMissing(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	mgr := ws.NewManager()
	connB := ws.NewConn(nil)
	require.NoError(t, mgr.Register(connB))
	mgr.SetAuth(connB.ID, "user-1", "desktop", "dev-b")

	cache := &mockAgentCache{
		deviceRoutes: map[string]string{
			"user-1|desktop|dev-b": connB.ID,
		},
	}
	svc := &AgentService{db: db, mgr: mgr, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "missing-target-dispatch-task",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		TargetID:          "target-dev-b",
		EdgeDeviceID:      "dev-b",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchTask(context.Background(), task, agent, "Run missing target task", "")

	select {
	case <-connB.Send:
		t.Fatal("target dispatch was pushed before task dispatch state was persisted")
	case <-time.After(100 * time.Millisecond):
	}
}

func TestDispatchTaskQueuesTargetBoundTaskWhenBoundDeviceOffline(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	mgr := ws.NewManager()
	connA := ws.NewConn(nil)
	require.NoError(t, mgr.Register(connA))
	mgr.SetAuth(connA.ID, "user-1", "desktop", "dev-a")

	cache := &mockAgentCache{routeID: connA.ID}
	svc := &AgentService{db: db, mgr: mgr, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-target-offline",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		TargetID:          "target-dev-b",
		EdgeDeviceID:      "dev-b",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchTask(context.Background(), task, agent, "Run on offline B", "")

	select {
	case <-connA.Send:
		t.Fatal("target-bound dispatch fell back to online device A")
	default:
	}
	require.Empty(t, cache.pushed)
	require.Len(t, cache.pushedTarget, 1)
	require.Equal(t, "target-dev-b", cache.pushedTargetID)
	require.Equal(t, "dev-b", cache.pushedDeviceID)
}

func TestMergeModelParamsLetsDispatchOverrideProfileDefaults(t *testing.T) {
	merged := mergeModelParams(
		`{"model":"claude-sonnet-4-6","reasoning_effort":"medium","permission_mode":"default"}`,
		`{"reasoning_effort":"high","work_dir":"D:\\Code\\TokenDance"}`,
	)

	var got map[string]any
	require.NoError(t, json.Unmarshal([]byte(merged), &got))
	require.Equal(t, "claude-sonnet-4-6", got["model"])
	require.Equal(t, "high", got["reasoning_effort"])
	require.Equal(t, "default", got["permission_mode"])
	require.Equal(t, `D:\Code\TokenDance`, got["work_dir"])
}

func TestSelectAgentInstanceHonorsRequestedRuntime(t *testing.T) {
	agents := []model.AgentInstance{
		{ID: "agent-claude", AgentType: "claude-code"},
		{ID: "agent-codex", AgentType: "codex"},
		{ID: "agent-opencode", AgentType: "opencode"},
	}

	selected, err := selectAgentInstance(agents, "", "codex", "")

	require.NoError(t, err)
	require.Equal(t, "agent-codex", selected.ID)
}

func TestSelectAgentInstanceRejectsMissingRequestedRuntime(t *testing.T) {
	agents := []model.AgentInstance{
		{ID: "agent-claude", AgentType: "claude-code"},
	}

	_, err := selectAgentInstance(agents, "", "opencode", "")

	require.ErrorIs(t, err, errcode.AgentNotFound)
}

// ==================== CancelTask ====================

func TestCancelTask_AtomicFailClosed(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	bus := newTestBus(t)
	svc := &AgentService{db: db, bus: bus}

	taskID := "task-cancel-atomic"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.CancelTask(context.Background(), "user-1", taskID)
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestCancelTask_AlreadyTerminal(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	bus := newTestBus(t)
	svc := &AgentService{db: db, bus: bus}

	taskID := "task-done"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDone))

	err := svc.CancelTask(context.Background(), "user-1", taskID)
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== HandleTaskAck ====================

func TestHandleTaskAck_DispatchedToRunningAtomic(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-ack"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDispatched, "dev-1", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-001")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_AlreadyRunningIdempotent(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-already-running"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	// Already running with edgeRunID set → idempotent, no DB update needed.
	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-001")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_EdgeRunIDBackfill(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-backfill"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(`UPDATE "pending_agent_tasks" SET "edge_run_id"`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-002")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_EdgeRunIDBackfillConflictAcceptsSameRunID(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-backfill-same-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(`UPDATE "pending_agent_tasks" SET "edge_run_id"`).
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-002"))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-002")
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_EdgeRunIDBackfillConflictRejectsMismatch(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-backfill-mismatch-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(`UPDATE "pending_agent_tasks" SET "edge_run_id"`).
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-other"))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-002")
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAckRejectsOversizedEdgeRunID(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", "task-ack", strings.Repeat("x", 129))
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskStream_DispatchedTransitionConflictDoesNotPersist(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	bus := newTestBus(t)
	streamEvents := make(chan Event, 1)
	bus.Subscribe(ws.TypeAgentStream, func(ctx context.Context, event Event) {
		streamEvents <- event
	})
	svc := &AgentService{db: db, bus: bus, cacheClient: &mockAgentCache{}}

	taskID := "task-stream-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDispatched, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "codex", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDone, "dev-1", "run-001"))

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", taskID, "run-001", model.AgentRunEventInput{
		Payload: json.RawMessage(`{"type":"run.output.batch","content":"hello"}`),
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	select {
	case <-streamEvents:
		t.Fatal("agent.stream was published after dispatched transition conflict")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

// ==================== HandleTaskDone ====================

func TestHandleTaskDone_AtomicTransition(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	bus := newTestBus(t)
	svc := &AgentService{db: db, bus: bus}

	taskID := "task-done-atomic"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectBegin()
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskDone_AtomicConflictDoesNotPublish(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	bus := newTestBus(t)
	doneEvents := make(chan Event, 1)
	bus.Subscribe("agent.done", func(ctx context.Context, event Event) {
		doneEvents <- event
	})
	svc := &AgentService{db: db, bus: bus}

	taskID := "task-done-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectBegin()
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "")
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	select {
	case <-doneEvents:
		t.Fatal("agent.done was published after atomic update conflict")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

// ==================== HandleTaskFail ====================

func TestHandleTaskFail_AtomicTransition(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	bus := newTestBus(t)
	svc := &AgentService{db: db, bus: bus}

	taskID := "task-fail-atomic"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", taskID, "run-001", "model error")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskFail_AtomicConflictDoesNotPublish(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	bus := newTestBus(t)
	failedEvents := make(chan Event, 1)
	bus.Subscribe("agent.failed", func(ctx context.Context, event Event) {
		failedEvents <- event
	})
	svc := &AgentService{db: db, bus: bus}

	taskID := "task-fail-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 0))

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", taskID, "run-001", "model error")
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	select {
	case <-failedEvents:
		t.Fatal("agent.failed was published after atomic update conflict")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskFail_AlreadyTerminal(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-already-done"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDone, "dev-1", "run-001"))

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", taskID, "run-001", "error")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== #109: lifecycle enforcement ====================

func TestHandleTaskDone_RejectsQueuedTask(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-queued"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued, "dev-1", "run-001"))

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "final")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskFail_RejectsQueuedTask(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-queued-fail"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued, "dev-1", "run-001"))

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", taskID, "run-001", "error")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskDone_AcceptsDispatchedTask(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	bus := newTestBus(t)
	svc := &AgentService{db: db, bus: bus}

	taskID := "task-dispatched-done"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDispatched, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectBegin()
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== #99: offline-replayed tasks ====================

func TestHandleTaskAck_QueuedToRunning(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-queued-ack"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued, "dev-1", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	// queued → running (offline-replayed task)
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-001")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_QueuedOfflineReplayTransitionsToRunning(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	task := &model.PendingAgentTask{
		ID:                "task-queued-ack-real",
		AgentInstanceID:   "agent-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		Status:            model.TaskStatusQueued,
		EdgeDeviceID:      "dev-1",
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(task).Error)
	svc := &AgentService{db: db}

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", task.ID, "run-queued")

	require.NoError(t, err)
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, model.TaskStatusRunning, stored.Status)
	require.Equal(t, "run-queued", stored.EdgeRunID)
}

// ==================== B5: #116 reject agent tasks for dissolved sessions ====================

func TestTriggerAgentTask_RejectsDissolvedSession(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	triggerMsgID := "trigger-msg-dissolved"

	// GetMessageByID
	mock.ExpectQuery(`FROM "messages" WHERE id =`).
		WithArgs(triggerMsgID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "sender_type", "sender_id", "content_type", "content", "seq_id", "client_msg_id"}).
			AddRow(triggerMsgID, "session-dissolved", "user", "user-1", "text", `{"text":"hello"}`, int64(1), "client-1"))

	// GetSessionByID returns dissolved session
	mock.ExpectQuery(`FROM "sessions" WHERE id =`).
		WithArgs("session-dissolved", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("session-dissolved", "group", true, "owner-1"))

	svc := &AgentService{db: db}
	_, err := svc.TriggerAgentTask(context.Background(), "user-1", triggerMsgID, "", "", "", "", "")
	require.ErrorIs(t, err, errcode.SessionDissolved)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestTriggerAgentTaskRejectsTargetOwnedByAnotherUser(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	svc := &AgentService{db: db, cacheClient: &mockAgentCache{}}

	_, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-other")

	require.ErrorIs(t, err, errcode.TargetNotFound)
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
	require.Equal(t, int64(0), count)
}

func TestTriggerAgentTaskRejectsTargetWithoutBoundDevice(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, name, target_type, workspace_allowlist, trust_level, health_state, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-no-device", "user-1", "Local workstation", "local_edge", `["/workspace"]`, "local", "healthy", "{}", "{}").Error)
	svc := &AgentService{db: db, cacheClient: &mockAgentCache{}}

	_, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-no-device")

	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
	require.Equal(t, int64(0), count)
}

func TestTriggerAgentTaskStoresAndDispatchesOwnedTarget(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO devices (id, user_id, device_type, app_version, capabilities, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"dev-target", "user-1", "desktop", "0.1.0", "[]", "2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z").Error)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, device_id, name, target_type, workspace_allowlist, trust_level, health_state, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-local", "user-1", "dev-target", "Local workstation", "local_edge", `["/workspace"]`, "local", "healthy", "{}", "{}").Error)
	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}

	task, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-local")

	require.NoError(t, err)
	require.Equal(t, "target-local", task.TargetID)
	require.Equal(t, "dev-target", task.EdgeDeviceID)
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, "target-local", stored.TargetID)
	require.Equal(t, "dev-target", stored.EdgeDeviceID)
	require.Eventually(t, func() bool {
		return len(cache.pushedTarget) == 1
	}, time.Second, 10*time.Millisecond)
	var payload dispatchPayload
	require.NoError(t, json.Unmarshal([]byte(cache.pushedTarget[0]), &payload))
	require.Equal(t, "target-local", payload.TargetID)
}

func TestTriggerAgentTaskPrebindsOwnedTargetDevice(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO devices (id, user_id, device_type, app_version, capabilities, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"dev-local", "user-1", "desktop", "0.1.0", "[]", "2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z").Error)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, device_id, name, target_type, workspace_allowlist, trust_level, health_state, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-local-device", "user-1", "dev-local", "Local workstation", "local_edge", `["/workspace"]`, "local", "healthy", "{}", "{}").Error)
	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}

	task, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-local-device")

	require.NoError(t, err)
	require.Equal(t, "target-local-device", task.TargetID)
	require.Equal(t, "dev-local", task.EdgeDeviceID)
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, "dev-local", stored.EdgeDeviceID)
}

func newAgentTaskTargetContractDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	for _, ddl := range []string{
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			dissolved BOOLEAN DEFAULT FALSE,
			owner_user_id TEXT
		)`,
		`CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			sender_type TEXT NOT NULL,
			sender_id TEXT NOT NULL,
			content_type TEXT NOT NULL,
			content TEXT NOT NULL,
			seq_id INTEGER NOT NULL,
			client_msg_id TEXT NOT NULL
		)`,
		`CREATE TABLE session_members (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			member_type TEXT NOT NULL,
			member_id TEXT NOT NULL,
			role TEXT NOT NULL,
			left_at DATETIME
		)`,
		`CREATE TABLE agent_instances (
			id TEXT PRIMARY KEY,
			agent_type TEXT NOT NULL,
			custom_agent_id TEXT,
			session_id TEXT NOT NULL,
			inviter_user_id TEXT NOT NULL,
			display_name TEXT NOT NULL
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
			created_at DATETIME,
			dispatched_at DATETIME,
			finished_at DATETIME,
			expire_at DATETIME NOT NULL
		)`,
		`CREATE TABLE devices (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			device_type TEXT NOT NULL,
			app_version TEXT DEFAULT '',
			capabilities TEXT DEFAULT '[]',
			last_active_at DATETIME,
			created_at DATETIME
		)`,
		`CREATE TABLE execution_targets (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			device_id TEXT,
			name TEXT NOT NULL,
			target_type TEXT NOT NULL DEFAULT 'local_edge',
			workspace_allowlist TEXT DEFAULT '[]',
			trust_level TEXT DEFAULT 'local',
			health_state TEXT DEFAULT 'unknown',
			capabilities TEXT DEFAULT '{}',
			metadata TEXT DEFAULT '{}',
			deleted_at DATETIME
		)`,
	} {
		require.NoError(t, db.Exec(ddl).Error)
	}
	require.NoError(t, db.Exec(`INSERT INTO sessions (id, type, dissolved, owner_user_id) VALUES (?, ?, ?, ?)`, "sess-1", model.SessionTypeGroup, false, "user-1").Error)
	require.NoError(t, db.Exec(`INSERT INTO messages (id, session_id, sender_type, sender_id, content_type, content, seq_id, client_msg_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"msg-1", "sess-1", model.SenderTypeUser, "user-1", model.ContentTypeText, `{"text":"run"}`, int64(1), "client-1").Error)
	require.NoError(t, db.Exec(`INSERT INTO session_members (id, session_id, member_type, member_id, role) VALUES (?, ?, ?, ?, ?)`,
		"member-1", "sess-1", model.MemberTypeUser, "user-1", model.MemberRoleMember).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name) VALUES (?, ?, ?, ?, ?)`,
		"agent-1", "codex", "sess-1", "user-1", "Codex").Error)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, name, target_type, workspace_allowlist, trust_level, health_state, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-other", "other-user", "Other target", "local_edge", `["/workspace"]`, "local", "unknown", "{}", "{}").Error)
	return db
}
