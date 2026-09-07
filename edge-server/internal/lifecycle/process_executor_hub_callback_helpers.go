package lifecycle

import (
	"bytes"
	"encoding/json"
	"log/slog"

	"github.com/agenthub/edge-server/internal/adapters"
)

// shouldForwardHubTypedEvent reports whether a local runtime event should be
// carried through the Hub typed stream contract. Text delta/block events keep
// their existing coalesced TaskStream path and are deliberately excluded to
// avoid double-forwarding text.
func shouldForwardHubTypedEvent(eventType string) bool {
	switch eventType {
	case adapters.BusEventThinking,
		adapters.BusEventToolCall,
		adapters.BusEventToolResult,
		adapters.BusEventFileChange,
		adapters.BusEventPermissionRequested,
		adapters.BusEventPermissionDecided,
		adapters.BusEventRouteDecision,
		adapters.BusEventResult:
		return true
	default:
		return false
	}
}

// hubCallbackTypedEventPayload sanitizes the local runtime payload with the
// existing recursive sanitizer, then validates that it serializes as a JSON
// object (the Hub typed stream contract rejects stringified payloads).
func hubCallbackTypedEventPayload(payload any) (json.RawMessage, bool) {
	sanitized, _ := SanitizeSubAgentResult(payload)
	raw, err := json.Marshal(sanitized)
	if err != nil {
		return nil, false
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, false
	}
	return append(json.RawMessage(nil), trimmed...), true
}

// fireHubTaskStreamEvent enqueues one typed Edge runtime event on the same
// per-run FIFO and UUID sequence used by text stream callbacks. It is a
// no-op when the task has no Hub binding (including desktop-owned runs) or
// the configured reporter does not implement TaskEventReporter.
func (e *ProcessExecutor) fireHubTaskStreamEvent(runID, eventType string, payload any) {
	if e == nil || !shouldForwardHubTypedEvent(eventType) {
		return
	}
	taskID := e.hubTaskID(runID)
	if !shouldFireHubCallback(e.hubCallback != nil, taskID) {
		return
	}
	if _, ok := e.hubCallback.(TaskEventReporter); !ok {
		return
	}
	raw, ok := hubCallbackTypedEventPayload(payload)
	if !ok {
		slog.Debug("hub callback typed event skipped: payload is not a JSON object", "taskId", taskID, "runId", runID, "eventType", eventType)
		return
	}
	chunkIdx := nextHubStreamChunkIdx(runID)
	clientMsgID := hubStreamClientMsgID(runID, chunkIdx)
	if !e.enqueueHubTypedEventJob(runID, hubCallbackJob{
		kind:        hubJobStreamEvent,
		taskID:      taskID,
		runID:       runID,
		clientMsgID: clientMsgID,
		eventType:   eventType,
		payload:     raw,
	}) {
		slog.Debug("hub callback typed event skipped after queue close", "taskId", taskID, "runId", runID, "eventType", eventType)
	}
}

// enqueueHubTypedEventJob appends a typed runtime event to the run's FIFO with
// the same bounded backpressure as terminal jobs: it waits for a queue slot
// instead of dropping approvals, and it never closes the queue. The consumer
// is already started by the stream/typed enqueuer that filled the queue, and
// every delivery is bounded by hubCallbackTimeout, so the wait always makes
// progress. No per-event goroutine is created.
func (e *ProcessExecutor) enqueueHubTypedEventJob(runID string, job hubCallbackJob) bool {
	state := loadOrInitHubCallbackQueue(runID)

	state.mu.Lock()
	defer state.mu.Unlock()
	if state.closed {
		return false
	}
	state.ch <- job
	e.startHubCallbackQueue(state)
	return true
}
