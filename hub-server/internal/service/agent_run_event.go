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
