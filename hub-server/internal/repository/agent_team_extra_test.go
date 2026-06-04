package repository

import (
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAgentTeamRepo_TaskCRUD(t *testing.T) {
	db := setupSQLite(t)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "Task Team"}
	require.NoError(t, CreateTeam(db, team))

	run := &model.AgentTeamRun{TeamID: team.ID, TriggerUserID: "user-1", Status: model.TeamRunStatusRunning}
	require.NoError(t, CreateTeamRun(db, run))

	agentID := "agent-1"
	m := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID, Role: model.TeamMemberRoleExecutor}
	require.NoError(t, AddTeamMember(db, m))

	task := &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: m.ID,
		Objective:        "Refactor auth",
	}
	err := CreateTeamTask(db, task)
	require.NoError(t, err)
	assert.NotEmpty(t, task.ID)
	assert.Equal(t, "{}", task.InputRefs)
	assert.Equal(t, 1, task.Attempt)
	assert.Equal(t, model.TeamTaskRiskNormal, task.RiskLevel)
	assert.Equal(t, model.TeamTaskStatusPending, task.Status)

	// List
	tasks, err := ListTeamTasksByRun(db, run.ID)
	require.NoError(t, err)
	assert.Len(t, tasks, 1)
}

func TestAgentTeamRepo_GetTeamTaskByAssignmentID(t *testing.T) {
	db := setupSQLite(t)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "TaskByAssign"}
	require.NoError(t, CreateTeam(db, team))
	run := &model.AgentTeamRun{TeamID: team.ID, TriggerUserID: "user-1", Status: model.TeamRunStatusRunning}
	require.NoError(t, CreateTeamRun(db, run))

	agentID := "agent-1"
	m := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID, Role: model.TeamMemberRoleExecutor}
	require.NoError(t, AddTeamMember(db, m))

	task := &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssignmentID:     strPtr("assign-1"),
		AssigneeMemberID: m.ID,
		Objective:        "Do something",
	}
	require.NoError(t, CreateTeamTask(db, task))

	got, err := GetTeamTaskByAssignmentID(db, "assign-1")
	require.NoError(t, err)
	assert.Equal(t, task.ID, got.ID)
}

func TestAgentTeamRepo_UpdateTeamTaskDispatchBinding(t *testing.T) {
	db := setupSQLite(t)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "DispatchBind"}
	require.NoError(t, CreateTeam(db, team))
	run := &model.AgentTeamRun{TeamID: team.ID, TriggerUserID: "user-1", Status: model.TeamRunStatusRunning}
	require.NoError(t, CreateTeamRun(db, run))

	agentID := "agent-1"
	m := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID, Role: model.TeamMemberRoleExecutor}
	require.NoError(t, AddTeamMember(db, m))

	task := &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: m.ID,
		Objective:        "Dispatch test",
	}
	require.NoError(t, CreateTeamTask(db, task))

	err := UpdateTeamTaskDispatchBinding(db, task.ID, "pending-task-1")
	require.NoError(t, err)

	tasks, err := ListTeamTasksByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	assert.Equal(t, model.TeamTaskStatusDispatched, tasks[0].Status)
	require.NotNil(t, tasks[0].RunID)
	assert.Equal(t, "pending-task-1", *tasks[0].RunID)
}

func TestAgentTeamRepo_CountAssignmentsByTeamRun(t *testing.T) {
	db := setupSQLite(t)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "CountAssign"}
	require.NoError(t, CreateTeam(db, team))

	agentID := "a1"
	m1 := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID, Role: model.TeamMemberRoleSupervisor}
	m2 := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID, Role: model.TeamMemberRoleExecutor}
	require.NoError(t, AddTeamMember(db, m1))
	require.NoError(t, AddTeamMember(db, m2))

	run := &model.AgentTeamRun{TeamID: team.ID, TriggerUserID: "user-1", Status: model.TeamRunStatusRunning}
	require.NoError(t, CreateTeamRun(db, run))

	for i := 0; i < 3; i++ {
		a := &model.AgentTeamAssignment{
			TeamRunID: run.ID, FromMemberID: m1.ID, ToMemberID: m2.ID,
			Type: model.AssignmentTypeDelegate, TaskPrompt: "T",
		}
		require.NoError(t, CreateAssignment(db, a))
	}

	count, err := CountAssignmentsByTeamRun(db, run.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(3), count)
}

func TestAgentTeamRepo_CountActiveAssignmentsByTeamRun(t *testing.T) {
	db := setupSQLite(t)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "CountActive"}
	require.NoError(t, CreateTeam(db, team))

	agentID := "a1"
	m1 := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID, Role: model.TeamMemberRoleSupervisor}
	m2 := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID, Role: model.TeamMemberRoleExecutor}
	require.NoError(t, AddTeamMember(db, m1))
	require.NoError(t, AddTeamMember(db, m2))

	run := &model.AgentTeamRun{TeamID: team.ID, TriggerUserID: "user-1", Status: model.TeamRunStatusRunning}
	require.NoError(t, CreateTeamRun(db, run))

	// 2 active + 1 done
	a1 := &model.AgentTeamAssignment{TeamRunID: run.ID, FromMemberID: m1.ID, ToMemberID: m2.ID, Type: model.AssignmentTypeDelegate, TaskPrompt: "A", Status: model.AssignmentStatusPending}
	a2 := &model.AgentTeamAssignment{TeamRunID: run.ID, FromMemberID: m1.ID, ToMemberID: m2.ID, Type: model.AssignmentTypeDelegate, TaskPrompt: "B", Status: model.AssignmentStatusRunning}
	a3 := &model.AgentTeamAssignment{TeamRunID: run.ID, FromMemberID: m1.ID, ToMemberID: m2.ID, Type: model.AssignmentTypeDelegate, TaskPrompt: "C", Status: model.AssignmentStatusDone}
	require.NoError(t, CreateAssignment(db, a1))
	require.NoError(t, CreateAssignment(db, a2))
	require.NoError(t, CreateAssignment(db, a3))

	count, err := CountActiveAssignmentsByTeamRun(db, run.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(2), count)
}

func TestAgentTeamRepo_UpdateAssignmentDispatchBinding(t *testing.T) {
	db := setupSQLite(t)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "DispatchAssign"}
	require.NoError(t, CreateTeam(db, team))

	agentID := "a1"
	m1 := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID, Role: model.TeamMemberRoleSupervisor}
	m2 := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID, Role: model.TeamMemberRoleExecutor}
	require.NoError(t, AddTeamMember(db, m1))
	require.NoError(t, AddTeamMember(db, m2))

	run := &model.AgentTeamRun{TeamID: team.ID, TriggerUserID: "user-1", Status: model.TeamRunStatusRunning}
	require.NoError(t, CreateTeamRun(db, run))

	a := &model.AgentTeamAssignment{TeamRunID: run.ID, FromMemberID: m1.ID, ToMemberID: m2.ID, Type: model.AssignmentTypeDelegate, TaskPrompt: "X"}
	require.NoError(t, CreateAssignment(db, a))

	err := UpdateAssignmentDispatchBinding(db, a.ID, "task-42")
	require.NoError(t, err)

	got, err := GetAssignmentByID(db, a.ID)
	require.NoError(t, err)
	assert.Equal(t, model.AssignmentStatusDispatched, got.Status)
	require.NotNil(t, got.RunID)
	assert.Equal(t, "task-42", *got.RunID)
}

func TestAgentTeamRepo_GetAssignmentByToMember(t *testing.T) {
	db := setupSQLite(t)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "ByToMember"}
	require.NoError(t, CreateTeam(db, team))

	agentID := "a1"
	m1 := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID, Role: model.TeamMemberRoleSupervisor}
	m2 := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &agentID, Role: model.TeamMemberRoleExecutor}
	require.NoError(t, AddTeamMember(db, m1))
	require.NoError(t, AddTeamMember(db, m2))

	run := &model.AgentTeamRun{TeamID: team.ID, TriggerUserID: "user-1", Status: model.TeamRunStatusRunning}
	require.NoError(t, CreateTeamRun(db, run))

	a := &model.AgentTeamAssignment{TeamRunID: run.ID, FromMemberID: m1.ID, ToMemberID: m2.ID, Type: model.AssignmentTypeDelegate, TaskPrompt: "Delegate to m2", Depth: 1}
	require.NoError(t, CreateAssignment(db, a))

	got, err := GetAssignmentByToMember(db, run.ID, m2.ID)
	require.NoError(t, err)
	assert.Equal(t, a.ID, got.ID)
}

func TestAgentTeamRepo_ArtifactsReplaceAndList(t *testing.T) {
	db := setupSQLite(t)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "ArtifactTeam"}
	require.NoError(t, CreateTeam(db, team))
	run := &model.AgentTeamRun{TeamID: team.ID, TriggerUserID: "user-1", Status: model.TeamRunStatusRunning}
	require.NoError(t, CreateTeamRun(db, run))

	artifacts := []model.AgentTeamArtifact{
		{TeamRunID: run.ID, Path: "/src/a.go", NormalizedPath: "src/a.go"},
		{TeamRunID: run.ID, Path: "/src/b.go", NormalizedPath: "src/b.go"},
	}
	err := ReplaceTeamArtifactsForRun(db, run.ID, artifacts)
	require.NoError(t, err)

	list, err := ListTeamArtifactsByRun(db, run.ID)
	require.NoError(t, err)
	assert.Len(t, list, 2)

	// Replace with new set
	artifacts2 := []model.AgentTeamArtifact{
		{TeamRunID: run.ID, Path: "/src/c.go", NormalizedPath: "src/c.go"},
	}
	err = ReplaceTeamArtifactsForRun(db, run.ID, artifacts2)
	require.NoError(t, err)

	list, err = ListTeamArtifactsByRun(db, run.ID)
	require.NoError(t, err)
	assert.Len(t, list, 1)
	assert.Equal(t, "src/c.go", list[0].NormalizedPath)

	// Replace with empty
	err = ReplaceTeamArtifactsForRun(db, run.ID, nil)
	require.NoError(t, err)
	list, err = ListTeamArtifactsByRun(db, run.ID)
	require.NoError(t, err)
	assert.Len(t, list, 0)
}

func TestAgentTeamRepo_GetTeamRunBySessionID(t *testing.T) {
	db := setupSQLite(t)

	team := &model.AgentTeam{OwnerID: "user-1", Name: "SessionRun"}
	require.NoError(t, CreateTeam(db, team))

	sessID := "session-xyz"
	run := &model.AgentTeamRun{TeamID: team.ID, SessionID: sessID, TriggerUserID: "user-1", Status: model.TeamRunStatusRunning}
	require.NoError(t, CreateTeamRun(db, run))

	got, err := GetTeamRunBySessionID(db, sessID)
	require.NoError(t, err)
	assert.Equal(t, run.ID, got.ID)
}
