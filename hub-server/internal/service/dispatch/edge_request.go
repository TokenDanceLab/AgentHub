package dispatch

import "encoding/json"

// EdgeRunRequest is the pure JSON body POSTed to Edge /v1/runs.
// Kept free of service orchestration so HTTP dispatch can build it without
// embedding field literals in agent_dispatch.go.
type EdgeRunRequest struct {
	ProjectID              string    `json:"projectId"`
	ThreadID               string    `json:"threadId"`
	Prompt                 string    `json:"prompt"`
	AgentID                string    `json:"agentId,omitempty"`
	Model                  string    `json:"model,omitempty"`
	SystemPrompt           string    `json:"systemPrompt,omitempty"`
	HubTaskID              string    `json:"hubTaskId"`
	DeliveryID             string    `json:"deliveryId,omitempty"`
	Messages               []Message `json:"messages,omitempty"`
	PinnedMessages         []Message `json:"pinnedMessages,omitempty"`
	StructuredOutputSchema string    `json:"structuredOutputSchema,omitempty"`
}

// BuildEdgeRunRequest maps dispatch payload fields into an Edge run request.
// agentType is normalized via NormalizeRuntimeAgentType; model defaults to "claude".
func BuildEdgeRunRequest(
	prompt, agentType, systemPrompt, hubTaskID, deliveryID string,
	messages, pinned []Message,
	outputSchema *json.RawMessage,
) EdgeRunRequest {
	req := EdgeRunRequest{
		ProjectID:      LocalProjectID,
		ThreadID:       LocalThreadID,
		Prompt:         prompt,
		AgentID:        NormalizeRuntimeAgentType(agentType),
		Model:          "claude",
		SystemPrompt:   systemPrompt,
		HubTaskID:      hubTaskID,
		DeliveryID:     deliveryID,
		Messages:       messages,
		PinnedMessages: pinned,
	}
	if outputSchema != nil && len(*outputSchema) > 0 {
		req.StructuredOutputSchema = string(*outputSchema)
	}
	return req
}
