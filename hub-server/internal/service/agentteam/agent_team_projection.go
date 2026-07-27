package agentteam

import (
	"encoding/json"
	"log/slog"
	"strings"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// Pure TeamRunState projection helpers extracted for #1385.
// These functions have no service.db dependency; the only write helper
// (refreshTeamArtifactIndex) is invoked best-effort from the read path.

type teamRuntimeTaskRef struct {
	TeamTaskID   string
	AssignmentID string
	MemberID     string
}

func projectTeamRuntimeSummaries(runEvents []model.AgentRunEvent, taskRefs map[string]teamRuntimeTaskRef) ([]model.TeamApprovalState, []model.TeamArtifactState) {
	approvals := []model.TeamApprovalState{}
	artifacts := []model.TeamArtifactState{}
	approvalIndex := map[string]int{}
	for _, event := range runEvents {
		var payload map[string]any
		if err := json.Unmarshal([]byte(event.Payload), &payload); err != nil {
			continue
		}
		switch event.EventType {
		case "run.agent.permission_requested":
			requestID := firstJSONString(payload, "requestId", "request_id")
			toolUseID := firstJSONString(payload, "toolUseId", "tool_use_id")
			key := firstNonEmptyString(requestID, toolUseID)
			if key == "" {
				continue
			}
			ref := taskRefs[event.TaskID]
			status := firstNonEmptyString(firstJSONString(payload, "status"), "pending")
			approvalIndex[key] = len(approvals)
			approvals = append(approvals, model.TeamApprovalState{
				ApprovalID:   approvalIDFor(requestID, toolUseID),
				AgentTaskID:  event.TaskID,
				TeamTaskID:   ref.TeamTaskID,
				AssignmentID: ref.AssignmentID,
				MemberID:     ref.MemberID,
				EdgeRunID:    event.EdgeRunID,
				RequestID:    requestID,
				ToolName:     firstJSONString(payload, "toolName", "tool_name"),
				ToolUseID:    toolUseID,
				Status:       status,
				CreatedAt:    event.CreatedAt,
			})
		case "run.agent.permission_decided":
			requestID := firstJSONString(payload, "requestId", "request_id")
			toolUseID := firstJSONString(payload, "toolUseId", "tool_use_id")
			key := firstNonEmptyString(requestID, toolUseID)
			if key == "" {
				continue
			}
			decision := firstNonEmptyString(firstJSONString(payload, "decision", "status"), "decided")
			decidedAt := event.CreatedAt
			if idx, ok := approvalIndex[key]; ok {
				approvals[idx].Status = decision
				approvals[idx].Reason = firstJSONString(payload, "reason")
				approvals[idx].DecidedAt = &decidedAt
				if approvals[idx].RequestID == "" {
					approvals[idx].RequestID = requestID
				}
				if approvals[idx].ToolUseID == "" {
					approvals[idx].ToolUseID = toolUseID
				}
				if approvals[idx].ToolName == "" {
					approvals[idx].ToolName = firstJSONString(payload, "toolName", "tool_name")
				}
				continue
			}
			approvalIndex[key] = len(approvals)
			ref := taskRefs[event.TaskID]
			approvals = append(approvals, model.TeamApprovalState{
				ApprovalID:   approvalIDFor(requestID, toolUseID),
				AgentTaskID:  event.TaskID,
				TeamTaskID:   ref.TeamTaskID,
				AssignmentID: ref.AssignmentID,
				MemberID:     ref.MemberID,
				EdgeRunID:    event.EdgeRunID,
				RequestID:    requestID,
				ToolName:     firstJSONString(payload, "toolName", "tool_name"),
				ToolUseID:    toolUseID,
				Status:       decision,
				Reason:       firstJSONString(payload, "reason"),
				CreatedAt:    event.CreatedAt,
				DecidedAt:    &decidedAt,
			})
		case "run.agent.file_change":
			path := firstJSONString(payload, "path", "filePath", "file_path")
			if path == "" {
				continue
			}
			ref := taskRefs[event.TaskID]
			artifacts = append(artifacts, model.TeamArtifactState{
				AgentTaskID:   event.TaskID,
				TeamTaskID:    ref.TeamTaskID,
				AssignmentID:  ref.AssignmentID,
				MemberID:      ref.MemberID,
				EdgeRunID:     event.EdgeRunID,
				SourceEventID: event.ID,
				EventSeq:      event.EventSeq,
				Path:          path,
				Action:        firstJSONString(payload, "action"),
				ToolName:      firstJSONString(payload, "toolName", "tool_name"),
				Status:        firstJSONString(payload, "status"),
				CreatedAt:     event.CreatedAt,
			})
		}
	}
	return approvals, artifacts
}

func approvalIDFor(requestID, toolUseID string) string {
	return firstNonEmptyString(requestID, toolUseID)
}

func projectTeamConflicts(artifacts []model.TeamArtifactState) []model.TeamConflictState {
	type conflictBucket struct {
		conflict model.TeamConflictState
		sources  map[string]bool
	}
	buckets := map[string]*conflictBucket{}
	order := []string{}
	for _, artifact := range artifacts {
		if !artifactCanConflict(artifact) {
			continue
		}
		path := normalizedArtifactPath(artifact.Path)
		if path == "" {
			continue
		}
		key := strings.ToLower(path)
		source := firstNonEmptyString(artifact.MemberID, artifact.AgentTaskID, artifact.EdgeRunID)
		if source == "" {
			continue
		}
		bucket, ok := buckets[key]
		if !ok {
			bucket = &conflictBucket{
				conflict: model.TeamConflictState{
					ConflictID:  conflictIDForPath(path),
					Path:        path,
					Status:      model.TeamConflictStatusPending,
					FirstSeenAt: artifact.CreatedAt,
					LastSeenAt:  artifact.CreatedAt,
				},
				sources: map[string]bool{},
			}
			buckets[key] = bucket
			order = append(order, key)
		}
		bucket.sources[source] = true
		bucket.conflict.AgentTaskIDs = appendUniqueString(bucket.conflict.AgentTaskIDs, artifact.AgentTaskID)
		bucket.conflict.TeamTaskIDs = appendUniqueString(bucket.conflict.TeamTaskIDs, artifact.TeamTaskID)
		bucket.conflict.AssignmentIDs = appendUniqueString(bucket.conflict.AssignmentIDs, artifact.AssignmentID)
		bucket.conflict.MemberIDs = appendUniqueString(bucket.conflict.MemberIDs, artifact.MemberID)
		bucket.conflict.EdgeRunIDs = appendUniqueString(bucket.conflict.EdgeRunIDs, artifact.EdgeRunID)
		bucket.conflict.Actions = appendUniqueString(bucket.conflict.Actions, artifact.Action)
		if bucket.conflict.FirstSeenAt.IsZero() || artifact.CreatedAt.Before(bucket.conflict.FirstSeenAt) {
			bucket.conflict.FirstSeenAt = artifact.CreatedAt
		}
		if artifact.CreatedAt.After(bucket.conflict.LastSeenAt) {
			bucket.conflict.LastSeenAt = artifact.CreatedAt
		}
	}

	conflicts := []model.TeamConflictState{}
	for _, key := range order {
		bucket := buckets[key]
		if len(bucket.sources) < 2 {
			continue
		}
		conflictID := bucket.conflict.ConflictID
		for i := range artifacts {
			if strings.EqualFold(normalizedArtifactPath(artifacts[i].Path), bucket.conflict.Path) {
				artifacts[i].ConflictID = conflictID
			}
		}
		conflicts = append(conflicts, bucket.conflict)
	}
	return conflicts
}

func artifactCanConflict(artifact model.TeamArtifactState) bool {
	status := strings.ToLower(strings.TrimSpace(artifact.Status))
	switch status {
	case "failed", "cancelled", "canceled", "discarded", "skipped":
		return false
	}
	action := strings.ToLower(strings.TrimSpace(artifact.Action))
	switch action {
	case "", "create", "created", "add", "added", "write", "written", "modify", "modified", "edit", "edited", "update", "updated", "delete", "deleted", "remove", "removed", "rename", "renamed":
		return true
	case "read", "view", "open", "inspect":
		return false
	default:
		return true
	}
}

func normalizedArtifactPath(path string) string {
	path = strings.TrimSpace(strings.ReplaceAll(path, "\\", "/"))
	for strings.HasPrefix(path, "./") {
		path = strings.TrimPrefix(path, "./")
	}
	return path
}

func conflictIDForPath(path string) string {
	path = strings.ReplaceAll(path, " ", "_")
	path = strings.ReplaceAll(path, "/", ":")
	return "file:" + path
}

func appendUniqueString(values []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

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

// refreshTeamArtifactIndex rewrites the durable artifact index for a run.
// Callers on the GetTeamRunState read path must use
// tryRefreshTeamArtifactIndex so delete+insert failures never fail the read.
func (s *AgentTeamService) refreshTeamArtifactIndex(runID string, artifacts []model.TeamArtifactState) error {
	indexed := make([]model.AgentTeamArtifact, 0, len(artifacts))
	for _, artifact := range artifacts {
		path := normalizedArtifactPath(artifact.Path)
		if path == "" {
			continue
		}
		indexed = append(indexed, model.AgentTeamArtifact{
			TeamRunID:      runID,
			TeamTaskID:     stringPtrOrNil(artifact.TeamTaskID),
			AssignmentID:   stringPtrOrNil(artifact.AssignmentID),
			MemberID:       stringPtrOrNil(artifact.MemberID),
			AgentTaskID:    stringPtrOrNil(artifact.AgentTaskID),
			EdgeRunID:      artifact.EdgeRunID,
			SourceEventID:  stringPtrOrNil(artifact.SourceEventID),
			EventSeq:       artifact.EventSeq,
			Path:           path,
			NormalizedPath: strings.ToLower(path),
			Action:         artifact.Action,
			ToolName:       artifact.ToolName,
			Status:         artifact.Status,
			ConflictID:     artifact.ConflictID,
			CreatedAt:      artifact.CreatedAt,
		})
	}
	return repository.ReplaceTeamArtifactsForRun(s.db, runID, indexed)
}

// tryRefreshTeamArtifactIndex is the read-path side effect for the durable
// artifact index. Strategy (#1385): keep a best-effort synchronous refresh so
// existing consumers still see an up-to-date index after GetTeamRunState, but
// never let delete+insert errors fail or cascade into the client-facing
// projection. Concurrent reads may still race on the same run's index rows;
// that is preferable to blocking/failing reads. Write-path-only refresh is a
// follow-up if index races become a production issue.
func (s *AgentTeamService) tryRefreshTeamArtifactIndex(runID string, artifacts []model.TeamArtifactState) {
	if err := s.refreshTeamArtifactIndex(runID, artifacts); err != nil {
		slog.Warn("team run artifact index refresh failed; projection still returned",
			"run_id", runID,
			"artifact_count", len(artifacts),
			"error", err,
		)
	}
}

func stringPtrOrNil(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}
