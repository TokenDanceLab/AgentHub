package service

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestAgentTeamService_CreateTeam(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	mock.ExpectExec(`INSERT INTO "agent_teams"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	team, err := svc.CreateTeam(context.Background(), "user-1", "My Team", "A test team")
	require.NoError(t, err)
	assert.Equal(t, "My Team", team.Name)
	assert.Equal(t, "user-1", team.OwnerID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_CreateTeamEmptyName(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	_, err := svc.CreateTeam(context.Background(), "user-1", "", "desc")
	require.Error(t, err)
	assert.Equal(t, errcode.ErrBadRequest, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_GetTeam(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	rows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "desc", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(rows)

	team, err := svc.GetTeam(context.Background(), "user-1", "team-1")
	require.NoError(t, err)
	assert.Equal(t, "My Team", team.Name)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_GetTeamWrongOwner(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	rows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-2", "My Team", "desc", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(rows)

	_, err := svc.GetTeam(context.Background(), "user-1", "team-1")
	require.Error(t, err)
	assert.Equal(t, errcode.AgentNotFound, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_GetTeamNotFound(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnError(gorm.ErrRecordNotFound)

	_, err := svc.GetTeam(context.Background(), "user-1", "team-1")
	require.Error(t, err)
	assert.Equal(t, errcode.AgentNotFound, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_ListTeams(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	rows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "Team 1", "", "", time.Now(), time.Now()).
		AddRow("team-2", "user-1", "Team 2", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(rows)

	teams, err := svc.ListTeams(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Len(t, teams, 2)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_UpdateTeam(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team first
	rows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "Old Name", "old desc", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(rows)

	// Update
	mock.ExpectExec(`UPDATE "agent_teams"`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.UpdateTeam(context.Background(), "user-1", "team-1", "New Name", "new desc")
	require.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_UpdateTeamWrongOwner(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	rows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-2", "Old Name", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(rows)

	err := svc.UpdateTeam(context.Background(), "user-1", "team-1", "New Name", "")
	require.Error(t, err)
	assert.Equal(t, errcode.AgentNotFound, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_DeleteTeam(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team first
	rows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(rows)

	// Delete
	mock.ExpectExec(`DELETE FROM "agent_teams"`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.DeleteTeam(context.Background(), "user-1", "team-1")
	require.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_AddTeamMember(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team
	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	// Get agent profile
	agentRows := sqlmock.NewRows([]string{"id", "owner_user_id", "name", "avatar_url", "agent_type", "system_prompt", "capability_tags", "tool_whitelist", "model_params", "deleted_at", "created_at", "updated_at"}).
		AddRow("agent-1", "user-1", "Agent 1", "", "codex", "prompt", "[]", "[]", "{}", nil, time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "custom_agents"`).
		WillReturnRows(agentRows)

	// Add member
	mock.ExpectExec(`INSERT INTO "agent_team_members"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	err := svc.AddTeamMember(context.Background(), "user-1", "team-1", "agent-1", model.TeamMemberRoleExecutor)
	require.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_AddTeamMemberInvalidRole(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team
	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	// Get agent profile
	agentRows := sqlmock.NewRows([]string{"id", "owner_user_id", "name", "avatar_url", "agent_type", "system_prompt", "capability_tags", "tool_whitelist", "model_params", "deleted_at", "created_at", "updated_at"}).
		AddRow("agent-1", "user-1", "Agent 1", "", "codex", "prompt", "[]", "[]", "{}", nil, time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "custom_agents"`).
		WillReturnRows(agentRows)

	err := svc.AddTeamMember(context.Background(), "user-1", "team-1", "agent-1", "invalid_role")
	require.Error(t, err)
	assert.Equal(t, errcode.ErrBadRequest, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_RemoveTeamMember(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team
	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	// Get member
	memberRows := sqlmock.NewRows([]string{"id", "team_id", "agent_profile_id", "role", "position", "created_at"}).
		AddRow("member-1", "team-1", "agent-1", "executor", 0, time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_team_members"`).
		WillReturnRows(memberRows)

	// Remove member
	mock.ExpectExec(`DELETE FROM "agent_team_members"`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.RemoveTeamMember(context.Background(), "user-1", "team-1", "member-1")
	require.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_GetTeamWithMembers(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team
	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	// List members
	memberRows := sqlmock.NewRows([]string{"id", "team_id", "agent_profile_id", "role", "position", "created_at"}).
		AddRow("member-1", "team-1", "agent-1", "executor", 0, time.Now()).
		AddRow("member-2", "team-1", "agent-2", "supervisor", 1, time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_team_members"`).
		WillReturnRows(memberRows)

	detail, err := svc.GetTeamWithMembers(context.Background(), "user-1", "team-1")
	require.NoError(t, err)
	assert.Equal(t, "My Team", detail.Name)
	assert.Len(t, detail.Members, 2)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_GetTeamRun(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team
	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	// Get run
	runRows := sqlmock.NewRows([]string{"id", "team_id", "session_id", "trigger_user_id", "trigger_message", "status", "created_at", "updated_at"}).
		AddRow("run-1", "team-1", "session-1", "user-1", "hello", "completed", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_team_runs"`).
		WillReturnRows(runRows)

	run, err := svc.GetTeamRun(context.Background(), "user-1", "team-1", "run-1")
	require.NoError(t, err)
	assert.Equal(t, "completed", run.Status)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_GetTeamRunWrongTeam(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team
	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	// Get run (different team)
	runRows := sqlmock.NewRows([]string{"id", "team_id", "session_id", "trigger_user_id", "trigger_message", "status", "created_at", "updated_at"}).
		AddRow("run-1", "team-2", "session-2", "user-1", "hello", "completed", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_team_runs"`).
		WillReturnRows(runRows)

	_, err := svc.GetTeamRun(context.Background(), "user-1", "team-1", "run-1")
	require.Error(t, err)
	assert.Equal(t, errcode.AgentTaskNotFound, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_ListTeamRuns(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team
	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	// List runs
	runRows := sqlmock.NewRows([]string{"id", "team_id", "session_id", "trigger_user_id", "trigger_message", "status", "created_at", "updated_at"}).
		AddRow("run-1", "team-1", "session-1", "user-1", "msg1", "completed", time.Now(), time.Now()).
		AddRow("run-2", "team-1", "session-2", "user-1", "msg2", "running", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_team_runs"`).
		WillReturnRows(runRows)

	runs, err := svc.ListTeamRuns(context.Background(), "user-1", "team-1")
	require.NoError(t, err)
	assert.Len(t, runs, 2)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// newMockAgentTeamDB creates a sqlmock-backed gorm.DB for agent team tests.
func newMockAgentTeamDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, _ := newMockDBAgent(t)
	return db, mock
}

// mockAgentTeamAgentSvc implements agentTeamAgentSvc for tests.
type mockAgentTeamAgentSvc struct{}

func (m *mockAgentTeamAgentSvc) AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) error {
	return nil
}

func (m *mockAgentTeamAgentSvc) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	return &model.PendingAgentTask{ID: "task-1"}, nil
}

// --- StartTeamRun tests ---

func TestAgentTeamService_StartTeamRun_TeamNotFound(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnError(gorm.ErrRecordNotFound)

	_, err := svc.StartTeamRun(context.Background(), "user-1", "team-1", "hello")
	require.Error(t, err)
	assert.Equal(t, errcode.AgentNotFound, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_StartTeamRun_EmptyMembers(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team
	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	// List members (empty)
	mock.ExpectQuery(`SELECT * FROM "agent_team_members"`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "team_id", "agent_profile_id", "role", "position", "created_at"}))

	_, err := svc.StartTeamRun(context.Background(), "user-1", "team-1", "hello")
	require.Error(t, err)
	assert.Equal(t, errcode.ErrBadRequest, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_StartTeamRun_Success(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	agentSvc := &mockAgentTeamAgentSvc{}
	svc := NewAgentTeamService(db, agentSvc, nil)

	now := time.Now()
	agentProfileID := "agent-1"

	// Get team
	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "desc", "", now, now)
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	// List members (one supervisor)
	memberRows := sqlmock.NewRows([]string{"id", "team_id", "agent_profile_id", "role", "position", "created_at"}).
		AddRow("member-1", "team-1", agentProfileID, "supervisor", 0, now)
	mock.ExpectQuery(`SELECT * FROM "agent_team_members"`).
		WillReturnRows(memberRows)

	// Transaction: Begin
	mock.ExpectBegin()

	// CreateSession
	mock.ExpectExec(`INSERT INTO "sessions"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// CreateSessionMember (owner)
	mock.ExpectExec(`INSERT INTO "session_members"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Batch query custom agents
	agentRows := sqlmock.NewRows([]string{"id", "owner_user_id", "name", "avatar_url", "agent_type", "system_prompt", "capability_tags", "tool_whitelist", "model_params", "deleted_at", "created_at", "updated_at"}).
		AddRow("agent-1", "user-1", "My Agent", "", "codex", "prompt", "[]", "[]", "{}", nil, now, now)
	mock.ExpectQuery(`SELECT * FROM "custom_agents" WHERE id IN`).
		WillReturnRows(agentRows)

	// CreateAgentInstance
	mock.ExpectExec(`INSERT INTO "agent_instances"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// CreateSessionMember (agent)
	mock.ExpectExec(`INSERT INTO "session_members"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// AllocateSeqID (UPDATE ... RETURNING next_seq)
	mock.ExpectQuery(`UPDATE sessions SET next_seq`).
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(1))

	// InsertMessage
	mock.ExpectExec(`INSERT INTO "messages"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// CreateTeamRun
	mock.ExpectExec(`INSERT INTO "agent_team_runs"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Transaction: Commit
	mock.ExpectCommit()

	run, err := svc.StartTeamRun(context.Background(), "user-1", "team-1", "hello")
	require.NoError(t, err)
	assert.NotNil(t, run)
	assert.Equal(t, "team-1", run.TeamID)
	assert.Equal(t, model.TeamRunStatusRunning, run.Status)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_GetTeamRunStateReplaysEvents(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "State Team"}
	require.NoError(t, repository.CreateTeam(db, team))

	supervisorProfileID := "profile-supervisor"
	executorProfileID := "profile-executor"
	supervisor := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: &supervisorProfileID,
		Role:           model.TeamMemberRoleSupervisor,
	}
	executor := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: &executorProfileID,
		Role:           model.TeamMemberRoleExecutor,
	}
	require.NoError(t, repository.AddTeamMember(db, supervisor))
	require.NoError(t, repository.AddTeamMember(db, executor))

	run := &model.AgentTeamRun{
		TeamID:         team.ID,
		SessionID:      "session-1",
		TriggerUserID:  "user-1",
		TriggerMessage: "ship it",
		Status:         model.TeamRunStatusRunning,
	}
	require.NoError(t, repository.CreateTeamRun(db, run))

	assignment := &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: supervisor.ID,
		ToMemberID:   executor.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "Implement replay",
		Status:       model.AssignmentStatusDone,
		Result:       "done",
		Depth:        1,
		RunID:        stringPtr("edge-run-1"),
	}
	require.NoError(t, repository.CreateAssignment(db, assignment))

	require.NoError(t, repository.AppendTeamEvent(db, &model.AgentTeamEvent{
		TeamRunID: run.ID,
		Type:      model.TeamEventRunStarted,
		Payload:   `{"status":"running"}`,
	}))
	require.NoError(t, repository.AppendTeamEvent(db, &model.AgentTeamEvent{
		TeamRunID: run.ID,
		Type:      model.TeamEventRouteDecided,
		Payload:   `{"action":"delegate","next_worker":"` + executor.ID + `","instructions":"Implement replay","reasoning":"needs executor"}`,
	}))
	require.NoError(t, repository.AppendTeamEvent(db, &model.AgentTeamEvent{
		TeamRunID: run.ID,
		Type:      model.TeamEventRunCompleted,
		Payload:   `{"summary":"done"}`,
	}))

	state, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	assert.Equal(t, run.ID, state.RunID)
	assert.Equal(t, team.ID, state.TeamID)
	assert.Equal(t, model.TeamRunStatusCompleted, state.Status)
	assert.Equal(t, "done", state.TerminalReason)
	require.Len(t, state.Members, 2)
	assert.Equal(t, 1, state.Members[1].CompletedTasks)
	require.Len(t, state.Assignments, 1)
	assert.Equal(t, assignment.ID, state.Assignments[0].AssignmentID)
	assert.Equal(t, "edge-run-1", state.Assignments[0].RunID)
	require.Len(t, state.RouteLog, 1)
	assert.Equal(t, "delegate", state.RouteLog[0].Action)
	assert.Equal(t, executor.ID, state.RouteLog[0].NextWorker)
}

func setupAgentTeamStateSQLite(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	tables := []string{
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
			role TEXT NOT NULL DEFAULT 'executor',
			position INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME
		)`,
		`CREATE TABLE agent_team_runs (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			session_id TEXT,
			trigger_user_id TEXT NOT NULL,
			trigger_message TEXT DEFAULT '',
			status TEXT NOT NULL DEFAULT 'queued',
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_assignments (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			from_member_id TEXT NOT NULL,
			to_member_id TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'delegate',
			task_prompt TEXT NOT NULL,
			context TEXT DEFAULT '',
			status TEXT NOT NULL DEFAULT 'pending',
			run_id TEXT,
			result TEXT DEFAULT '',
			depth INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_events (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			seq INTEGER NOT NULL,
			type TEXT NOT NULL,
			payload TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME
		)`,
	}
	for _, ddl := range tables {
		require.NoError(t, db.Exec(ddl).Error)
	}
	return db
}

func stringPtr(value string) *string {
	return &value
}
