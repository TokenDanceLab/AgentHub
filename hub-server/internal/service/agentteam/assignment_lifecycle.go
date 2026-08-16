package agentteam

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/uuidv7"
	"gorm.io/gorm"
)

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
	s.publishTeamEvent(ctx, bus.EventTypeTeamAssignmentDone, map[string]interface{}{
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
	s.publishTeamEvent(ctx, bus.EventTypeTeamAssignmentFail, map[string]interface{}{
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
//
// Scanning runs in bounded batches (failTimedOutBatchSize) instead of a single
// unbounded full-table scan so a large backlog cannot monopolize the DB or the
// per-tick goroutine. The caller's ctx is honored across batches via
// WithContext + an early-exit on ctx.Err(); the repository's per-row writes
// (status update / event append) stay on the same context-bearing handle.
func (s *AgentTeamService) FailTimedOutAssignments(ctx context.Context) (int, error) {
	const failTimedOutBatchSize = 100
	// Hard ceiling on iterations so a pathological producer (assignments timing
	// out faster than we can fail them) cannot pin the ticker indefinitely.
	const failTimedOutMaxBatches = 64

	failed := 0
	for batch := 0; batch < failTimedOutMaxBatches; batch++ {
		if err := ctx.Err(); err != nil {
			return failed, err
		}
		deadline := time.Now().Add(-s.guardrails.AssignmentTimeout)
		assignments, err := repository.ListTimedOutActiveAssignments(s.db.WithContext(ctx), deadline, failTimedOutBatchSize)
		if err != nil {
			return failed, err
		}
		if len(assignments) == 0 {
			return failed, nil
		}
		for i := range assignments {
			a := &assignments[i]
			reason := "assignment timeout reached"
			updated, err := repository.UpdateAssignmentStatusIf(s.db.WithContext(ctx), a.ID,
				[]string{
					model.AssignmentStatusPending,
					model.AssignmentStatusDispatched,
					model.AssignmentStatusRunning,
				},
				model.AssignmentStatusFailed, reason)
			if err != nil {
				if metrics.TeamAssignmentStateTransitionFailures != nil {
					metrics.TeamAssignmentStateTransitionFailures.WithLabelValues("status_update").Inc()
				}
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
				if metrics.TeamAssignmentStateTransitionFailures != nil {
					metrics.TeamAssignmentStateTransitionFailures.WithLabelValues("event_append").Inc()
				}
				slog.Warn("failed to append timeout event for assignment",
					"assignment_id", a.ID, "team_run_id", a.TeamRunID, "error", err)
				// Status already failed; keep counting so the scan reports progress.
			}
			if metrics.TeamAssignmentTimeouts != nil {
				metrics.TeamAssignmentTimeouts.Inc()
			}
			failed++
		}
		// A short batch means we drained the backlog; a full batch means more
		// rows may qualify, so loop again. The next iteration recomputes the
		// deadline so newly-timed-out rows are picked up too.
		if len(assignments) < failTimedOutBatchSize {
			return failed, nil
		}
	}
	slog.Warn("timed-out assignment scan hit batch ceiling; remaining rows deferred to next tick",
		"batch_ceiling", failTimedOutMaxBatches, "terminated_so_far", failed)
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
