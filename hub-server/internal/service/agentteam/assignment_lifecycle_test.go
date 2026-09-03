package agentteam

import (
	"context"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
