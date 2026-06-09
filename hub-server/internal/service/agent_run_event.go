package service

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// ListTaskRunEvents returns run events for a pending task, filtered and paginated.
func (s *AgentService) ListTaskRunEvents(ctx context.Context, userID, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error) {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentTaskNotFound
		}
		return nil, err
	}
	if task.TriggeredByUserID != userID {
		return nil, errcode.AgentTaskNotFound
	}
	filter.EventType = strings.TrimSpace(filter.EventType)
	if filter.Limit < 0 || filter.AfterSeq < 0 {
		return nil, errcode.ErrBadRequest
	}
	if filter.Limit > 500 {
		filter.Limit = 500
	}
	return repository.ListAgentRunEventsByTaskIDFiltered(s.db, taskID, filter)
}

// GetTaskRunEventSummary returns a rollup summary for a task's run events.
func (s *AgentService) GetTaskRunEventSummary(ctx context.Context, userID, taskID string) (*model.AgentRunEventSummary, error) {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentTaskNotFound
		}
		return nil, err
	}
	if task.TriggeredByUserID != userID {
		return nil, errcode.AgentTaskNotFound
	}
	events, err := repository.ListAgentRunEventsByTaskID(s.db, taskID)
	if err != nil {
		return nil, err
	}
	summary := summarizeAgentRunEvents(task, events)
	return &summary, nil
}

func (s *AgentService) ListTaskApprovals(ctx context.Context, userID, taskID string) (*model.AgentTaskApprovalList, error) {
	task, events, err := s.taskRunEventsForOwner(userID, taskID)
	if err != nil {
		return nil, err
	}
	return projectTaskApprovals(task, events), nil
}

func (s *AgentService) DecideTaskApproval(ctx context.Context, userID, taskID, approvalID string, decision model.TeamApprovalDecision) (*model.AgentTaskApproval, error) {
	approvalID = strings.TrimSpace(approvalID)
	decision.Decision = strings.ToLower(strings.TrimSpace(decision.Decision))
	decision.Reason = strings.TrimSpace(decision.Reason)
	if approvalID == "" || !validApprovalDecision(decision.Decision) {
		return nil, errcode.ErrBadRequest
	}

	task, events, err := s.taskRunEventsForOwner(userID, taskID)
	if err != nil {
		return nil, err
	}
	projection := projectTaskApprovals(task, events)
	approval := findTaskApproval(projection.Approvals, approvalID)
	if approval == nil {
		return nil, errcode.AgentTaskNotFound
	}
	if !pendingApprovalStatus(approval.Status) {
		return nil, errcode.ErrBadRequest
	}
	if strings.TrimSpace(approval.RequestID) == "" || strings.TrimSpace(approval.EdgeRunID) == "" || strings.TrimSpace(task.EdgeDeviceID) == "" {
		return nil, errcode.ErrBadRequest
	}

	now := time.Now().UTC()
	edgeControl := &model.TeamApprovalEdgeControl{
		RunID:     approval.EdgeRunID,
		RequestID: approval.RequestID,
		Decision:  decision.Decision,
		Reason:    decision.Reason,
	}
	payloadBytes, err := json.Marshal(map[string]any{
		"requestId":    approval.RequestID,
		"toolUseId":    approval.ToolUseID,
		"toolName":     approval.ToolName,
		"decision":     decision.Decision,
		"reason":       decision.Reason,
		"decided_by":   userID,
		"edge_control": edgeControl,
	})
	if err != nil {
		return nil, err
	}
	event := &model.AgentRunEvent{
		TaskID:          task.ID,
		EdgeRunID:       approval.EdgeRunID,
		SessionID:       approval.SessionID,
		AgentInstanceID: task.AgentInstanceID,
		EventType:       "run.agent.permission_decided",
		Payload:         string(payloadBytes),
		CreatedAt:       now,
	}
	if err := repository.CreateAgentRunEventWithNextSeq(s.db, event); err != nil {
		return nil, err
	}

	if controlCache, ok := s.cacheClient.(agentControlCache); ok {
		controlSvc := &AgentControlService{cacheClient: controlCache, mgr: s.mgr}
		if err := controlSvc.DeliverToDesktopDevice(ctx, userID, task.EdgeDeviceID, model.AgentControlPayload{
			Kind:         model.AgentControlKindPermissionDecide,
			AgentTaskID:  task.ID,
			TargetID:     strings.TrimSpace(task.TargetID),
			EdgeDeviceID: strings.TrimSpace(task.EdgeDeviceID),
			ApprovalID:   firstNonEmptyString(approval.ApprovalID, approvalIDFor(approval.RequestID, approval.ToolUseID)),
			EdgeControl:  edgeControl,
		}); err != nil {
			return nil, err
		}
	}

	decided := *approval
	decided.Status = decision.Decision
	decided.Reason = decision.Reason
	decided.DecidedBy = userID
	decided.DecidedAt = &now
	decided.EdgeControl = edgeControl
	return &decided, nil
}

func (s *AgentService) ListTaskArtifacts(ctx context.Context, userID, taskID string) (*model.AgentTaskArtifactList, error) {
	task, events, err := s.taskRunEventsForOwner(userID, taskID)
	if err != nil {
		return nil, err
	}
	return projectTaskArtifacts(task, events), nil
}

func (s *AgentService) taskRunEventsForOwner(userID, taskID string) (*model.PendingAgentTask, []model.AgentRunEvent, error) {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, errcode.AgentTaskNotFound
		}
		return nil, nil, err
	}
	if task.TriggeredByUserID != userID {
		return nil, nil, errcode.AgentTaskNotFound
	}
	events, err := repository.ListAgentRunEventsByTaskID(s.db, taskID)
	if err != nil {
		return nil, nil, err
	}
	return task, events, nil
}

func summarizeAgentRunEvents(task *model.PendingAgentTask, events []model.AgentRunEvent) model.AgentRunEventSummary {
	summary := model.AgentRunEventSummary{
		TaskID:          task.ID,
		EdgeRunID:       task.EdgeRunID,
		Status:          task.Status,
		TotalEvents:     len(events),
		EventTypeCounts: make(map[string]int),
	}
	startedAt := task.CreatedAt
	if startedAt.IsZero() && len(events) > 0 {
		startedAt = events[0].CreatedAt
	}
	if !startedAt.IsZero() {
		summary.StartedAt = &startedAt
	}
	if task.FinishedAt != nil {
		finishedAt := task.FinishedAt.UTC()
		summary.FinishedAt = &finishedAt
	}

	approvalStates := map[string]string{}
	for _, event := range events {
		if event.EventSeq > summary.LastEventSeq {
			summary.LastEventSeq = event.EventSeq
		}
		if summary.EdgeRunID == "" {
			summary.EdgeRunID = event.EdgeRunID
		}
		summary.EventTypeCounts[event.EventType]++
		if strings.HasPrefix(event.EventType, "run.agent.") {
			summary.StepCount++
		}

		payload := map[string]any{}
		_ = json.Unmarshal([]byte(event.Payload), &payload)
		switch event.EventType {
		case model.RunEventTypeOutputBatch:
			summary.OutputBytes += outputBytesFromPayload(payload)
		case "run.agent.tool_call":
			summary.ToolCallCount++
		case "run.agent.permission_requested":
			key := firstRuntimeString(payload, "requestId", "request_id", "toolUseId", "tool_use_id")
			if key == "" {
				key = event.ID
			}
			approvalStates[key] = firstNonEmpty(firstRuntimeString(payload, "status"), "pending")
		case "run.agent.permission_decided":
			key := firstRuntimeString(payload, "requestId", "request_id", "toolUseId", "tool_use_id")
			if key == "" {
				key = event.ID
			}
			approvalStates[key] = firstNonEmpty(firstRuntimeString(payload, "decision", "status"), "decided")
		case "run.agent.file_change":
			summary.ArtifactCount++
		case "run.agent.result", "run.agent.context_usage":
			inputTokens, outputTokens := tokenUsageFromPayload(payload)
			summary.InputTokens += inputTokens
			summary.OutputTokens += outputTokens
		}
	}
	for _, status := range approvalStates {
		summary.ApprovalCount++
		if pendingApprovalStatus(status) {
			summary.PendingApprovals++
		} else {
			summary.DecidedApprovals++
		}
	}

	if summary.StartedAt != nil {
		end := time.Time{}
		if summary.FinishedAt != nil {
			end = *summary.FinishedAt
		} else if len(events) > 0 {
			end = events[len(events)-1].CreatedAt
		}
		if !end.IsZero() && end.After(*summary.StartedAt) {
			summary.ElapsedMs = end.Sub(*summary.StartedAt).Milliseconds()
		}
	}
	return summary
}

func projectTaskApprovals(task *model.PendingAgentTask, events []model.AgentRunEvent) *model.AgentTaskApprovalList {
	result := &model.AgentTaskApprovalList{
		TaskID:    task.ID,
		EdgeRunID: task.EdgeRunID,
		Approvals: []model.AgentTaskApproval{},
		Pending:   []model.AgentTaskApproval{},
		Decided:   []model.AgentTaskApproval{},
	}
	approvalIndex := map[string]int{}
	for _, event := range events {
		if event.EventSeq > result.LastEventSeq {
			result.LastEventSeq = event.EventSeq
		}
		if result.EdgeRunID == "" {
			result.EdgeRunID = event.EdgeRunID
		}
		if result.SessionID == "" {
			result.SessionID = event.SessionID
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(event.Payload), &payload); err != nil {
			continue
		}
		switch event.EventType {
		case "run.agent.permission_requested":
			edgeRunID := firstNonEmptyString(event.EdgeRunID, task.EdgeRunID)
			requestID := firstJSONString(payload, "requestId", "request_id")
			toolUseID := firstJSONString(payload, "toolUseId", "tool_use_id")
			key := firstNonEmptyString(requestID, toolUseID)
			if key == "" {
				continue
			}
			approvalIndex[key] = len(result.Approvals)
			result.Approvals = append(result.Approvals, model.AgentTaskApproval{
				ApprovalID:    approvalIDFor(requestID, toolUseID),
				TaskID:        event.TaskID,
				EdgeRunID:     edgeRunID,
				SessionID:     event.SessionID,
				SourceEventID: event.ID,
				EventSeq:      event.EventSeq,
				RequestID:     requestID,
				ToolName:      firstJSONString(payload, "toolName", "tool_name"),
				ToolUseID:     toolUseID,
				Status:        firstNonEmptyString(firstJSONString(payload, "status"), "pending"),
				CreatedAt:     event.CreatedAt,
			})
		case "run.agent.permission_decided":
			edgeRunID := firstNonEmptyString(event.EdgeRunID, task.EdgeRunID)
			requestID := firstJSONString(payload, "requestId", "request_id")
			toolUseID := firstJSONString(payload, "toolUseId", "tool_use_id")
			key := firstNonEmptyString(requestID, toolUseID)
			if key == "" {
				continue
			}
			decision := firstNonEmptyString(firstJSONString(payload, "decision", "status"), "decided")
			decidedAt := event.CreatedAt
			edgeControl := taskApprovalEdgeControl(payload)
			if idx, ok := approvalIndex[key]; ok {
				result.Approvals[idx].Status = decision
				result.Approvals[idx].Reason = firstJSONString(payload, "reason")
				result.Approvals[idx].DecidedBy = firstJSONString(payload, "decided_by", "decidedBy")
				result.Approvals[idx].DecidedAt = &decidedAt
				if result.Approvals[idx].RequestID == "" {
					result.Approvals[idx].RequestID = requestID
				}
				if result.Approvals[idx].ToolUseID == "" {
					result.Approvals[idx].ToolUseID = toolUseID
				}
				if result.Approvals[idx].ToolName == "" {
					result.Approvals[idx].ToolName = firstJSONString(payload, "toolName", "tool_name")
				}
				if edgeControl != nil {
					result.Approvals[idx].EdgeControl = edgeControl
				}
				continue
			}
			approvalIndex[key] = len(result.Approvals)
			result.Approvals = append(result.Approvals, model.AgentTaskApproval{
				ApprovalID:    approvalIDFor(requestID, toolUseID),
				TaskID:        event.TaskID,
				EdgeRunID:     edgeRunID,
				SessionID:     event.SessionID,
				SourceEventID: event.ID,
				EventSeq:      event.EventSeq,
				RequestID:     requestID,
				ToolName:      firstJSONString(payload, "toolName", "tool_name"),
				ToolUseID:     toolUseID,
				Status:        decision,
				Reason:        firstJSONString(payload, "reason"),
				DecidedBy:     firstJSONString(payload, "decided_by", "decidedBy"),
				CreatedAt:     event.CreatedAt,
				DecidedAt:     &decidedAt,
				EdgeControl:   edgeControl,
			})
		}
	}
	for _, approval := range result.Approvals {
		if pendingApprovalStatus(approval.Status) {
			result.Pending = append(result.Pending, approval)
		} else {
			result.Decided = append(result.Decided, approval)
		}
	}
	return result
}

func taskApprovalEdgeControl(payload map[string]any) *model.TeamApprovalEdgeControl {
	raw, ok := payload["edge_control"]
	if !ok {
		raw = payload["edgeControl"]
	}
	controlMap, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	control := &model.TeamApprovalEdgeControl{
		RunID:     firstJSONString(controlMap, "runId", "run_id"),
		RequestID: firstJSONString(controlMap, "requestId", "request_id"),
		Decision:  firstJSONString(controlMap, "decision"),
		Reason:    firstJSONString(controlMap, "reason"),
	}
	if control.RunID == "" && control.RequestID == "" && control.Decision == "" {
		return nil
	}
	return control
}

func findTaskApproval(approvals []model.AgentTaskApproval, approvalID string) *model.AgentTaskApproval {
	approvalID = strings.TrimSpace(approvalID)
	for i := range approvals {
		if approvalID != "" && (approvals[i].ApprovalID == approvalID || approvals[i].RequestID == approvalID || approvals[i].ToolUseID == approvalID) {
			return &approvals[i]
		}
	}
	return nil
}

func projectTaskArtifacts(task *model.PendingAgentTask, events []model.AgentRunEvent) *model.AgentTaskArtifactList {
	result := &model.AgentTaskArtifactList{
		TaskID:    task.ID,
		EdgeRunID: task.EdgeRunID,
		Artifacts: []model.AgentTaskArtifact{},
	}
	for _, event := range events {
		if event.EventSeq > result.LastEventSeq {
			result.LastEventSeq = event.EventSeq
		}
		if result.EdgeRunID == "" {
			result.EdgeRunID = event.EdgeRunID
		}
		if result.SessionID == "" {
			result.SessionID = event.SessionID
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(event.Payload), &payload); err != nil {
			continue
		}
		switch event.EventType {
		case "run.agent.file_change":
			edgeRunID := firstNonEmptyString(event.EdgeRunID, task.EdgeRunID)
			paths := taskArtifactPaths(payload)
			for _, path := range paths {
				result.Artifacts = append(result.Artifacts, model.AgentTaskArtifact{
					TaskID:        event.TaskID,
					SessionID:     event.SessionID,
					SourceEventID: event.ID,
					EventSeq:      event.EventSeq,
					EdgeRunID:     edgeRunID,
					Path:          path,
					Action:        firstJSONString(payload, "action", "kind"),
					ToolName:      firstJSONString(payload, "toolName", "tool_name"),
					Status:        firstJSONString(payload, "status"),
					CreatedAt:     event.CreatedAt,
				})
			}
		case "artifact.created":
			edgeRunID := firstNonEmptyString(event.EdgeRunID, task.EdgeRunID)
			path := firstJSONString(payload, "path", "filePath", "file_path", "uri")
			if path == "" {
				continue
			}
			result.Artifacts = append(result.Artifacts, model.AgentTaskArtifact{
				TaskID:        event.TaskID,
				EdgeRunID:     edgeRunID,
				SessionID:     event.SessionID,
				SourceEventID: event.ID,
				EventSeq:      event.EventSeq,
				Path:          path,
				Action:        firstJSONString(payload, "action"),
				ToolName:      firstJSONString(payload, "toolName", "tool_name"),
				Status:        firstJSONString(payload, "status"),
				ArtifactID:    firstJSONString(payload, "artifact_id", "artifactId", "id"),
				Name:          firstJSONString(payload, "name", "filename", "file_name"),
				MimeType:      firstJSONString(payload, "mime_type", "mimeType", "content_type", "contentType"),
				SizeBytes:     int64(firstRuntimeInt(payload, "size_bytes", "sizeBytes", "size")),
				CreatedAt:     event.CreatedAt,
			})
		}
	}
	return result
}

func taskArtifactPaths(payload map[string]any) []string {
	paths := []string{}
	if path := firstJSONString(payload, "path", "filePath", "file_path"); path != "" {
		paths = append(paths, path)
	}
	if files, ok := payload["files"].([]any); ok {
		for _, file := range files {
			if value, ok := file.(string); ok && strings.TrimSpace(value) != "" {
				paths = append(paths, strings.TrimSpace(value))
			}
		}
	}
	return paths
}

func outputBytesFromPayload(payload map[string]any) int {
	total := len(runtimeString(payload, "content", "text"))
	if chunks, ok := payload["chunks"].([]any); ok {
		for _, chunk := range chunks {
			chunkMap, ok := chunk.(map[string]any)
			if !ok {
				continue
			}
			total += len(runtimeString(chunkMap, "content", "text"))
		}
	}
	return total
}

func tokenUsageFromPayload(payload map[string]any) (int, int) {
	source := payload
	if usage, ok := payload["usage"].(map[string]any); ok {
		source = usage
	}
	inputTokens := firstRuntimeInt(source, "input_tokens", "inputTokens", "prompt_tokens", "promptTokens")
	outputTokens := firstRuntimeInt(source, "output_tokens", "outputTokens", "completion_tokens", "completionTokens")
	return inputTokens, outputTokens
}

func firstRuntimeString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := payload[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func runtimeString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := payload[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

func firstRuntimeInt(payload map[string]any, keys ...string) int {
	for _, key := range keys {
		switch value := payload[key].(type) {
		case int:
			return value
		case int64:
			return int(value)
		case float64:
			return int(value)
		case json.Number:
			n, _ := value.Int64()
			return int(n)
		case string:
			n, _ := strconv.Atoi(strings.TrimSpace(value))
			return n
		}
	}
	return 0
}

func normalizeRunEventInput(stream model.AgentRunEventInput) (eventType, payload, messageContent string, err error) {
	eventType = strings.TrimSpace(stream.EventType)
	content := strings.TrimSpace(stream.Content)

	if len(stream.Payload) > 0 {
		if !json.Valid(stream.Payload) {
			return "", "", "", errcode.ErrBadRequest
		}
		payload = string(stream.Payload)
	} else if content != "" {
		if json.Valid([]byte(content)) {
			payload = content
		} else {
			wrapped, marshalErr := json.Marshal(map[string]string{"content": stream.Content})
			if marshalErr != nil {
				return "", "", "", marshalErr
			}
			payload = string(wrapped)
		}
	} else {
		return "", "", "", errcode.ErrBadRequest
	}
	if err := validateAgentCallbackPayloadSize(payload); err != nil {
		return "", "", "", err
	}

	if eventType == "" {
		eventType = inferRunEventType(payload)
	}
	if eventType == "" {
		eventType = model.RunEventTypeOutputBatch
	}
	if err := validateRunEventType(eventType); err != nil {
		return "", "", "", err
	}

	messageContent = content
	if messageContent == "" {
		messageContent = payload
	}
	if !json.Valid([]byte(messageContent)) {
		wrapped, marshalErr := json.Marshal(map[string]string{"content": messageContent})
		if marshalErr != nil {
			return "", "", "", marshalErr
		}
		messageContent = string(wrapped)
	}
	if err := validateAgentCallbackPayloadSize(messageContent); err != nil {
		return "", "", "", err
	}

	return eventType, payload, messageContent, nil
}

func validateAgentCallbackPayloadSize(value string) error {
	if len(value) > model.RunEventPayloadMaxBytes {
		return errcode.ErrBadRequest.WithMessage("agent callback payload exceeds maximum size")
	}
	return nil
}

func validateAgentCallbackEdgeRunID(edgeRunID string) error {
	if len(edgeRunID) > model.AgentCallbackEdgeRunIDMaxLength {
		return errcode.ErrBadRequest.WithMessage("agent callback run id exceeds maximum length")
	}
	return nil
}

func validateRunEventType(eventType string) error {
	if eventType == "" || len(eventType) > model.RunEventTypeMaxLength {
		return errcode.ErrBadRequest
	}
	for _, r := range eventType {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '.', r == '_', r == '-':
		default:
			return errcode.ErrBadRequest
		}
	}
	return nil
}

func inferRunEventType(payload string) string {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(payload), &fields); err != nil {
		return ""
	}
	for _, key := range []string{"event_type", "type"} {
		if raw, ok := fields[key]; ok {
			var value string
			if err := json.Unmarshal(raw, &value); err == nil {
				return strings.TrimSpace(value)
			}
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
