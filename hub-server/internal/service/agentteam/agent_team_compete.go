package agentteam

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/uuidv7"
)

// CompeteAggregator is the interface for calling an LLM to compare
// multiple agent outputs and produce a comparison summary for compete mode.
type CompeteAggregator interface {
	// CompareResults sends the collected results to an LLM and returns a
	// comparison summary. The entries slice contains one entry per worker
	// with its assignment result.
	CompareResults(ctx context.Context, taskPrompt string, entries []model.CompeteSummaryEntry) (string, error)
}

// noOpCompeteAggregator returns a plain diff when no LLM is configured.
type noOpCompeteAggregator struct{}

func (noOpCompeteAggregator) CompareResults(_ context.Context, taskPrompt string, entries []model.CompeteSummaryEntry) (string, error) {
	var b strings.Builder
	b.WriteString("Comparison summary (no LLM configured):\n\n")
	fmt.Fprintf(&b, "Task: %s\n\n", taskPrompt)
	for i, e := range entries {
		fmt.Fprintf(&b, "=== Agent %d (member %s) ===\n%s\n\n", i+1, e.MemberID, truncateResult(e.Result, 2000))
	}
	return b.String(), nil
}

// defaultCompeteAggregator returns the baseline aggregator to use when no
// external aggregator is injected.
func defaultCompeteAggregator() CompeteAggregator {
	return noOpCompeteAggregator{}
}

// ensureCompeteAggregator returns the configured aggregator or a no-op fallback.
func (s *AgentTeamService) ensureCompeteAggregator() CompeteAggregator {
	if s.competeAggregator != nil {
		return s.competeAggregator
	}
	return defaultCompeteAggregator()
}

// SetCompeteAggregator injects a custom aggregator for compete mode.
func (s *AgentTeamService) SetCompeteAggregator(a CompeteAggregator) {
	s.competeAggregator = a
}

// HandleCompeteRouteDecision dispatches the same task to multiple team members
// in parallel (compete mode). It expects the decision's NextWorker to contain
// comma-separated member IDs. When NextWorker is empty, all non-supervisor
// members are used (subject to the max cap).
func (s *AgentTeamService) HandleCompeteRouteDecision(ctx context.Context, userID, teamID, runID string, decision model.CoordinatorRouteDecision) ([]model.AgentTeamAssignment, error) {
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
	if isTerminalTeamRunStatus(run.Status) {
		return nil, s.rejectRouteDecision(runID, decision, "team run already in terminal status "+run.Status)
	}

	decision.Action = "compete"
	if strings.TrimSpace(decision.Instructions) == "" {
		return nil, s.rejectRouteDecision(runID, decision, "instructions are required")
	}

	members, err := repository.ListTeamMembers(s.db, teamID)
	if err != nil {
		return nil, err
	}

	// Resolve workers: comma-separated from NextWorker, or all non-supervisor members.
	workerIDs := resolveCompeteWorkers(decision.NextWorker, members)
	if len(workerIDs) == 0 {
		return nil, s.rejectRouteDecision(runID, decision, "no compete workers found")
	}
	if len(workerIDs) > s.competeMaxAgents {
		return nil, s.rejectRouteDecision(runID, decision, fmt.Sprintf("compete workers (%d) exceed max (%d)", len(workerIDs), s.competeMaxAgents))
	}

	// Find supervisor.
	supervisor, _ := findSupervisorAndWorker(members, members[0].ID)
	if supervisor == nil {
		return nil, s.rejectRouteDecision(runID, decision, "supervisor member is required")
	}

	// Generate a correlation id to link this compete batch.
	correlationID := decision.CorrelationID
	if strings.TrimSpace(correlationID) == "" {
		correlationID = newCorrelationID()
	}
	decision.CorrelationID = correlationID
	decision.Accepted = true
	decision.AgentID = strings.Join(workerIDs, ",")

	// Serialize guardrail counting + all assignment creates inside a per-run
	// row lock so two concurrent compete dispatches cannot both pass the check-
	// then-act gap. A failed CreateTeamTask rolls back all preceding inserts
	// (all-or-nothing per compete batch, #1383).
	assignments := make([]model.AgentTeamAssignment, 0, len(workerIDs))
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
		if taskCount+int64(len(workerIDs)) > s.guardrails.MaxTasksPerTeamRun {
			return rejectRoute("task limit reached")
		}
		activeCount, err := repository.CountActiveAssignmentsByTeamRun(tx, runID)
		if err != nil {
			return err
		}
		if activeCount+int64(len(workerIDs)) > s.guardrails.MaxActiveSubAgentsPerRun {
			return rejectRoute("active subagent limit reached")
		}

		for _, workerID := range workerIDs {
			var worker *model.AgentTeamMember
			for i := range members {
				if members[i].ID == workerID {
					worker = &members[i]
					break
				}
			}
			if worker == nil {
				continue
			}

			assignment, err := s.createAssignmentInTx(tx, ctx, userID, runID, supervisor.ID, worker.ID, model.AssignmentTypeCompete, decision.Instructions, decision.Context)
			if err != nil {
				return err
			}
			assignments = append(assignments, *assignment)

			task := &model.AgentTeamTask{
				TeamRunID:        runID,
				AssignmentID:     &assignment.ID,
				AssigneeMemberID: workerID,
				Status:           model.TeamTaskStatusPending,
				Objective:        decision.Instructions,
				InputRefs:        "{}",
				Attempt:          1,
				RiskLevel:        model.TeamTaskRiskNormal,
			}
			if err := repository.CreateTeamTask(tx, task); err != nil {
				return err
			}
		}
		if len(assignments) == 0 {
			return rejectRoute("no compete assignments created")
		}
		if err := s.appendTeamEventTx(tx, runID, model.TeamEventCompeteDispatched, map[string]any{
			"decision":       decision,
			"worker_ids":     workerIDs,
			"assignment_ids": assignmentIDs(assignments),
			"correlation_id": correlationID,
		}); err != nil {
			return err
		}
		if err := s.appendTeamEventTx(tx, runID, model.TeamEventRouteDecided, decision); err != nil {
			return err
		}
		for i := range assignments {
			if err := s.appendTeamEventTx(tx, runID, model.TeamEventAssignmentCreated, &assignments[i]); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if reason, rejected := routeRejectionReason(err); rejected {
			return nil, s.rejectRouteDecision(runID, decision, reason)
		}
		return nil, err
	}

	return assignments, nil
}

// GenerateCompeteSummary collects completed compete assignments for a team run
// and calls the aggregator (LLM) to produce a comparison summary.
func (s *AgentTeamService) GenerateCompeteSummary(ctx context.Context, userID, runID string, req model.CompeteSummaryRequest) (*model.CompeteSummaryResponse, error) {
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
	if run.Mode != model.TeamRunModeCompete {
		return nil, errcode.ErrBadRequest
	}

	allAssignments, err := repository.ListAssignmentsByTeamRun(s.db, runID)
	if err != nil {
		return nil, err
	}

	// Collect compete assignments (type = "compete").
	entries := make([]model.CompeteSummaryEntry, 0, len(allAssignments))
	var taskPrompt string
	for _, a := range allAssignments {
		if a.Type != model.AssignmentTypeCompete {
			continue
		}
		if taskPrompt == "" {
			taskPrompt = a.TaskPrompt
		}
		entry := model.CompeteSummaryEntry{
			MemberID:     a.ToMemberID,
			AssignmentID: a.ID,
			Result:       a.Result,
			Status:       a.Status,
		}
		if a.RunID != nil {
			entry.AgentTaskID = *a.RunID
		}
		// Try to resolve the team task for this assignment.
		task, _ := repository.GetTeamTaskByAssignmentID(s.db, a.ID)
		if task != nil {
			entry.TaskID = task.ID
		}
		entries = append(entries, entry)
	}

	if len(entries) == 0 {
		return nil, errcode.AgentTaskNotFound
	}

	// If user supplied a custom prompt, prepend it.
	comparePrompt := taskPrompt
	if strings.TrimSpace(req.Prompt) != "" {
		comparePrompt = req.Prompt + "\n\nOriginal task: " + taskPrompt
	}

	aggregator := s.ensureCompeteAggregator()
	summary, err := aggregator.CompareResults(ctx, comparePrompt, entries)
	if err != nil {
		return nil, err
	}

	resp := &model.CompeteSummaryResponse{
		TeamRunID: runID,
		Summary:   summary,
		Entries:   entries,
	}

	if err := s.appendTeamEvent(runID, model.TeamEventCompeteAggregated, resp); err != nil {
		// Summary already computed; keep returning it but surface the
		// durability failure so operators can diagnose missing events.
		slog.Error("failed to append team.compete.aggregated event",
			"run_id", runID,
			"error", err,
		)
		return resp, err
	}

	return resp, nil
}

// resolveCompeteWorkers parses a comma-separated worker list. When input is
// empty, returns all non-supervisor members.
func resolveCompeteWorkers(nextWorker string, members []model.AgentTeamMember) []string {
	trimmed := strings.TrimSpace(nextWorker)
	if trimmed != "" {
		parts := strings.Split(trimmed, ",")
		result := make([]string, 0, len(parts))
		for _, p := range parts {
			if id := strings.TrimSpace(p); id != "" {
				result = append(result, id)
			}
		}
		return result
	}

	// Auto-select all non-supervisor members.
	result := make([]string, 0, len(members))
	for _, m := range members {
		if m.Role != model.TeamMemberRoleSupervisor {
			result = append(result, m.ID)
		}
	}
	return result
}

func assignmentIDs(assignments []model.AgentTeamAssignment) []string {
	ids := make([]string, len(assignments))
	for i, a := range assignments {
		ids[i] = a.ID
	}
	return ids
}

func truncateResult(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "...[truncated]"
}

func newCorrelationID() string {
	id, err := uuidv7.New()
	if err != nil {
		return fmt.Sprintf("compete-%d", timeNow().UnixNano())
	}
	return id
}

func timeNow() time.Time {
	return time.Now()
}
