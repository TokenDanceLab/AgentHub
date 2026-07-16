package service

import (
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/agentevent"
)

// Compatibility wrappers keep existing same-package call sites and tests green
// after pure helpers moved into service/agentevent (#468). Prefer agentevent.*
// for new code.

func validApprovalDecision(decision string) bool {
	return agentevent.ValidApprovalDecision(decision)
}

func pendingApprovalStatus(status string) bool {
	return agentevent.PendingApprovalStatus(status)
}

func approvalIDFor(requestID, toolUseID string) string {
	return agentevent.ApprovalIDFor(requestID, toolUseID)
}

func firstNonEmptyString(values ...string) string {
	return agentevent.FirstNonEmptyString(values...)
}

func firstJSONString(values map[string]any, keys ...string) string {
	return agentevent.FirstJSONString(values, keys...)
}

func firstNonEmpty(values ...string) string {
	return agentevent.FirstNonEmpty(values...)
}

func firstRuntimeString(payload map[string]any, keys ...string) string {
	return agentevent.FirstRuntimeString(payload, keys...)
}

func firstRuntimeInt(payload map[string]any, keys ...string) int {
	return agentevent.FirstRuntimeInt(payload, keys...)
}

func validateRunEventType(eventType string) error {
	return agentevent.ValidateRunEventType(eventType)
}

func inferRunEventType(payload string) string {
	return agentevent.InferRunEventType(payload)
}

func validateAgentCallbackPayloadSize(value string) error {
	return agentevent.ValidateAgentCallbackPayloadSize(value)
}

func validateAgentCallbackEdgeRunID(edgeRunID string) error {
	return agentevent.ValidateAgentCallbackEdgeRunID(edgeRunID)
}

func normalizeRunEventInput(stream model.AgentRunEventInput) (eventType, payload, messageContent string, err error) {
	return agentevent.NormalizeRunEventInput(stream)
}
