package agentteam

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
