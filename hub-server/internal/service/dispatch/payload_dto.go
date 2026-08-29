package dispatch

import "encoding/json"

// Payload is the pure agent.dispatch edge payload shape historically kept as
// package-private dispatchPayload in service/agent_dispatch.go. JSON tags must
// stay stable so redispatch unmarshaling of stored outbox rows continues to work.
// Orchestration still owns ports/DB/WS; this type is free of service deps.
type Payload struct {
	TaskID           string `json:"task_id"`
	DeliveryID       string `json:"delivery_id,omitempty"`
	AgentInstanceID  string `json:"agent_instance_id"`
	AgentType        string `json:"agent_type"`
	CustomAgentID    string `json:"custom_agent_id,omitempty"`
	TargetID         string `json:"target_id,omitempty"`
	EdgeDeviceID     string `json:"edge_device_id,omitempty"`
	SessionID        string `json:"session_id"`
	TriggerMessageID string `json:"trigger_message_id"`
	TriggerUserID    string `json:"trigger_user_id"`
	Prompt           string `json:"prompt"`
	DisplayName      string `json:"display_name"`
	SystemPrompt     string `json:"system_prompt,omitempty"`
	ModelParams      string `json:"model_params,omitempty"`
	ToolWhitelist    string `json:"tool_whitelist,omitempty"`
	TeamID           string `json:"team_id,omitempty"`
	TeamRunID        string `json:"team_run_id,omitempty"`
	TeamMemberID     string `json:"team_member_id,omitempty"`
	TeamMemberRole   string `json:"team_member_role,omitempty"`
	// TraceID correlates this dispatch with the originating Hub trace. Populated
	// by AssembleDispatchPayload; empty on legacy payloads is safe (omitempty).
	TraceID          string `json:"trace_id,omitempty"`
	// Context continuity: thread history and pinned messages for all agent runtimes.
	Messages       []Message `json:"messages,omitempty"`
	PinnedMessages []Message `json:"pinned_messages,omitempty"`
	// OutputSchema is the JSON Schema for structured output (--json-schema).
	OutputSchema *json.RawMessage `json:"structured_output_schema,omitempty"`
}

// NewPayload builds the identity/prompt core of a dispatch payload.
// AgentType is normalized via NormalizeRuntimeAgentType.
func NewPayload(
	taskID, agentInstanceID, agentType, targetID, edgeDeviceID, sessionID,
	triggerMessageID, triggerUserID, prompt, displayName string,
) Payload {
	return Payload{
		TaskID:           taskID,
		AgentInstanceID:  agentInstanceID,
		AgentType:        NormalizeRuntimeAgentType(agentType),
		TargetID:         targetID,
		EdgeDeviceID:     edgeDeviceID,
		SessionID:        sessionID,
		TriggerMessageID: triggerMessageID,
		TriggerUserID:    triggerUserID,
		Prompt:           prompt,
		DisplayName:      displayName,
	}
}

// ApplyCustomAgentProfile sets CustomAgentID and profile-derived fields on p.
// No-op when customAgentID is empty.
func ApplyCustomAgentProfile(p *Payload, customAgentID string, fields *CustomAgentFields) {
	if p == nil || customAgentID == "" {
		return
	}
	p.CustomAgentID = customAgentID
	p.SystemPrompt, p.ModelParams, p.ToolWhitelist, p.OutputSchema =
		ApplyCustomAgentToPayload(customAgentID, fields)
}

// ApplyTeamContext sets team attribution fields on p when TeamRunID is present.
func ApplyTeamContext(p *Payload, tc TeamContext) {
	if p == nil {
		return
	}
	p.TeamID, p.TeamRunID, p.TeamMemberID, p.TeamMemberRole = ApplyTeamContextToPayload(tc)
}

// MergePayloadModelParams shallow-merges override model params onto p.ModelParams.
func MergePayloadModelParams(p *Payload, override string) {
	if p == nil {
		return
	}
	p.ModelParams = MergeModelParams(p.ModelParams, override)
}

// AttachDeliveryID sets DeliveryID on p (for outbox / redispatch ack correlation).
func AttachDeliveryID(p *Payload, deliveryID string) {
	if p == nil {
		return
	}
	p.DeliveryID = deliveryID
}

// MarshalWithDeliveryID attaches deliveryID and marshals the payload.
func MarshalWithDeliveryID(p Payload, deliveryID string) ([]byte, error) {
	p.DeliveryID = deliveryID
	return json.Marshal(p)
}

// FinalizePayloadWithDelivery attaches deliveryID on a payload copy and returns
// the updated value plus marshaled bytes. Used after outbox RecordDelivery so
// orchestration can swap the wire body without duplicating attach+marshal.
func FinalizePayloadWithDelivery(dp Payload, deliveryID string) (Payload, []byte, error) {
	AttachDeliveryID(&dp, deliveryID)
	body, err := json.Marshal(dp)
	return dp, body, err
}
