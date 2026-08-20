package sdk

import (
	"encoding/json"
	"strings"
)

// Residual pure-helper peel #1122: public types + stream entrypoints for SDK fixture mapping.

const (
	SDKFixtureProviderClaude                 = "claude-sdk-fixture"
	SDKFixtureProviderOpenAI                 = "openai-agents-sdk-fixture"
	SDKFixtureProviderOpenCode               = "opencode-agent-sdk-fixture"
	SDKFixtureProviderCustomOpenAICompatible = "custom-openai-compatible-fixture"

	sdkFixtureEventArtifactCreated = "artifact.created"
)

// SDKFixtureStream is a provider-shaped event stream used only by tests and
// contract fixtures. It intentionally does not model or expose real SDK types.
type SDKFixtureStream struct {
	Provider string            `json:"provider,omitempty"`
	Events   []SDKFixtureEvent `json:"events"`
}

// SDKFixtureEvent is the narrow provider-like event shape accepted by the
// fixture mapper. Unknown fields stay below the adapter boundary and are not
// forwarded in mapped events.
type SDKFixtureEvent struct {
	ID             string           `json:"id,omitempty"`
	Type           string           `json:"type"`
	Provider       string           `json:"provider,omitempty"`
	SessionID      string           `json:"sessionId,omitempty"`
	TraceID        string           `json:"traceId,omitempty"`
	TraceRefs      []string         `json:"traceRefs,omitempty"`
	EvidenceRefs   []string         `json:"evidenceRefs,omitempty"`
	Model          string           `json:"model,omitempty"`
	PermissionMode string           `json:"permissionMode,omitempty"`
	Tools          []string         `json:"tools,omitempty"`
	Status         string           `json:"status,omitempty"`
	ToolName       string           `json:"toolName,omitempty"`
	ToolUseID      string           `json:"toolUseId,omitempty"`
	CallID         string           `json:"callId,omitempty"`
	Input          map[string]any   `json:"input,omitempty"`
	Text           string           `json:"text,omitempty"`
	Content        string           `json:"content,omitempty"`
	Output         string           `json:"output,omitempty"`
	Error          string           `json:"error,omitempty"`
	IsError        bool             `json:"isError,omitempty"`
	RequestID      string           `json:"requestId,omitempty"`
	RiskLevel      string           `json:"riskLevel,omitempty"`
	Reason         string           `json:"reason,omitempty"`
	Decision       string           `json:"decision,omitempty"`
	Guardrail      string           `json:"guardrail,omitempty"`
	Action         string           `json:"action,omitempty"`
	TargetAgent    string           `json:"targetAgent,omitempty"`
	NextWorker     string           `json:"nextWorker,omitempty"`
	Instructions   string           `json:"instructions,omitempty"`
	Path           string           `json:"path,omitempty"`
	Kind           string           `json:"kind,omitempty"`
	Diff           string           `json:"diff,omitempty"`
	ArtifactID     string           `json:"artifactId,omitempty"`
	SizeBytes      int64            `json:"sizeBytes,omitempty"`
	Summary        string           `json:"summary,omitempty"`
	Success        *bool            `json:"success,omitempty"`
	Attachments    []map[string]any `json:"attachments,omitempty"`
	Metadata       map[string]any   `json:"metadata,omitempty"`

	// Provider-neutral Edge contract fields. These are fixture-only projections
	// of SDK/CLI signals and must stay redacted before they cross the adapter
	// boundary.
	AdapterID           string                  `json:"adapterId,omitempty"`
	CommandName         string                  `json:"commandName,omitempty"`
	ArgFlags            []string                `json:"argFlags,omitempty"`
	ConfigKeys          []string                `json:"configKeys,omitempty"`
	PositionalArgCount  int                     `json:"positionalArgCount,omitempty"`
	EnvNames            []string                `json:"envNames,omitempty"`
	WorkDir             string                  `json:"workDir,omitempty"`
	PromptRedacted      bool                    `json:"promptRedacted,omitempty"`
	Observed            bool                    `json:"observed,omitempty"`
	RealTested          bool                    `json:"realTested,omitempty"`
	RealTestedReason    string                  `json:"realTestedReason,omitempty"`
	ExecutionMode       string                  `json:"executionMode,omitempty"`
	NoSpendDefault      bool                    `json:"noSpendDefault,omitempty"`
	RedactionApplied    bool                    `json:"redactionApplied,omitempty"`
	ApprovalRequired    bool                    `json:"approvalRequired,omitempty"`
	ApprovalEvidenceRef string                  `json:"approvalEvidenceRef,omitempty"`
	TaskID              string                  `json:"taskId,omitempty"`
	Description         string                  `json:"description,omitempty"`
	LastToolName        string                  `json:"lastToolName,omitempty"`
	Percent             float64                 `json:"percent,omitempty"`
	Usage               *SDKFixtureUsage        `json:"usage,omitempty"`
	Capabilities        *SDKFixtureCapabilities `json:"capabilities,omitempty"`
	Health              *SDKFixtureHealth       `json:"health,omitempty"`

	// Fixture evidence metadata. These fields describe the AgentHub-owned
	// runtime adapter projection, not provider-native SDK objects.
	RuntimeID           string `json:"runtimeId,omitempty"`
	AdapterMode         string `json:"adapterMode,omitempty"`
	FixtureTransport    string `json:"fixtureTransport,omitempty"`
	WorkspacePathPolicy string `json:"workspacePathPolicy,omitempty"`
	RawSDKObjectPolicy  string `json:"rawSdkObjectPolicy,omitempty"`
	FixtureOnly         bool   `json:"fixtureOnly,omitempty"`
}

// SDKFixtureUsage is a provider-neutral usage/cost projection accepted only by
// fixture contract tests.
type SDKFixtureUsage struct {
	InputTokens  int64   `json:"inputTokens,omitempty"`
	OutputTokens int64   `json:"outputTokens,omitempty"`
	TotalTokens  int64   `json:"totalTokens,omitempty"`
	TotalCostUSD float64 `json:"totalCostUsd,omitempty"`
}

// SDKFixtureCapabilities is a fixture-only provider-neutral capability shape.
// It mirrors AgentHub runtime abilities instead of provider SDK feature names.
type SDKFixtureCapabilities struct {
	Streaming       bool     `json:"streaming,omitempty"`
	ToolCalls       bool     `json:"toolCalls,omitempty"`
	FileChanges     bool     `json:"fileChanges,omitempty"`
	PermissionHooks bool     `json:"permissionHooks,omitempty"`
	ThinkingVisible bool     `json:"thinkingVisible,omitempty"`
	MultiTurn       bool     `json:"multiTurn,omitempty"`
	MCPIntegration  bool     `json:"mcpIntegration,omitempty"`
	SubAgentSpawn   bool     `json:"subAgentSpawn,omitempty"`
	FixtureOnly     bool     `json:"fixtureOnly,omitempty"`
	NoSpendDefault  bool     `json:"noSpendDefault,omitempty"`
	Transports      []string `json:"transports,omitempty"`
}

// SDKFixtureHealth records no-spend health evidence for fixture capability
// checks. It must not contain provider credentials or raw SDK session objects.
type SDKFixtureHealth struct {
	State    string            `json:"state,omitempty"`
	Reason   string            `json:"reason,omitempty"`
	Checks   map[string]string `json:"checks,omitempty"`
	Metadata map[string]any    `json:"metadata,omitempty"`
}

// SDKMappedEvent is the AgentHub-owned event projection emitted by the mapper.
type SDKMappedEvent struct {
	Type    string         `json:"type"`
	Scope   map[string]any `json:"scope"`
	Payload map[string]any `json:"payload"`
}

// MapSDKFixtureStream projects a fixture-only SDK event stream into existing
// AgentHub runtime/evidence event types. It does not import, instantiate, or
// register provider SDKs.
func MapSDKFixtureStream(stream SDKFixtureStream, scope map[string]any) []SDKMappedEvent {
	provider := strings.TrimSpace(stream.Provider)
	mapped := make([]SDKMappedEvent, 0, len(stream.Events))
	for _, fixtureEvent := range stream.Events {
		eventProvider := provider
		if fixtureEvent.Provider != "" {
			eventProvider = fixtureEvent.Provider
		}
		if eventProvider == "" {
			eventProvider = "sdk-fixture"
		}
		mapped = append(mapped, mapSDKFixtureEvent(fixtureEvent, eventProvider, scope)...)
	}
	return mapped
}

// DecodeSDKFixtureStream decodes fixture JSON into the mapper input shape.
func DecodeSDKFixtureStream(data []byte) (SDKFixtureStream, error) {
	var stream SDKFixtureStream
	if err := json.Unmarshal(data, &stream); err != nil {
		return SDKFixtureStream{}, err
	}
	return stream, nil
}
