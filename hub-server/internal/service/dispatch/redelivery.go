package dispatch

import (
	"encoding/json"

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
