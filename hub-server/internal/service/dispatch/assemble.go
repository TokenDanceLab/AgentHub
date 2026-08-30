package dispatch

import (
	"encoding/json"

	"github.com/agenthub/pkg/otelids"
)

// AssemblePayloadInput is the pure surface used to build a dispatch Payload
// before outbox recording. History slices are supplied by the caller after IO.
type AssemblePayloadInput struct {
	TaskID           string
	AgentInstanceID  string
	AgentType        string
	TargetID         string
	EdgeDeviceID     string
	SessionID        string
	TriggerMessageID string
	TriggerUserID    string
	Prompt           string
	DisplayName      string
	CustomAgentID    string
	CustomFields     *CustomAgentFields
	ModelParams      string
	Team             TeamContext
	Messages         []Message
	PinnedMessages   []Message
}

// AssembleDispatchPayload builds the edge payload core (identity, custom-agent
// profile, model params merge, team attribution, and optional history). Pure —
// no DB / WS / cache. Empty CustomAgentID skips profile application (matches
// HasCustomAgentBinding false path).
func AssembleDispatchPayload(in AssemblePayloadInput) Payload {
	dp := NewPayload(
		in.TaskID, in.AgentInstanceID, in.AgentType, in.TargetID, in.EdgeDeviceID, in.SessionID,
		in.TriggerMessageID, in.TriggerUserID, in.Prompt, in.DisplayName,
	)
	if in.CustomAgentID != "" {
		ApplyCustomAgentProfile(&dp, in.CustomAgentID, in.CustomFields)
	}
	MergePayloadModelParams(&dp, in.ModelParams)
	ApplyTeamContext(&dp, in.Team)
	dp.Messages = in.Messages
	dp.PinnedMessages = in.PinnedMessages
	if dp.TraceID == "" {
		dp.TraceID = otelids.NewTraceID()
	}
	return dp
}

// FinalizeAfterDeliveryRecord attaches deliveryID after a successful outbox
// RecordDelivery. Prefers FinalizePayloadWithDelivery; on marshal failure falls
// back to AttachDeliveryID + json.Marshal (historical degraded path).
func FinalizeAfterDeliveryRecord(dp Payload, deliveryID string) (Payload, []byte) {
	if finalized, withDelivery, mErr := FinalizePayloadWithDelivery(dp, deliveryID); mErr == nil {
		return finalized, withDelivery
	}
	AttachDeliveryID(&dp, deliveryID)
	payload, _ := json.Marshal(dp)
	return dp, payload
}

// MarshalPayload JSON-encodes a Payload for outbox / wire use.
func MarshalPayload(dp Payload) ([]byte, error) {
	return json.Marshal(dp)
}
