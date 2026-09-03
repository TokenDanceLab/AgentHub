package agentteam

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
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

	// Transaction: batch-delete members in one statement (#2102 F10) + delete team.
	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM "agent_team_members" WHERE team_id`).
		WillReturnResult(sqlmock.NewResult(0, 0))
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
