package service

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
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
		AddRow("run-1", "team-1", nil, "user-1", "hello", "completed", time.Now(), time.Now())
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
		AddRow("run-1", "team-2", nil, "user-1", "hello", "completed", time.Now(), time.Now())
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
		AddRow("run-1", "team-1", nil, "user-1", "msg1", "completed", time.Now(), time.Now()).
		AddRow("run-2", "team-1", nil, "user-1", "msg2", "running", time.Now(), time.Now())
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
