package service

import (
	"context"
	"encoding/json"
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
type mockAgentTeamAgentSvc struct {
	triggerMessageID string
	modelParams      string
	returnTaskID     string
}

func (m *mockAgentTeamAgentSvc) AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) error {
	return nil
}

func (m *mockAgentTeamAgentSvc) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	m.triggerMessageID = triggerMessageID
	m.modelParams = modelParams
	taskID := m.returnTaskID
	if taskID == "" {
		taskID = "task-1"
	}
	return &model.PendingAgentTask{ID: taskID}, nil
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
	assert.NotEmpty(t, agentSvc.triggerMessageID)
	assert.Contains(t, agentSvc.modelParams, "structured_output_schema")
	assert.Contains(t, agentSvc.modelParams, "AgentHub TeamRun supervisor mode")
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

func TestAgentTeamService_HandleRouteDecisionCreatesAssignmentAndAuditEvents(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, supervisor, executor, run := seedAgentTeamRun(t, db)

	assignment, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
		Action:       "delegate",
		NextWorker:   executor.ID,
		Instructions: "Implement the replay UI",
		Reasoning:    "executor owns UI work",
		Context:      "state endpoint is ready",
	})
	require.NoError(t, err)
	require.NotNil(t, assignment)
	assert.Equal(t, supervisor.ID, assignment.FromMemberID)
	assert.Equal(t, executor.ID, assignment.ToMemberID)
	assert.Equal(t, model.AssignmentTypeDelegate, assignment.Type)
	assert.Equal(t, model.AssignmentStatusPending, assignment.Status)
	assert.Equal(t, 1, assignment.Depth)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 3)
	assert.Equal(t, model.TeamEventRouteDecided, events[0].Type)
	assert.Equal(t, model.TeamEventAssignmentCreated, events[1].Type)
	assert.Equal(t, model.TeamEventTaskCreated, events[2].Type)

	state, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	require.Len(t, state.RouteLog, 1)
	assert.Equal(t, "delegate", state.RouteLog[0].Action)
	require.Len(t, state.Assignments, 1)
	assert.Equal(t, assignment.ID, state.Assignments[0].AssignmentID)
	assert.Equal(t, 1, state.Members[1].ActiveTasks)
	require.Len(t, state.Tasks, 1)
	assert.Equal(t, assignment.ID, state.Tasks[0].AssignmentID)
	assert.Equal(t, executor.ID, state.Tasks[0].AssigneeMemberID)
	assert.Equal(t, "Implement the replay UI", state.Tasks[0].Objective)
	assert.Equal(t, model.TeamTaskStatusPending, state.Tasks[0].Status)
}

func TestAgentTeamService_HandleRouteDecisionRejectsMissingWorkerWithAuditEvent(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, _, run := seedAgentTeamRun(t, db)

	assignment, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
		Action:       "delegate",
		NextWorker:   "missing-member",
		Instructions: "Do work",
	})
	require.Error(t, err)
	assert.Equal(t, errcode.ErrBadRequest, err)
	assert.Nil(t, assignment)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventRouteRejected, events[0].Type)
	assert.Contains(t, events[0].Payload, "next_worker")
}

func TestAgentTeamService_HandleRouteDecisionRejectsWhenTaskLimitReached(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, supervisor, executor, run := seedAgentTeamRun(t, db)
	for i := 0; i < model.MaxTasksPerTeamRun; i++ {
		require.NoError(t, repository.CreateAssignment(db, &model.AgentTeamAssignment{
			TeamRunID:    run.ID,
			FromMemberID: supervisor.ID,
			ToMemberID:   executor.ID,
			Type:         model.AssignmentTypeDelegate,
			TaskPrompt:   "existing task",
			Status:       model.AssignmentStatusDone,
			Depth:        1,
		}))
	}

	assignment, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
		Action:       "delegate",
		NextWorker:   executor.ID,
		Instructions: "one more task",
	})
	require.Error(t, err)
	assert.Equal(t, errcode.ErrBadRequest, err)
	assert.Nil(t, assignment)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventRouteRejected, events[0].Type)
	assert.Contains(t, events[0].Payload, "task limit")
}

func TestAgentTeamService_HandleRouteDecisionRejectsWhenActiveSubagentLimitReached(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, supervisor, executor, run := seedAgentTeamRun(t, db)
	for i := 0; i < model.MaxActiveSubAgentsPerRun; i++ {
		require.NoError(t, repository.CreateAssignment(db, &model.AgentTeamAssignment{
			TeamRunID:    run.ID,
			FromMemberID: supervisor.ID,
			ToMemberID:   executor.ID,
			Type:         model.AssignmentTypeDelegate,
			TaskPrompt:   "active task",
			Status:       model.AssignmentStatusRunning,
			Depth:        1,
		}))
	}

	assignment, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
		Action:       "delegate",
		NextWorker:   executor.ID,
		Instructions: "blocked by active limit",
	})
	require.Error(t, err)
	assert.Equal(t, errcode.ErrBadRequest, err)
	assert.Nil(t, assignment)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventRouteRejected, events[0].Type)
	assert.Contains(t, events[0].Payload, "active subagent limit")
}

func TestAgentTeamService_HandleRouteDecisionRejectsWhenRouteRepeatLimitReached(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, executor, run := seedAgentTeamRun(t, db)
	repeated := model.CoordinatorRouteDecision{
		Action:       "delegate",
		NextWorker:   executor.ID,
		Instructions: "repeat me",
		Reasoning:    "same route",
	}
	for i := 0; i < model.MaxRouteRepeats; i++ {
		require.NoError(t, repository.AppendTeamEvent(db, &model.AgentTeamEvent{
			TeamRunID: run.ID,
			Type:      model.TeamEventRouteDecided,
			Payload:   mustJSON(t, repeated),
		}))
	}

	assignment, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, repeated)
	require.Error(t, err)
	assert.Equal(t, errcode.ErrBadRequest, err)
	assert.Nil(t, assignment)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, model.MaxRouteRepeats+1)
	assert.Equal(t, model.TeamEventRouteRejected, events[len(events)-1].Type)
	assert.Contains(t, events[len(events)-1].Payload, "route repeat limit")
}

func TestAgentTeamService_HandleRouteDecisionRejectsTimedOutAssignment(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, supervisor, executor, run := seedAgentTeamRun(t, db)
	require.NoError(t, repository.CreateAssignment(db, &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: supervisor.ID,
		ToMemberID:   executor.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "stale task",
		Status:       model.AssignmentStatusRunning,
		Depth:        1,
		CreatedAt:    time.Now().Add(-model.DefaultAssignmentTimeout - time.Minute),
	}))

	assignment, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
		Action:       "delegate",
		NextWorker:   executor.ID,
		Instructions: "blocked by timeout",
	})
	require.Error(t, err)
	assert.Equal(t, errcode.ErrBadRequest, err)
	assert.Nil(t, assignment)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventRouteRejected, events[0].Type)
	assert.Contains(t, events[0].Payload, "assignment timeout")
}

func TestAgentTeamService_HandleRouteDecisionRejectsBudgetExceeded(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, executor, run := seedAgentTeamRun(t, db)
	agentTaskID := "budget-task-1"
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusDone,
		Objective:        "spent budget",
		RunID:            &agentTaskID,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          agentTaskID,
		EdgeRunID:       "edge-budget",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.result",
		Payload:         `{"success":true,"usage":{"input_tokens":600,"output_tokens":400},"tokenLimit":1000}`,
	}))

	assignment, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
		Action:       "delegate",
		NextWorker:   executor.ID,
		Instructions: "blocked by budget",
	})
	require.Error(t, err)
	assert.Equal(t, errcode.ErrBadRequest, err)
	assert.Nil(t, assignment)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventRouteRejected, events[0].Type)
	assert.Contains(t, events[0].Payload, "budget exceeded")
}

func TestAgentTeamService_ListTeamTasksIsOwnerScoped(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, executor, run := seedAgentTeamRun(t, db)
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusPending,
		Objective:        "Build task board",
		InputRefs:        "{}",
		Attempt:          1,
		RiskLevel:        model.TeamTaskRiskNormal,
	}))

	tasks, err := svc.ListTeamTasks(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	assert.Equal(t, "Build task board", tasks[0].Objective)

	_, err = svc.ListTeamTasks(context.Background(), "other-user", team.ID, run.ID)
	require.Error(t, err)
	assert.Equal(t, errcode.AgentNotFound, err)
}

func TestAgentTeamService_DispatchAssignmentBindsTeamTaskToPendingAgentTask(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	agentSvc := &AgentService{db: db, cacheClient: &mockAgentCache{}}
	svc := NewAgentTeamService(db, agentSvc, nil)
	team, supervisor, executor, run := seedAgentTeamRun(t, db)
	seedTeamRunSession(t, db, run.SessionID, "user-1", executor)

	assignment := &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: supervisor.ID,
		ToMemberID:   executor.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "Implement replay",
		Context:      "include events",
		Status:       model.AssignmentStatusPending,
		Depth:        1,
	}
	require.NoError(t, repository.CreateAssignment(db, assignment))
	assignmentID := assignment.ID
	teamTask := &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssignmentID:     &assignmentID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusPending,
		Objective:        assignment.TaskPrompt,
	}
	require.NoError(t, repository.CreateTeamTask(db, teamTask))

	require.NoError(t, svc.DispatchAssignment(context.Background(), "user-1", assignment.ID))

	var reloadedAssignment model.AgentTeamAssignment
	require.NoError(t, db.Where("id = ?", assignment.ID).First(&reloadedAssignment).Error)
	require.NotNil(t, reloadedAssignment.RunID)
	assert.Equal(t, model.AssignmentStatusDispatched, reloadedAssignment.Status)

	var reloadedTask model.AgentTeamTask
	require.NoError(t, db.Where("id = ?", teamTask.ID).First(&reloadedTask).Error)
	require.NotNil(t, reloadedTask.RunID)
	assert.Equal(t, *reloadedAssignment.RunID, *reloadedTask.RunID)
	assert.Equal(t, model.TeamTaskStatusDispatched, reloadedTask.Status)

	var pending model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", *reloadedTask.RunID).First(&pending).Error)
	assert.Equal(t, "agent-executor", pending.AgentInstanceID)
	assert.NotEmpty(t, pending.TriggerMessageID)

	var triggerMessage model.Message
	require.NoError(t, db.Where("id = ?", pending.TriggerMessageID).First(&triggerMessage).Error)
	assert.Contains(t, triggerMessage.Content, "Implement replay")
	assert.Contains(t, triggerMessage.Content, "include events")

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventAssignmentDispatched, events[0].Type)

	require.NoError(t, repository.UpdatePendingTaskStatusWithEdgeRunID(db, pending.ID, model.TaskStatusRunning, "", "edge-run-1"))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       "edge-run-1",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       model.RunEventTypeOutputBatch,
		Payload:         `{"content":"runtime output"}`,
	}))
	state, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	require.Len(t, state.Assignments, 1)
	assert.Equal(t, model.AssignmentStatusRunning, state.Assignments[0].Status)
	assert.Equal(t, pending.ID, state.Assignments[0].AgentTaskID)
	assert.Equal(t, "edge-run-1", state.Assignments[0].EdgeRunID)
	require.Len(t, state.Tasks, 1)
	assert.Equal(t, model.TeamTaskStatusRunning, state.Tasks[0].Status)
	assert.Equal(t, pending.ID, state.Tasks[0].AgentTaskID)
	assert.Equal(t, "edge-run-1", state.Tasks[0].EdgeRunID)
	require.Len(t, state.RunEvents, 1)
	assert.Equal(t, pending.ID, state.RunEvents[0].AgentTaskID)
	assert.Equal(t, "edge-run-1", state.RunEvents[0].EdgeRunID)
	assert.Equal(t, model.RunEventTypeOutputBatch, state.RunEvents[0].EventType)
	assert.JSONEq(t, `{"content":"runtime output"}`, state.RunEvents[0].Payload)
}

func TestAgentTeamService_GetTeamRunStateProjectsDependenciesAndBudget(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, executor, run := seedAgentTeamRun(t, db)
	reviewerProfileID := "profile-reviewer"
	reviewer := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: &reviewerProfileID,
		Role:           model.TeamMemberRoleReviewer,
	}
	require.NoError(t, repository.AddTeamMember(db, reviewer))
	pending := &model.PendingAgentTask{
		AgentInstanceID:   "agent-executor",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "message-1",
		Status:            model.TaskStatusRunning,
		EdgeRunID:         "edge-run-budget",
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(pending).Error)

	root := &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusRunning,
		Objective:        "Root task",
		RunID:            &pending.ID,
	}
	require.NoError(t, repository.CreateTeamTask(db, root))
	child := &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		ParentTaskID:     &root.ID,
		Status:           model.TeamTaskStatusPending,
		Objective:        "Child task",
	}
	require.NoError(t, repository.CreateTeamTask(db, child))
	conflictingPending := &model.PendingAgentTask{
		AgentInstanceID:   "agent-reviewer",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "message-2",
		Status:            model.TaskStatusDone,
		EdgeRunID:         "edge-run-reviewer",
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(conflictingPending).Error)
	conflictingTask := &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: reviewer.ID,
		Status:           model.TeamTaskStatusDone,
		Objective:        "Review same file",
		RunID:            &conflictingPending.ID,
	}
	require.NoError(t, repository.CreateTeamTask(db, conflictingTask))

	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       "edge-run-budget",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.result",
		Payload:         `{"success":true,"usage":{"input_tokens":1200,"output_tokens":800},"tokenLimit":200000,"tokensRemaining":198000,"usagePercent":1.0}`,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       "edge-run-budget",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.context_warning",
		Payload:         `{"usagePercent":86.5,"threshold":85}`,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       "edge-run-budget",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.permission_requested",
		Payload:         `{"requestId":"req-1","toolUseId":"tool-1","toolName":"Bash","status":"pending"}`,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       "edge-run-budget",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.permission_decided",
		Payload:         `{"requestId":"req-1","decision":"allow","reason":"safe command"}`,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       "edge-run-budget",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.file_change",
		Payload:         `{"path":"hub-server/internal/service/agent_team.go","action":"modified","toolName":"apply_patch","status":"completed"}`,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          conflictingPending.ID,
		EdgeRunID:       "edge-run-reviewer",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-reviewer",
		EventType:       "run.agent.file_change",
		Payload:         `{"path":"./hub-server/internal/service/agent_team.go","action":"modified","toolName":"review_patch","status":"completed"}`,
	}))

	state, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	require.Len(t, state.Dependencies, 1)
	assert.Equal(t, child.ID, state.Dependencies[0].TaskID)
	assert.Equal(t, root.ID, state.Dependencies[0].DependsOnTaskID)
	assert.Equal(t, "parent_task", state.Dependencies[0].Kind)
	require.NotNil(t, state.Budget)
	assert.Equal(t, int64(2000), state.Budget.TotalTokensUsed)
	assert.Equal(t, int64(1200), state.Budget.InputTokens)
	assert.Equal(t, int64(800), state.Budget.OutputTokens)
	assert.Equal(t, int64(200000), state.Budget.TokenLimit)
	assert.Equal(t, int64(198000), state.Budget.RemainingTokens)
	assert.Equal(t, 86.5, state.Budget.UsagePercent)
	assert.Equal(t, 2, state.Budget.RunCount)
	assert.Equal(t, 1, state.Budget.ContextWarnings)
	require.Len(t, state.Approvals, 1)
	assert.Equal(t, pending.ID, state.Approvals[0].AgentTaskID)
	assert.Equal(t, root.ID, state.Approvals[0].TeamTaskID)
	assert.Equal(t, executor.ID, state.Approvals[0].MemberID)
	assert.Equal(t, "req-1", state.Approvals[0].RequestID)
	assert.Equal(t, "Bash", state.Approvals[0].ToolName)
	assert.Equal(t, "tool-1", state.Approvals[0].ToolUseID)
	assert.Equal(t, "allow", state.Approvals[0].Status)
	assert.Equal(t, "safe command", state.Approvals[0].Reason)
	require.NotNil(t, state.Approvals[0].DecidedAt)
	require.Len(t, state.Artifacts, 2)
	assert.Equal(t, pending.ID, state.Artifacts[0].AgentTaskID)
	assert.Equal(t, root.ID, state.Artifacts[0].TeamTaskID)
	assert.Equal(t, executor.ID, state.Artifacts[0].MemberID)
	assert.Equal(t, "hub-server/internal/service/agent_team.go", state.Artifacts[0].Path)
	assert.Equal(t, "modified", state.Artifacts[0].Action)
	assert.Equal(t, "apply_patch", state.Artifacts[0].ToolName)
	assert.Equal(t, "completed", state.Artifacts[0].Status)
	assert.Equal(t, state.Artifacts[0].ConflictID, state.Artifacts[1].ConflictID)
	require.Len(t, state.Conflicts, 1)
	assert.Equal(t, "hub-server/internal/service/agent_team.go", state.Conflicts[0].Path)
	assert.Equal(t, "pending", state.Conflicts[0].Status)
	assert.ElementsMatch(t, []string{pending.ID, conflictingPending.ID}, state.Conflicts[0].AgentTaskIDs)
	assert.ElementsMatch(t, []string{root.ID, conflictingTask.ID}, state.Conflicts[0].TeamTaskIDs)
	assert.ElementsMatch(t, []string{executor.ID, reviewer.ID}, state.Conflicts[0].MemberIDs)
	assert.ElementsMatch(t, []string{"modified"}, state.Conflicts[0].Actions)

	indexed, err := repository.ListTeamArtifactsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, indexed, 2)
	assert.Equal(t, run.ID, indexed[0].TeamRunID)
	require.NotNil(t, indexed[0].TeamTaskID)
	assert.Equal(t, root.ID, *indexed[0].TeamTaskID)
	require.NotNil(t, indexed[0].MemberID)
	assert.Equal(t, executor.ID, *indexed[0].MemberID)
	require.NotNil(t, indexed[0].AgentTaskID)
	assert.Equal(t, pending.ID, *indexed[0].AgentTaskID)
	require.NotNil(t, indexed[0].SourceEventID)
	assert.NotEmpty(t, *indexed[0].SourceEventID)
	assert.Equal(t, "apply_patch", indexed[0].ToolName)
	assert.Equal(t, "hub-server/internal/service/agent_team.go", indexed[0].NormalizedPath)
	assert.Equal(t, state.Artifacts[0].ConflictID, indexed[0].ConflictID)
}

func TestAgentTeamService_ResolveConflictAppendsEventAndUpdatesReplay(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, executor, run := seedAgentTeamRun(t, db)
	reviewerProfileID := "profile-reviewer"
	reviewer := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: &reviewerProfileID,
		Role:           model.TeamMemberRoleReviewer,
	}
	require.NoError(t, repository.AddTeamMember(db, reviewer))
	firstTaskID := "agent-task-one"
	secondTaskID := "agent-task-two"
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusDone,
		Objective:        "Change shared file",
		RunID:            &firstTaskID,
	}))
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: reviewer.ID,
		Status:           model.TeamTaskStatusDone,
		Objective:        "Review shared file",
		RunID:            &secondTaskID,
	}))
	for _, event := range []model.AgentRunEvent{
		{
			TaskID:          firstTaskID,
			EdgeRunID:       "edge-one",
			SessionID:       run.SessionID,
			AgentInstanceID: "agent-one",
			EventType:       "run.agent.file_change",
			Payload:         `{"path":"shared.txt","action":"modified","status":"completed"}`,
		},
		{
			TaskID:          secondTaskID,
			EdgeRunID:       "edge-two",
			SessionID:       run.SessionID,
			AgentInstanceID: "agent-two",
			EventType:       "run.agent.file_change",
			Payload:         `{"path":"./shared.txt","action":"modified","status":"completed"}`,
		},
	} {
		require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &event))
	}

	conflictID := conflictIDForPath("shared.txt")
	resolved, err := svc.ResolveConflict(context.Background(), "user-1", team.ID, run.ID, model.TeamConflictResolution{
		ConflictID:          conflictID,
		Resolution:          model.TeamConflictResolutionAcceptAgentTask,
		SelectedAgentTaskID: firstTaskID,
		Reason:              "Use executor result",
	})
	require.NoError(t, err)
	require.NotNil(t, resolved)
	assert.Equal(t, model.TeamConflictStatusResolved, resolved.Status)
	assert.Equal(t, model.TeamConflictResolutionAcceptAgentTask, resolved.Resolution)
	assert.Equal(t, firstTaskID, resolved.SelectedTask)
	assert.Equal(t, "user-1", resolved.ResolvedBy)
	require.NotNil(t, resolved.ResolvedAt)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventConflictResolved, events[0].Type)
	assert.Contains(t, events[0].Payload, firstTaskID)

	state, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	require.Len(t, state.Conflicts, 1)
	assert.Equal(t, model.TeamConflictStatusResolved, state.Conflicts[0].Status)
	assert.Equal(t, model.TeamConflictResolutionAcceptAgentTask, state.Conflicts[0].Resolution)
	assert.Equal(t, firstTaskID, state.Conflicts[0].SelectedTask)
}

func TestAgentTeamService_ResolveConflictRejectsTaskOutsideConflict(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, executor, run := seedAgentTeamRun(t, db)
	reviewerProfileID := "profile-reviewer"
	reviewer := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: &reviewerProfileID,
		Role:           model.TeamMemberRoleReviewer,
	}
	require.NoError(t, repository.AddTeamMember(db, reviewer))
	taskID := "agent-task-one"
	otherTaskID := "agent-task-two"
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusDone,
		Objective:        "Change shared file",
		RunID:            &taskID,
	}))
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: reviewer.ID,
		Status:           model.TeamTaskStatusDone,
		Objective:        "Review shared file",
		RunID:            &otherTaskID,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          taskID,
		EdgeRunID:       "edge-one",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-one",
		EventType:       "run.agent.file_change",
		Payload:         `{"path":"shared.txt","action":"modified","status":"completed"}`,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          otherTaskID,
		EdgeRunID:       "edge-two",
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-two",
		EventType:       "run.agent.file_change",
		Payload:         `{"path":"shared.txt","action":"modified","status":"completed"}`,
	}))

	resolved, err := svc.ResolveConflict(context.Background(), "user-1", team.ID, run.ID, model.TeamConflictResolution{
		ConflictID:          conflictIDForPath("shared.txt"),
		Resolution:          model.TeamConflictResolutionAcceptAgentTask,
		SelectedAgentTaskID: "missing-task",
	})
	require.Error(t, err)
	assert.Equal(t, errcode.ErrBadRequest, err)
	assert.Nil(t, resolved)
}

func TestAgentTeamService_ListTeamEventsIsOwnerScoped(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, _, run := seedAgentTeamRun(t, db)
	require.NoError(t, repository.AppendTeamEvent(db, &model.AgentTeamEvent{
		TeamRunID: run.ID,
		Type:      model.TeamEventRouteRejected,
		Payload:   `{"reason":"invalid action"}`,
	}))

	events, err := svc.ListTeamEvents(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventRouteRejected, events[0].Type)

	_, err = svc.ListTeamEvents(context.Background(), "other-user", team.ID, run.ID)
	require.Error(t, err)
	assert.Equal(t, errcode.AgentNotFound, err)
}

func setupAgentTeamStateSQLite(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
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
		`CREATE TABLE agent_team_tasks (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			assignment_id TEXT,
			assignee_member_id TEXT NOT NULL,
			parent_task_id TEXT,
			status TEXT NOT NULL DEFAULT 'pending',
			objective TEXT NOT NULL,
			input_refs TEXT NOT NULL DEFAULT '{}',
			run_id TEXT,
			attempt INTEGER NOT NULL DEFAULT 1,
			risk_level TEXT NOT NULL DEFAULT 'normal',
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
		`CREATE TABLE agent_team_artifacts (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			team_task_id TEXT,
			assignment_id TEXT,
			member_id TEXT,
			agent_task_id TEXT,
			edge_run_id TEXT,
			source_event_id TEXT,
			event_seq INTEGER NOT NULL DEFAULT 0,
			path TEXT NOT NULL,
			normalized_path TEXT NOT NULL,
			action TEXT,
			tool_name TEXT,
			status TEXT,
			conflict_id TEXT,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			name TEXT DEFAULT '',
			owner_user_id TEXT,
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
		`CREATE TABLE custom_agents (
			id TEXT PRIMARY KEY,
			owner_user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			avatar_url TEXT DEFAULT '',
			agent_type TEXT NOT NULL,
			system_prompt TEXT DEFAULT '',
			capability_tags TEXT DEFAULT '[]',
			tool_whitelist TEXT DEFAULT '[]',
			model_params TEXT DEFAULT '{}',
			deleted_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE pending_agent_tasks (
			id TEXT PRIMARY KEY,
			agent_instance_id TEXT NOT NULL,
			triggered_by_user_id TEXT NOT NULL,
			trigger_message_id TEXT NOT NULL,
			target_id TEXT,
			status TEXT NOT NULL,
			edge_run_id TEXT DEFAULT '',
			edge_device_id TEXT,
			error_message TEXT,
			created_at DATETIME,
			dispatched_at DATETIME,
			finished_at DATETIME,
			expire_at DATETIME NOT NULL
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
			created_at DATETIME
		)`,
		`CREATE UNIQUE INDEX idx_messages_session_client_msg ON messages (session_id, client_msg_id)`,
		`CREATE TABLE agent_run_events (
			id TEXT PRIMARY KEY,
			task_id TEXT NOT NULL,
			edge_run_id TEXT,
			session_id TEXT NOT NULL,
			agent_instance_id TEXT NOT NULL,
			event_seq INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			payload TEXT NOT NULL,
			created_at DATETIME
		)`,
	}
	for _, ddl := range tables {
		require.NoError(t, db.Exec(ddl).Error)
	}
	return db
}

func seedAgentTeamRun(t *testing.T, db *gorm.DB) (*model.AgentTeam, *model.AgentTeamMember, *model.AgentTeamMember, *model.AgentTeamRun) {
	t.Helper()
	team := &model.AgentTeam{OwnerID: "user-1", Name: "Route Team"}
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
	return team, supervisor, executor, run
}

func stringPtr(value string) *string {
	return &value
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	require.NoError(t, err)
	return string(data)
}

func seedTeamRunSession(t *testing.T, db *gorm.DB, sessionID, userID string, executor *model.AgentTeamMember) {
	t.Helper()
	now := time.Now()
	require.NoError(t, db.Exec(
		`INSERT INTO sessions (id, type, name, owner_user_id, next_seq, dissolved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		sessionID, model.SessionTypeGroup, "Team session", userID, 0, false, now,
	).Error)
	require.NoError(t, db.Exec(
		`INSERT INTO session_members (id, session_id, member_type, member_id, role, joined_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"session-member-user", sessionID, model.MemberTypeUser, userID, model.MemberRoleOwner, now,
	).Error)
	customAgentID := ""
	if executor.AgentProfileID != nil {
		customAgentID = *executor.AgentProfileID
	}
	require.NoError(t, db.Exec(
		`INSERT INTO agent_instances (id, agent_type, custom_agent_id, session_id, inviter_user_id, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"agent-executor", "codex", customAgentID, sessionID, userID, "Executor", now,
	).Error)
	require.NoError(t, db.Exec(
		`INSERT INTO session_members (id, session_id, member_type, member_id, role, joined_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"session-member-agent", sessionID, model.MemberTypeAgent, "agent-executor", model.MemberRoleMember, now,
	).Error)
}
