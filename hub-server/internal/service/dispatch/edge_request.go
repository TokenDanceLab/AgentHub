package dispatch

import "encoding/json"

// EdgeCallbackOwner is the fixed callback owner used when Hub dispatches a run
// directly to Edge. Edge is responsible for enforcing/responding to this route.
const EdgeCallbackOwner = "edge"

// EdgeRunRequest is the pure JSON body POSTed to Edge /v1/runs.
// Kept free of service orchestration so HTTP dispatch can build it without
// embedding field literals in agent_dispatch.go.
type EdgeRunRequest struct {
	ProjectID              string            `json:"projectId"`
	ThreadID               string            `json:"threadId"`
	CallbackOwner          string            `json:"callbackOwner"`
	Prompt                 string            `json:"prompt"`
	AgentID                string            `json:"agentId,omitempty"`
	Model                  string            `json:"model,omitempty"`
	SessionID              string            `json:"sessionId,omitempty"`
	Continue               *bool             `json:"continue,omitempty"`
	Fork                   *bool             `json:"fork,omitempty"`
	ReasoningEffort        string            `json:"reasoningEffort,omitempty"`
	ThinkingMode           string            `json:"thinkingMode,omitempty"`
	MaxThinkingTokens      *int              `json:"maxThinkingTokens,omitempty"`
	PermissionMode         string            `json:"permissionMode,omitempty"`
	WorkDir                string            `json:"workDir,omitempty"`
	IncludePartial         *bool             `json:"includePartial,omitempty"`
	StructuredOutputSchema string            `json:"structuredOutputSchema,omitempty"`
	SystemPrompt           string            `json:"systemPrompt,omitempty"`
	AppendSystemPrompt     string            `json:"appendSystemPrompt,omitempty"`
	AllowedTools           []string          `json:"allowedTools,omitempty"`
	ConfigOverrides        map[string]string `json:"configOverrides,omitempty"`
	Ephemeral              *bool             `json:"ephemeral,omitempty"`
	HubTaskID              string            `json:"hubTaskId"`
	TraceID                string            `json:"trace_id,omitempty"`
	DeliveryID             string            `json:"deliveryId,omitempty"`
	Messages               []Message         `json:"messages,omitempty"`
	PinnedMessages         []Message         `json:"pinnedMessages,omitempty"`
}

// BuildEdgeRunRequest maps a dispatch payload into an Edge run request.
// It preserves the Desktop projection aliases/priority for model params,
// workDir/tool allowlist/schema, while keeping Hub Task/Session identity and
// the local transport project/thread scope distinct.
func BuildEdgeRunRequest(payload Payload) EdgeRunRequest {
	params := parseModelParams(payload.ModelParams)

	var outputSchema any
	if payload.OutputSchema != nil {
		outputSchema = *payload.OutputSchema
	}

	return EdgeRunRequest{
		ProjectID:         LocalProjectID,
		ThreadID:          LocalThreadID,
		CallbackOwner:     EdgeCallbackOwner,
		Prompt:            payload.Prompt,
		AgentID:           NormalizeRuntimeAgentType(payload.AgentType),
		Model:             firstStringValue(params["model"]),
		SessionID:         firstStringValue(params["session_id"], params["sessionId"]),
		Continue:          firstBoolValue(params["continue"]),
		Fork:              firstBoolValue(params["fork"]),
		ReasoningEffort:   firstStringValue(params["reasoning_effort"], params["reasoningEffort"]),
		ThinkingMode:      firstStringValue(params["thinking_mode"], params["thinkingMode"]),
		MaxThinkingTokens: firstIntValue(params["max_thinking_tokens"], params["maxThinkingTokens"]),
		PermissionMode:    firstStringValue(params["permission_mode"], params["permissionMode"]),
		WorkDir:           firstStringValue(params["work_dir"], params["workDir"]),
		IncludePartial:    firstBoolValue(params["include_partial"], params["includePartial"]),
		StructuredOutputSchema: firstSchemaString(
			params["structured_output_schema"],
			params["structuredOutputSchema"],
			outputSchema,
		),
		SystemPrompt: firstStringValue(
			payload.SystemPrompt,
			params["system_prompt"],
			params["systemPrompt"],
		),
		AppendSystemPrompt: firstStringValue(params["append_system_prompt"], params["appendSystemPrompt"]),
		AllowedTools: firstStringArrayValue(
			payload.ToolWhitelist,
			params["tool_allowlist"],
			params["allowed_tools"],
			params["allowedTools"],
		),
		ConfigOverrides: firstStringRecordValue(
			params["config_overrides"],
			params["configOverrides"],
		),
		Ephemeral:      firstBoolValue(params["ephemeral"]),
		HubTaskID:      payload.TaskID,
		TraceID:        payload.TraceID,
		DeliveryID:     payload.DeliveryID,
		Messages:       payload.Messages,
		PinnedMessages: payload.PinnedMessages,
	}
}

// MarshalEdgeRunRequest builds and JSON-marshals an Edge /v1/runs body.
// HTTP client construction stays orchestration-side.
func MarshalEdgeRunRequest(payload Payload) ([]byte, error) {
	return json.Marshal(BuildEdgeRunRequest(payload))
}
