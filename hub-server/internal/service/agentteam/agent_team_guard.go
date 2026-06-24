package agentteam

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

func projectTeamBudget(runEvents []model.AgentRunEvent, runCount int) *model.TeamBudget {
	if runCount == 0 && len(runEvents) == 0 {
		return nil
	}
	budget := &model.TeamBudget{RunCount: runCount}
	observedTokensByTask := map[string]int64{}
	limitByTask := map[string]int64{}
	for _, event := range runEvents {
		var payload map[string]any
		if err := json.Unmarshal([]byte(event.Payload), &payload); err != nil {
			continue
		}
		switch event.EventType {
		case "run.agent.context_warning":
			budget.ContextWarnings++
		case "run.agent.context_compaction":
			budget.Compactions++
		}

		input, output, total := teamEventTokenUsage(payload)
		budget.InputTokens += input
		budget.OutputTokens += output
		budget.TotalTokensUsed += total

		if used := firstJSONInt(payload, "tokensUsed", "tokens_used"); used > observedTokensByTask[event.TaskID] {
			observedTokensByTask[event.TaskID] = used
		}
		if limit := firstJSONInt(payload, "tokenLimit", "token_limit", "contextLimit", "context_limit", "maxTokens", "max_tokens"); limit > limitByTask[event.TaskID] {
			limitByTask[event.TaskID] = limit
		}
		if remaining := firstJSONInt(payload, "tokensRemaining", "tokens_remaining", "remainingTokens", "remaining_tokens"); remaining > 0 {
			if budget.RemainingTokens == 0 || remaining < budget.RemainingTokens {
				budget.RemainingTokens = remaining
			}
		}
		if usagePercent := firstJSONFloat(payload, "usagePercent", "usage_percent"); usagePercent > budget.UsagePercent {
			budget.UsagePercent = usagePercent
		}
	}

	var observedTotal int64
	for _, tokens := range observedTokensByTask {
		observedTotal += tokens
	}
	if observedTotal > budget.TotalTokensUsed {
		budget.TotalTokensUsed = observedTotal
	}
	for _, limit := range limitByTask {
		budget.TokenLimit += limit
	}
	return budget
}

func teamEventTokenUsage(payload map[string]any) (input, output, total int64) {
	sawNestedUsage := false
	for _, key := range []string{"tokenUsage", "token_usage", "usage"} {
		if nested, ok := payload[key].(map[string]any); ok {
			sawNestedUsage = true
			nestedInput, nestedOutput, nestedTotal := tokenUsageFields(nested)
			input += nestedInput
			output += nestedOutput
			total += nestedTotal
		}
	}
	if !sawNestedUsage {
		directInput, directOutput, directTotal := tokenUsageFields(payload)
		input += directInput
		output += directOutput
		total += directTotal
	}
	if total == 0 && (input > 0 || output > 0) {
		total = input + output
	}
	return input, output, total
}

func tokenUsageFields(values map[string]any) (input, output, total int64) {
	input = firstJSONInt(values, "input", "inputTokens", "input_tokens")
	output = firstJSONInt(values, "output", "outputTokens", "output_tokens")
	total = firstJSONInt(values, "total", "totalTokens", "total_tokens")
	if total == 0 && (input > 0 || output > 0) {
		total = input + output
	}
	return input, output, total
}

func firstJSONString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := values[key]
		if !ok {
			continue
		}
		if text, ok := value.(string); ok {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
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

// ListTeamTasks returns first-class TeamTask rows for a run after owner checks.
func (s *AgentTeamService) hasTimedOutActiveAssignment(runID string) (bool, error) {
	deadline := time.Now().Add(-s.guardrails.AssignmentTimeout)
	return repository.HasTimedOutActiveAssignment(s.db, runID, deadline)
}

func (s *AgentTeamService) teamRunBudgetExceeded(runID string) (bool, error) {
	assignments, err := repository.ListAssignmentsByTeamRun(s.db, runID)
	if err != nil {
		return false, err
	}
	tasks, err := repository.ListTeamTasksByRun(s.db, runID)
	if err != nil {
		return false, err
	}
	events, err := repository.ListAgentRunEventsByTaskIDs(s.db, teamAgentTaskIDs(assignments, tasks))
	if err != nil {
		return false, err
	}
	budget := projectTeamBudget(events, 0)
	if budget == nil {
		return false, nil
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

func findSupervisorAndWorker(members []model.AgentTeamMember, workerID string) (*model.AgentTeamMember, *model.AgentTeamMember) {
	var supervisor *model.AgentTeamMember
	var worker *model.AgentTeamMember
	for i := range members {
		member := &members[i]
		if supervisor == nil && member.Role == model.TeamMemberRoleSupervisor {
			supervisor = member
		}
		if member.ID == workerID {
			worker = member
		}
	}
	if supervisor == nil && len(members) > 0 {
		supervisor = &members[0]
	}
	return supervisor, worker
}

func routeAssignmentType(action string) string {
	switch action {
	case "review":
		return model.AssignmentTypeReview
	case "approve":
		return model.AssignmentTypeApprove
	default:
		return model.AssignmentTypeDelegate
	}
}

