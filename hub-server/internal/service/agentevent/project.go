package agentevent

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/model"
)

// SummarizeAgentRunEvents rolls up runtime history for a pending task.
func SummarizeAgentRunEvents(task *model.PendingAgentTask, events []model.AgentRunEvent) model.AgentRunEventSummary {
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
		applyRunEventToSummary(&summary, approvalStates, event)
	}
	for _, status := range approvalStates {
		summary.ApprovalCount++
		if PendingApprovalStatus(status) {
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

// applyRunEventToSummary folds a single runtime event into the summary. The
// per-event-type projections (output bytes, token usage, approval states, …)
// live here so the main roll-up loop keeps a flat shape.
func applyRunEventToSummary(summary *model.AgentRunEventSummary, approvalStates map[string]string, event model.AgentRunEvent) {
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

	// Switch on the event type first and decode the payload only in the
	// branches that actually read it. text_delta and every other unlisted type
	// used to pay a full json.Unmarshal (plus a []byte copy of a payload that
	// can be KB-scale) whose result was then discarded; on a 2,000-event task
	// the payload-consuming types are a handful. tool_call / file_change only
	// bump counters, so they now decode nothing at all.
	switch event.EventType {
	case model.RunEventTypeOutputBatch:
		summary.OutputBytes += OutputBytesFromPayload(runtimePayload(event.Payload))
	case "run.agent.tool_call":
		summary.ToolCallCount++
	case "run.agent.permission_requested":
		payload := runtimePayload(event.Payload)
		key := FirstRuntimeString(payload, "requestId", "request_id", "toolUseId", "tool_use_id")
		if key == "" {
			key = event.ID
		}
		approvalStates[key] = FirstNonEmpty(FirstRuntimeString(payload, "status"), "pending")
	case "run.agent.permission_decided":
		payload := runtimePayload(event.Payload)
		key := FirstRuntimeString(payload, "requestId", "request_id", "toolUseId", "tool_use_id")
		if key == "" {
			key = event.ID
		}
		approvalStates[key] = FirstNonEmpty(FirstRuntimeString(payload, "decision", "status"), "decided")
	case "run.agent.file_change":
		summary.ArtifactCount++
	case "run.agent.result", "run.agent.context_usage":
		inputTokens, outputTokens := TokenUsageFromPayload(runtimePayload(event.Payload))
		summary.InputTokens += inputTokens
		summary.OutputTokens += outputTokens
	}
}

// runtimePayload decodes a run-event payload for projection, returning an empty
// (non-nil) map when the payload is absent or is not valid JSON.
//
// Undecodable payloads are deliberately non-fatal here: the summary fold still
// counts the event (EventTypeCounts / StepCount ran before the switch), which
// preserves the long-standing behaviour of discarding the unmarshal error and
// switching against an empty map. Projections that must skip such an event
// entirely use runtimePayloadStrict instead.
func runtimePayload(raw string) map[string]any {
	payload := map[string]any{}
	_ = json.Unmarshal([]byte(raw), &payload)
	return payload
}

// runtimePayloadStrict decodes a run-event payload and reports whether it was
// valid JSON, so callers can keep their existing "skip this event" semantics.
func runtimePayloadStrict(raw string) (map[string]any, bool) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil, false
	}
	return payload, true
}

// ProjectTaskApprovals builds pending/decided approval projections from run events.
func ProjectTaskApprovals(task *model.PendingAgentTask, events []model.AgentRunEvent) *model.AgentTaskApprovalList {
	result := &model.AgentTaskApprovalList{
		TaskID:    task.ID,
		EdgeRunID: task.EdgeRunID,
		Approvals: []model.AgentTaskApproval{},
		Pending:   []model.AgentTaskApproval{},
		Decided:   []model.AgentTaskApproval{},
	}
	projector := approvalProjector{
		result: result,
		index:  make(map[string]int),
		task:   task,
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
		// Decode only for the two approval-bearing types. They are typically a
		// handful per task, while the loop used to unmarshal all 2,000 events
		// (repository.maxAgentEventsPerQuery) including KB-scale text_delta
		// payloads, and throw every result away.
		switch event.EventType {
		case "run.agent.permission_requested":
			payload, ok := runtimePayloadStrict(event.Payload)
			if !ok {
				continue
			}
			projector.requested(event, payload)
		case "run.agent.permission_decided":
			payload, ok := runtimePayloadStrict(event.Payload)
			if !ok {
				continue
			}
			projector.decided(event, payload)
		}
	}
	for _, approval := range result.Approvals {
		if PendingApprovalStatus(approval.Status) {
			result.Pending = append(result.Pending, approval)
		} else {
			result.Decided = append(result.Decided, approval)
		}
	}
	return result
}

// approvalProjector projects permission_requested / permission_decided events
// into the combined approval list, keyed by request/tool-use id.
type approvalProjector struct {
	result *model.AgentTaskApprovalList
	index  map[string]int
	task   *model.PendingAgentTask
}

func (p *approvalProjector) requested(event model.AgentRunEvent, payload map[string]any) {
	edgeRunID := FirstNonEmptyString(event.EdgeRunID, p.task.EdgeRunID)
	requestID := FirstJSONString(payload, "requestId", "request_id")
	toolUseID := FirstJSONString(payload, "toolUseId", "tool_use_id")
	key := FirstNonEmptyString(requestID, toolUseID)
	if key == "" {
		return
	}
	p.index[key] = len(p.result.Approvals)
	p.result.Approvals = append(p.result.Approvals, model.AgentTaskApproval{
		ApprovalID:    ApprovalIDFor(requestID, toolUseID),
		TaskID:        event.TaskID,
		TargetID:      strings.TrimSpace(p.task.TargetID),
		EdgeDeviceID:  strings.TrimSpace(p.task.EdgeDeviceID),
		CorrelationID: FirstJSONString(payload, "correlation_id", "correlationId"),
		EdgeRunID:     edgeRunID,
		SessionID:     event.SessionID,
		SourceEventID: event.ID,
		EventSeq:      event.EventSeq,
		RequestID:     requestID,
		ToolName:      FirstJSONString(payload, "toolName", "tool_name"),
		ToolUseID:     toolUseID,
		Status:        FirstNonEmptyString(FirstJSONString(payload, "status"), "pending"),
		CreatedAt:     event.CreatedAt,
	})
}

func (p *approvalProjector) decided(event model.AgentRunEvent, payload map[string]any) {
	edgeRunID := FirstNonEmptyString(event.EdgeRunID, p.task.EdgeRunID)
	requestID := FirstJSONString(payload, "requestId", "request_id")
	toolUseID := FirstJSONString(payload, "toolUseId", "tool_use_id")
	key := FirstNonEmptyString(requestID, toolUseID)
	if key == "" {
		return
	}
	decision := FirstNonEmptyString(FirstJSONString(payload, "decision", "status"), "decided")
	decidedAt := event.CreatedAt
	edgeControl := TaskApprovalEdgeControl(payload)
	if idx, ok := p.index[key]; ok {
		applyDecisionToApproval(&p.result.Approvals[idx], p.task, payload, requestID, toolUseID, decision, decidedAt, edgeControl)
		return
	}
	p.index[key] = len(p.result.Approvals)
	p.result.Approvals = append(p.result.Approvals, model.AgentTaskApproval{
		ApprovalID:    ApprovalIDFor(requestID, toolUseID),
		TaskID:        event.TaskID,
		TargetID:      strings.TrimSpace(p.task.TargetID),
		EdgeDeviceID:  strings.TrimSpace(p.task.EdgeDeviceID),
		CorrelationID: FirstJSONString(payload, "correlation_id", "correlationId"),
		EdgeRunID:     edgeRunID,
		SessionID:     event.SessionID,
		SourceEventID: event.ID,
		EventSeq:      event.EventSeq,
		RequestID:     requestID,
		ToolName:      FirstJSONString(payload, "toolName", "tool_name"),
		ToolUseID:     toolUseID,
		Status:        decision,
		Reason:        FirstJSONString(payload, "reason"),
		DecidedBy:     FirstJSONString(payload, "decided_by", "decidedBy"),
		CreatedAt:     event.CreatedAt,
		DecidedAt:     &decidedAt,
		EdgeControl:   edgeControl,
	})
}

// applyDecisionToApproval merges a permission_decided event into a previously
// projected approval, filling only the fields the request event left empty.
func applyDecisionToApproval(approval *model.AgentTaskApproval, task *model.PendingAgentTask, payload map[string]any, requestID, toolUseID, decision string, decidedAt time.Time, edgeControl *model.TeamApprovalEdgeControl) {
	approval.Status = decision
	approval.Reason = FirstJSONString(payload, "reason")
	approval.DecidedBy = FirstJSONString(payload, "decided_by", "decidedBy")
	approval.DecidedAt = &decidedAt
	if approval.RequestID == "" {
		approval.RequestID = requestID
	}
	if approval.ToolUseID == "" {
		approval.ToolUseID = toolUseID
	}
	if approval.ToolName == "" {
		approval.ToolName = FirstJSONString(payload, "toolName", "tool_name")
	}
	if edgeControl != nil {
		approval.EdgeControl = edgeControl
	}
	if approval.TargetID == "" {
		approval.TargetID = strings.TrimSpace(task.TargetID)
	}
	if approval.EdgeDeviceID == "" {
		approval.EdgeDeviceID = strings.TrimSpace(task.EdgeDeviceID)
	}
	if approval.CorrelationID == "" {
		approval.CorrelationID = FirstJSONString(payload, "correlation_id", "correlationId")
	}
}

// TaskApprovalEdgeControl extracts optional edge_control payload fields.
func TaskApprovalEdgeControl(payload map[string]any) *model.TeamApprovalEdgeControl {
	raw, ok := payload["edge_control"]
	if !ok {
		raw = payload["edgeControl"]
	}
	controlMap, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	control := &model.TeamApprovalEdgeControl{
		RunID:     FirstJSONString(controlMap, "runId", "run_id"),
		RequestID: FirstJSONString(controlMap, "requestId", "request_id"),
		Decision:  FirstJSONString(controlMap, "decision"),
		Reason:    FirstJSONString(controlMap, "reason"),
	}
	if control.RunID == "" && control.RequestID == "" && control.Decision == "" {
		return nil
	}
	return control
}

// FindTaskApproval locates an approval by approval/request/tool-use id.
func FindTaskApproval(approvals []model.AgentTaskApproval, approvalID string) *model.AgentTaskApproval {
	approvalID = strings.TrimSpace(approvalID)
	for i := range approvals {
		if approvalID != "" && (approvals[i].ApprovalID == approvalID || approvals[i].RequestID == approvalID || approvals[i].ToolUseID == approvalID) {
			return &approvals[i]
		}
	}
	return nil
}

// ProjectTaskArtifacts builds artifact projections from file_change / artifact.created events.
func ProjectTaskArtifacts(task *model.PendingAgentTask, events []model.AgentRunEvent) *model.AgentTaskArtifactList {
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
		// Same shape as ProjectTaskApprovals: filter on type, then decode.
		switch event.EventType {
		case "run.agent.file_change":
			payload, ok := runtimePayloadStrict(event.Payload)
			if !ok {
				continue
			}
			edgeRunID := FirstNonEmptyString(event.EdgeRunID, task.EdgeRunID)
			paths := TaskArtifactPaths(payload)
			for _, path := range paths {
				result.Artifacts = append(result.Artifacts, model.AgentTaskArtifact{
					TaskID:        event.TaskID,
					SessionID:     event.SessionID,
					SourceEventID: event.ID,
					EventSeq:      event.EventSeq,
					EdgeRunID:     edgeRunID,
					Path:          path,
					Action:        FirstJSONString(payload, "action", "kind"),
					ToolName:      FirstJSONString(payload, "toolName", "tool_name"),
					Status:        FirstJSONString(payload, "status"),
					Diff:          FirstJSONString(payload, "diff", "unified_diff", "unifiedDiff", "patch"),
					EditID:        FirstJSONString(payload, "edit_id", "editId"),
					Hash:          FirstJSONString(payload, "hash", "diff_hash", "diffHash", "sha256"),
					ReviewStatus:  FirstJSONString(payload, "review_status", "reviewStatus", "status"),
					CanApply:      SafeTaskArtifactCapability(payload, "can_apply", "canApply"),
					CanRevert:     SafeTaskArtifactCapability(payload, "can_revert", "canRevert"),
					CreatedAt:     event.CreatedAt,
				})
			}
		case "artifact.created":
			payload, ok := runtimePayloadStrict(event.Payload)
			if !ok {
				continue
			}
			edgeRunID := FirstNonEmptyString(event.EdgeRunID, task.EdgeRunID)
			path := FirstJSONString(payload, "path", "filePath", "file_path", "uri")
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
				Action:        FirstJSONString(payload, "action"),
				ToolName:      FirstJSONString(payload, "toolName", "tool_name"),
				Status:        FirstJSONString(payload, "status"),
				ArtifactID:    FirstJSONString(payload, "artifact_id", "artifactId", "id"),
				Hash:          FirstJSONString(payload, "hash", "sha256"),
				Name:          FirstJSONString(payload, "name", "filename", "file_name"),
				MimeType:      FirstJSONString(payload, "mime_type", "mimeType", "content_type", "contentType"),
				SizeBytes:     int64(FirstRuntimeInt(payload, "size_bytes", "sizeBytes", "size")),
				CreatedAt:     event.CreatedAt,
			})
		}
	}
	return result
}

// TaskArtifactPaths extracts path/files fields from a file_change payload.
func TaskArtifactPaths(payload map[string]any) []string {
	paths := []string{}
	if path := FirstJSONString(payload, "path", "filePath", "file_path"); path != "" {
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

// SafeTaskArtifactCapability always reports false for apply/revert capabilities.
// Hub exposes artifact/file-change projection for review and evidence export only.
func SafeTaskArtifactCapability(payload map[string]any, keys ...string) *bool {
	requested := FirstJSONBoolPtr(payload, keys...)
	if requested == nil {
		return nil
	}
	disabled := false
	return &disabled
}

// FirstJSONBoolPtr returns a pointer to the first bool value for any key.
func FirstJSONBoolPtr(payload map[string]any, keys ...string) *bool {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok {
			continue
		}
		if typed, ok := value.(bool); ok {
			return &typed
		}
	}
	return nil
}

// OutputBytesFromPayload estimates streamed output size from content/text chunks.
func OutputBytesFromPayload(payload map[string]any) int {
	total := len(RuntimeString(payload, "content", "text"))
	if chunks, ok := payload["chunks"].([]any); ok {
		for _, chunk := range chunks {
			chunkMap, ok := chunk.(map[string]any)
			if !ok {
				continue
			}
			total += len(RuntimeString(chunkMap, "content", "text"))
		}
	}
	return total
}

// TokenUsageFromPayload extracts input/output token counts from a payload or nested usage object.
func TokenUsageFromPayload(payload map[string]any) (int, int) {
	source := payload
	if usage, ok := payload["usage"].(map[string]any); ok {
		source = usage
	}
	inputTokens := FirstRuntimeInt(source, "input_tokens", "inputTokens", "prompt_tokens", "promptTokens")
	outputTokens := FirstRuntimeInt(source, "output_tokens", "outputTokens", "completion_tokens", "completionTokens")
	return inputTokens, outputTokens
}

// FirstRuntimeInt returns the first numeric value for any key.
func FirstRuntimeInt(payload map[string]any, keys ...string) int {
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
