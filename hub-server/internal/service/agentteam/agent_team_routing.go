package agentteam

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/pkg/uuidv7"
	"gorm.io/gorm"
)

// HandleRouteDecision consumes a typed supervisor route decision and records
// the accepted or rejected route in the TeamEvent log.
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

	decision.Action = normalizeRouteAction(decision.Action)
	// Terminal-state guard: no route decision (delegate/review/approve/compete/
	// finish) may mutate a run that already reached a terminal status. This
	// also protects finishRouteDecision from downgrading completed to failed.
	if isTerminalTeamRunStatus(run.Status) {
		return nil, s.rejectRouteDecision(runID, decision, "team run already in terminal status "+run.Status)
	}
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

	// Serialize guardrail counting + assignment creation + task creation
	// inside a per-run row lock so two concurrent route decisions cannot
	// both pass the check-then-act gap (#1383).
	var assignment *model.AgentTeamAssignment
	var task *model.AgentTeamTask
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := repository.LockTeamRunForUpdate(tx, runID); err != nil {
			return err
		}
		lockedRun, err := repository.GetTeamRunByID(tx, runID)
		if err != nil {
			return err
		}
		if isTerminalTeamRunStatus(lockedRun.Status) {
			return rejectRoute("team run already in terminal status " + lockedRun.Status)
		}
		timedOut, err := s.hasTimedOutActiveAssignmentDB(tx, runID)
		if err != nil {
			return err
		}
		if timedOut {
			return rejectRoute("assignment timeout reached")
		}
		repeatCount, err := s.countMatchingRouteDecisionsDB(tx, runID, decision)
		if err != nil {
			return err
		}
		if repeatCount >= s.guardrails.MaxRouteRepeats {
			return rejectRoute("route repeat limit reached")
		}
		budgetExceeded, err := s.teamRunBudgetExceededDB(tx, runID)
		if err != nil {
			return err
		}
		if budgetExceeded {
			return rejectRoute("team run budget exceeded")
		}
		taskCount, err := repository.CountAssignmentsByTeamRun(tx, runID)
		if err != nil {
			return err
		}
		if taskCount >= s.guardrails.MaxTasksPerTeamRun {
			return rejectRoute("task limit reached")
		}
		activeCount, err := repository.CountActiveAssignmentsByTeamRun(tx, runID)
		if err != nil {
			return err
		}
		if activeCount >= s.guardrails.MaxActiveSubAgentsPerRun {
			return rejectRoute("active subagent limit reached")
		}
		assignment, err = s.createAssignmentInTx(tx, ctx, userID, runID, supervisor.ID, worker.ID, routeAssignmentType(decision.Action), decision.Instructions, decision.Context)
		if err != nil {
			return err
		}
		task = newTeamTaskFromRoute(runID, assignment.ID, worker.ID, decision)
		if err := repository.CreateTeamTask(tx, task); err != nil {
			return err
		}
		decision.Accepted = true
		decision.SubtaskID = firstNonEmptyString(decision.SubtaskID, task.ID)
		decision.AgentID = firstNonEmptyString(decision.AgentID, worker.ID)

		if err := s.appendTeamEventTx(tx, runID, model.TeamEventRouteDecided, decision); err != nil {
			return err
		}
		if err := s.appendTeamEventTx(tx, runID, model.TeamEventAssignmentCreated, assignment); err != nil {
			return err
		}
		return s.appendTeamEventTx(tx, runID, model.TeamEventTaskCreated, task)
	})
	if err != nil {
		if reason, rejected := routeRejectionReason(err); rejected {
			return nil, s.rejectRouteDecision(runID, decision, reason)
		}
		if appendErr := s.appendRouteRejected(runID, decision, err.Error()); appendErr != nil {
			return nil, appendErr
		}
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
	status, eventType, payload := finishRouteOutcome(decision)
	updated, err := repository.UpdateTeamRunStatusIfNotTerminal(s.db, runID, status)
	if err != nil {
		return err
	}
	if updated == 0 {
		// The run already reached a terminal status (e.g. a concurrent or
		// repeated finish): keep the first terminal outcome and skip the
		// conflicting run.completed/run.failed event so replay stays honest.
		return nil
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

func (s *AgentTeamService) countMatchingRouteDecisions(runID string, decision model.CoordinatorRouteDecision) (int, error) {
	return s.countMatchingRouteDecisionsDB(s.db, runID, decision)
}

func (s *AgentTeamService) countMatchingRouteDecisionsDB(db *gorm.DB, runID string, decision model.CoordinatorRouteDecision) (int, error) {
	events, err := repository.ListTeamEventsByRun(db, runID)
	if err != nil {
		return 0, err
	}
	return countMatchingRouteDecisionsInEvents(events, decision), nil
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

// appendTeamEventTx is the transaction-aware variant used inside per-run
// serialized blocks (DecideApproval, ResolveConflict).
func (s *AgentTeamService) appendTeamEventTx(tx *gorm.DB, runID, eventType string, payload any) error {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return repository.AppendTeamEvent(tx, &model.AgentTeamEvent{
		TeamRunID: runID,
		Type:      eventType,
		Payload:   string(payloadBytes),
	})
}

func (s *AgentTeamService) CreateAssignment(ctx context.Context, userID, teamRunID, fromMemberID, toMemberID, aType, taskPrompt, contextStr string) (*model.AgentTeamAssignment, error) {
	var assignment *model.AgentTeamAssignment
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := repository.LockTeamRunForUpdate(tx, teamRunID); err != nil {
			return err
		}
		var err error
		assignment, err = s.createAssignmentInTx(tx, ctx, userID, teamRunID, fromMemberID, toMemberID, aType, taskPrompt, contextStr)
		return err
	})
	return assignment, err
}

// createAssignmentInTx is the transaction-aware core of CreateAssignment.
// It uses tx for all DB operations so callers can serialize guardrail
// counting + insert inside a per-run row lock (#1383).
func (s *AgentTeamService) createAssignmentInTx(tx *gorm.DB, ctx context.Context, userID, teamRunID, fromMemberID, toMemberID, aType, taskPrompt, contextStr string) (*model.AgentTeamAssignment, error) {
	if taskPrompt == "" {
		return nil, errcode.ErrBadRequest
	}
	if aType == "" {
		aType = model.AssignmentTypeDelegate
	}

	// 1. Query TeamRun and verify trigger user.
	run, err := repository.GetTeamRunByID(tx, teamRunID)
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
	fromMember, err := repository.GetTeamMemberByID(tx, fromMemberID)
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
	toMember, err := repository.GetTeamMemberByID(tx, toMemberID)
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
		parentAssignment, aErr := repository.GetAssignmentByToMember(tx, teamRunID, parentID)
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
	taskCount, err := repository.CountAssignmentsByTeamRun(tx, teamRunID)
	if err != nil {
		return nil, err
	}
	if taskCount >= s.guardrails.MaxTasksPerTeamRun {
		return nil, errcode.ErrBadRequest
	}
	activeCount, err := repository.CountActiveAssignmentsByTeamRun(tx, teamRunID)
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
	if err := repository.CreateAssignment(tx, assignment); err != nil {
		return nil, err
	}
	return assignment, nil
}

// DispatchAssignment dispatches a pending assignment to the target agent.
// The flow is CAS-claim-first to prevent dual dispatch (#1383):
//  1. validate the immutable routing inputs
//  2. CAS claim pending → dispatched; only one caller wins
//  3. create local dispatch records and trigger the external task
//  4. bind run_id conditionally, or release the unbound claim on failure
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

	if !canDispatchAssignmentStatus(a.Status) {
		return errcode.ErrBadRequest
	}
	if assignmentAlreadyBound(a) {
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

	targetAIID := findAgentInstanceIDForMember(agents, toMember)
	if targetAIID == "" {
		return errcode.AgentNotFound
	}

	// Claim before creating the TeamTask/message so a losing concurrent caller
	// has no local or external side effects.
	claimed, err := repository.ClaimAssignmentForDispatch(s.db, assignmentID)
	if err != nil {
		return err
	}
	if claimed == 0 {
		current, getErr := repository.GetAssignmentByID(s.db, assignmentID)
		if getErr != nil {
			return getErr
		}
		if current.Status == model.AssignmentStatusDispatched || assignmentAlreadyBound(current) {
			return nil
		}
		return errcode.ErrBadRequest
	}

	teamTask, err := s.ensureTeamTaskForAssignment(a)
	if err != nil {
		return s.releaseDispatchClaim(assignmentID, err)
	}

	triggerMessageID, err := s.createAssignmentDispatchMessage(ctx, userID, run.SessionID, a)
	if err != nil {
		return s.releaseDispatchClaim(assignmentID, err)
	}

	pendingTask, triggerErr := s.agentSvc.TriggerAgentTask(ctx, userID, triggerMessageID, targetAIID, "", "", "", teamRunTargetID(run))
	if triggerErr != nil {
		slog.Error("failed to trigger dispatch for assignment", "assignment_id", assignmentID, "error", triggerErr)
		return s.releaseDispatchClaim(assignmentID, triggerErr)
	}
	if pendingTask == nil || pendingTask.ID == "" {
		return s.releaseDispatchClaim(assignmentID, errcode.ErrInternal)
	}

	bound, err := repository.BindClaimedAssignmentDispatch(s.db, assignmentID, pendingTask.ID)
	if err != nil {
		return err
	}
	if bound != 1 {
		return fmt.Errorf("bind dispatch claim for assignment %s: %w", assignmentID, errcode.ErrInternal)
	}
	// Task is bound and delivered to Edge: advance dispatched → running so
	// the DB status matches the projection layer (#1384). CompleteAssignment
	// still accepts dispatched for the #1376 compatibility path.
	if _, err := repository.MarkAssignmentRunningIfDispatched(s.db, assignmentID); err != nil {
		return err
	}
	if err := repository.UpdateTeamTaskDispatchBinding(s.db, teamTask.ID, pendingTask.ID); err != nil {
		return err
	}
	if err := s.appendTeamEvent(a.TeamRunID, model.TeamEventAssignmentDispatched, assignmentDispatchedEventPayload(assignmentID, teamTask.ID, pendingTask.ID)); err != nil {
		return err
	}

	return nil
}

type routeDecisionRejection struct {
	reason string
}

func (e *routeDecisionRejection) Error() string {
	return e.reason
}

func rejectRoute(reason string) error {
	return &routeDecisionRejection{reason: reason}
}

func routeRejectionReason(err error) (string, bool) {
	var rejection *routeDecisionRejection
	if !errors.As(err, &rejection) {
		return "", false
	}
	return rejection.reason, true
}

func (s *AgentTeamService) releaseDispatchClaim(assignmentID string, cause error) error {
	released, err := repository.ReleaseAssignmentDispatchClaim(s.db, assignmentID)
	if err != nil {
		return errors.Join(cause, fmt.Errorf("release dispatch claim: %w", err))
	}
	if released != 1 {
		return errors.Join(cause, fmt.Errorf("release dispatch claim: %w", errcode.ErrInternal))
	}
	return cause
}

func (s *AgentTeamService) ensureTeamTaskForAssignment(a *model.AgentTeamAssignment) (*model.AgentTeamTask, error) {
	task, err := repository.GetTeamTaskByAssignmentID(s.db, a.ID)
	if err == nil {
		return task, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	task = newTeamTaskFromAssignment(a)
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

// CompleteAssignment marks a running (or still-dispatched) assignment as done.
// Dispatched remains accepted so Completes that race the running write, or
// legacy rows from before #1384, still reach a terminal status (#1376).
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

	if a.Status != model.AssignmentStatusDispatched && a.Status != model.AssignmentStatusRunning {
		return errcode.ErrBadRequest
	}

	updated, err := repository.UpdateAssignmentStatusIf(s.db, assignmentID,
		[]string{model.AssignmentStatusDispatched, model.AssignmentStatusRunning},
		model.AssignmentStatusDone, result)
	if err != nil {
		return err
	}
	if updated == 0 {
		// Lost a race to complete/fail/timeout; surface as bad request rather
		// than re-publishing completion side effects.
		return errcode.ErrBadRequest
	}
	if err := s.appendTeamEvent(a.TeamRunID, model.TeamEventAssignmentCompleted, map[string]string{
		"assignment_id": assignmentID,
		"result":        result,
	}); err != nil {
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

	// Terminal assignments (done/failed/cancelled) must not be failed again:
	// repeated fails would rewrite the result and re-trigger fault escalation.
	if !isActiveAssignmentStatus(a.Status) {
		return errcode.ErrBadRequest
	}

	updated, err := repository.UpdateAssignmentStatusIf(s.db, assignmentID,
		[]string{
			model.AssignmentStatusPending,
			model.AssignmentStatusDispatched,
			model.AssignmentStatusRunning,
		},
		model.AssignmentStatusFailed, reason)
	if err != nil {
		return err
	}
	if updated == 0 {
		return errcode.ErrBadRequest
	}
	if err := s.appendTeamEvent(a.TeamRunID, model.TeamEventAssignmentFailed, map[string]string{
		"assignment_id": assignmentID,
		"reason":        reason,
	}); err != nil {
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

// FailTimedOutAssignments scans for active assignments past the guardrail
// timeout and terminates each with failed + assignment.failed event. This is
// the write-side counterpart of hasTimedOutActiveAssignment, which only blocks
// new routes. Returns the number of assignments successfully terminated.
func (s *AgentTeamService) FailTimedOutAssignments(ctx context.Context) (int, error) {
	_ = ctx
	deadline := time.Now().Add(-s.guardrails.AssignmentTimeout)
	assignments, err := repository.ListTimedOutActiveAssignments(s.db, deadline, 0)
	if err != nil {
		return 0, err
	}
	failed := 0
	for i := range assignments {
		a := &assignments[i]
		reason := "assignment timeout reached"
		updated, err := repository.UpdateAssignmentStatusIf(s.db, a.ID,
			[]string{
				model.AssignmentStatusPending,
				model.AssignmentStatusDispatched,
				model.AssignmentStatusRunning,
			},
			model.AssignmentStatusFailed, reason)
		if err != nil {
			slog.Warn("failed to terminate timed-out assignment",
				"assignment_id", a.ID, "team_run_id", a.TeamRunID, "error", err)
			continue
		}
		if updated == 0 {
			continue
		}
		if err := s.appendTeamEvent(a.TeamRunID, model.TeamEventAssignmentFailed, map[string]string{
			"assignment_id": a.ID,
			"reason":        reason,
		}); err != nil {
			slog.Warn("failed to append timeout event for assignment",
				"assignment_id", a.ID, "team_run_id", a.TeamRunID, "error", err)
			// Status already failed; keep counting so the scan reports progress.
		}
		failed++
	}
	return failed, nil
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

	supervisor := findTeamSupervisor(members)
	if supervisor == nil {
		slog.Error("fault escalation: no supervisor member", "teamRunId", run.ID)
		return
	}

	// Layer 2: AI review — the supervisor analyzes the error and decides next steps.
	decision := buildFaultEscalationReviewDecision(a.ID, supervisor.ID, escalationCtx)

	if _, err := s.HandleRouteDecision(ctx, run.TriggerUserID, run.TeamID, run.ID, decision); err != nil {
		slog.Error("fault escalation: failed to create review decision", "teamRunId", run.ID, "error", err)
		return
	}

	if err := s.appendTeamEvent(run.ID, "team.escalation.review", faultEscalationReviewEventPayload(a.ID, escalationCtx)); err != nil {
		slog.Warn("team.escalation.review event append failed", "run_id", run.ID, "err", err)
		if metrics.TeamFaultEscalationReviewEventFailures != nil {
			metrics.TeamFaultEscalationReviewEventFailures.Inc()
		}
	}

	slog.Warn("fault escalation: AI review triggered",
		"teamRunId", run.ID,
		"assignmentId", a.ID,
		"retries", escalationCtx["retries"],
	)
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
