package service

import (
	"context"
	"encoding/json"
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

	switch decision.Action {
	case model.ReviewActionApprove:
		// Accept the plan: set run back to running so dispatch can proceed.
		if err := repository.UpdateTeamRunStatus(s.db, runID, model.TeamRunStatusRunning); err != nil {
			return nil, err
		}
		state.Comment = firstNonEmptyString(state.Comment, "approved")

	case model.ReviewActionDiscuss:
		// Reject for discussion: cancel pending assignments, set run back to
		// running so the supervisor can generate a new plan with the feedback.
		if err := s.cancelPendingAssignmentsForReview(runID, decision.Comment); err != nil {
			return nil, err
		}
		if err := repository.UpdateTeamRunStatus(s.db, runID, model.TeamRunStatusRunning); err != nil {
			return nil, err
		}
		state.Comment = firstNonEmptyString(state.Comment, "returned for discussion")

	case model.ReviewActionModify:
		// Reject with modification notes: cancel pending assignments, set run
		// back to running. The supervisor should incorporate the changes into
		// a new route decision.
		if err := s.cancelPendingAssignmentsForReview(runID, decision.Comment); err != nil {
			return nil, err
		}
		if err := repository.UpdateTeamRunStatus(s.db, runID, model.TeamRunStatusRunning); err != nil {
			return nil, err
		}
		state.Comment = firstNonEmptyString(state.Comment, "returned with modifications")
	}

	// Record the review decision as an event.
	if err := s.appendTeamEvent(runID, model.TeamEventReviewDecided, state); err != nil {
		return nil, err
	}

	return state, nil
}

// cancelPendingAssignmentsForReview marks all pending assignments for a run as
// cancelled and records the cancellation reason.
func (s *AgentTeamService) cancelPendingAssignmentsForReview(runID, reason string) error {
	assignments, err := repository.ListAssignmentsByTeamRun(s.db, runID)
	if err != nil {
		return err
	}
	for _, a := range assignments {
		if a.Status == model.AssignmentStatusPending || a.Status == model.AssignmentStatusDispatched {
			if err := repository.UpdateAssignmentStatus(s.db, a.ID, model.AssignmentStatusCancelled, reason); err != nil {
				return err
			}
			if err := s.appendTeamEvent(runID, model.TeamEventAssignmentCancelled, map[string]string{
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
func (s *AgentTeamService) setRunPendingReview(runID string, latestDecision model.CoordinatorRouteDecision) error {
	if err := repository.UpdateTeamRunStatus(s.db, runID, model.TeamRunStatusPendingReview); err != nil {
		return err
	}
	return s.appendTeamEvent(runID, model.TeamEventReviewPending, map[string]any{
		"decision": latestDecision,
		"submitted_at": time.Now(),
	})
}

// GetHumanReviewEnabled exposes the human review flag for use in tests and
// external inspection.
func (s *AgentTeamService) GetHumanReviewEnabled() bool {
	return s.humanReviewEnabled
}

// replayReviewEvents populates the Reviews slice in TeamRunState from stored
// TeamEvent entries of type team.review.pending and team.review.decided.
func replayReviewEvents(events []model.AgentTeamEvent, state *model.TeamRunState) {
	state.Reviews = []model.HumanReviewState{}
	for _, event := range events {
		switch event.Type {
		case model.TeamEventReviewDecided:
			var review model.HumanReviewState
			if err := json.Unmarshal([]byte(event.Payload), &review); err == nil && review.Action != "" {
				state.Reviews = append(state.Reviews, review)
			}
		case model.TeamEventReviewPending:
			// Mark the run as awaiting review so the caller can detect it.
			if state.Status == model.TeamRunStatusRunning {
				state.Status = model.TeamRunStatusPendingReview
			}
		}
	}
}
