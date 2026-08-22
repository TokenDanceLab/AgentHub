package sdk

import (
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
)

// Residual pure-helper peel #1122: payload/scope helpers for SDK fixture mapping.

func commonSDKPayload(event SDKFixtureEvent, provider string, fields map[string]any) map[string]any {
	payload := map[string]any{
		"provider": provider,
	}
	if event.ID != "" {
		payload["sourceEventId"] = event.ID
	}
	if event.SessionID != "" {
		payload["sessionId"] = event.SessionID
	}
	if event.TraceID != "" {
		payload["traceId"] = sanitizeSDKText(event.TraceID)
	}
	if len(event.TraceRefs) > 0 {
		payload["traceRefs"] = sanitizeSDKValue(event.TraceRefs)
	}
	if len(event.EvidenceRefs) > 0 {
		payload["evidenceRefs"] = sanitizeSDKValue(event.EvidenceRefs)
	}
	if len(event.Metadata) > 0 {
		payload["metadata"] = sanitizeSDKValue(event.Metadata)
	}
	for key, value := range fields {
		if sdkFieldIsEmpty(value) {
			continue
		}
		payload[key] = sanitizeSDKValue(value)
	}
	return payload
}

// sdkFieldIsEmpty reports whether a mapped field carries no usable value and
// should be omitted from the emitted payload.
func sdkFieldIsEmpty(value any) bool {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v) == ""
	case int64:
		return v == 0
	case map[string]any:
		return len(v) == 0
	case []string:
		return len(v) == 0
	case []map[string]any:
		return len(v) == 0
	case float64:
		return v == 0
	case nil:
		return true
	}
	return false
}

func oneSDKMappedEvent(eventType string, scope map[string]any, payload map[string]any) []MappedEvent {
	return []MappedEvent{{
		Type:    eventType,
		Scope:   cloneSDKScope(scope),
		Payload: payload,
	}}
}

func cloneSDKScope(scope map[string]any) map[string]any {
	if scope == nil {
		return map[string]any{}
	}
	cloned := make(map[string]any, len(scope))
	for key, value := range scope {
		cloned[key] = value
	}
	return cloned
}

func sdkUsagePayload(event SDKFixtureEvent) map[string]any {
	if event.Usage == nil {
		return nil
	}
	payload := map[string]any{}
	if event.Usage.InputTokens > 0 {
		payload["inputTokens"] = event.Usage.InputTokens
	}
	if event.Usage.OutputTokens > 0 {
		payload["outputTokens"] = event.Usage.OutputTokens
	}
	if event.Usage.TotalTokens > 0 {
		payload["totalTokens"] = event.Usage.TotalTokens
	}
	if event.Usage.TotalCostUSD > 0 {
		payload["totalCostUsd"] = event.Usage.TotalCostUSD
	}
	if event.Model != "" {
		payload["model"] = event.Model
	}
	if event.SessionID != "" {
		payload["sessionId"] = event.SessionID
	}
	return payload
}

func sdkFixtureCapabilityHealthPayload(event SDKFixtureEvent) map[string]any {
	healthState := "fixture-ready"
	if event.Health != nil && strings.TrimSpace(event.Health.State) != "" {
		healthState = event.Health.State
	}
	payload := map[string]any{
		"status":              healthState,
		"runtimeId":           firstNonEmpty(event.RuntimeID, event.AdapterID),
		"adapterId":           event.AdapterID,
		"adapterMode":         firstNonEmpty(event.AdapterMode, "fixture"),
		"fixtureOnly":         true,
		"noSpendDefault":      true,
		"fixtureTransport":    firstNonEmpty(event.FixtureTransport, "fixture-file"),
		"workspacePathPolicy": firstNonEmpty(event.WorkspacePathPolicy, "workspace-relative-or-basename"),
		"rawSdkObjectPolicy":  firstNonEmpty(event.RawSDKObjectPolicy, "never-expose-above-edge-adapter"),
	}
	if event.Capabilities != nil {
		payload["capabilities"] = sanitizeSDKValue(sdkFixtureCapabilitiesPayload(*event.Capabilities))
	}
	if event.Health != nil {
		payload["health"] = sanitizeSDKValue(map[string]any{
			"state":    healthState,
			"reason":   event.Health.Reason,
			"checks":   event.Health.Checks,
			"metadata": event.Health.Metadata,
		})
	}
	return payload
}

func sdkFixtureCapabilitiesPayload(capabilities FixtureCapabilities) map[string]any {
	payload := map[string]any{}
	if capabilities.Streaming {
		payload["streaming"] = true
	}
	if capabilities.ToolCalls {
		payload["toolCalls"] = true
	}
	if capabilities.FileChanges {
		payload["fileChanges"] = true
	}
	if capabilities.PermissionHooks {
		payload["permissionHooks"] = true
	}
	if capabilities.ThinkingVisible {
		payload["thinkingVisible"] = true
	}
	if capabilities.MultiTurn {
		payload["multiTurn"] = true
	}
	if capabilities.MCPIntegration {
		payload["mcpIntegration"] = true
	}
	if capabilities.SubAgentSpawn {
		payload["subAgentSpawn"] = true
	}
	if capabilities.FixtureOnly {
		payload["fixtureOnly"] = true
	}
	if capabilities.NoSpendDefault {
		payload["noSpendDefault"] = true
	}
	if len(capabilities.Transports) > 0 {
		payload["transports"] = adapters.EnvNamesOnly(capabilities.Transports)
	}
	return payload
}

func terminalReasonForSDKEvent(event SDKFixtureEvent, success bool) string {
	normalizedType := normalizeSDKFixtureType(event.Type)
	if normalizedType == "cancelled" || normalizedType == "canceled" || normalizedType == "cancellation" {
		return "cancelled"
	}
	normalizedReason := strings.ToLower(event.Reason)
	if strings.Contains(normalizedReason, "cancel") {
		return "cancelled"
	}
	if !success {
		return "error"
	}
	return "completed"
}
