package agentteam

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"gorm.io/gorm"
)

// ReviewDagPlan handles the human review decision for a team run that is in
// pending_review status. The decision action controls whether execution
// proceeds, is rejected for discussion, or is rejected with modifications.
func (s *AgentTeamService) ReviewDagPlan(ctx context.Context, userID, runID string, decision model.HumanReviewDecision) (*model.HumanReviewState, error) {
	if !s.humanReviewEnabled {
		return nil, errcode.ErrBadRequest
	}

	run, err := repository.GetTeamRunByID(s.db, runID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentTaskNotFound
		}
		return nil, err
	}
	if run.TriggerUserID != userID {
		s.recordTeamAudit(ctx, auditActionReviewDecide, runID, userID, auditOutcomeDenied, "not trigger user")
		return nil, errcode.AgentTaskNotFound
	}
	if run.Status != model.TeamRunStatusPendingReview {
		return nil, errcode.ErrBadRequest
	}

	decision.Action = strings.ToLower(strings.TrimSpace(decision.Action))
	if !model.ValidReviewActions()[decision.Action] {
		return nil, errcode.ErrBadRequest
	}

	now := time.Now()
	state := &model.HumanReviewState{
		ReviewID:  runID + "-review-" + now.Format("20060102T150405"),
		RunID:     runID,
		Action:    decision.Action,
		Comment:   strings.TrimSpace(decision.Comment),
		Changes:   decision.Changes,
		DecidedBy: userID,
		CreatedAt: now,
		DecidedAt: &now,
	}
	if state.Changes == nil {
		state.Changes = []model.HumanReviewChange{}
	}

	// Resolve the comment before opening the transaction: it is a pure function
	// of the action, so keeping it here means the closure below only writes.
	switch decision.Action {
	case model.ReviewActionApprove:
		// Accept the plan: the run is claimed back to running inside the
		// transaction below.
		state.Comment = firstNonEmptyString(state.Comment, "approved")

	case model.ReviewActionDiscuss:
		// Reject for discussion: cancel pending assignments so the supervisor
		// can generate a new plan with the feedback.
		state.Comment = firstNonEmptyString(state.Comment, "returned for discussion")

	case model.ReviewActionModify:
		// Reject with modification notes: cancel pending assignments; the
		// supervisor should incorporate the changes into a new route decision.
		state.Comment = firstNonEmptyString(state.Comment, "returned with modifications")
	}

	// The claim and every side effect it authorizes commit or roll back
	// together (#2256 E-P2-5).
	//
	// Two invariants this restores:
	//
	//   - The conditional status write still folds the :status-check + the
	//     status-write into one CAS, so concurrent or repeated decisions cannot
	//     both pass the guard above and then double-cancel assignments or
	//     double-append the review-decided event. The loser sees the same
	//     ErrBadRequest as the stale-status guard above. Under READ COMMITTED
	//     the loser's UPDATE blocks on the row lock the winner's transaction
	//     holds, then re-evaluates its predicate against the committed
	//     'running' row and matches zero rows.
	//   - Cancelling N assignments writes 2N rows (one conditional UPDATE plus
	//     one assignment_cancelled event each). Those writes used to run on
	//     s.db with no transaction, so a failure at step k left k-1 assignments
	//     cancelled with the k-th event permanently missing, and the caller's
	//     only compensation was a best-effort status write that could not undo
	//     the cancels. The team event log is the projection source for reviews
	//     (replayReviewEvents), so a cancelled assignment without its event is
	//     a divergence a reader can observe, not a cosmetic gap.
	//
	// Because the claim is now inside the transaction, the compensating
	// running -> pending_review write it used to need is gone: a failed
	// decision leaves the run in pending_review by rollback rather than by a
	// second best-effort write that could itself fail and strand the run in
	// 'running' with assignments already cancelled.
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		claimed, err := repository.UpdateTeamRunStatusIf(tx, runID,
			model.TeamRunStatusPendingReview, model.TeamRunStatusRunning)
		if err != nil {
			return err
		}
		if claimed == 0 {
			return errReviewClaimLost
		}

		if decision.Action == model.ReviewActionDiscuss || decision.Action == model.ReviewActionModify {
			if err := s.cancelPendingAssignmentsForReview(tx, runID, decision.Comment); err != nil {
				return err
			}
		}

		// Record the review decision as an event.
		return s.appendTeamEventTx(tx, runID, model.TeamEventReviewDecided, state)
	})
	if err != nil {
		if errors.Is(err, errReviewClaimLost) {
			return nil, errcode.ErrBadRequest
		}
		return nil, err
	}

	s.recordTeamAudit(ctx, auditActionReviewDecide, runID, userID, auditOutcomeSuccess, "")
	return state, nil
}

// errReviewClaimLost is the in-transaction sentinel for "this run is no longer
// in pending_review, so this decision lost the claim". It exists only to be
// mapped back to errcode.ErrBadRequest by the caller, which keeps the loser's
// response byte-identical to the stale-status guard; a bare ErrBadRequest
// returned from the closure would be indistinguishable from a real write
// failure in the error path.
var errReviewClaimLost = errors.New("agentteam: review claim lost")

// cancelPendingAssignmentsForReview marks all pending assignments for a run as
// cancelled and records the cancellation reason.
//
// tx is the caller's transaction: every write here must commit or roll back
// with the claim that authorized it (#2256 E-P2-5). The audit trail is written
// through appendTeamEventTx on the same handle for the same reason — a
// cancelled assignment whose event is missing is an observable divergence,
// because replayReviewEvents projects review state from the event log.
func (s *AgentTeamService) cancelPendingAssignmentsForReview(tx *gorm.DB, runID, reason string) error {
	assignments, err := repository.ListAssignmentsByTeamRun(tx, runID)
	if err != nil {
		return err
	}
	for _, a := range assignments {
		if a.Status == model.AssignmentStatusPending || a.Status == model.AssignmentStatusDispatched {
			updated, err := repository.UpdateAssignmentStatusIf(tx, a.ID,
				[]string{model.AssignmentStatusPending, model.AssignmentStatusDispatched},
				model.AssignmentStatusCancelled, reason)
			if err != nil {
				return err
			}
			if updated == 0 {
				continue
			}
			if err := s.appendTeamEventTx(tx, runID, model.TeamEventAssignmentCancelled, map[string]string{
				"assignment_id": a.ID,
				"reason":        reason,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

// setRunPendingReview transitions a team run into the pending_review state and
// records a review_pending event carrying the latest route decision context.
//
// Both writes are one transaction for the same reason as ReviewDagPlan: the
// event log is the projection source (replayReviewEvents marks the run as
// awaiting review only when it sees a review_pending event), so a status write
// that commits without its event leaves the row saying pending_review while the
// projection says running.
//
// Residual, deliberately not folded in: HandleRouteDecision commits the
// assignment + agent task in an earlier transaction and calls this afterwards
// (route_decision.go), so a failure here still leaves a created assignment on a
// run that never reached the review gate. Folding this into that transaction
// would route a DB failure through resolveRouteError, which appends a
// route_rejected event for anything that is not a rejectRoute marker — i.e. it
// would report an infrastructure failure as a policy rejection. Tracked in
// #2256 rather than mis-classified here.
func (s *AgentTeamService) setRunPendingReview(runID string, latestDecision model.CoordinatorRouteDecision) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.UpdateTeamRunStatus(tx, runID, model.TeamRunStatusPendingReview); err != nil {
			return err
		}
		return s.appendTeamEventTx(tx, runID, model.TeamEventReviewPending, map[string]any{
			"decision":     latestDecision,
			"submitted_at": time.Now(),
		})
	})
}

// replayReviewEvents populates the Reviews slice in TeamRunState from stored
// TeamEvent entries of type team.review.pending and team.review.decided.
func replayReviewEvents(events []model.AgentTeamEvent, state *model.TeamRunState) {
	state.Reviews = []model.HumanReviewState{}
	for _, event := range events {
		switch event.Type {
		case model.TeamEventReviewDecided:
			review, ok := decodeTeamEventPayload[model.HumanReviewState](event)
			if ok && review.Action != "" {
				state.Reviews = append(state.Reviews, review)
				// Mirror the write side (ReviewDagPlan): every decided action
				// (approve/discuss/modify) sets the run back to running in the
				// DB, so the projection must leave the review gate as well.
				if state.Status == model.TeamRunStatusPendingReview {
					state.Status = model.TeamRunStatusRunning
				}
			}
		case model.TeamEventReviewPending:
			// Mark the run as awaiting review so the caller can detect it.
			if state.Status == model.TeamRunStatusRunning {
				state.Status = model.TeamRunStatusPendingReview
			}
		}
	}
}
