package repository

import (
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestAgentTeamRepo_CRUD(t *testing.T) {
	db := setupSQLite(t)

	team := &model.AgentTeam{
		OwnerID:     "user-1",
		Name:        "Test Team",
		Description: "A test team",
	}

	// Create
	err := CreateTeam(db, team)
	require.NoError(t, err)
	assert.NotEmpty(t, team.ID)

	// Get
	got, err := GetTeamByID(db, team.ID)
	require.NoError(t, err)
	assert.Equal(t, "Test Team", got.Name)
	assert.Equal(t, "user-1", got.OwnerID)

	// List by owner
	teams, err := ListTeamsByOwner(db, "user-1")
	require.NoError(t, err)
	assert.Len(t, teams, 1)

	// Update
	team.Name = "Updated Team"
	err = UpdateTeam(db, team)
	require.NoError(t, err)
	got, err = GetTeamByID(db, team.ID)
	require.NoError(t, err)
	assert.Equal(t, "Updated Team", got.Name)

	// Delete
	err = DeleteTeam(db, team.ID)
	require.NoError(t, err)
	_, err = GetTeamByID(db, team.ID)
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
}

func TestAgentTeamRepo_MemberCRUD(t *testing.T) {
	db := setupSQLite(t)

	team := &model.AgentTeam{
		OwnerID:     "user-1",
		Name:        "Member Test Team",
		Description: "Testing members",
	}
	require.NoError(t, CreateTeam(db, team))

	agentID := "agent-1"
	member := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: &agentID,
		Role:           model.TeamMemberRoleExecutor,
		Position:       1,
	}

	// Add
	err := AddTeamMember(db, member)
	require.NoError(t, err)
	assert.NotEmpty(t, member.ID)

	// List
	members, err := ListTeamMembers(db, team.ID)
	require.NoError(t, err)
	assert.Len(t, members, 1)
	assert.Equal(t, model.TeamMemberRoleExecutor, members[0].Role)

	// Get by ID
	got, err := GetTeamMemberByID(db, member.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TeamMemberRoleExecutor, got.Role)

	// Remove
	err = RemoveTeamMember(db, member.ID)
	require.NoError(t, err)
	members, err = ListTeamMembers(db, team.ID)
	require.NoError(t, err)
	assert.Len(t, members, 0)
}

func TestAgentTeamRepo_RunCRUD(t *testing.T) {
	db := setupSQLite(t)

	team := &model.AgentTeam{
		OwnerID: "user-1",
		Name:    "Run Test Team",
	}
	require.NoError(t, CreateTeam(db, team))

	run := &model.AgentTeamRun{
		TeamID:         team.ID,
		TriggerUserID:  "user-1",
		TriggerMessage: "Test trigger",
		Status:         model.TeamRunStatusQueued,
	}

	// Create
	err := CreateTeamRun(db, run)
	require.NoError(t, err)
	assert.NotEmpty(t, run.ID)

	// Get
	got, err := GetTeamRunByID(db, run.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TeamRunStatusQueued, got.Status)

	// List
	runs, err := ListTeamRunsByTeam(db, team.ID)
	require.NoError(t, err)
	assert.Len(t, runs, 1)

	// Update status
	err = UpdateTeamRunStatus(db, run.ID, model.TeamRunStatusCompleted)
	require.NoError(t, err)
	got, err = GetTeamRunByID(db, run.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TeamRunStatusCompleted, got.Status)
}

func TestAgentTeamRepo_ListTeamsByOwnerEmpty(t *testing.T) {
	db := setupSQLite(t)
	teams, err := ListTeamsByOwner(db, "nonexistent-user")
	require.NoError(t, err)
	assert.NotNil(t, teams)
	assert.Len(t, teams, 0)
}
