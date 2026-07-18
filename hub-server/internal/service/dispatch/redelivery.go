package dispatch

import (
	"encoding/json"
	"fmt"

	"github.com/agenthub/hub-server/internal/model"
)

// ShouldTryHTTPRedelivery is true when a redispatch should attempt local Edge
// HTTP first (unbound task with no edge device).
func ShouldTryHTTPRedelivery(targetID, edgeDeviceID string) bool {
	return targetID == "" && edgeDeviceID == ""
}

// MinimalPendingTaskForHTTP builds the *model.PendingAgentTask subset needed by
// dispatchToEdgeHTTP during redelivery (ID + target/device routing fields).
func MinimalPendingTaskForHTTP(task PendingTaskSnapshot) *model.PendingAgentTask {
	return &model.PendingAgentTask{
		ID:           task.ID,
		TargetID:     task.TargetID,
		EdgeDeviceID: task.EdgeDeviceID,
	}
}

// ParseEdgeRunID decodes an Edge /v1/runs response body and returns the run ID.
// Empty string + nil error when the body decodes but has no runId.
func ParseEdgeRunID(respBody []byte) (string, error) {
	var edgeResp EdgeRunResponse
	if err := json.Unmarshal(respBody, &edgeResp); err != nil {
		return "", err
	}
	return edgeResp.Data.RunID, nil
}

// Dead-letter reason prefixes for redispatchDelivery (historical format strings).
const (
	DeadLetterKindPayloadUnmarshal = "payload unmarshal"
	DeadLetterKindPayloadMarshal   = "payload marshal"
	DeadLetterKindTaskLookup       = "task lookup"
)

// PayloadPrepError is a pure redispatch payload prep failure with a dead-letter kind.
type PayloadPrepError struct {
	Kind string
	Err  error
}

func (e *PayloadPrepError) Error() string {
	if e == nil {
		return ""
	}
	return DeadLetterReason(e.Kind, e.Err)
}

func (e *PayloadPrepError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// PrepareRedispatchPayload unmarshals a stored outbox payload, attaches deliveryID,
// and marshals the redispatch body. Pure JSON only — dead-letter moves stay
// orchestration-side. On failure returns *PayloadPrepError with Kind set to
// DeadLetterKindPayloadUnmarshal or DeadLetterKindPayloadMarshal.
func PrepareRedispatchPayload(raw, deliveryID string) (Payload, []byte, error) {
	var dp Payload
	if err := json.Unmarshal([]byte(raw), &dp); err != nil {
		return Payload{}, nil, &PayloadPrepError{Kind: DeadLetterKindPayloadUnmarshal, Err: err}
	}
	newPayload, err := MarshalWithDeliveryID(dp, deliveryID)
	if err != nil {
		return Payload{}, nil, &PayloadPrepError{Kind: DeadLetterKindPayloadMarshal, Err: err}
	}
	AttachDeliveryID(&dp, deliveryID)
	return dp, newPayload, nil
}

// DeadLetterReason formats "kind: err" dead-letter lastError strings.
func DeadLetterReason(kind string, err error) string {
	return fmt.Sprintf("%s: %v", kind, err)
}

// DeadLetterTaskStatus formats the terminal-status dead-letter reason.
func DeadLetterTaskStatus(status string) string {
	return fmt.Sprintf("task status is %s", status)
}

// PendingTaskRedeliverySelect is the column list for getPendingTaskForRedelivery.
const PendingTaskRedeliverySelect = "id, agent_instance_id, triggered_by_user_id, status, edge_device_id, edge_run_id, target_id"

// MapPendingTaskRedeliveryRow maps scanned redelivery columns onto PendingTaskSnapshot.
func MapPendingTaskRedeliveryRow(
	id, agentInstanceID, triggeredByUserID, status, edgeDeviceID, edgeRunID, targetID string,
) PendingTaskSnapshot {
	return NewPendingTaskSnapshot(id, agentInstanceID, triggeredByUserID, status, edgeDeviceID, edgeRunID, targetID)
}
