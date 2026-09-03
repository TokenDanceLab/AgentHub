package agentteam

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
)

func TestNormalizeRouteAction(t *testing.T) {
	assert.Equal(t, "delegate", normalizeRouteAction("  DeLeGaTe "))
	assert.Equal(t, "finish", normalizeRouteAction("FINISH"))
	assert.Equal(t, "", normalizeRouteAction("   "))
}

func TestRouteAssignmentType(t *testing.T) {
	assert.Equal(t, model.AssignmentTypeReview, routeAssignmentType("review"))
	assert.Equal(t, model.AssignmentTypeApprove, routeAssignmentType("APPROVE"))
	assert.Equal(t, model.AssignmentTypeDelegate, routeAssignmentType("delegate"))
	assert.Equal(t, model.AssignmentTypeDelegate, routeAssignmentType("unknown"))
	assert.Equal(t, model.AssignmentTypeDelegate, routeAssignmentType(""))
}

func TestFindSupervisorAndWorker(t *testing.T) {
	members := []model.AgentTeamMember{
		{ID: "m1", Role: model.TeamMemberRoleExecutor},
		{ID: "m2", Role: model.TeamMemberRoleSupervisor},
		{ID: "m3", Role: model.TeamMemberRoleExecutor},
	}
	sup, worker := findSupervisorAndWorker(members, "m3")
	require.NotNil(t, sup)
	require.NotNil(t, worker)
	assert.Equal(t, "m2", sup.ID)
	assert.Equal(t, "m3", worker.ID)

	sup, worker = findSupervisorAndWorker(members, "missing")
	require.NotNil(t, sup)
	assert.Equal(t, "m2", sup.ID)
	assert.Nil(t, worker)

	// No supervisor role → first member fallback.
	onlyWorkers := []model.AgentTeamMember{{ID: "w1", Role: model.TeamMemberRoleExecutor}}
	sup, worker = findSupervisorAndWorker(onlyWorkers, "w1")
	require.NotNil(t, sup)
	assert.Equal(t, "w1", sup.ID)
	require.NotNil(t, worker)
}

func TestFindTeamSupervisor(t *testing.T) {
	members := []model.AgentTeamMember{
		{ID: "m1", Role: model.TeamMemberRoleExecutor},
		{ID: "m2", Role: model.TeamMemberRoleSupervisor},
	}
	sup := findTeamSupervisor(members)
	require.NotNil(t, sup)
	assert.Equal(t, "m2", sup.ID)

	// Unified fallback (#1385): no explicit supervisor → first member.
	onlyWorkers := []model.AgentTeamMember{{ID: "m1", Role: model.TeamMemberRoleExecutor}}
	fallback := findTeamSupervisor(onlyWorkers)
	require.NotNil(t, fallback)
	assert.Equal(t, "m1", fallback.ID)

	assert.Nil(t, findTeamSupervisor(nil))
	assert.Nil(t, resolveTeamSupervisor(nil))
}

func TestRouteAuditStateFromDecision(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	decision := model.CoordinatorRouteDecision{
		Action:        "delegate",
		SubtaskID:     "st-1",
		ParentTaskID:  "pt-1",
		NextWorker:    "worker-1",
		CorrelationID: "corr-1",
	}
	audit := routeAuditStateFromDecision("accepted", decision, "fallback", now)
	assert.Equal(t, "accepted", audit.Status)
	assert.Equal(t, "delegate", audit.Action)
	assert.Equal(t, "st-1", audit.SubtaskID)
	assert.Equal(t, "worker-1", audit.AgentID)
	assert.Equal(t, "fallback", audit.Reason)
	assert.Equal(t, "corr-1", audit.CorrelationID)
	assert.Equal(t, now, audit.CreatedAt)

	decision.AgentID = "agent-explicit"
	decision.Reason = "explicit"
	audit = routeAuditStateFromDecision("rejected", decision, "fallback", now)
	assert.Equal(t, "agent-explicit", audit.AgentID)
	assert.Equal(t, "explicit", audit.Reason)
}

func TestRouteDecisionMatchesAndCount(t *testing.T) {
	target := model.CoordinatorRouteDecision{
		Action:       "Delegate",
		NextWorker:   " w1 ",
		Instructions: " do work ",
	}
	prev := model.CoordinatorRouteDecision{
		Action:       "delegate",
		NextWorker:   "w1",
		Instructions: "do work",
	}
	assert.True(t, routeDecisionMatches(prev, target))
	prev.Instructions = "other"
	assert.False(t, routeDecisionMatches(prev, target))

	matchPayload, err := json.Marshal(model.CoordinatorRouteDecision{
		Action: "delegate", NextWorker: "w1", Instructions: "do work",
	})
	require.NoError(t, err)
	rejectPayload, err := json.Marshal(model.CoordinatorRouteDecision{
		Action: "review", NextWorker: "w1", Instructions: "do work",
	})
	require.NoError(t, err)
	events := []model.AgentTeamEvent{
		{Type: model.TeamEventRouteDecided, Payload: string(matchPayload)},
		{Type: model.TeamEventRouteRejected, Payload: string(matchPayload)},
		{Type: model.TeamEventRouteDecided, Payload: string(rejectPayload)},
		{Type: model.TeamEventRouteDecided, Payload: "{not-json"},
		{Type: model.TeamEventRouteDecided, Payload: string(matchPayload)},
	}
	assert.Equal(t, 2, countMatchingRouteDecisionsInEvents(events, model.CoordinatorRouteDecision{
		Action: "delegate", NextWorker: "w1", Instructions: "do work",
	}))
}

func TestFinishRouteOutcome(t *testing.T) {
	status, eventType, payload := finishRouteOutcome(model.CoordinatorRouteDecision{Summary: "done"})
	assert.Equal(t, model.TeamRunStatusCompleted, status)
	assert.Equal(t, model.TeamEventRunCompleted, eventType)
	assert.Equal(t, "done", payload["summary"])

	status, eventType, payload = finishRouteOutcome(model.CoordinatorRouteDecision{BlockedReason: "stuck"})
	assert.Equal(t, model.TeamRunStatusFailed, status)
	assert.Equal(t, model.TeamEventRunFailed, eventType)
	assert.Equal(t, "stuck", payload["blocked_reason"])
}

func TestAssignmentDispatchPrompt(t *testing.T) {
	assert.Equal(t, "", assignmentDispatchPrompt(nil))
	assert.Equal(t, "task", assignmentDispatchPrompt(&model.AgentTeamAssignment{TaskPrompt: " task "}))
	assert.Equal(t, "task\n\nContext:\nctx", assignmentDispatchPrompt(&model.AgentTeamAssignment{
		TaskPrompt: "task",
		Context:    " ctx ",
	}))
}

func TestDispatchBindingHelpers(t *testing.T) {
	assert.True(t, canDispatchAssignmentStatus(model.AssignmentStatusPending))
	assert.True(t, canDispatchAssignmentStatus(model.AssignmentStatusDispatched))
	assert.False(t, canDispatchAssignmentStatus(model.AssignmentStatusRunning))
	assert.False(t, canDispatchAssignmentStatus(model.AssignmentStatusDone))

	assert.False(t, assignmentAlreadyBound(nil))
	assert.False(t, assignmentAlreadyBound(&model.AgentTeamAssignment{}))
	empty := ""
	assert.False(t, assignmentAlreadyBound(&model.AgentTeamAssignment{RunID: &empty}))
	runID := "run-1"
	assert.True(t, assignmentAlreadyBound(&model.AgentTeamAssignment{RunID: &runID}))
}

func TestFindAgentInstanceIDForMember(t *testing.T) {
	profile := "ca-1"
	other := "ca-2"
	agents := []model.AgentInstance{
		{ID: "ai-1", CustomAgentID: &other},
		{ID: "ai-2", CustomAgentID: &profile},
	}
	member := &model.AgentTeamMember{AgentProfileID: &profile}
	assert.Equal(t, "ai-2", findAgentInstanceIDForMember(agents, member))
	assert.Equal(t, "", findAgentInstanceIDForMember(agents, &model.AgentTeamMember{}))
	assert.Equal(t, "", findAgentInstanceIDForMember(agents, nil))
	assert.Equal(t, "", findAgentInstanceIDForMember(nil, member))
}

func TestNewTeamTaskBuilders(t *testing.T) {
	decision := model.CoordinatorRouteDecision{
		Instructions: "build it",
		ParentTaskID: " parent ",
	}
	task := newTeamTaskFromRoute("run-1", "asg-1", "worker-1", decision)
	require.NotNil(t, task)
	assert.Equal(t, "run-1", task.TeamRunID)
	require.NotNil(t, task.AssignmentID)
	assert.Equal(t, "asg-1", *task.AssignmentID)
	assert.Equal(t, "worker-1", task.AssigneeMemberID)
	require.NotNil(t, task.ParentTaskID)
	assert.Equal(t, "parent", *task.ParentTaskID)
	assert.Equal(t, model.TeamTaskStatusPending, task.Status)
	assert.Equal(t, "build it", task.Objective)
	assert.Equal(t, "{}", task.InputRefs)
	assert.Equal(t, 1, task.Attempt)
	assert.Equal(t, model.TeamTaskRiskNormal, task.RiskLevel)

	assert.Nil(t, newTeamTaskFromAssignment(nil))
	fromAsg := newTeamTaskFromAssignment(&model.AgentTeamAssignment{
		ID: "asg-9", TeamRunID: "run-9", ToMemberID: "m-9", TaskPrompt: "prompt",
	})
	require.NotNil(t, fromAsg)
	assert.Equal(t, "run-9", fromAsg.TeamRunID)
	require.NotNil(t, fromAsg.AssignmentID)
	assert.Equal(t, "asg-9", *fromAsg.AssignmentID)
	assert.Equal(t, "m-9", fromAsg.AssigneeMemberID)
	assert.Equal(t, "prompt", fromAsg.Objective)
}

func TestAssignmentDispatchedEventPayload(t *testing.T) {
	payload := assignmentDispatchedEventPayload("a1", "t1", "p1")
	assert.Equal(t, "a1", payload["assignment_id"])
	assert.Equal(t, "t1", payload["team_task_id"])
	assert.Equal(t, "p1", payload["agent_task_id"])
}

func TestParseFaultEscalationReason(t *testing.T) {
	raw := "[fault_escalation] retries=3 maxRetries=5 error=timeout exceeded"
	got := parseFaultEscalationReason(raw)
	assert.Equal(t, "3", got["retries"])
	assert.Equal(t, "5", got["maxRetries"])
	assert.Equal(t, "timeout", got["error"]) // Fields splits on space; error value is first token only

	// Defaults when prefix missing.
	got = parseFaultEscalationReason("plain failure")
	assert.Equal(t, "0", got["retries"])
	assert.Equal(t, "1", got["maxRetries"])
	assert.Equal(t, "plain failure", got["error"])
}

func TestFaultEscalationBuilders(t *testing.T) {
	ctx := map[string]string{
		"retries":    "2",
		"maxRetries": "3",
		"error":      "boom",
	}
	instr := buildFaultEscalationReviewInstructions("asg-1", ctx)
	assert.Contains(t, instr, "asg-1")
	assert.Contains(t, instr, "boom")
	assert.Contains(t, instr, "Retry count: 2 (max: 3)")

	decision := buildFaultEscalationReviewDecision("asg-1", "sup-1", ctx)
	assert.Equal(t, "review", decision.Action)
	assert.Equal(t, "sup-1", decision.NextWorker)
	assert.Equal(t, "asg-1", decision.CorrelationID)
	assert.Contains(t, decision.Reasoning, "asg-1")
	assert.Equal(t, instr, decision.Instructions)

	payload := faultEscalationReviewEventPayload("asg-1", ctx)
	assert.Equal(t, "asg-1", payload["assignment_id"])
	assert.Equal(t, "review", payload["phase"])
	assert.Equal(t, "boom", payload["error"])
	assert.Equal(t, "2", payload["retries"])
	assert.Equal(t, "3", payload["maxRetries"])
}

func TestSupervisorRouteModelParams(t *testing.T) {
	raw := supervisorRouteModelParams()
	require.NotEmpty(t, raw)
	var params map[string]string
	require.NoError(t, json.Unmarshal([]byte(raw), &params))
	assert.Contains(t, params["structured_output_schema"], `"action"`)
	assert.Contains(t, params["append_system_prompt"], "supervisor mode")
}

func TestIsTerminalTeamRunStatusIncludesCancelledWithoutCancelAPI(t *testing.T) {
	// Documented dead write-path: cancelled is a terminal guard token only.
	assert.True(t, isTerminalTeamRunStatus(model.TeamRunStatusCancelled))
	assert.True(t, isTerminalTeamRunStatus(model.TeamRunStatusCompleted))
	assert.True(t, isTerminalTeamRunStatus(model.TeamRunStatusFailed))
	assert.False(t, isTerminalTeamRunStatus(model.TeamRunStatusRunning))
}
