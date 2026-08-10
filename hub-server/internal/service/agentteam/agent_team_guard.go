package agentteam

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/agentevent"
	"gorm.io/gorm"
)

func firstJSONString(values map[string]any, keys ...string) string {
	return agentevent.FirstJSONString(values, keys...)
}

func firstNonEmptyString(values ...string) string {
	return agentevent.FirstNonEmptyString(values...)
}

func firstJSONInt(values map[string]any, keys ...string) int64 {
	for _, key := range keys {
		value, ok := values[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return int64(typed)
		case int:
			return int64(typed)
		case int64:
			return typed
		case json.Number:
			if parsed, err := typed.Int64(); err == nil {
				return parsed
			}
		case string:
			if parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64); err == nil {
				return parsed
			}
		}
	}
	return 0
}

func firstJSONFloat(values map[string]any, keys ...string) float64 {
	for _, key := range keys {
		value, ok := values[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return typed
		case int:
			return float64(typed)
		case int64:
			return float64(typed)
		case json.Number:
			if parsed, err := typed.Float64(); err == nil {
				return parsed
			}
		case string:
			if parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64); err == nil {
				return parsed
			}
		}
	}
	return 0
}

func teamAgentTaskIDs(assignments []model.AgentTeamAssignment, tasks []model.AgentTeamTask) []string {
	ids := make([]string, 0, len(assignments)+len(tasks))
	seen := make(map[string]struct{}, len(assignments)+len(tasks))
	addID := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	for _, assignment := range assignments {
		if assignment.RunID != nil {
			addID(*assignment.RunID)
		}
	}
	for _, task := range tasks {
		if task.RunID != nil {
			addID(*task.RunID)
		}
	}
	return ids
}

func teamTaskStatusFromPending(status string) string {
	switch status {
	case model.TaskStatusQueued:
		return model.TeamTaskStatusDispatched
	case model.TaskStatusDispatched:
		return model.TeamTaskStatusDispatched
	case model.TaskStatusRunning:
		return model.TeamTaskStatusRunning
	case model.TaskStatusDone:
		return model.TeamTaskStatusDone
	case model.TaskStatusCancelled:
		return model.TeamTaskStatusCancelled
	case model.TaskStatusFailed, model.TaskStatusTimeout:
		return model.TeamTaskStatusFailed
	default:
		return model.TeamTaskStatusPending
	}
}

func assignmentStatusFromPending(status string) string {
	switch status {
	case model.TaskStatusQueued:
		return model.AssignmentStatusDispatched
	case model.TaskStatusDispatched:
		return model.AssignmentStatusDispatched
	case model.TaskStatusRunning:
		return model.AssignmentStatusRunning
	case model.TaskStatusDone:
		return model.AssignmentStatusDone
	case model.TaskStatusCancelled:
		return model.AssignmentStatusCancelled
	case model.TaskStatusFailed, model.TaskStatusTimeout:
		return model.AssignmentStatusFailed
	default:
		return model.AssignmentStatusPending
	}
}

func (s *AgentTeamService) hasTimedOutActiveAssignmentDB(db *gorm.DB, runID string) (bool, error) {
	deadline := time.Now().Add(-s.guardrails.AssignmentTimeout)
	return repository.HasTimedOutActiveAssignment(db, runID, deadline)
}

func (s *AgentTeamService) teamRunBudgetExceededDB(db *gorm.DB, runID string) (bool, error) {
	// Read the run row (already locked by the caller via LockTeamRunForUpdate)
	// to inspect the maintained token_usage_total counter. When non-NULL and
	// already at or above the run budget, the guard short-circuits in O(1)
	// without scanning assignments + tasks + run events — the previous path
	// did a full event scan on every route decision inside the per-run lock
	// (route_decision.go), a hot-path regression under load.
	lockedRun, err := repository.GetTeamRunByID(db, runID)
	if err != nil {
		return false, err
	}
	if lockedRun.TokenUsageTotal != nil && *lockedRun.TokenUsageTotal >= s.guardrails.MaxTeamRunBudgetTokens {
		return true, nil
	}
	// Fallback: project from events (the existing O(n) path). The counter
	// may be NULL (run not yet incremented, or a pre-backfill historical run)
	// or stale (events written before the increment path existed); take
	// max(column, projection) so a NULL/stale counter never under-reports.
	assignments, err := repository.ListAssignmentsByTeamRun(db, runID)
	if err != nil {
		return false, err
	}
	tasks, err := repository.ListTeamTasksByRun(db, runID)
	if err != nil {
		return false, err
	}
	events, err := repository.ListAgentRunEventsByTaskIDs(db, teamAgentTaskIDs(assignments, tasks))
	if err != nil {
		return false, err
	}
	budget := projectTeamBudget(events, 0)
	if budget == nil {
		return false, nil
	}
	// max(column, projection): the counter is maintained incrementally and
	// may lag the event projection during a race; the projection is the
	// authoritative fallback. Keep whichever is larger so the guard is
	// monotonic and never under-reports.
	if lockedRun.TokenUsageTotal != nil && *lockedRun.TokenUsageTotal > budget.TotalTokensUsed {
		budget.TotalTokensUsed = *lockedRun.TokenUsageTotal
	}
	if budget.TokenLimit > 0 && budget.TotalTokensUsed >= budget.TokenLimit {
		return true, nil
	}
	if budget.TotalTokensUsed >= s.guardrails.MaxTeamRunBudgetTokens {
		return true, nil
	}
	if budget.UsagePercent >= s.guardrails.MaxTeamRunBudgetUsagePct {
		return true, nil
	}
	return false, nil
}

func isActiveAssignmentStatus(status string) bool {
	switch status {
	case model.AssignmentStatusPending, model.AssignmentStatusDispatched, model.AssignmentStatusRunning:
		return true
	default:
		return false
	}
}

func payloadString(payload string, keys ...string) string {
	var values map[string]string
	if err := json.Unmarshal([]byte(payload), &values); err != nil {
		return ""
	}
	for _, key := range keys {
		if value := values[key]; value != "" {
			return value
		}
	}
	return ""
}
