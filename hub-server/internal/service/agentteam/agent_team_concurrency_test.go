package agentteam

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type recordingAgentTeamControlSvc struct {
	mu        sync.Mutex
	calls     []agentTeamControlCall
	failCalls int
}

func (m *recordingAgentTeamControlSvc) DeliverToDesktopDevice(_ context.Context, userID, deviceID string, payload model.AgentControlPayload) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls = append(m.calls, agentTeamControlCall{userID: userID, deviceID: deviceID, payload: payload})
	if m.failCalls > 0 {
		m.failCalls--
		return errors.New("injected edge delivery failure")
	}
	return nil
}

func (m *recordingAgentTeamControlSvc) snapshot() []agentTeamControlCall {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]agentTeamControlCall(nil), m.calls...)
}

type blockingAgentTeamAgentSvc struct {
	mu      sync.Mutex
	calls   int
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (m *blockingAgentTeamAgentSvc) AddAgentToSession(context.Context, string, string, string, string, string) (*model.AgentInstance, error) {
	return &model.AgentInstance{}, nil
}

func (m *blockingAgentTeamAgentSvc) TriggerAgentTask(context.Context, string, string, string, string, string, string, string) (*model.PendingAgentTask, error) {
	m.mu.Lock()
	m.calls++
	m.mu.Unlock()
	m.once.Do(func() { close(m.entered) })
	<-m.release
	return &model.PendingAgentTask{ID: "external-task-1"}, nil
}

func (m *blockingAgentTeamAgentSvc) callCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls
}

type flakyAgentTeamAgentSvc struct {
	mu    sync.Mutex
	calls int
}

func (m *flakyAgentTeamAgentSvc) AddAgentToSession(context.Context, string, string, string, string, string) (*model.AgentInstance, error) {
	return &model.AgentInstance{}, nil
}

func (m *flakyAgentTeamAgentSvc) TriggerAgentTask(context.Context, string, string, string, string, string, string, string) (*model.PendingAgentTask, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	if m.calls == 1 {
		return nil, errors.New("injected trigger failure")
	}
	return &model.PendingAgentTask{ID: "external-task-retry"}, nil
}

func TestAgentTeamService_DecideApprovalConcurrentOppositeDecisionsFirstWins(t *testing.T) {
	db := setupAgentTeamConcurrentSQLite(t)
	controlSvc := &recordingAgentTeamControlSvc{}
	svc := NewAgentTeamService(db, nil, nil)
	svc.SetControlService(controlSvc)
	team, _, executor, run := seedAgentTeamRun(t, db)
	seedPendingApproval(t, db, run, executor, "approval-concurrent")

	type result struct {
		decision string
		err      error
	}
	start := make(chan struct{})
	results := make(chan result, 2)
	for _, decision := range []string{"allow", "deny"} {
		decision := decision
		go func() {
			<-start
			_, err := svc.DecideApproval(context.Background(), "user-1", team.ID, run.ID, "approval-concurrent", model.TeamApprovalDecision{Decision: decision})
			results <- result{decision: decision, err: err}
		}()
	}
	close(start)

	got := []result{<-results, <-results}
	var winner string
	conflicts := 0
	for _, item := range got {
		if item.err == nil {
			winner = item.decision
			continue
		}
		if errors.Is(item.err, errcode.ErrBadRequest) {
			conflicts++
			continue
		}
		require.NoError(t, item.err)
	}
	require.NotEmpty(t, winner)
	assert.Equal(t, 1, conflicts)

	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventApprovalDecided, events[0].Type)
	var recorded model.TeamApprovalDecision
	require.NoError(t, json.Unmarshal([]byte(events[0].Payload), &recorded))
	assert.Equal(t, winner, recorded.Decision)
	calls := controlSvc.snapshot()
	require.Len(t, calls, 1)
	require.NotNil(t, calls[0].payload.EdgeControl)
	assert.Equal(t, winner, calls[0].payload.EdgeControl.Decision)
}

func TestAgentTeamService_DecideApprovalDeliveryFailureKeepsDecisionForRetry(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	controlSvc := &recordingAgentTeamControlSvc{failCalls: 1}
	svc := NewAgentTeamService(db, nil, nil)
	svc.SetControlService(controlSvc)
	team, _, executor, run := seedAgentTeamRun(t, db)
	seedPendingApproval(t, db, run, executor, "approval-redelivery")

	_, err := svc.DecideApproval(context.Background(), "user-1", team.ID, run.ID, "approval-redelivery", model.TeamApprovalDecision{Decision: "allow"})
	require.Error(t, err)
	events, listErr := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, listErr)
	require.Len(t, events, 1)

	decided, err := svc.DecideApproval(context.Background(), "user-1", team.ID, run.ID, "approval-redelivery", model.TeamApprovalDecision{Decision: "allow"})
	require.NoError(t, err)
	assert.Equal(t, "allow", decided.Status)
	events, listErr = repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, listErr)
	assert.Len(t, events, 1)
	assert.Len(t, controlSvc.snapshot(), 2)
}

func TestAgentTeamService_ResolveConflictConcurrentResolutionsFirstWins(t *testing.T) {
	db := setupAgentTeamConcurrentSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, executor, run := seedAgentTeamRun(t, db)
	firstTaskID, secondTaskID, conflictID := seedTeamConflict(t, db, run, executor)

	start := make(chan struct{})
	results := make(chan error, 2)
	for _, selectedTaskID := range []string{firstTaskID, secondTaskID} {
		selectedTaskID := selectedTaskID
		go func() {
			<-start
			_, err := svc.ResolveConflict(context.Background(), "user-1", team.ID, run.ID, model.TeamConflictResolution{
				ConflictID:          conflictID,
				Resolution:          model.TeamConflictResolutionAcceptAgentTask,
				SelectedAgentTaskID: selectedTaskID,
			})
			results <- err
		}()
	}
	close(start)

	successes := 0
	conflicts := 0
	for range 2 {
		err := <-results
		switch {
		case err == nil:
			successes++
		case errors.Is(err, errcode.ErrBadRequest):
			conflicts++
		default:
			require.NoError(t, err)
		}
	}
	assert.Equal(t, 1, successes)
	assert.Equal(t, 1, conflicts)
	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.TeamEventConflictResolved, events[0].Type)
}

func TestAgentTeamService_DispatchAssignmentConcurrentCallsTriggerOnce(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	agentSvc := &blockingAgentTeamAgentSvc{entered: make(chan struct{}), release: make(chan struct{})}
	svc := NewAgentTeamService(db, agentSvc, nil)
	_, supervisor, executor, run := seedAgentTeamRun(t, db)
	seedTeamRunSession(t, db, run.SessionID, "user-1", executor)
	assignment := seedPendingAssignment(t, db, run, supervisor, executor)

	firstResult := make(chan error, 1)
	go func() {
		firstResult <- svc.DispatchAssignment(context.Background(), "user-1", assignment.ID)
	}()
	select {
	case <-agentSvc.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("first dispatch did not reach external trigger")
	}

	secondResult := make(chan error, 1)
	go func() {
		secondResult <- svc.DispatchAssignment(context.Background(), "user-1", assignment.ID)
	}()
	select {
	case err := <-secondResult:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		close(agentSvc.release)
		t.Fatal("concurrent dispatch did not return after losing CAS claim")
	}
	close(agentSvc.release)
	require.NoError(t, <-firstResult)
	assert.Equal(t, 1, agentSvc.callCount())

	var messages int64
	require.NoError(t, db.Model(&model.Message{}).Count(&messages).Error)
	assert.Equal(t, int64(1), messages)
	var tasks int64
	require.NoError(t, db.Model(&model.AgentTeamTask{}).Where("assignment_id = ?", assignment.ID).Count(&tasks).Error)
	assert.Equal(t, int64(1), tasks)
}

func TestAgentTeamService_DispatchAssignmentTriggerFailureReleasesClaim(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	agentSvc := &flakyAgentTeamAgentSvc{}
	svc := NewAgentTeamService(db, agentSvc, nil)
	_, supervisor, executor, run := seedAgentTeamRun(t, db)
	seedTeamRunSession(t, db, run.SessionID, "user-1", executor)
	assignment := seedPendingAssignment(t, db, run, supervisor, executor)

	err := svc.DispatchAssignment(context.Background(), "user-1", assignment.ID)
	require.ErrorContains(t, err, "injected trigger failure")
	reloaded, err := repository.GetAssignmentByID(db, assignment.ID)
	require.NoError(t, err)
	assert.Equal(t, model.AssignmentStatusPending, reloaded.Status)
	assert.Nil(t, reloaded.RunID)

	require.NoError(t, svc.DispatchAssignment(context.Background(), "user-1", assignment.ID))
	reloaded, err = repository.GetAssignmentByID(db, assignment.ID)
	require.NoError(t, err)
	assert.Equal(t, model.AssignmentStatusRunning, reloaded.Status)
	require.NotNil(t, reloaded.RunID)
	assert.Equal(t, "external-task-retry", *reloaded.RunID)
}

func TestAgentTeamService_HandleRouteDecisionConcurrentGuardrailDoesNotOverflow(t *testing.T) {
	db := setupAgentTeamConcurrentSQLite(t)
	guardrails := DefaultAgentTeamGuardrails()
	guardrails.MaxTasksPerTeamRun = 1
	guardrails.MaxActiveSubAgentsPerRun = 1
	svc := NewAgentTeamServiceWithGuardrails(db, nil, nil, guardrails)
	team, _, executor, run := seedAgentTeamRun(t, db)
	decision := model.CoordinatorRouteDecision{Action: "delegate", NextWorker: executor.ID, Instructions: "one slot only"}

	errs := runConcurrentRouteCalls(2, func() error {
		_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, decision)
		return err
	})
	assertOneSuccessOneBadRequest(t, errs)
	assertAssignmentAndTaskCounts(t, db, run.ID, 1, 1)
}

func TestAgentTeamService_CreateAssignmentConcurrentGuardrailDoesNotOverflow(t *testing.T) {
	db := setupAgentTeamConcurrentSQLite(t)
	guardrails := DefaultAgentTeamGuardrails()
	guardrails.MaxTasksPerTeamRun = 1
	guardrails.MaxActiveSubAgentsPerRun = 1
	svc := NewAgentTeamServiceWithGuardrails(db, nil, nil, guardrails)
	_, supervisor, executor, run := seedAgentTeamRun(t, db)

	errs := runConcurrentRouteCalls(2, func() error {
		_, err := svc.CreateAssignment(
			context.Background(), "user-1", run.ID, supervisor.ID, executor.ID,
			model.AssignmentTypeDelegate, "one direct assignment slot", "",
		)
		return err
	})
	assertOneSuccessOneBadRequest(t, errs)
	assertAssignmentAndTaskCounts(t, db, run.ID, 1, 0)
}

func TestAgentTeamService_HandleCompeteConcurrentBatchesStayAtomicAndWithinLimit(t *testing.T) {
	db := setupAgentTeamConcurrentSQLite(t)
	guardrails := DefaultAgentTeamGuardrails()
	guardrails.MaxTasksPerTeamRun = 2
	guardrails.MaxActiveSubAgentsPerRun = 2
	svc := NewAgentTeamServiceWithGuardrails(db, nil, nil, guardrails)
	team, supervisor, first, run := seedAgentTeamRun(t, db)
	secondProfile := "profile-second-executor"
	second := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &secondProfile, Role: model.TeamMemberRoleExecutor}
	require.NoError(t, repository.AddTeamMember(db, second))
	decision := model.CoordinatorRouteDecision{
		Action:       "compete",
		NextWorker:   first.ID + "," + second.ID,
		Instructions: "one atomic compete batch",
	}

	errs := runConcurrentRouteCalls(2, func() error {
		_, err := svc.HandleCompeteRouteDecision(context.Background(), "user-1", team.ID, run.ID, decision)
		return err
	})
	assertOneSuccessOneBadRequest(t, errs)
	assertAssignmentAndTaskCounts(t, db, run.ID, 2, 2)

	assignments, err := repository.ListAssignmentsByTeamRun(db, run.ID)
	require.NoError(t, err)
	for _, assignment := range assignments {
		assert.Equal(t, supervisor.ID, assignment.FromMemberID)
	}
}

func TestAgentTeamService_HandleCompeteTaskFailureRollsBackWholeBatch(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	team, _, first, run := seedAgentTeamRun(t, db)
	secondProfile := "profile-failing-executor"
	second := &model.AgentTeamMember{TeamID: team.ID, AgentProfileID: &secondProfile, Role: model.TeamMemberRoleExecutor}
	require.NoError(t, repository.AddTeamMember(db, second))
	injectedErr := errors.New("injected team task create failure")
	const callbackName = "test:agentteam_compete_task_failure"
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table == "agent_team_tasks" {
			tx.AddError(injectedErr)
		}
	}))
	t.Cleanup(func() { _ = db.Callback().Create().Remove(callbackName) })

	_, err := svc.HandleCompeteRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
		Action:       "compete",
		NextWorker:   first.ID + "," + second.ID,
		Instructions: "must roll back",
	})
	require.ErrorIs(t, err, injectedErr)
	assertAssignmentAndTaskCounts(t, db, run.ID, 0, 0)
	events, listErr := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, listErr)
	assert.Empty(t, events)
}

func seedPendingApproval(t *testing.T, db *gorm.DB, run *model.AgentTeamRun, executor *model.AgentTeamMember, approvalID string) {
	t.Helper()
	pending := &model.PendingAgentTask{
		ID:                "agent-task-" + approvalID,
		AgentInstanceID:   "agent-executor",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "message-" + approvalID,
		Status:            model.TaskStatusRunning,
		EdgeRunID:         "edge-run-" + approvalID,
		EdgeDeviceID:      "edge-device-" + approvalID,
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(pending).Error)
	require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
		TeamRunID:        run.ID,
		AssigneeMemberID: executor.ID,
		Status:           model.TeamTaskStatusRunning,
		Objective:        "approve once",
		RunID:            &pending.ID,
	}))
	require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
		TaskID:          pending.ID,
		EdgeRunID:       pending.EdgeRunID,
		SessionID:       run.SessionID,
		AgentInstanceID: pending.AgentInstanceID,
		EventType:       "run.agent.permission_requested",
		Payload:         `{"requestId":"` + approvalID + `","toolUseId":"tool-` + approvalID + `","toolName":"Bash","status":"pending"}`,
	}))
}

func seedTeamConflict(t *testing.T, db *gorm.DB, run *model.AgentTeamRun, firstMember *model.AgentTeamMember) (string, string, string) {
	t.Helper()
	secondProfile := "profile-conflict-reviewer"
	secondMember := &model.AgentTeamMember{TeamID: run.TeamID, AgentProfileID: &secondProfile, Role: model.TeamMemberRoleReviewer}
	require.NoError(t, repository.AddTeamMember(db, secondMember))
	firstTaskID := "conflict-task-first"
	secondTaskID := "conflict-task-second"
	for _, item := range []struct {
		member *model.AgentTeamMember
		taskID string
	}{
		{member: firstMember, taskID: firstTaskID},
		{member: secondMember, taskID: secondTaskID},
	} {
		require.NoError(t, repository.CreateTeamTask(db, &model.AgentTeamTask{
			TeamRunID: run.ID, AssigneeMemberID: item.member.ID, Status: model.TeamTaskStatusDone,
			Objective: "edit conflict.txt", RunID: &item.taskID,
		}))
		require.NoError(t, repository.CreateAgentRunEventWithNextSeq(db, &model.AgentRunEvent{
			TaskID: item.taskID, EdgeRunID: "edge-" + item.taskID, SessionID: run.SessionID,
			AgentInstanceID: "agent-" + item.taskID, EventType: "run.agent.file_change",
			Payload: `{"path":"conflict.txt","action":"modified","status":"completed"}`,
		}))
	}
	return firstTaskID, secondTaskID, conflictIDForPath("conflict.txt")
}

func seedPendingAssignment(t *testing.T, db *gorm.DB, run *model.AgentTeamRun, supervisor, executor *model.AgentTeamMember) *model.AgentTeamAssignment {
	t.Helper()
	assignment := &model.AgentTeamAssignment{
		TeamRunID: run.ID, FromMemberID: supervisor.ID, ToMemberID: executor.ID,
		Type: model.AssignmentTypeDelegate, TaskPrompt: "dispatch exactly once", Status: model.AssignmentStatusPending, Depth: 1,
	}
	require.NoError(t, repository.CreateAssignment(db, assignment))
	return assignment
}

func runConcurrentRouteCalls(count int, call func() error) []error {
	start := make(chan struct{})
	results := make(chan error, count)
	for range count {
		go func() {
			<-start
			results <- call()
		}()
	}
	close(start)
	errs := make([]error, 0, count)
	for range count {
		errs = append(errs, <-results)
	}
	return errs
}

func assertOneSuccessOneBadRequest(t *testing.T, errs []error) {
	t.Helper()
	successes := 0
	badRequests := 0
	for _, err := range errs {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, errcode.ErrBadRequest):
			badRequests++
		default:
			require.NoError(t, err)
		}
	}
	assert.Equal(t, 1, successes)
	assert.Equal(t, 1, badRequests)
}

func assertAssignmentAndTaskCounts(t *testing.T, db *gorm.DB, runID string, wantAssignments, wantTasks int64) {
	t.Helper()
	var assignments int64
	require.NoError(t, db.Model(&model.AgentTeamAssignment{}).Where("team_run_id = ?", runID).Count(&assignments).Error)
	assert.Equal(t, wantAssignments, assignments)
	var tasks int64
	require.NoError(t, db.Model(&model.AgentTeamTask{}).Where("team_run_id = ?", runID).Count(&tasks).Error)
	assert.Equal(t, wantTasks, tasks)
}

// TestAgentTeamService_ReviewDagPlanConcurrentDecisionsFirstWins is the race
// regression: before the CAS claim, concurrent ReviewDagPlan calls all passed
// the pending_review status read and each applied its side effects (double
// assignment cancels, duplicate review-decided events). With the conditional
// claim exactly one decision wins; the losers get the same ErrBadRequest as a
// stale-status call.
func TestAgentTeamService_ReviewDagPlanConcurrentDecisionsFirstWins(t *testing.T) {
	db := setupAgentTeamConcurrentSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	svc.SetHumanReviewEnabled(true)
	team, _, executor, run := seedAgentTeamRun(t, db)

	_, err := svc.HandleRouteDecision(context.Background(), "user-1", team.ID, run.ID, model.CoordinatorRouteDecision{
		Action:       "delegate",
		NextWorker:   executor.ID,
		Instructions: "Do the thing",
	})
	require.NoError(t, err)

	gotRun, err := repository.GetTeamRunByID(db, run.ID)
	require.NoError(t, err)
	require.Equal(t, model.TeamRunStatusPendingReview, gotRun.Status, "seed must reach pending_review")

	start := make(chan struct{})
	actions := []string{
		model.ReviewActionApprove,
		model.ReviewActionDiscuss,
		model.ReviewActionModify,
		model.ReviewActionApprove,
	}
	results := make(chan error, len(actions))
	for _, action := range actions {
		action := action
		go func() {
			<-start
			_, err := svc.ReviewDagPlan(context.Background(), "user-1", run.ID, model.HumanReviewDecision{
				Action:  action,
				Comment: "racing decision",
			})
			results <- err
		}()
	}
	close(start)

	winners, conflicts := 0, 0
	for range actions {
		err := <-results
		if err == nil {
			winners++
			continue
		}
		if errors.Is(err, errcode.ErrBadRequest) {
			conflicts++
			continue
		}
		require.NoError(t, err)
	}
	require.Equal(t, 1, winners, "exactly one concurrent decision may win")
	assert.Equal(t, len(actions)-1, conflicts)

	// Exactly one review-decided event despite four racing decisions.
	events, err := repository.ListTeamEventsByRun(db, run.ID)
	require.NoError(t, err)
	decided := 0
	for _, e := range events {
		if e.Type == model.TeamEventReviewDecided {
			decided++
		}
	}
	assert.Equal(t, 1, decided, "racing decisions must not duplicate review-decided events")

	finalRun, err := repository.GetTeamRunByID(db, run.ID)
	require.NoError(t, err)
	assert.Equal(t, model.TeamRunStatusRunning, finalRun.Status)
}
