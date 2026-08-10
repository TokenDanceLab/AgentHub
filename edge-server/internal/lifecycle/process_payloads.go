package lifecycle

import (
	"fmt"
	"log/slog"

	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// contextCompactionPayload builds the bus payload for a context compaction event.
func contextCompactionPayload(runID string, usagePct float64, tokensUsed, remaining int64) map[string]any {
	return map[string]any{
		"runId":           runID,
		"usagePercent":    usagePct,
		"tokensUsed":      tokensUsed,
		"tokensRemaining": remaining,
		"threshold":       runnerctx.CompactionThreshold,
	}
}

// recoverableParseWarningPayload builds the bus payload for a recoverable
// structured-output parse error that should not fail the run.
func recoverableParseWarningPayload(runID, message, warning string) map[string]any {
	return map[string]any{
		"runId":   runID,
		"message": message,
		"warning": warning,
	}
}

// faultEscalationRetryPayload builds the bus payload for an auto-retry attempt.
func faultEscalationRetryPayload(runID string, retryCount, maxRetries int) map[string]any {
	return map[string]any{
		"runId":      runID,
		"retryCount": retryCount,
		"maxRetries": maxRetries,
	}
}

// faultEscalationExhaustedPayload builds the bus payload when max retries are spent.
func faultEscalationExhaustedPayload(runID string, maxRetries int) map[string]any {
	return map[string]any{
		"runId":      runID,
		"maxRetries": maxRetries,
	}
}

// runOutputBatchPayload builds a run.output.batch event payload. When truncated
// is true, truncation metadata is attached for the frontend and logs.
func runOutputBatchPayload(runID, stream, text string, offset int, truncated bool, written, maxBytes int64) map[string]any {
	payload := map[string]any{
		"runId":  runID,
		"stream": stream,
		"chunks": []map[string]any{
			{"offset": offset, "text": text},
		},
	}
	if truncated {
		payload["truncated"] = true
		payload["maxBytes"] = maxBytes
		payload["bytesWritten"] = written
		payload["message"] = fmt.Sprintf("run output truncated after %d bytes", maxBytes)
	}
	return payload
}

// runFailedEventPayload builds the bus payload for a run.failed event.
func runFailedEventPayload(runID, status string, classified *RunError) map[string]any {
	return map[string]any{
		"runId":  runID,
		"status": status,
		"error":  classified,
	}
}

// itemEventScope builds the project/thread/run/item scope for message/item events.
func itemEventScope(item store.Item) map[string]any {
	return map[string]any{
		"projectId": item.ProjectID,
		"threadId":  item.ThreadID,
		"runId":     item.RunID,
		"itemId":    item.ID,
	}
}

// persistenceErrorScopePayload builds scope and payload for run.persistence_error.
func persistenceErrorScopePayload(runID string, err error) (scope, payload map[string]any) {
	slog.Error("run persistence error", "runId", runID, "error", err)
	scope = map[string]any{"runId": runID}
	payload = map[string]any{
		"runId": runID,
		"error": "persistence error",
	}
	return scope, payload
}

// subAgentErrorPayload wraps an error string for sendSubAgentResult on failure paths.
func subAgentErrorPayload(err error) map[string]any {
	if err == nil {
		return map[string]any{"error": ""}
	}
	slog.Error("sub-agent error", "error", err)
	return map[string]any{"error": "sub-agent execution failed"}
}

// subAgentResultQueuePayload builds the message-queue payload after sanitization.
func subAgentResultQueuePayload(runID, status, agentID, agentName string, sanitizedResult any, sanitizeReason string) map[string]any {
	return map[string]any{
		"runId":             runID,
		"status":            status,
		"agentId":           agentID,
		"agentName":         agentName,
		"result":            sanitizedResult,
		"_sanitized":        sanitizeReason != "",
		"_sanitized_reason": sanitizeReason,
	}
}

// aggregatorOutput chooses the value stored in the result aggregator: when
// sanitization changed the payload, the redacted copy is persisted; otherwise
// the original payload is kept.
func aggregatorOutput(raw, sanitized any, sanitizeReason string) any {
	if sanitizeReason != "" {
		return sanitized
	}
	return raw
}

// agentFailureItem builds the store.Item used to persist a failed agent message.
// itemID must be supplied by the caller (typically via transcriptItemID).
func agentFailureItem(run store.Run, itemID, content string) store.Item {
	return store.Item{
		ID:        itemID,
		ProjectID: run.ProjectID,
		ThreadID:  run.ThreadID,
		RunID:     run.ID,
		Type:      "agent_message",
		Role:      "agent",
		Status:    "failed",
		Content:   content,
	}
}

// adapterMetricsLabel returns the Prometheus adapter label for a resolved adapter.
func adapterMetricsLabel(adapterID string, hasAdapter bool) string {
	if !hasAdapter {
		return "none"
	}
	if adapterID == "" {
		return "none"
	}
	return adapterID
}
