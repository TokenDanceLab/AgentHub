//nolint:gosec // 测试 fixture：凭据模式字符串用于构造测试用例，非真实凭据
package agentteam

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/agenthub/hub-server/internal/bus"
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
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
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
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)

	team := &model.AgentTeam{OwnerID: "user-2", Name: "My Team", Description: "desc"}
	require.NoError(t, repository.CreateTeam(db, team))

	_, err := svc.GetTeam(context.Background(), "user-1", team.ID)
	require.Error(t, err)
	assert.Equal(t, errcode.AgentNotFound, err)
}

func TestAgentTeamService_GetTeamAllowsAgentProfileOwnerMemberRead(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)

	team := &model.AgentTeam{OwnerID: "owner-user", Name: "Shared Team"}
	require.NoError(t, repository.CreateTeam(db, team))
	memberAgent := &model.CustomAgent{
		OwnerUserID:  "member-user",
		Name:         "Member Agent",
		AgentType:    "codex",
		SystemPrompt: "Help the team",
	}
	require.NoError(t, repository.CreateCustomAgent(db, memberAgent))
	require.NoError(t, repository.AddTeamMember(db, &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: &memberAgent.ID,
		Role:           model.TeamMemberRoleExecutor,
	}))

	got, err := svc.GetTeam(context.Background(), "member-user", team.ID)
	require.NoError(t, err)
	assert.Equal(t, team.ID, got.ID)

	_, err = svc.GetTeam(context.Background(), "intruder-user", team.ID)
	require.Error(t, err)
	assert.Equal(t, errcode.AgentNotFound, err)

	err = svc.UpdateTeam(context.Background(), "member-user", team.ID, "Should Not Write", "")
	require.Error(t, err)
	assert.Equal(t, errcode.AgentNotFound, err)
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
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)

	require.NoError(t, repository.CreateTeam(db, &model.AgentTeam{OwnerID: "user-1", Name: "Team 1"}))
	require.NoError(t, repository.CreateTeam(db, &model.AgentTeam{OwnerID: "user-1", Name: "Team 2"}))

	teams, err := svc.ListTeams(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Len(t, teams, 2)
}

func TestAgentTeamService_ListTeamsIncludesReadableMemberTeamsWithoutLeaking(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)

	ownedTeam := &model.AgentTeam{OwnerID: "member-user", Name: "Owned Team"}
	require.NoError(t, repository.CreateTeam(db, ownedTeam))

	sharedTeam := &model.AgentTeam{OwnerID: "owner-user", Name: "Shared Team"}
	require.NoError(t, repository.CreateTeam(db, sharedTeam))
	memberAgent := &model.CustomAgent{
		OwnerUserID:  "member-user",
		Name:         "Member Agent",
		AgentType:    "codex",
		SystemPrompt: "Read shared team",
	}
	require.NoError(t, repository.CreateCustomAgent(db, memberAgent))
	require.NoError(t, repository.AddTeamMember(db, &model.AgentTeamMember{
		TeamID:         sharedTeam.ID,
		AgentProfileID: &memberAgent.ID,
		Role:           model.TeamMemberRoleExecutor,
	}))

	foreignTeam := &model.AgentTeam{OwnerID: "foreign-owner", Name: "Foreign Team"}
	require.NoError(t, repository.CreateTeam(db, foreignTeam))
	foreignAgent := &model.CustomAgent{
		OwnerUserID:  "foreign-member",
		Name:         "Foreign Agent",
		AgentType:    "codex",
		SystemPrompt: "Not visible",
	}
	require.NoError(t, repository.CreateCustomAgent(db, foreignAgent))
	require.NoError(t, repository.AddTeamMember(db, &model.AgentTeamMember{
		TeamID:         foreignTeam.ID,
		AgentProfileID: &foreignAgent.ID,
		Role:           model.TeamMemberRoleExecutor,
	}))

	teams, err := svc.ListTeams(context.Background(), "member-user")
	require.NoError(t, err)
	gotIDs := make([]string, 0, len(teams))
	for _, team := range teams {
		gotIDs = append(gotIDs, team.ID)
	}
	assert.ElementsMatch(t, []string{ownedTeam.ID, sharedTeam.ID}, gotIDs)
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

	// No run history → deletable.
	mock.ExpectQuery(`SELECT * FROM "agent_team_runs" WHERE team_id`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "team_id", "session_id", "trigger_user_id", "trigger_message", "mode", "status", "created_at", "updated_at"}))

	// Transaction: list members (none) + delete team.
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT * FROM "agent_team_members" WHERE team_id`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "team_id", "agent_profile_id", "role", "position", "created_at"}))
	mock.ExpectExec(`DELETE FROM "agent_teams"`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := svc.DeleteTeam(context.Background(), "user-1", "team-1")
	require.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_DeleteTeamWithRuns(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	// Get team first
	rows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "", "", time.Now(), time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(rows)

	// One historical run → 409, no delete attempted.
	mock.ExpectQuery(`SELECT * FROM "agent_team_runs" WHERE team_id`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "team_id", "session_id", "trigger_user_id", "trigger_message", "mode", "status", "created_at", "updated_at"}).
			AddRow("run-1", "team-1", "sess-1", "user-1", "go", "supervisor", "completed", time.Now(), time.Now()))

	err := svc.DeleteTeam(context.Background(), "user-1", "team-1")
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.TeamHasRuns)
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

	// Add member — the service first lists existing members to reject
	// duplicates with 409 instead of leaking a 23505 as a 500.
	memberRows := sqlmock.NewRows([]string{"id", "team_id", "agent_profile_id", "role", "position", "created_at"})
	mock.ExpectQuery(`SELECT * FROM "agent_team_members" WHERE team_id`).
		WillReturnRows(memberRows)

	mock.ExpectExec(`INSERT INTO "agent_team_members"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	err := svc.AddTeamMember(context.Background(), "user-1", "team-1", "agent-1", model.TeamMemberRoleExecutor)
	require.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_AddTeamMemberDuplicate(t *testing.T) {
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

	// Existing members include the same profile → 409, no insert.
	memberRows := sqlmock.NewRows([]string{"id", "team_id", "agent_profile_id", "role", "position", "created_at"}).
		AddRow("member-1", "team-1", "agent-1", model.TeamMemberRoleExecutor, 0, time.Now())
	mock.ExpectQuery(`SELECT * FROM "agent_team_members" WHERE team_id`).
		WillReturnRows(memberRows)

	err := svc.AddTeamMember(context.Background(), "user-1", "team-1", "agent-1", model.TeamMemberRoleSupervisor)
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.TeamMemberAlready)
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
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
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
	targetID         string
	modelParams      string
	returnTaskID     string
}

func (m *mockAgentTeamAgentSvc) AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error) {
	return &model.AgentInstance{}, nil
}

func (m *mockAgentTeamAgentSvc) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	m.triggerMessageID = triggerMessageID
	m.targetID = targetID
	m.modelParams = modelParams
	taskID := m.returnTaskID
	if taskID == "" {
		taskID = "task-1"
	}
	return &model.PendingAgentTask{ID: taskID}, nil
}

type mockAgentTeamControlSvc struct {
	calls []agentTeamControlCall
}

type agentTeamControlCall struct {
	userID   string
	deviceID string
	payload  model.AgentControlPayload
}

func (m *mockAgentTeamControlSvc) DeliverToDesktopDevice(ctx context.Context, userID, deviceID string, payload model.AgentControlPayload) error {
	m.calls = append(m.calls, agentTeamControlCall{
		userID:   userID,
		deviceID: deviceID,
		payload:  payload,
	})
	return nil
}

// --- StartTeamRun tests ---

func TestAgentTeamService_StartTeamRun_TeamNotFound(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	svc := NewAgentTeamService(db, nil, nil)

	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnError(gorm.ErrRecordNotFound)

	_, err := svc.StartTeamRun(context.Background(), "user-1", "team-1", "hello", "")
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

	_, err := svc.StartTeamRun(context.Background(), "user-1", "team-1", "hello", "")
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_StartTeamRun_Success(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	agentSvc := &mockAgentTeamAgentSvc{}
	svc := NewAgentTeamService(db, agentSvc, nil)
	eventBus, err := bus.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { eventBus.Close(context.Background()) })
	events := make(chan bus.Event, 1)
	eventBus.Subscribe("team.run.started", func(ctx context.Context, event bus.Event) {
		events <- event
	})
	svc.SetBus(eventBus)

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

	// AppendTeamEvent(team.run.started) after successful trigger.
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM agent_team_runs WHERE id`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("run-placeholder"))
	mock.ExpectQuery(`COALESCE(MAX(seq)`).
		WillReturnRows(sqlmock.NewRows([]string{"coalesce"}).AddRow(0))
	mock.ExpectExec(`INSERT INTO "agent_team_events"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	run, err := svc.StartTeamRun(context.Background(), "user-1", "team-1", "hello", "")
	require.NoError(t, err)
	assert.NotNil(t, run)
	assert.Equal(t, "team-1", run.TeamID)
	assert.Equal(t, model.TeamRunStatusRunning, run.Status)
	assert.NotEmpty(t, agentSvc.triggerMessageID)
	assert.Contains(t, agentSvc.modelParams, "structured_output_schema")
	assert.Contains(t, agentSvc.modelParams, "AgentHub TeamRun supervisor mode")
	event := readAgentTeamEvent(t, events)
	assert.Equal(t, "team.run.started", event.Type)
	payload, ok := event.Payload.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "team-1", payload["team_id"])
	assert.Equal(t, run.ID, payload["run_id"])
	assert.Equal(t, run.SessionID, payload["session_id"])
	assert.Equal(t, "user-1", payload["user_id"])
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_StartTeamRunPassesTargetIDToSupervisor(t *testing.T) {
	db, mock := newMockAgentTeamDB(t)
	agentSvc := &mockAgentTeamAgentSvc{}
	svc := NewAgentTeamService(db, agentSvc, nil)

	now := time.Now()
	agentProfileID := "agent-1"

	teamRows := sqlmock.NewRows([]string{"id", "owner_id", "name", "description", "avatar_url", "created_at", "updated_at"}).
		AddRow("team-1", "user-1", "My Team", "desc", "", now, now)
	mock.ExpectQuery(`SELECT * FROM "agent_teams"`).
		WillReturnRows(teamRows)

	memberRows := sqlmock.NewRows([]string{"id", "team_id", "agent_profile_id", "role", "position", "created_at"}).
		AddRow("member-1", "team-1", agentProfileID, "supervisor", 0, now)
	mock.ExpectQuery(`SELECT * FROM "agent_team_members"`).
		WillReturnRows(memberRows)

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO "sessions"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO "session_members"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	agentRows := sqlmock.NewRows([]string{"id", "owner_user_id", "name", "avatar_url", "agent_type", "system_prompt", "capability_tags", "tool_whitelist", "model_params", "deleted_at", "created_at", "updated_at"}).
		AddRow("agent-1", "user-1", "My Agent", "", "codex", "prompt", "[]", "[]", "{}", nil, now, now)
	mock.ExpectQuery(`SELECT * FROM "custom_agents" WHERE id IN`).
		WillReturnRows(agentRows)
	mock.ExpectExec(`INSERT INTO "agent_instances"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO "session_members"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`UPDATE sessions SET next_seq`).
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(1))
	mock.ExpectExec(`INSERT INTO "messages"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO "agent_team_runs"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM agent_team_runs WHERE id`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("run-placeholder"))
	mock.ExpectQuery(`COALESCE(MAX(seq)`).
		WillReturnRows(sqlmock.NewRows([]string{"coalesce"}).AddRow(0))
	mock.ExpectExec(`INSERT INTO "agent_team_events"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	run, err := svc.StartTeamRun(context.Background(), "user-1", "team-1", "hello", "target-local-edge-1")
	require.NoError(t, err)
	require.NotNil(t, run.TargetID)
	assert.Equal(t, "target-local-edge-1", *run.TargetID)
	assert.Equal(t, "target-local-edge-1", agentSvc.targetID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAgentTeamService_CompleteAssignmentPublishesEvent(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	eventBus, err := bus.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { eventBus.Close(context.Background()) })
	events := make(chan bus.Event, 1)
	eventBus.Subscribe(bus.EventTypeTeamAssignmentDone, func(ctx context.Context, event bus.Event) {
		events <- event
	})
	svc.SetBus(eventBus)

	_, supervisor, executor, run := seedAgentTeamRun(t, db)
	assignment := &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: supervisor.ID,
		ToMemberID:   executor.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "Ship it",
		Status:       model.AssignmentStatusRunning,
	}
	require.NoError(t, repository.CreateAssignment(db, assignment))

	require.NoError(t, svc.CompleteAssignment(context.Background(), "user-1", assignment.ID, "done text"))

	event := readAgentTeamEvent(t, events)
	assert.Equal(t, bus.EventTypeTeamAssignmentDone, event.Type)
	payload, ok := event.Payload.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, run.ID, payload["team_run_id"])
	assert.Equal(t, assignment.ID, payload["assignment_id"])
	assert.Equal(t, run.SessionID, payload["session_id"])
	assert.Equal(t, "done text", payload["result"])
}

func TestAgentTeamService_FailAssignmentPublishesEvent(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	eventBus, err := bus.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { eventBus.Close(context.Background()) })
	events := make(chan bus.Event, 1)
	eventBus.Subscribe("team.assignment.failed", func(ctx context.Context, event bus.Event) {
		events <- event
	})
	svc.SetBus(eventBus)

	_, supervisor, executor, run := seedAgentTeamRun(t, db)
	assignment := &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: supervisor.ID,
		ToMemberID:   executor.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "Ship it",
		Status:       model.AssignmentStatusRunning,
	}
	require.NoError(t, repository.CreateAssignment(db, assignment))

	require.NoError(t, svc.FailAssignment(context.Background(), "user-1", assignment.ID, "blocked"))

	event := readAgentTeamEvent(t, events)
	assert.Equal(t, "team.assignment.failed", event.Type)
	payload, ok := event.Payload.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, run.ID, payload["team_run_id"])
	assert.Equal(t, assignment.ID, payload["assignment_id"])
	assert.Equal(t, run.SessionID, payload["session_id"])
	assert.Equal(t, "blocked", payload["reason"])
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
		Action:        "delegate",
		NextWorker:    executor.ID,
		Instructions:  "Implement the replay UI",
		Reasoning:     "executor owns UI work",
		Reason:        "worker owns fixture implementation",
		Context:       "state endpoint is ready",
		AgentID:       executor.ID,
		ParentTaskID:  "parent-task-1",
		CorrelationID: "corr-route-1",
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
	var accepted model.CoordinatorRouteDecision
	require.NoError(t, json.Unmarshal([]byte(events[0].Payload), &accepted))
	require.NotEmpty(t, accepted.SubtaskID)
	assert.True(t, accepted.Accepted)
	assert.Equal(t, executor.ID, accepted.AgentID)
	assert.Equal(t, "parent-task-1", accepted.ParentTaskID)
	assert.Equal(t, "worker owns fixture implementation", accepted.Reason)
	assert.Equal(t, "corr-route-1", accepted.CorrelationID)

	state, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	require.Len(t, state.RouteLog, 1)
	assert.Equal(t, "delegate", state.RouteLog[0].Action)
	assert.Equal(t, "corr-route-1", state.RouteLog[0].CorrelationID)
	require.Len(t, state.RouteAuditLog, 1)
	assert.Equal(t, "accepted", state.RouteAuditLog[0].Status)
	assert.Equal(t, "corr-route-1", state.RouteAuditLog[0].CorrelationID)
	assert.Equal(t, accepted.SubtaskID, state.RouteAuditLog[0].SubtaskID)
	assert.Equal(t, "parent-task-1", state.RouteAuditLog[0].ParentTaskID)
	assert.Equal(t, executor.ID, state.RouteAuditLog[0].AgentID)
	assert.Equal(t, "worker owns fixture implementation", state.RouteAuditLog[0].Reason)
	require.Len(t, state.Assignments, 1)
	assert.Equal(t, assignment.ID, state.Assignments[0].AssignmentID)
	assert.Equal(t, 1, state.Members[1].ActiveTasks)
	require.Len(t, state.Tasks, 1)
	assert.Equal(t, assignment.ID, state.Tasks[0].AssignmentID)
	assert.Equal(t, executor.ID, state.Tasks[0].AssigneeMemberID)
	assert.Equal(t, "parent-task-1", state.Tasks[0].ParentTaskID)
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
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
	assert.Nil(t, assignment)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventRouteRejected, events[0].Type)
	assert.Contains(t, events[0].Payload, "next_worker")

	state, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	require.Len(t, state.RouteAuditLog, 1)
	assert.Equal(t, "rejected", state.RouteAuditLog[0].Status)
	assert.Equal(t, "missing-member", state.RouteAuditLog[0].AgentID)
	assert.Equal(t, "next_worker is not a team member", state.RouteAuditLog[0].Reason)
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
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
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
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
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
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
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
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
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
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
	assert.Nil(t, assignment)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventRouteRejected, events[0].Type)
	assert.Contains(t, events[0].Payload, "budget exceeded")
}

func TestAgentTeamService_CreateAssignmentRejectsDelegationDepthLimit(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	_, supervisor, _, run := seedAgentTeamRun(t, db)
	supervisor2 := addTeamSupervisor(t, db, supervisor.TeamID, "profile-supervisor-2")
	supervisor3 := addTeamSupervisor(t, db, supervisor.TeamID, "profile-supervisor-3")
	supervisor4 := addTeamSupervisor(t, db, supervisor.TeamID, "profile-supervisor-4")
	supervisor5 := addTeamSupervisor(t, db, supervisor.TeamID, "profile-supervisor-5")

	require.NoError(t, repository.CreateAssignment(db, &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: supervisor.ID,
		ToMemberID:   supervisor2.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "depth 1",
		Status:       model.AssignmentStatusDone,
		Depth:        1,
	}))
	require.NoError(t, repository.CreateAssignment(db, &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: supervisor2.ID,
		ToMemberID:   supervisor3.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "depth 2",
		Status:       model.AssignmentStatusDone,
		Depth:        2,
	}))
	require.NoError(t, repository.CreateAssignment(db, &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: supervisor3.ID,
		ToMemberID:   supervisor4.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "depth 3",
		Status:       model.AssignmentStatusDone,
		Depth:        model.MaxDelegationDepth,
	}))

	assignment, err := svc.CreateAssignment(context.Background(), "user-1", run.ID, supervisor4.ID, supervisor5.ID, model.AssignmentTypeDelegate, "too deep", "")
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
	assert.Nil(t, assignment)
}

func TestAgentTeamService_CreateAssignmentRejectsTeamRunTaskLimit(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	_, supervisor, executor, run := seedAgentTeamRun(t, db)

	for i := 0; i < model.MaxTasksPerTeamRun; i++ {
		require.NoError(t, repository.CreateAssignment(db, &model.AgentTeamAssignment{
			TeamRunID:    run.ID,
			FromMemberID: supervisor.ID,
			ToMemberID:   executor.ID,
			Type:         model.AssignmentTypeDelegate,
			TaskPrompt:   "completed task",
			Status:       model.AssignmentStatusDone,
			Depth:        1,
		}))
	}

	assignment, err := svc.CreateAssignment(context.Background(), "user-1", run.ID, supervisor.ID, executor.ID, model.AssignmentTypeDelegate, "too many", "")
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
	assert.Nil(t, assignment)
}

func TestAgentTeamService_CreateAssignmentRejectsDelegationCycle(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	_, supervisor, _, run := seedAgentTeamRun(t, db)
	supervisor2 := addTeamSupervisor(t, db, supervisor.TeamID, "profile-supervisor-cycle-2")
	supervisor3 := addTeamSupervisor(t, db, supervisor.TeamID, "profile-supervisor-cycle-3")

	require.NoError(t, repository.CreateAssignment(db, &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: supervisor.ID,
		ToMemberID:   supervisor2.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "cycle depth 1",
		Status:       model.AssignmentStatusDone,
		Depth:        1,
	}))
	require.NoError(t, repository.CreateAssignment(db, &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: supervisor2.ID,
		ToMemberID:   supervisor3.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "cycle depth 2",
		Status:       model.AssignmentStatusDone,
		Depth:        2,
	}))

	assignment, err := svc.CreateAssignment(context.Background(), "user-1", run.ID, supervisor3.ID, supervisor.ID, model.AssignmentTypeDelegate, "cycle", "")
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
	assert.Nil(t, assignment)
}

func TestAgentTeamService_CreateAssignmentUsesConfiguredDelegationDepthLimit(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamServiceWithGuardrails(db, nil, nil, AgentTeamGuardrails{
		MaxDelegationDepth: 1,
	})
	_, supervisor, _, run := seedAgentTeamRun(t, db)
	supervisor2 := addTeamSupervisor(t, db, supervisor.TeamID, "profile-config-depth-2")
	supervisor3 := addTeamSupervisor(t, db, supervisor.TeamID, "profile-config-depth-3")

	require.NoError(t, repository.CreateAssignment(db, &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: supervisor.ID,
		ToMemberID:   supervisor2.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "depth 1",
		Status:       model.AssignmentStatusDone,
		Depth:        1,
	}))

	assignment, err := svc.CreateAssignment(context.Background(), "user-1", run.ID, supervisor2.ID, supervisor3.ID, model.AssignmentTypeDelegate, "too deep for config", "")
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
	assert.Nil(t, assignment)
}

func TestAgentTeamService_CreateAssignmentUsesConfiguredTeamRunTaskLimit(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamServiceWithGuardrails(db, nil, nil, AgentTeamGuardrails{
		MaxTasksPerTeamRun: 1,
	})
	_, supervisor, executor, run := seedAgentTeamRun(t, db)

	require.NoError(t, repository.CreateAssignment(db, &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: supervisor.ID,
		ToMemberID:   executor.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "first task",
		Status:       model.AssignmentStatusDone,
		Depth:        1,
	}))

	assignment, err := svc.CreateAssignment(context.Background(), "user-1", run.ID, supervisor.ID, executor.ID, model.AssignmentTypeDelegate, "over configured task limit", "")
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
	assert.Nil(t, assignment)
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
	agentSvc := &mockAgentTeamAgentSvc{returnTaskID: "task-dispatch-1"}
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
	assert.Equal(t, model.AssignmentStatusRunning, reloadedAssignment.Status)

	// Seed the pending task that the mock agent service would have created.
	triggerMsgID := "msg-trigger-dispatch"
	require.NoError(t, db.Exec(
		"INSERT INTO pending_agent_tasks (id, agent_instance_id, trigger_message_id, triggered_by_user_id, status, expire_at) VALUES (?, ?, ?, ?, ?, ?)",
		*reloadedAssignment.RunID, "agent-executor", triggerMsgID, "user-1", model.TaskStatusRunning, time.Now().Add(1*time.Hour),
	).Error)
	require.NoError(t, db.Exec(
		"INSERT INTO messages (id, session_id, seq_id, client_msg_id, sender_type, sender_id, content_type, content, created_at) VALUES (?, ?, 1, ?, 'user', ?, 'text', ?, ?)",
		triggerMsgID, run.SessionID, triggerMsgID, "user-1", "Task: Implement replay\nContext: include events", time.Now(),
	).Error)

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

func TestAgentTeamService_DispatchAssignmentPassesTeamRunTargetID(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	agentSvc := &mockAgentTeamAgentSvc{returnTaskID: "task-dispatch-1"}
	svc := NewAgentTeamService(db, agentSvc, nil)
	_, supervisor, executor, run := seedAgentTeamRun(t, db)
	targetID := "target-local-edge-1"
	run.TargetID = &targetID
	require.NoError(t, db.Model(&model.AgentTeamRun{}).Where("id = ?", run.ID).Update("target_id", targetID).Error)
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

	require.NoError(t, svc.DispatchAssignment(context.Background(), "user-1", assignment.ID))

	assert.Equal(t, "target-local-edge-1", agentSvc.targetID)
	var reloadedAssignment model.AgentTeamAssignment
	require.NoError(t, db.Where("id = ?", assignment.ID).First(&reloadedAssignment).Error)
	require.NotNil(t, reloadedAssignment.RunID)
	assert.Equal(t, "task-dispatch-1", *reloadedAssignment.RunID)
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
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
	assert.Nil(t, resolved)
}

func TestAgentTeamService_DecideApprovalAppendsEventAndUpdatesReplay(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, executor, run := seedAgentTeamRun(t, db)
	pending := &model.PendingAgentTask{
		ID:                "agent-task-approval",
		AgentInstanceID:   "agent-executor",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-approval",
		Status:            model.TaskStatusRunning,
		EdgeRunID:         "edge-run-approval",
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(pending).Error)
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusRunning,
		Objective:        "Run gated command",
		RunID:            &pending.ID,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       pending.EdgeRunID,
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.permission_requested",
		Payload:         `{"requestId":"req-approval","toolUseId":"tool-approval","toolName":"Bash","status":"pending"}`,
	}))

	decided, err := svc.DecideApproval(context.Background(), "user-1", team.ID, run.ID, "req-approval", model.TeamApprovalDecision{
		Decision: "allow",
		Reason:   "Known safe command",
	})
	require.NoError(t, err)
	require.NotNil(t, decided)
	assert.Equal(t, "req-approval", decided.ApprovalID)
	assert.Equal(t, "allow", decided.Status)
	assert.Equal(t, "user-1", decided.DecidedBy)
	require.NotNil(t, decided.EdgeControl)
	assert.Equal(t, pending.EdgeRunID, decided.EdgeControl.RunID)
	assert.Equal(t, "req-approval", decided.EdgeControl.RequestID)
	assert.Equal(t, "allow", decided.EdgeControl.Decision)
	assert.Equal(t, "Known safe command", decided.EdgeControl.Reason)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventApprovalDecided, events[0].Type)
	assert.Contains(t, events[0].Payload, `"edge_control"`)
	assert.Contains(t, events[0].Payload, `"runId":"edge-run-approval"`)

	state, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	require.Len(t, state.Approvals, 1)
	assert.Equal(t, "req-approval", state.Approvals[0].ApprovalID)
	assert.Equal(t, "allow", state.Approvals[0].Status)
	assert.Equal(t, "Known safe command", state.Approvals[0].Reason)
	assert.Equal(t, "user-1", state.Approvals[0].DecidedBy)
	require.NotNil(t, state.Approvals[0].DecidedAt)
	require.NotNil(t, state.Approvals[0].EdgeControl)
	assert.Equal(t, "edge-run-approval", state.Approvals[0].EdgeControl.RunID)
}

func TestAgentTeamService_DecideApprovalDeliversControlToExactEdgeDevice(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	controlSvc := &mockAgentTeamControlSvc{}
	svc := NewAgentTeamService(db, nil, nil)
	svc.SetControlService(controlSvc)
	team, _, executor, run := seedAgentTeamRun(t, db)
	pending := &model.PendingAgentTask{
		ID:                "agent-task-control",
		AgentInstanceID:   "agent-executor",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-control",
		TargetID:          "target-local",
		Status:            model.TaskStatusRunning,
		EdgeRunID:         "edge-run-control",
		EdgeDeviceID:      "edge-device-control",
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(pending).Error)
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusRunning,
		Objective:        "Run gated command",
		RunID:            &pending.ID,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       pending.EdgeRunID,
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.permission_requested",
		Payload:         `{"requestId":"req-control","toolUseId":"tool-control","toolName":"Bash","status":"pending"}`,
	}))

	_, err := svc.DecideApproval(context.Background(), "user-1", team.ID, run.ID, "req-control", model.TeamApprovalDecision{
		Decision: "allow",
		Reason:   "Known safe command",
	})
	require.NoError(t, err)
	require.Len(t, controlSvc.calls, 1)
	call := controlSvc.calls[0]
	assert.Equal(t, "user-1", call.userID)
	assert.Equal(t, "edge-device-control", call.deviceID)
	assert.Equal(t, model.AgentControlKindPermissionDecide, call.payload.Kind)
	assert.Equal(t, pending.ID, call.payload.AgentTaskID)
	assert.Equal(t, "target-local", call.payload.TargetID)
	assert.Equal(t, "edge-device-control", call.payload.EdgeDeviceID)
	assert.Equal(t, "req-control", call.payload.ApprovalID)
	require.NotNil(t, call.payload.EdgeControl)
	assert.Equal(t, "edge-run-control", call.payload.EdgeControl.RunID)
	assert.Equal(t, "req-control", call.payload.EdgeControl.RequestID)
	assert.Equal(t, "allow", call.payload.EdgeControl.Decision)
}

func TestAgentTeamService_DecideApprovalRedeliversSameDecisionWithoutDuplicateEvent(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	controlSvc := &mockAgentTeamControlSvc{}
	svc := NewAgentTeamService(db, nil, nil)
	svc.SetControlService(controlSvc)
	team, _, executor, run := seedAgentTeamRun(t, db)
	pending := &model.PendingAgentTask{
		ID:                "agent-task-redeliver-control",
		AgentInstanceID:   "agent-executor",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-redeliver-control",
		TargetID:          "target-local",
		Status:            model.TaskStatusRunning,
		EdgeRunID:         "edge-run-redeliver-control",
		EdgeDeviceID:      "edge-device-redeliver-control",
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(pending).Error)
	teamTask := &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusRunning,
		Objective:        "Run gated command",
		RunID:            &pending.ID,
	}
	require.NoError(t, repository.CreateTeamTask(db, teamTask))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       pending.EdgeRunID,
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.permission_requested",
		Payload:         `{"requestId":"req-redeliver","toolUseId":"tool-redeliver","toolName":"Bash","status":"pending"}`,
	}))
	decidedAt := time.Now().UTC()
	record := model.TeamApprovalDecision{
		ApprovalID:  "req-redeliver",
		AgentTaskID: pending.ID,
		TeamTaskID:  teamTask.ID,
		MemberID:    executor.ID,
		EdgeRunID:   pending.EdgeRunID,
		RequestID:   "req-redeliver",
		ToolName:    "Bash",
		ToolUseID:   "tool-redeliver",
		Decision:    "allow",
		Reason:      "Known safe command",
		DecidedBy:   "user-1",
		DecidedAt:   decidedAt,
		EdgeControl: &model.TeamApprovalEdgeControl{
			RunID:     pending.EdgeRunID,
			RequestID: "req-redeliver",
			Decision:  "allow",
			Reason:    "Known safe command",
		},
	}
	payload, err := json.Marshal(record)
	require.NoError(t, err)
	require.NoError(t, repository.AppendTeamEvent(db, &model.AgentTeamEvent{
		TeamRunID: run.ID,
		Type:      model.TeamEventApprovalDecided,
		Payload:   string(payload),
	}))

	decided, err := svc.DecideApproval(context.Background(), "user-1", team.ID, run.ID, "req-redeliver", model.TeamApprovalDecision{
		Decision: "allow",
		Reason:   "Known safe command",
	})

	require.NoError(t, err)
	require.NotNil(t, decided)
	assert.Equal(t, "allow", decided.Status)
	require.Len(t, controlSvc.calls, 1)
	call := controlSvc.calls[0]
	assert.Equal(t, "user-1", call.userID)
	assert.Equal(t, pending.EdgeDeviceID, call.deviceID)
	assert.Equal(t, pending.ID, call.payload.AgentTaskID)
	assert.Equal(t, "req-redeliver", call.payload.ApprovalID)
	require.NotNil(t, call.payload.EdgeControl)
	assert.Equal(t, pending.EdgeRunID, call.payload.EdgeControl.RunID)
	assert.Equal(t, "allow", call.payload.EdgeControl.Decision)
	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
}

func TestAgentTeamService_DecideApprovalRejectsMissingEdgeDeviceForControl(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	controlSvc := &mockAgentTeamControlSvc{}
	svc := NewAgentTeamService(db, nil, nil)
	svc.SetControlService(controlSvc)
	team, _, executor, run := seedAgentTeamRun(t, db)
	pending := &model.PendingAgentTask{
		ID:                "agent-task-no-device",
		AgentInstanceID:   "agent-executor",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-no-device",
		Status:            model.TaskStatusRunning,
		EdgeRunID:         "edge-run-no-device",
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(pending).Error)
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusRunning,
		Objective:        "Run gated command",
		RunID:            &pending.ID,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       pending.EdgeRunID,
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.permission_requested",
		Payload:         `{"requestId":"req-no-device","toolUseId":"tool-no-device","toolName":"Bash","status":"pending"}`,
	}))

	decided, err := svc.DecideApproval(context.Background(), "user-1", team.ID, run.ID, "req-no-device", model.TeamApprovalDecision{
		Decision: "allow",
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
	assert.Nil(t, decided)
	assert.Empty(t, controlSvc.calls)
}

func TestAgentTeamService_DecideApprovalRejectsAlreadyDecided(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, executor, run := seedAgentTeamRun(t, db)
	taskID := "agent-task-decided"
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusRunning,
		Objective:        "Run gated command",
		RunID:            &taskID,
	}))
	for _, event := range []model.AgentRunEvent{
		{
			TaskID:          taskID,
			EdgeRunID:       "edge-run-decided",
			SessionID:       run.SessionID,
			AgentInstanceID: "agent-executor",
			EventType:       "run.agent.permission_requested",
			Payload:         `{"requestId":"req-decided","toolUseId":"tool-decided","toolName":"Bash","status":"pending"}`,
		},
		{
			TaskID:          taskID,
			EdgeRunID:       "edge-run-decided",
			SessionID:       run.SessionID,
			AgentInstanceID: "agent-executor",
			EventType:       "run.agent.permission_decided",
			Payload:         `{"requestId":"req-decided","decision":"deny","reason":"too broad"}`,
		},
	} {
		require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &event))
	}

	decided, err := svc.DecideApproval(context.Background(), "user-1", team.ID, run.ID, "req-decided", model.TeamApprovalDecision{
		Decision: "allow",
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
	assert.Nil(t, decided)
}

func TestAgentTeamService_MemberReadableTeamCannotMutateRunDecisions(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, executor, run := seedAgentTeamRun(t, db)
	addReadableTeamMemberForUser(t, db, team.ID, "member-user")

	state, err := svc.GetTeamRunState(context.Background(), "member-user", team.ID, run.ID)
	require.NoError(t, err)
	require.NotNil(t, state)

	reviewerProfileID := "profile-reviewer"
	reviewer := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: &reviewerProfileID,
		Role:           model.TeamMemberRoleReviewer,
	}
	require.NoError(t, repository.AddTeamMember(db, reviewer))
	firstTaskID := "agent-task-conflict-one"
	secondTaskID := "agent-task-conflict-two"
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
			EdgeRunID:       "edge-conflict-one",
			SessionID:       run.SessionID,
			AgentInstanceID: "agent-one",
			EventType:       "run.agent.file_change",
			Payload:         `{"path":"shared.txt","action":"modified","status":"completed"}`,
		},
		{
			TaskID:          secondTaskID,
			EdgeRunID:       "edge-conflict-two",
			SessionID:       run.SessionID,
			AgentInstanceID: "agent-two",
			EventType:       "run.agent.file_change",
			Payload:         `{"path":"shared.txt","action":"modified","status":"completed"}`,
		},
	} {
		require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &event))
	}

	resolved, err := svc.ResolveConflict(context.Background(), "member-user", team.ID, run.ID, model.TeamConflictResolution{
		ConflictID:          conflictIDForPath("shared.txt"),
		Resolution:          model.TeamConflictResolutionAcceptAgentTask,
		SelectedAgentTaskID: firstTaskID,
	})
	require.Error(t, err)
	assert.Equal(t, errcode.AgentNotFound, err)
	assert.Nil(t, resolved)

	pending := &model.PendingAgentTask{
		ID:                "agent-task-member-approval",
		AgentInstanceID:   "agent-executor",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-member-approval",
		Status:            model.TaskStatusRunning,
		EdgeRunID:         "edge-run-member-approval",
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(pending).Error)
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusRunning,
		Objective:        "Run gated command",
		RunID:            &pending.ID,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       pending.EdgeRunID,
		SessionID:       run.SessionID,
		AgentInstanceID: "agent-executor",
		EventType:       "run.agent.permission_requested",
		Payload:         `{"requestId":"req-member-approval","toolUseId":"tool-member-approval","toolName":"Bash","status":"pending"}`,
	}))

	decided, err := svc.DecideApproval(context.Background(), "member-user", team.ID, run.ID, "req-member-approval", model.TeamApprovalDecision{
		Decision: "allow",
	})
	require.Error(t, err)
	assert.Equal(t, errcode.AgentNotFound, err)
	assert.Nil(t, decided)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	assert.Empty(t, events)
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

func readAgentTeamEvent(t *testing.T, events <-chan bus.Event) bus.Event {
	t.Helper()
	select {
	case event := <-events:
		return event
	case <-time.After(time.Second):
		t.Fatal("agent team event was not published")
	}
	return bus.Event{}
}

func setupAgentTeamStateSQLite(t *testing.T) *gorm.DB {
	t.Helper()
	return setupAgentTeamStateSQLiteDSN(t, ":memory:", 1)
}

func setupAgentTeamConcurrentSQLite(t *testing.T) *gorm.DB {
	t.Helper()
	path := filepath.ToSlash(filepath.Join(t.TempDir(), "agentteam-concurrency.db"))
	dsn := fmt.Sprintf("file:%s?cache=shared&_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)", path)
	return setupAgentTeamStateSQLiteDSN(t, dsn, 8)
}

func setupAgentTeamStateSQLiteDSN(t *testing.T, dsn string, maxOpenConns int) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	sqlDB.SetMaxOpenConns(maxOpenConns)
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
			target_id TEXT,
			mode TEXT NOT NULL DEFAULT 'supervisor',
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
			output_schema TEXT DEFAULT NULL,
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
			model_params TEXT DEFAULT '{}',
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
			edited BOOLEAN NOT NULL DEFAULT FALSE,
			edited_at DATETIME,
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

func addReadableTeamMemberForUser(t *testing.T, db *gorm.DB, teamID, userID string) *model.AgentTeamMember {
	t.Helper()
	agent := &model.CustomAgent{
		OwnerUserID:  userID,
		Name:         "Readable Member Agent",
		AgentType:    "codex",
		SystemPrompt: "Read shared team state",
	}
	require.NoError(t, repository.CreateCustomAgent(db, agent))
	member := &model.AgentTeamMember{
		TeamID:         teamID,
		AgentProfileID: &agent.ID,
		Role:           model.TeamMemberRoleExecutor,
	}
	require.NoError(t, repository.AddTeamMember(db, member))
	return member
}

func addTeamSupervisor(t *testing.T, db *gorm.DB, teamID, profileID string) *model.AgentTeamMember {
	t.Helper()
	member := &model.AgentTeamMember{
		TeamID:         teamID,
		AgentProfileID: &profileID,
		Role:           model.TeamMemberRoleSupervisor,
	}
	require.NoError(t, repository.AddTeamMember(db, member))
	return member
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

// mockCompeteAggregator implements CompeteAggregator for tests.
type mockCompeteAggregator struct {
	summary string
}

func (m *mockCompeteAggregator) CompareResults(_ context.Context, _ string, entries []model.CompeteSummaryEntry) (string, error) {
	if m.summary != "" {
		return m.summary, nil
	}
	return "Comparison: " + strings.Join(entryMemberIDs(entries), " vs "), nil
}

func entryMemberIDs(entries []model.CompeteSummaryEntry) []string {
	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = e.MemberID
	}
	return ids
}

func TestCompeteMode(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	aggregator := &mockCompeteAggregator{}
	svc := NewAgentTeamService(db, nil, nil)
	svc.SetCompeteAggregator(aggregator)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "Compete Team"}
	require.NoError(t, repository.CreateTeam(db, team))

	supervisor := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: strPtr("profile-supervisor"),
		Role:           model.TeamMemberRoleSupervisor,
	}
	executor1 := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: strPtr("profile-executor-1"),
		Role:           model.TeamMemberRoleExecutor,
	}
	executor2 := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: strPtr("profile-executor-2"),
		Role:           model.TeamMemberRoleExecutor,
	}
	require.NoError(t, repository.AddTeamMember(db, supervisor))
	require.NoError(t, repository.AddTeamMember(db, executor1))
	require.NoError(t, repository.AddTeamMember(db, executor2))

	run := &model.AgentTeamRun{
		TeamID:         team.ID,
		SessionID:      "session-compete",
		TriggerUserID:  "user-1",
		TriggerMessage: "compare implementations of factorial",
		Mode:           model.TeamRunModeCompete,
		Status:         model.TeamRunStatusRunning,
	}
	require.NoError(t, repository.CreateTeamRun(db, run))

	// Submit a compete route decision targeting two executors.
	workerIDs := executor1.ID + "," + executor2.ID
	assignment, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
		Action:       "compete",
		NextWorker:   workerIDs,
		Instructions: "Implement factorial in your best style",
		Reasoning:    "Let's see different approaches",
	})
	require.NoError(t, err)
	require.NotNil(t, assignment)
	assert.Equal(t, model.AssignmentTypeCompete, assignment.Type)

	// Both executors should have assignments.
	assignments, err := svc.ListAssignments(context.Background(), "user-1", run.ID)
	require.NoError(t, err)
	assert.Len(t, assignments, 2)
	assert.Equal(t, model.AssignmentTypeCompete, assignments[0].Type)
	assert.Equal(t, model.AssignmentTypeCompete, assignments[1].Type)

	// Complete both assignments with results.
	as1 := &assignments[0]
	as1.Status = model.AssignmentStatusRunning
	require.NoError(t, db.Model(&model.AgentTeamAssignment{}).Where("id = ?", as1.ID).Update("status", model.AssignmentStatusRunning).Error)
	require.NoError(t, svc.CompleteAssignment(context.Background(), "user-1", as1.ID, "func fact(n int) int { if n <= 1 { return 1 }; return n * fact(n-1) }"))

	as2 := &assignments[1]
	as2.Status = model.AssignmentStatusRunning
	require.NoError(t, db.Model(&model.AgentTeamAssignment{}).Where("id = ?", as2.ID).Update("status", model.AssignmentStatusRunning).Error)
	require.NoError(t, svc.CompleteAssignment(context.Background(), "user-1", as2.ID, "def factorial(n): return 1 if n <= 1 else n * factorial(n-1)"))

	// Generate compete summary.
	resp, err := svc.GenerateCompeteSummary(context.Background(), "user-1", run.ID, model.CompeteSummaryRequest{})
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, run.ID, resp.TeamRunID)
	assert.Contains(t, resp.Summary, "Comparison:")
	assert.Len(t, resp.Entries, 2)

	// Verify events include compete dispatched and aggregated.
	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	hasCompeteDispatched := false
	hasCompeteAggregated := false
	for _, ev := range events {
		if ev.Type == model.TeamEventCompeteDispatched {
			hasCompeteDispatched = true
		}
		if ev.Type == model.TeamEventCompeteAggregated {
			hasCompeteAggregated = true
		}
	}
	assert.True(t, hasCompeteDispatched, "expected team.compete.dispatched event")
	assert.True(t, hasCompeteAggregated, "expected team.compete.aggregated event")
}

func TestCompeteModeAutoSelectsExecutors(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	aggregator := &mockCompeteAggregator{}
	svc := NewAgentTeamService(db, nil, nil)
	svc.SetCompeteAggregator(aggregator)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "Auto Compete Team"}
	require.NoError(t, repository.CreateTeam(db, team))

	supervisor := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: strPtr("profile-supervisor"),
		Role:           model.TeamMemberRoleSupervisor,
	}
	executor1 := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: strPtr("profile-executor-1"),
		Role:           model.TeamMemberRoleExecutor,
	}
	executor2 := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: strPtr("profile-executor-2"),
		Role:           model.TeamMemberRoleExecutor,
	}
	require.NoError(t, repository.AddTeamMember(db, supervisor))
	require.NoError(t, repository.AddTeamMember(db, executor1))
	require.NoError(t, repository.AddTeamMember(db, executor2))

	run := &model.AgentTeamRun{
		TeamID:         team.ID,
		SessionID:      "session-auto-compete",
		TriggerUserID:  "user-1",
		TriggerMessage: "auto compete",
		Mode:           model.TeamRunModeCompete,
		Status:         model.TeamRunStatusRunning,
	}
	require.NoError(t, repository.CreateTeamRun(db, run))

	// Submit compete decision with empty NextWorker — should pick both executors.
	assignment, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
		Action:       "compete",
		Instructions: "Write hello world",
		Reasoning:    "Auto-select",
	})
	require.NoError(t, err)
	require.NotNil(t, assignment)

	assignments, err := svc.ListAssignments(context.Background(), "user-1", run.ID)
	require.NoError(t, err)
	assert.Len(t, assignments, 2)
	// Both should be executors (not supervisor).
	for _, a := range assignments {
		assert.NotEqual(t, supervisor.ID, a.ToMemberID)
	}
}

func TestCompeteModeRejectsExceedingMaxAgents(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	svc.SetCompeteMaxAgents(2)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "Max Compete Team"}
	require.NoError(t, repository.CreateTeam(db, team))

	supervisor := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: strPtr("profile-supervisor"),
		Role:           model.TeamMemberRoleSupervisor,
	}
	require.NoError(t, repository.AddTeamMember(db, supervisor))

	workerIDs := make([]string, 3)
	for i := range 3 {
		e := &model.AgentTeamMember{
			TeamID:         team.ID,
			AgentProfileID: strPtr(fmt.Sprintf("profile-executor-%d", i)),
			Role:           model.TeamMemberRoleExecutor,
		}
		require.NoError(t, repository.AddTeamMember(db, e))
		workerIDs[i] = e.ID
	}

	run := &model.AgentTeamRun{
		TeamID:         team.ID,
		SessionID:      "session-max-compete",
		TriggerUserID:  "user-1",
		TriggerMessage: "too many",
		Mode:           model.TeamRunModeCompete,
		Status:         model.TeamRunStatusRunning,
	}
	require.NoError(t, repository.CreateTeamRun(db, run))

	_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
		Action:       "compete",
		NextWorker:   strings.Join(workerIDs, ","),
		Instructions: "Too many workers",
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
}

func strPtr(s string) *string {
	return &s
}

// ── Human Review Gate (ADR-008) ────────────────────────────────

func TestHumanReviewGate(t *testing.T) {
	t.Run("disabled by default rejects review API", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		team, _, executor, run := seedAgentTeamRun(t, db)

		// HandleRouteDecision should proceed normally (no pending_review).
		assignment, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Do the thing",
		})
		require.NoError(t, err)
		require.NotNil(t, assignment)

		// Verify the run is still in running state, not pending_review.
		gotRun, err := repository.GetTeamRunByID(db, run.ID)
		require.NoError(t, err)
		assert.Equal(t, model.TeamRunStatusRunning, gotRun.Status)

		// Calling ReviewDagPlan when disabled should fail.
		_, err = svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
			Action: model.ReviewActionApprove,
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, errcode.ErrBadRequest)
	})

	t.Run("enabled sets pending_review after route decision", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		svc.SetHumanReviewEnabled(true)
		team, _, executor, run := seedAgentTeamRun(t, db)

		assignment, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Do the thing",
		})
		require.NoError(t, err)
		require.NotNil(t, assignment)

		// Verify the run is now pending_review.
		gotRun, err := repository.GetTeamRunByID(db, run.ID)
		require.NoError(t, err)
		assert.Equal(t, model.TeamRunStatusPendingReview, gotRun.Status)

		// Verify review_pending event was recorded.
		events, err := repository.ListTeamEventsByRun(db, run.ID)
		require.NoError(t, err)
		foundPending := false
		for _, e := range events {
			if e.Type == model.TeamEventReviewPending {
				foundPending = true
				break
			}
		}
		assert.True(t, foundPending, "expected team.review.pending event")
	})

	t.Run("enabled approve transitions back to running", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		svc.SetHumanReviewEnabled(true)
		team, _, executor, run := seedAgentTeamRun(t, db)

		_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Do the thing",
		})
		require.NoError(t, err)

		// Review: approve
		state, err := svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
			Action:  model.ReviewActionApprove,
			Comment: "looks good",
		})
		require.NoError(t, err)
		assert.Equal(t, model.ReviewActionApprove, state.Action)
		assert.Equal(t, "looks good", state.Comment)

		// Verify the run is back to running.
		gotRun, err := repository.GetTeamRunByID(db, run.ID)
		require.NoError(t, err)
		assert.Equal(t, model.TeamRunStatusRunning, gotRun.Status)

		// Verify review_decided event was recorded.
		events, err := repository.ListTeamEventsByRun(db, run.ID)
		require.NoError(t, err)
		foundDecided := false
		for _, e := range events {
			if e.Type == model.TeamEventReviewDecided {
				foundDecided = true
				break
			}
		}
		assert.True(t, foundDecided, "expected team.review.decided event")

		// The replay projection must leave the review gate too: before the
		// ReviewDecided replay fix the client-facing GetTeamRunState stayed
		// pending_review forever even though the DB row was already running.
		runState, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
		require.NoError(t, err)
		assert.Equal(t, model.TeamRunStatusRunning, runState.Status)
		require.Len(t, runState.Reviews, 1)
		assert.Equal(t, model.ReviewActionApprove, runState.Reviews[0].Action)
	})

	t.Run("decided review restores running in projection for discuss and modify", func(t *testing.T) {
		for _, action := range []string{model.ReviewActionDiscuss, model.ReviewActionModify} {
			db := setupAgentTeamStateSQLite(t)
			svc := NewAgentTeamService(db, nil, nil)
			svc.SetHumanReviewEnabled(true)
			team, _, executor, run := seedAgentTeamRun(t, db)

			_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
				Action:       "delegate",
				NextWorker:   executor.ID,
				Instructions: "Do the thing",
			})
			require.NoError(t, err)

			_, err = svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
				Action:  action,
				Comment: "not yet",
			})
			require.NoError(t, err)

			// Write side sets the DB row back to running for every decided
			// action; the projection must agree.
			runState, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
			require.NoError(t, err)
			assert.Equal(t, model.TeamRunStatusRunning, runState.Status, "action=%s", action)
		}
	})

	t.Run("enabled discuss cancels pending assignments", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		svc.SetHumanReviewEnabled(true)
		team, _, executor, run := seedAgentTeamRun(t, db)

		_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Do the thing",
		})
		require.NoError(t, err)

		// Verify assignment is pending before review.
		assignments, err := repository.ListAssignmentsByTeamRun(db, run.ID)
		require.NoError(t, err)
		require.Len(t, assignments, 1)
		assert.Equal(t, model.AssignmentStatusPending, assignments[0].Status)

		// Review: discuss
		state, err := svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
			Action:  model.ReviewActionDiscuss,
			Comment: "needs more thought",
		})
		require.NoError(t, err)
		assert.Equal(t, model.ReviewActionDiscuss, state.Action)

		// Verify the run is back to running (so supervisor can re-plan).
		gotRun, err := repository.GetTeamRunByID(db, run.ID)
		require.NoError(t, err)
		assert.Equal(t, model.TeamRunStatusRunning, gotRun.Status)

		// Verify assignments were cancelled.
		assignments, err = repository.ListAssignmentsByTeamRun(db, run.ID)
		require.NoError(t, err)
		require.Len(t, assignments, 1)
		assert.Equal(t, model.AssignmentStatusCancelled, assignments[0].Status)
	})

	t.Run("enabled modify cancels pending assignments with changes recorded", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		svc.SetHumanReviewEnabled(true)
		team, _, executor, run := seedAgentTeamRun(t, db)

		_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Do the thing",
		})
		require.NoError(t, err)

		state, err := svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
			Action: model.ReviewActionModify,
			Changes: []model.HumanReviewChange{
				{Field: "instructions", Value: "Do the other thing"},
				{Field: "next_worker", Value: "worker-2"},
			},
			Comment: "change the target",
		})
		require.NoError(t, err)
		assert.Equal(t, model.ReviewActionModify, state.Action)
		assert.Len(t, state.Changes, 2)
		assert.Equal(t, "instructions", state.Changes[0].Field)

		// Verify the run is back to running.
		gotRun, err := repository.GetTeamRunByID(db, run.ID)
		require.NoError(t, err)
		assert.Equal(t, model.TeamRunStatusRunning, gotRun.Status)

		// Verify assignments were cancelled.
		assignments, err := repository.ListAssignmentsByTeamRun(db, run.ID)
		require.NoError(t, err)
		assert.Equal(t, model.AssignmentStatusCancelled, assignments[0].Status)
	})

	t.Run("review rejects invalid action", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		svc.SetHumanReviewEnabled(true)
		team, _, executor, run := seedAgentTeamRun(t, db)

		_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Do the thing",
		})
		require.NoError(t, err)

		_, err = svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
			Action: "bogus",
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, errcode.ErrBadRequest)
	})

	t.Run("review rejects non-pending_review status", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		svc.SetHumanReviewEnabled(true)
		_, _, _, run := seedAgentTeamRun(t, db) // run status is "running"

		_, err := svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
			Action: model.ReviewActionApprove,
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, errcode.ErrBadRequest)
	})

	t.Run("review rejects non-owner user", func(t *testing.T) {
		db := setupAgentTeamStateSQLite(t)
		svc := NewAgentTeamService(db, nil, nil)
		svc.SetHumanReviewEnabled(true)
		team, _, executor, run := seedAgentTeamRun(t, db)

		_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
			Action:       "delegate",
			NextWorker:   executor.ID,
			Instructions: "Do the thing",
		})
		require.NoError(t, err)

		_, err = svc.ReviewDagPlan(context.Background(), "intruder-user", run.ID, model.HumanReviewDecision{
			Action: model.ReviewActionApprove,
		})
		require.Error(t, err)
		assert.Equal(t, errcode.AgentTaskNotFound, err)
	})
}

// ── State machine guards (terminal states & assignment reachability) ──

// TestAgentTeamService_CompleteAssignmentAcceptsDispatchedViaDispatchPath drives
// an assignment through the real production path (pending -> dispatched ->
// running via DispatchAssignment) and verifies CompleteAssignment succeeds
// without raw SQL status injection. CompleteAssignment also still accepts a
// legacy dispatched row for #1376 compatibility.
func TestAgentTeamService_CompleteAssignmentAcceptsDispatchedViaDispatchPath(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	agentSvc := &mockAgentTeamAgentSvc{returnTaskID: "task-complete-dispatched-1"}
	svc := NewAgentTeamService(db, agentSvc, nil)
	_, supervisor, executor, run := seedAgentTeamRun(t, db)
	seedTeamRunSession(t, db, run.SessionID, "user-1", executor)

	assignment, err := svc.CreateAssignment(context.Background(), "user-1", run.ID, supervisor.ID, executor.ID, model.AssignmentTypeDelegate, "Ship the feature", "")
	require.NoError(t, err)

	require.NoError(t, svc.DispatchAssignment(context.Background(), "user-1", assignment.ID))

	var running model.AgentTeamAssignment
	require.NoError(t, db.Where("id = ?", assignment.ID).First(&running).Error)
	require.Equal(t, model.AssignmentStatusRunning, running.Status)

	require.NoError(t, svc.CompleteAssignment(context.Background(), "user-1", assignment.ID, "shipped"))

	var done model.AgentTeamAssignment
	require.NoError(t, db.Where("id = ?", assignment.ID).First(&done).Error)
	assert.Equal(t, model.AssignmentStatusDone, done.Status)
	assert.Equal(t, "shipped", done.Result)

	// Legacy dispatched row (pre-#1384) must still complete.
	legacy := &model.AgentTeamAssignment{
		TeamRunID: run.ID, FromMemberID: supervisor.ID, ToMemberID: executor.ID,
		Type: model.AssignmentTypeDelegate, TaskPrompt: "legacy complete", Status: model.AssignmentStatusDispatched,
	}
	require.NoError(t, repository.CreateAssignment(db, legacy))
	require.NoError(t, svc.CompleteAssignment(context.Background(), "user-1", legacy.ID, "legacy shipped"))
	var legacyDone model.AgentTeamAssignment
	require.NoError(t, db.Where("id = ?", legacy.ID).First(&legacyDone).Error)
	assert.Equal(t, model.AssignmentStatusDone, legacyDone.Status)
}

// TestAgentTeamService_HandleRouteDecisionRejectsTerminalRun verifies that no
// route decision (delegate or a repeated finish) can mutate a run that already
// reached a terminal status, and that each rejection is audited.
func TestAgentTeamService_HandleRouteDecisionRejectsTerminalRun(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, executor, run := seedAgentTeamRun(t, db)
	require.NoError(t, repository.UpdateTeamRunStatus(db, run.ID, model.TeamRunStatusCompleted))

	// Delegate on a completed run must be rejected.
	_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
		Action:       "delegate",
		NextWorker:   executor.ID,
		Instructions: "Do more work",
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)

	// A repeated finish with blocked_reason must not downgrade completed to failed.
	_, err = svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
		Action:        "finish",
		BlockedReason: "should not overwrite",
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)

	gotRun, err := repository.GetTeamRunByID(db, run.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TeamRunStatusCompleted, gotRun.Status)

	assignments, err := repository.ListAssignmentsByTeamRun(db, run.ID)
	require.NoError(t, err)
	assert.Empty(t, assignments)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	rejected := 0
	for _, e := range events {
		if e.Type == model.TeamEventRouteRejected {
			rejected++
		}
	}
	assert.Equal(t, 2, rejected, "expected each terminal-run route decision to append team.route.rejected")
}

// TestAgentTeamService_FinishRouteDecisionDoesNotDowngradeTerminalRun calls
// finishRouteDecision directly (bypassing the HandleRouteDecision entry guard,
// as a racing finish would) and verifies the conditional status write keeps
// the first terminal outcome and does not emit a conflicting run.failed event.
func TestAgentTeamService_FinishRouteDecisionDoesNotDowngradeTerminalRun(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	_, _, _, run := seedAgentTeamRun(t, db)

	require.NoError(t, svc.finishRouteDecision(run.ID, model.CoordinatorRouteDecision{
		Action:  "finish",
		Summary: "all done",
	}))
	gotRun, err := repository.GetTeamRunByID(db, run.ID)
	require.NoError(t, err)
	require.Equal(t, model.TeamRunStatusCompleted, gotRun.Status)

	require.NoError(t, svc.finishRouteDecision(run.ID, model.CoordinatorRouteDecision{
		Action:        "finish",
		BlockedReason: "late failure",
	}))
	gotRun, err = repository.GetTeamRunByID(db, run.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TeamRunStatusCompleted, gotRun.Status)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	completedEvents, failedEvents := 0, 0
	for _, e := range events {
		switch e.Type {
		case model.TeamEventRunCompleted:
			completedEvents++
		case model.TeamEventRunFailed:
			failedEvents++
		}
	}
	assert.Equal(t, 1, completedEvents)
	assert.Zero(t, failedEvents, "repeated finish must not append team.run.failed")
}

// TestAgentTeamService_FailAssignmentRejectsTerminalAssignment verifies that a
// done/failed/cancelled assignment cannot be failed again, so repeated fails
// can no longer rewrite the stored result or re-trigger fault escalation.
func TestAgentTeamService_FailAssignmentRejectsTerminalAssignment(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	_, supervisor, executor, run := seedAgentTeamRun(t, db)

	for _, status := range []string{
		model.AssignmentStatusDone,
		model.AssignmentStatusFailed,
		model.AssignmentStatusCancelled,
	} {
		assignment := &model.AgentTeamAssignment{
			TeamRunID:    run.ID,
			FromMemberID: supervisor.ID,
			ToMemberID:   executor.ID,
			Type:         model.AssignmentTypeDelegate,
			TaskPrompt:   "Ship it",
			Status:       status,
			Result:       "original outcome",
		}
		require.NoError(t, repository.CreateAssignment(db, assignment))

		err := svc.FailAssignment(context.Background(), "user-1", assignment.ID, "[fault_escalation] retries=3 maxRetries=3 error=late")
		require.Error(t, err, "status=%s", status)
		assert.Equal(t, errcode.ErrBadRequest, err, "status=%s", status)

		var reloaded model.AgentTeamAssignment
		require.NoError(t, db.Where("id = ?", assignment.ID).First(&reloaded).Error)
		assert.Equal(t, status, reloaded.Status, "terminal status must be preserved")
		assert.Equal(t, "original outcome", reloaded.Result)
	}

	// The rejected fails must not have appended any team events (no repeated
	// escalation side effects).
	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	assert.Empty(t, events)
}

// ── Assignment lifecycle (#1384) ──────────────────────────────────────────────

func TestAgentTeamService_FailTimedOutAssignmentsTerminatesActiveAndIsIdempotent(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	guardrails := DefaultAgentTeamGuardrails()
	guardrails.AssignmentTimeout = time.Minute
	svc := NewAgentTeamServiceWithGuardrails(db, nil, nil, guardrails)
	_, supervisor, executor, run := seedAgentTeamRun(t, db)

	old := time.Now().Add(-2 * time.Hour)
	fresh := time.Now()
	timedOut := &model.AgentTeamAssignment{
		TeamRunID: run.ID, FromMemberID: supervisor.ID, ToMemberID: executor.ID,
		Type: model.AssignmentTypeDelegate, TaskPrompt: "stale work", Status: model.AssignmentStatusRunning,
		CreatedAt: old, UpdatedAt: old,
	}
	freshA := &model.AgentTeamAssignment{
		TeamRunID: run.ID, FromMemberID: supervisor.ID, ToMemberID: executor.ID,
		Type: model.AssignmentTypeDelegate, TaskPrompt: "fresh work", Status: model.AssignmentStatusPending,
		CreatedAt: fresh, UpdatedAt: fresh,
	}
	require.NoError(t, repository.CreateAssignment(db, timedOut))
	require.NoError(t, repository.CreateAssignment(db, freshA))
	// Force created_at past the guardrail (GORM autoCreateTime may overwrite on insert).
	require.NoError(t, db.Model(&model.AgentTeamAssignment{}).Where("id = ?", timedOut.ID).Update("created_at", old).Error)
	require.NoError(t, db.Model(&model.AgentTeamAssignment{}).Where("id = ?", freshA.ID).Update("created_at", fresh).Error)

	n, err := svc.FailTimedOutAssignments(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	reloaded, err := repository.GetAssignmentByID(db, timedOut.ID)
	require.NoError(t, err)
	assert.Equal(t, model.AssignmentStatusFailed, reloaded.Status)
	assert.Equal(t, "assignment timeout reached", reloaded.Result)

	stillFresh, err := repository.GetAssignmentByID(db, freshA.ID)
	require.NoError(t, err)
	assert.Equal(t, model.AssignmentStatusPending, stillFresh.Status)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventAssignmentFailed, events[0].Type)

	// Second scan must not rewrite or re-emit.
	n, err = svc.FailTimedOutAssignments(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 0, n)
	events, err = repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	assert.Len(t, events, 1)
}

func TestAgentTeamService_CompleteAssignmentConcurrentOnlyOneWins(t *testing.T) {
	db := setupAgentTeamConcurrentSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	_, supervisor, executor, run := seedAgentTeamRun(t, db)
	assignment := &model.AgentTeamAssignment{
		TeamRunID: run.ID, FromMemberID: supervisor.ID, ToMemberID: executor.ID,
		Type: model.AssignmentTypeDelegate, TaskPrompt: "race complete", Status: model.AssignmentStatusRunning,
	}
	require.NoError(t, repository.CreateAssignment(db, assignment))

	errs := runConcurrentRouteCalls(2, func() error {
		return svc.CompleteAssignment(context.Background(), "user-1", assignment.ID, "winner")
	})
	successes, bad := 0, 0
	for _, err := range errs {
		switch err {
		case nil:
			successes++
		case errcode.ErrBadRequest:
			bad++
		default:
			require.NoError(t, err)
		}
	}
	assert.Equal(t, 1, successes)
	assert.Equal(t, 1, bad)

	done, err := repository.GetAssignmentByID(db, assignment.ID)
	require.NoError(t, err)
	assert.Equal(t, model.AssignmentStatusDone, done.Status)
	assert.Equal(t, "winner", done.Result)
}

func TestAgentTeamService_GetTeamRunStateKeepsTerminalAssignmentOverPendingProjection(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, supervisor, executor, run := seedAgentTeamRun(t, db)
	pendingID := "pending-task-terminal-1"
	assignment := &model.AgentTeamAssignment{
		TeamRunID: run.ID, FromMemberID: supervisor.ID, ToMemberID: executor.ID,
		Type: model.AssignmentTypeDelegate, TaskPrompt: "already failed", Status: model.AssignmentStatusFailed,
		Result: "assignment timeout reached", RunID: &pendingID,
	}
	require.NoError(t, repository.CreateAssignment(db, assignment))
	require.NoError(t, db.Exec(
		"INSERT INTO pending_agent_tasks (id, agent_instance_id, trigger_message_id, triggered_by_user_id, status, expire_at) VALUES (?, ?, ?, ?, ?, ?)",
		pendingID, "agent-executor", "msg-1", "user-1", model.TaskStatusRunning, time.Now().Add(time.Hour),
	).Error)

	state, err := svc.GetTeamRunState(context.Background(), "user-1", team.ID, run.ID)
	require.NoError(t, err)
	require.Len(t, state.Assignments, 1)
	assert.Equal(t, model.AssignmentStatusFailed, state.Assignments[0].Status)
}

func TestIsTerminalTeamRunStatusIncludesCancelledWithoutCancelAPI(t *testing.T) {
	// Documented dead write-path: cancelled is a terminal guard token only.
	assert.True(t, isTerminalTeamRunStatus(model.TeamRunStatusCancelled))
	assert.True(t, isTerminalTeamRunStatus(model.TeamRunStatusCompleted))
	assert.True(t, isTerminalTeamRunStatus(model.TeamRunStatusFailed))
	assert.False(t, isTerminalTeamRunStatus(model.TeamRunStatusRunning))
}
