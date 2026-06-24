package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/pkg/uuidv7"
	"gorm.io/gorm"
)

const supervisorRouteDecisionSchema = `{"type":"object","additionalProperties":false,"required":["action"],"properties":{"action":{"type":"string","enum":["delegate","review","approve","finish"]},"next_worker":{"type":"string","description":"AgentTeamMember id to receive delegate/review/approve work"},"instructions":{"type":"string","description":"Concrete task prompt for the next worker"},"reasoning":{"type":"string","description":"Why this route is appropriate"},"context":{"type":"string","description":"Additional context for the next worker"},"approved":{"type":"boolean"},"feedback":{"type":"string"},"summary":{"type":"string","description":"Final TeamRun summary for action=finish"},"blocked_reason":{"type":"string","description":"Why the TeamRun cannot continue"},"correlation_id":{"type":"string","description":"Optional id linking this route to prior work"}}}`

const supervisorRoutePrompt = "AgentHub TeamRun supervisor mode: decide the next team step with the structured output schema. Use action=delegate/review/approve with next_worker set to an AgentTeamMember id and instructions set to the next task, or action=finish with summary/blocked_reason when the TeamRun is done or blocked. Do not start sub-agents locally; Hub will create TeamAssignment and dispatch them."

func supervisorRouteModelParams() string {
	data, err := json.Marshal(map[string]string{
		"structured_output_schema": supervisorRouteDecisionSchema,
		"append_system_prompt":     supervisorRoutePrompt,
	})
	if err != nil {
		return ""
	}
	return string(data)
}

// GetTeamRun returns a single team run, verifying owner access.
func (s *AgentTeamService) HandleRouteDecision(ctx context.Context, userID, teamID, runID string, decision model.CoordinatorRouteDecision) (*model.AgentTeamAssignment, error) {
	if _, err := s.requireTeamOwner(ctx, userID, teamID); err != nil {
		return nil, err
	}
	run, err := repository.GetTeamRunByID(s.db, runID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentTaskNotFound
		}
		return nil, err
	}
	if run.TeamID != teamID {
		return nil, errcode.AgentTaskNotFound
	}

	decision.Action = strings.ToLower(strings.TrimSpace(decision.Action))
	if !model.ValidActions()[decision.Action] {
		return nil, s.rejectRouteDecision(runID, decision, "invalid action")
	}

	if decision.Action == "finish" {
		return nil, s.finishRouteDecision(runID, decision)
	}

	// Compete mode: dispatch the same task to multiple workers in parallel.
	if decision.Action == "compete" {
		assignments, err := s.HandleCompeteRouteDecision(ctx, userID, teamID, runID, decision)
		if err != nil {
			return nil, err
		}
		if len(assignments) == 0 {
			return nil, s.rejectRouteDecision(runID, decision, "no compete assignments created")
		}
		// Return the first assignment for API compatibility; the full list
		// is available via ListAssignments.
		return &assignments[0], nil
	}

	if strings.TrimSpace(decision.NextWorker) == "" {
		return nil, s.rejectRouteDecision(runID, decision, "next_worker is required")
	}
	if strings.TrimSpace(decision.Instructions) == "" {
		return nil, s.rejectRouteDecision(runID, decision, "instructions are required")
	}

	members, err := repository.ListTeamMembers(s.db, teamID)
	if err != nil {
		return nil, err
	}
	supervisor, worker := findSupervisorAndWorker(members, decision.NextWorker)
	if supervisor == nil {
		return nil, s.rejectRouteDecision(runID, decision, "supervisor member is required")
	}
	if worker == nil {
		return nil, s.rejectRouteDecision(runID, decision, "next_worker is not a team member")
	}

	taskCount, err := repository.CountAssignmentsByTeamRun(s.db, runID)
	if err != nil {
		return nil, err
	}
	if taskCount >= s.guardrails.MaxTasksPerTeamRun {
		return nil, s.rejectRouteDecision(runID, decision, "task limit reached")
	}
	timedOut, err := s.hasTimedOutActiveAssignment(runID)
	if err != nil {
		return nil, err
	}
	if timedOut {
		return nil, s.rejectRouteDecision(runID, decision, "assignment timeout reached")
	}
	activeCount, err := repository.CountActiveAssignmentsByTeamRun(s.db, runID)
	if err != nil {
		return nil, err
	}
	if activeCount >= s.guardrails.MaxActiveSubAgentsPerRun {
		return nil, s.rejectRouteDecision(runID, decision, "active subagent limit reached")
	}
	repeatCount, err := s.countMatchingRouteDecisions(runID, decision)
	if err != nil {
		return nil, err
	}
	if repeatCount >= s.guardrails.MaxRouteRepeats {
		return nil, s.rejectRouteDecision(runID, decision, "route repeat limit reached")
	}
	budgetExceeded, err := s.teamRunBudgetExceeded(runID)
	if err != nil {
		return nil, err
	}
	if budgetExceeded {
		return nil, s.rejectRouteDecision(runID, decision, "team run budget exceeded")
	}

	assignment, err := s.CreateAssignment(ctx, userID, runID, supervisor.ID, worker.ID, routeAssignmentType(decision.Action), decision.Instructions, decision.Context)
	if err != nil {
		if appendErr := s.appendRouteRejected(runID, decision, err.Error()); appendErr != nil {
			return nil, appendErr
		}
		return nil, err
	}
	task := &model.AgentTeamTask{
		TeamRunID:        runID,
		AssignmentID:     &assignment.ID,
		AssigneeMemberID: worker.ID,
		ParentTaskID:     stringPtrOrNil(strings.TrimSpace(decision.ParentTaskID)),
		Status:           model.TeamTaskStatusPending,
		Objective:        decision.Instructions,
		InputRefs:        "{}",
		Attempt:          1,
		RiskLevel:        model.TeamTaskRiskNormal,
	}
	if err := repository.CreateTeamTask(s.db, task); err != nil {
		return nil, err
	}
	decision.Accepted = true
	decision.SubtaskID = firstNonEmptyString(decision.SubtaskID, task.ID)
	decision.AgentID = firstNonEmptyString(decision.AgentID, worker.ID)

	if err := s.appendTeamEvent(runID, model.TeamEventRouteDecided, decision); err != nil {
		return nil, err
	}
	if err := s.appendTeamEvent(runID, model.TeamEventAssignmentCreated, assignment); err != nil {
		return nil, err
	}
	if err := s.appendTeamEvent(runID, model.TeamEventTaskCreated, task); err != nil {
		return nil, err
	}

	// Human review gate: when enabled, transition to pending_review
	// instead of letting the assignment proceed immediately.
	if s.humanReviewEnabled {
		if err := s.setRunPendingReview(runID, decision); err != nil {
			return nil, err
		}
	}

	return assignment, nil
}

func (s *AgentTeamService) finishRouteDecision(runID string, decision model.CoordinatorRouteDecision) error {
	if err := s.appendTeamEvent(runID, model.TeamEventRouteDecided, decision); err != nil {
		return err
	}
	status := model.TeamRunStatusCompleted
	eventType := model.TeamEventRunCompleted
	payload := map[string]string{"summary": decision.Summary}
	if strings.TrimSpace(decision.BlockedReason) != "" {
		status = model.TeamRunStatusFailed
		eventType = model.TeamEventRunFailed
		payload = map[string]string{"blocked_reason": decision.BlockedReason}
	}
	if err := repository.UpdateTeamRunStatus(s.db, runID, status); err != nil {
		return err
	}
	return s.appendTeamEvent(runID, eventType, payload)
}

func (s *AgentTeamService) rejectRouteDecision(runID string, decision model.CoordinatorRouteDecision, reason string) error {
	if err := s.appendRouteRejected(runID, decision, reason); err != nil {
		return err
	}
	return errcode.ErrBadRequest
}

func (s *AgentTeamService) appendRouteRejected(runID string, decision model.CoordinatorRouteDecision, reason string) error {
	decision.Accepted = false
	decision.Reason = firstNonEmptyString(decision.Reason, reason)
	decision.AgentID = firstNonEmptyString(decision.AgentID, decision.NextWorker)
	return s.appendTeamEvent(runID, model.TeamEventRouteRejected, map[string]any{
		"decision": decision,
		"reason":   reason,
	})
}

func routeAuditStateFromDecision(status string, decision model.CoordinatorRouteDecision, fallbackReason string, createdAt time.Time) model.TeamRouteAuditState {
	return model.TeamRouteAuditState{
		Status:        status,
		Action:        decision.Action,
		SubtaskID:     decision.SubtaskID,
		ParentTaskID:  decision.ParentTaskID,
		AgentID:       firstNonEmptyString(decision.AgentID, decision.NextWorker),
		Reason:        firstNonEmptyString(decision.Reason, fallbackReason),
		CorrelationID: decision.CorrelationID,
		CreatedAt:     createdAt,
	}
}

func (s *AgentTeamService) countMatchingRouteDecisions(runID string, decision model.CoordinatorRouteDecision) (int, error) {
	events, err := repository.ListTeamEventsByRun(s.db, runID)
	if err != nil {
		return 0, err
	}
	targetAction := strings.ToLower(strings.TrimSpace(decision.Action))
	targetWorker := strings.TrimSpace(decision.NextWorker)
	targetInstructions := strings.TrimSpace(decision.Instructions)
	count := 0
	for _, event := range events {
		if event.Type != model.TeamEventRouteDecided {
			continue
		}
		var previous model.CoordinatorRouteDecision
		if err := json.Unmarshal([]byte(event.Payload), &previous); err != nil {
			continue
		}
		if strings.ToLower(strings.TrimSpace(previous.Action)) == targetAction &&
			strings.TrimSpace(previous.NextWorker) == targetWorker &&
			strings.TrimSpace(previous.Instructions) == targetInstructions {
			count++
		}
	}
	return count, nil
}

func (s *AgentTeamService) appendTeamEvent(runID, eventType string, payload any) error {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return repository.AppendTeamEvent(s.db, &model.AgentTeamEvent{
		TeamRunID: runID,
		Type:      eventType,
		Payload:   string(payloadBytes),
	})
}

func (s *AgentTeamService) CreateAssignment(ctx context.Context, userID, teamRunID, fromMemberID, toMemberID, aType, taskPrompt, contextStr string) (*model.AgentTeamAssignment, error) {
	if taskPrompt == "" {
		return nil, errcode.ErrBadRequest
	}
	if aType == "" {
		aType = model.AssignmentTypeDelegate
	}

	// 1. Query TeamRun and verify trigger user.
	run, err := repository.GetTeamRunByID(s.db, teamRunID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentTaskNotFound
		}
		return nil, err
	}
	if run.TriggerUserID != userID {
		return nil, errcode.AgentTaskNotFound
	}

	// 2. Query fromMember and verify role is supervisor.
	fromMember, err := repository.GetTeamMemberByID(s.db, fromMemberID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentNotFound
		}
		return nil, err
	}
	if fromMember.Role != model.TeamMemberRoleSupervisor {
		return nil, errcode.ErrBadRequest
	}

	// 3. Query toMember and verify same team.
	toMember, err := repository.GetTeamMemberByID(s.db, toMemberID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentNotFound
		}
		return nil, err
	}
	if toMember.TeamID != fromMember.TeamID {
		return nil, errcode.ErrBadRequest
	}
	if fromMemberID == toMemberID {
		return nil, errcode.ErrBadRequest
	}

	// 4. Build ancestor chain and compute depth.
	ancestorDepth := 0
	var ancestorIDs []string // member IDs in the chain (both from and to)
	visitedAncestors := map[string]struct{}{}
	parentID := fromMemberID
	for {
		if _, seen := visitedAncestors[parentID]; seen {
			return nil, errcode.ErrBadRequest
		}
		visitedAncestors[parentID] = struct{}{}
		parentAssignment, aErr := repository.GetAssignmentByToMember(s.db, teamRunID, parentID)
		if aErr != nil {
			if errors.Is(aErr, gorm.ErrRecordNotFound) {
				break // root of chain
			}
			return nil, aErr
		}
		if parentAssignment.Depth > ancestorDepth {
			ancestorDepth = parentAssignment.Depth
		}
		ancestorIDs = append(ancestorIDs, parentAssignment.FromMemberID, parentAssignment.ToMemberID)
		parentID = parentAssignment.FromMemberID
	}

	newDepth := ancestorDepth + 1
	if newDepth > s.guardrails.MaxDelegationDepth {
		return nil, errcode.ErrBadRequest
	}

	// 5. Check total and active assignment limits for this team run.
	taskCount, err := repository.CountAssignmentsByTeamRun(s.db, teamRunID)
	if err != nil {
		return nil, err
	}
	if taskCount >= s.guardrails.MaxTasksPerTeamRun {
		return nil, errcode.ErrBadRequest
	}
	activeCount, err := repository.CountActiveAssignmentsByTeamRun(s.db, teamRunID)
	if err != nil {
		return nil, err
	}
	if activeCount >= s.guardrails.MaxActiveSubAgentsPerRun {
		return nil, errcode.ErrBadRequest
	}

	// 6. Check no duplicate member in ancestor chain.
	for _, mid := range ancestorIDs {
		if mid == toMemberID {
			return nil, errcode.ErrBadRequest
		}
	}

	// 7. Create assignment.
	assignment := &model.AgentTeamAssignment{
		TeamRunID:    teamRunID,
		FromMemberID: fromMemberID,
		ToMemberID:   toMemberID,
		Type:         aType,
		TaskPrompt:   taskPrompt,
		Context:      contextStr,
		Status:       model.AssignmentStatusPending,
		Depth:        newDepth,
	}
	if err := repository.CreateAssignment(s.db, assignment); err != nil {
		return nil, err
	}
	return assignment, nil
}

// DispatchAssignment dispatches a pending assignment to the target agent.
func (s *AgentTeamService) DispatchAssignment(ctx context.Context, userID, assignmentID string) error {
	// 1. Query assignment and verify team run owner.
	a, err := repository.GetAssignmentByID(s.db, assignmentID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentTaskNotFound
		}
		return err
	}

	run, err := repository.GetTeamRunByID(s.db, a.TeamRunID)
	if err != nil {
		return err
	}
	if run.TriggerUserID != userID {
		return errcode.AgentTaskNotFound
	}

	if a.Status != model.AssignmentStatusPending && a.Status != model.AssignmentStatusDispatched {
		return errcode.ErrBadRequest
	}
	if a.RunID != nil && strings.TrimSpace(*a.RunID) != "" {
		return nil
	}

	// 2. Find the target agent instance in the team run's session.
	if run.SessionID == "" {
		return errcode.AgentNotFound
	}

	toMember, err := repository.GetTeamMemberByID(s.db, a.ToMemberID)
	if err != nil {
		return err
	}

	agents, err := repository.ListAgentInstancesBySession(s.db, run.SessionID)
	if err != nil || len(agents) == 0 {
		return errcode.AgentNotFound
	}

	var targetAIID string
	for i := range agents {
		agent := &agents[i]
		if toMember.AgentProfileID != nil && agent.CustomAgentID != nil && *agent.CustomAgentID == *toMember.AgentProfileID {
			targetAIID = agent.ID
			break
		}
	}
	if targetAIID == "" {
		return errcode.AgentNotFound
	}

	teamTask, err := s.ensureTeamTaskForAssignment(a)
	if err != nil {
		return err
	}

	triggerMessageID, err := s.createAssignmentDispatchMessage(ctx, userID, run.SessionID, a)
	if err != nil {
		return err
	}

	pendingTask, triggerErr := s.agentSvc.TriggerAgentTask(ctx, userID, triggerMessageID, targetAIID, "", "", "", teamRunTargetID(run))
	if triggerErr != nil {
		slog.Error("failed to trigger dispatch for assignment", "assignment_id", assignmentID, "error", triggerErr)
		return triggerErr
	}
	if pendingTask == nil || pendingTask.ID == "" {
		return errcode.ErrInternal
	}

	if err := repository.UpdateAssignmentDispatchBinding(s.db, assignmentID, pendingTask.ID); err != nil {
		return err
	}
	if err := repository.UpdateTeamTaskDispatchBinding(s.db, teamTask.ID, pendingTask.ID); err != nil {
		return err
	}
	if err := s.appendTeamEvent(a.TeamRunID, model.TeamEventAssignmentDispatched, map[string]string{
		"assignment_id": assignmentID,
		"team_task_id":  teamTask.ID,
		"agent_task_id": pendingTask.ID,
	}); err != nil {
		return err
	}

	return nil
}

func (s *AgentTeamService) ensureTeamTaskForAssignment(a *model.AgentTeamAssignment) (*model.AgentTeamTask, error) {
	task, err := repository.GetTeamTaskByAssignmentID(s.db, a.ID)
	if err == nil {
		return task, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	assignmentID := a.ID
	task = &model.AgentTeamTask{
		TeamRunID:        a.TeamRunID,
		AssignmentID:     &assignmentID,
		AssigneeMemberID: a.ToMemberID,
		Status:           model.TeamTaskStatusPending,
		Objective:        a.TaskPrompt,
		InputRefs:        "{}",
		Attempt:          1,
		RiskLevel:        model.TeamTaskRiskNormal,
	}
	if err := repository.CreateTeamTask(s.db, task); err != nil {
		return nil, err
	}
	if err := s.appendTeamEvent(a.TeamRunID, model.TeamEventTaskCreated, task); err != nil {
		return nil, err
	}
	return task, nil
}

func (s *AgentTeamService) createAssignmentDispatchMessage(ctx context.Context, userID, sessionID string, a *model.AgentTeamAssignment) (string, error) {
	contentBytes, err := json.Marshal(map[string]string{"text": assignmentDispatchPrompt(a)})
	if err != nil {
		return "", err
	}
	msgClientID, err := uuidv7.New()
	if err != nil {
		return "", err
	}
	msg := &model.Message{
		SessionID:   sessionID,
		ClientMsgID: msgClientID,
		SenderType:  model.SenderTypeUser,
		SenderID:    userID,
		ContentType: model.ContentTypeText,
		Content:     string(contentBytes),
	}
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		seq, seqErr := repository.AllocateSeqID(tx, sessionID)
		if seqErr != nil {
			return seqErr
		}
		msg.SeqID = seq
		return repository.InsertMessage(tx, msg)
	}); err != nil {
		return "", err
	}
	return msg.ID, nil
}

func assignmentDispatchPrompt(a *model.AgentTeamAssignment) string {
	prompt := strings.TrimSpace(a.TaskPrompt)
	contextStr := strings.TrimSpace(a.Context)
	if contextStr == "" {
		return prompt
	}
	return prompt + "\n\nContext:\n" + contextStr
}

// CompleteAssignment marks a running assignment as done with the given result.
func (s *AgentTeamService) CompleteAssignment(ctx context.Context, userID, assignmentID string, result string) error {
	a, err := repository.GetAssignmentByID(s.db, assignmentID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentTaskNotFound
		}
		return err
	}

	run, err := repository.GetTeamRunByID(s.db, a.TeamRunID)
	if err != nil {
		return err
	}
	if run.TriggerUserID != userID {
		return errcode.AgentTaskNotFound
	}

	if a.Status != model.AssignmentStatusRunning {
		return errcode.ErrBadRequest
	}

	if err := repository.UpdateAssignmentStatus(s.db, assignmentID, model.AssignmentStatusDone, result); err != nil {
		return err
	}
	s.publishTeamEvent(ctx, "team.assignment.completed", map[string]interface{}{
		"team_run_id":   a.TeamRunID,
		"assignment_id": assignmentID,
		"session_id":    run.SessionID,
		"result":        result,
	})
	return nil
}

// FailAssignment marks an assignment as failed with the given reason.
func (s *AgentTeamService) FailAssignment(ctx context.Context, userID, assignmentID string, reason string) error {
	a, err := repository.GetAssignmentByID(s.db, assignmentID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentTaskNotFound
		}
		return err
	}

	run, err := repository.GetTeamRunByID(s.db, a.TeamRunID)
	if err != nil {
		return err
	}
	if run.TriggerUserID != userID {
		return errcode.AgentTaskNotFound
	}

	if err := repository.UpdateAssignmentStatus(s.db, assignmentID, model.AssignmentStatusFailed, reason); err != nil {
		return err
	}
	s.publishTeamEvent(ctx, "team.assignment.failed", map[string]interface{}{
		"team_run_id":   a.TeamRunID,
		"assignment_id": assignmentID,
		"session_id":    run.SessionID,
		"reason":        reason,
	})

	// Fault escalation: when an assignment fails with escalation metadata,
	// trigger Layer 2 (AI review) if configured.
	if strings.Contains(reason, "[fault_escalation]") {
		s.handleFaultEscalation(ctx, a, run, reason)
	}

	return nil
}

// handleFaultEscalation processes Layer 2 (AI review) and Layer 3 (replan)
// of the fault escalation chain when an Edge run has exhausted all retries.
//
// Layer 2 (AI review): Creates a review assignment for the supervisor to
// analyze the error output and suggest a fix or reassignment.
//
// Layer 3 (Replan): When the AI review determines the failure is not
// recoverable, the team run is marked as failed with a replan indication
// so the orchestrator can regenerate the plan with error context.
func (s *AgentTeamService) handleFaultEscalation(ctx context.Context, a *model.AgentTeamAssignment, run *model.AgentTeamRun, reason string) {
	// Parse fault escalation metadata from reason.
	// Format: "[fault_escalation] retries=N maxRetries=M error=..."
	escalationCtx := parseFaultEscalationReason(reason)

	members, err := repository.ListTeamMembers(s.db, run.TeamID)
	if err != nil {
		slog.Error("fault escalation: failed to list team members", "teamRunId", run.ID, "error", err)
		return
	}

	// Find the supervisor for AI review.
	var supervisor *model.AgentTeamMember
	for i := range members {
		if members[i].Role == model.TeamMemberRoleSupervisor {
			supervisor = &members[i]
			break
		}
	}

	// Layer 2: AI review — the supervisor analyzes the error and decides next steps.
	reviewInstructions := fmt.Sprintf(
		"Fault escalation: review the following run failure and decide next steps.\n\n"+
			"Failed assignment: %s\n"+
			"Error context: %s\n"+
			"Retry count: %s (max: %s)\n\n"+
			"Actions:\n"+
			"- If the error is recoverable (e.g., fixable bug), suggest a fix and reassign.\n"+
			"- If a different agent would be better suited, suggest reassignment.\n"+
			"- If the error is not recoverable, respond with action=finish and blocked_reason.",
		a.ID, escalationCtx["error"], escalationCtx["retries"], escalationCtx["maxRetries"],
	)

	// Create a review decision for the supervisor.
	decision := model.CoordinatorRouteDecision{
		Action:       "review",
		NextWorker:   supervisor.ID,
		Instructions: reviewInstructions,
		Reasoning:    fmt.Sprintf("Fault escalation Layer 2 triggered: assignment %s failed after %s retries", a.ID, escalationCtx["retries"]),
		CorrelationID: a.ID,
	}

	if _, err := s.HandleRouteDecision(ctx, run.TriggerUserID, run.TeamID, run.ID, decision); err != nil {
		slog.Error("fault escalation: failed to create review decision", "teamRunId", run.ID, "error", err)
		return
	}

	_ = s.appendTeamEvent(run.ID, "team.escalation.review", map[string]any{
		"assignment_id": a.ID,
		"phase":         "review",
		"error":         escalationCtx["error"],
		"retries":       escalationCtx["retries"],
		"maxRetries":    escalationCtx["maxRetries"],
	})

	slog.Warn("fault escalation: AI review triggered",
		"teamRunId", run.ID,
		"assignmentId", a.ID,
		"retries", escalationCtx["retries"],
	)
}

// parseFaultEscalationReason extracts structured metadata from a fault
// escalation reason string produced by the Edge server.
//
// Expected format: "[fault_escalation] retries=N maxRetries=M error=..."
func parseFaultEscalationReason(reason string) map[string]string {
	result := map[string]string{
		"retries":    "0",
		"maxRetries": "1",
		"error":      reason,
	}
	// Strip prefix.
	if idx := strings.Index(reason, "[fault_escalation]"); idx >= 0 {
		rest := reason[idx+len("[fault_escalation]"):]
		for _, part := range strings.Fields(rest) {
			if kv := strings.SplitN(part, "=", 2); len(kv) == 2 {
				result[kv[0]] = kv[1]
			}
		}
	}
	return result
}

func (s *AgentTeamService) ListAssignments(ctx context.Context, userID, teamRunID string) ([]model.AgentTeamAssignment, error) {
	run, err := repository.GetTeamRunByID(s.db, teamRunID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentTaskNotFound
		}
		return nil, err
	}
	if run.TriggerUserID != userID {
		return nil, errcode.AgentTaskNotFound
	}

	as, err := repository.ListAssignmentsByTeamRun(s.db, teamRunID)
	if err != nil {
		return nil, err
	}
	if as == nil {
		as = []model.AgentTeamAssignment{}
	}
	return as, nil
}
