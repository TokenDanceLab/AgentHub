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
