package agentteam

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/pkg/uuidv7"
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
	b.WriteString(fmt.Sprintf("Task: %s\n\n", taskPrompt))
	for i, e := range entries {
		b.WriteString(fmt.Sprintf("=== Agent %d (member %s) ===\n%s\n\n", i+1, e.MemberID, truncateResult(e.Result, 2000)))
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

	// Guardrail checks (reuse existing limits).
	taskCount, err := repository.CountAssignmentsByTeamRun(s.db, runID)
	if err != nil {
		return nil, err
	}
	if taskCount+int64(len(workerIDs)) > s.guardrails.MaxTasksPerTeamRun {
		return nil, s.rejectRouteDecision(runID, decision, "task limit reached")
	}
	activeCount, err := repository.CountActiveAssignmentsByTeamRun(s.db, runID)
	if err != nil {
		return nil, err
	}
	if activeCount+int64(len(workerIDs)) > s.guardrails.MaxActiveSubAgentsPerRun {
		return nil, s.rejectRouteDecision(runID, decision, "active subagent limit reached")
	}
	budgetExceeded, err := s.teamRunBudgetExceeded(runID)
	if err != nil {
		return nil, err
	}
	if budgetExceeded {
		return nil, s.rejectRouteDecision(runID, decision, "team run budget exceeded")
	}

	// Generate a correlation id to link this compete batch.
	correlationID := decision.CorrelationID
	if strings.TrimSpace(correlationID) == "" {
		correlationID = newCorrelationID()
	}
	decision.CorrelationID = correlationID

	assignments := make([]model.AgentTeamAssignment, 0, len(workerIDs))

	for _, workerID := range workerIDs {
		// Look up the worker member.
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

		assignment, err := s.CreateAssignment(ctx, userID, runID, supervisor.ID, worker.ID, model.AssignmentTypeCompete, decision.Instructions, decision.Context)
		if err != nil {
			// Record the failure but continue with other workers.
			_ = s.appendRouteRejected(runID, decision, fmt.Sprintf("failed to create assignment for worker %s: %v", workerID, err))
			continue
		}
		assignments = append(assignments, *assignment)

		// Create a TeamTask for each assignment.
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
		if err := repository.CreateTeamTask(s.db, task); err != nil {
			return nil, err
		}
	}

	if len(assignments) == 0 {
		return nil, s.rejectRouteDecision(runID, decision, "no compete assignments created")
	}

	decision.Accepted = true
	decision.AgentID = strings.Join(workerIDs, ",")

	_ = s.appendTeamEvent(runID, model.TeamEventCompeteDispatched, map[string]any{
		"decision":       decision,
		"worker_ids":     workerIDs,
		"assignment_ids": assignmentIDs(assignments),
		"correlation_id": correlationID,
	})
	_ = s.appendTeamEvent(runID, model.TeamEventRouteDecided, decision)
	for _, a := range assignments {
		_ = s.appendTeamEvent(runID, model.TeamEventAssignmentCreated, a)
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

	_ = s.appendTeamEvent(runID, model.TeamEventCompeteAggregated, resp)

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
