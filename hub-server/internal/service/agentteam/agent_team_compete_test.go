package agentteam

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
