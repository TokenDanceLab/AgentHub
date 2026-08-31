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

func TestAgentTeamRepo_RemoveTeamMembersByTeamBatch(t *testing.T) {
	db := setupSQLite(t)

	teamA := &model.AgentTeam{Name: "A", OwnerID: "u1"}
	require.NoError(t, CreateTeam(db, teamA))
	teamB := &model.AgentTeam{Name: "B", OwnerID: "u1"}
	require.NoError(t, CreateTeam(db, teamB))

	add := func(teamID, id string) {
		require.NoError(t, AddTeamMember(db, &model.AgentTeamMember{
			TeamID: teamID, AgentProfileID: &id, Role: model.TeamMemberRoleExecutor,
		}))
	}
	for i, id := range []string{"a1", "a2", "a3"} {
		add(teamA.ID, id)
		_ = i
	}
	add(teamB.ID, "b1")

	require.NoError(t, RemoveTeamMembersByTeam(db, teamA.ID))

	membersA, err := ListTeamMembers(db, teamA.ID)
	require.NoError(t, err)
	assert.Empty(t, membersA)
	membersB, err := ListTeamMembers(db, teamB.ID)
	require.NoError(t, err)
	assert.Len(t, membersB, 1, "other team's members must survive")
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

func TestAgentTeamRepo_AssignmentCRUD(t *testing.T) {
	db := setupSQLite(t)

	// Create parent team, members, and run (foreign key dependencies).
	team := &model.AgentTeam{OwnerID: "user-1", Name: "Assignment Team"}
	require.NoError(t, CreateTeam(db, team))

	agentID1 := "agent-1"
	agentID2 := "agent-2"
	m1 := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID1, Role: model.TeamMemberRoleSupervisor}
	m2 := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID2, Role: model.TeamMemberRoleExecutor}
	require.NoError(t, AddTeamMember(db, m1))
	require.NoError(t, AddTeamMember(db, m2))

	run := &model.AgentTeamRun{TeamID: team.ID, TriggerUserID: "user-1", TriggerMessage: "test", Status: model.TeamRunStatusRunning}
	require.NoError(t, CreateTeamRun(db, run))

	a := &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: m1.ID,
		ToMemberID:   m2.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "Refactor auth.go",
		Depth:        0,
	}

	// Create
	err := CreateAssignment(db, a)
	require.NoError(t, err)
	assert.NotEmpty(t, a.ID)

	// Get
	got, err := GetAssignmentByID(db, a.ID)
	require.NoError(t, err)
	assert.Equal(t, a.TaskPrompt, got.TaskPrompt)
	assert.Equal(t, model.AssignmentStatusPending, got.Status)

	// List by team run
	list, err := ListAssignmentsByTeamRun(db, run.ID)
	require.NoError(t, err)
	assert.Len(t, list, 1)

	// Update status
	err = UpdateAssignmentStatus(db, a.ID, model.AssignmentStatusDispatched, "")
	require.NoError(t, err)
	got, err = GetAssignmentByID(db, a.ID)
	require.NoError(t, err)
	assert.Equal(t, model.AssignmentStatusDispatched, got.Status)
}

func TestAgentTeamRepo_CountActiveAssignments(t *testing.T) {
	db := setupSQLite(t)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "Count Team"}
	require.NoError(t, CreateTeam(db, team))

	agentID1 := "agent-1"
	agentID2 := "agent-2"
	agentID3 := "agent-3"
	m1 := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID1, Role: model.TeamMemberRoleSupervisor}
	m2 := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID2, Role: model.TeamMemberRoleExecutor}
	m3 := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID3, Role: model.TeamMemberRoleExecutor}
	require.NoError(t, AddTeamMember(db, m1))
	require.NoError(t, AddTeamMember(db, m2))
	require.NoError(t, AddTeamMember(db, m3))

	run := &model.AgentTeamRun{TeamID: team.ID, TriggerUserID: "user-1", Status: model.TeamRunStatusRunning}
	require.NoError(t, CreateTeamRun(db, run))

	// Create 3 active assignments from m1.
	for i := 0; i < 3; i++ {
		a := &model.AgentTeamAssignment{
			TeamRunID:    run.ID,
			FromMemberID: m1.ID,
			ToMemberID:   m2.ID,
			Type:         model.AssignmentTypeDelegate,
			TaskPrompt:   "Task",
			Status:       model.AssignmentStatusPending,
		}
		if i == 1 {
			a.Status = model.AssignmentStatusDispatched
		}
		if i == 2 {
			a.Status = model.AssignmentStatusRunning
		}
		require.NoError(t, CreateAssignment(db, a))
	}

	// Create 1 done assignment (should NOT be counted).
	done := &model.AgentTeamAssignment{
		TeamRunID:    run.ID,
		FromMemberID: m1.ID,
		ToMemberID:   m3.ID,
		Type:         model.AssignmentTypeDelegate,
		TaskPrompt:   "Done task",
		Status:       model.AssignmentStatusDone,
	}
	require.NoError(t, CreateAssignment(db, done))

	count, err := CountActiveAssignmentsByMember(db, m1.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(3), count)

	// m2 has no assignments as from_member.
	count2, err := CountActiveAssignmentsByMember(db, m2.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), count2)
}

func TestAgentTeamRepo_ListAssignmentsEmpty(t *testing.T) {
	db := setupSQLite(t)

	list, err := ListAssignmentsByTeamRun(db, "00000000-0000-0000-0000-000000000000")
	require.NoError(t, err)
	assert.NotNil(t, list)
	assert.Len(t, list, 0)
}

func TestAgentTeamRepo_AppendAndListTeamEvents(t *testing.T) {
	db := setupSQLite(t)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "Event Team"}
	require.NoError(t, CreateTeam(db, team))

	run := &model.AgentTeamRun{
		TeamID:         team.ID,
		TriggerUserID:  "user-1",
		TriggerMessage: "test",
		Status:         model.TeamRunStatusRunning,
	}
	require.NoError(t, CreateTeamRun(db, run))

	started := &model.AgentTeamEvent{
		TeamRunID: run.ID,
		Type:      model.TeamEventRunStarted,
		Payload:   `{"status":"running"}`,
	}
	require.NoError(t, AppendTeamEvent(db, started))
	assert.Equal(t, 1, started.Seq)

	completed := &model.AgentTeamEvent{
		TeamRunID: run.ID,
		Type:      model.TeamEventRunCompleted,
		Payload:   `{"summary":"done"}`,
	}
	require.NoError(t, AppendTeamEvent(db, completed))
	assert.Equal(t, 2, completed.Seq)

	events, err := ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 2)
	assert.Equal(t, model.TeamEventRunStarted, events[0].Type)
	assert.Equal(t, model.TeamEventRunCompleted, events[1].Type)
	assert.Equal(t, 1, events[0].Seq)
	assert.Equal(t, 2, events[1].Seq)
}
