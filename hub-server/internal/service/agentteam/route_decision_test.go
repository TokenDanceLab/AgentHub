package agentteam

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
