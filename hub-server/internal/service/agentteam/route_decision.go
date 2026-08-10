package agentteam

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
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
	// Surface the specific guardrail reason (e.g. "route repeat limit
	// reached") in the API response instead of a generic "invalid request":
	// the coordinator UI needs to know which limit was hit.
	return errcode.ErrBadRequest.WithMessage(reason)
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
