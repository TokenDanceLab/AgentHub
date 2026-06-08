package adapters

import (
	"encoding/json"
	"path"
	"path/filepath"
	"strings"
)

const (
	SDKFixtureProviderClaude = "claude-sdk-fixture"
	SDKFixtureProviderOpenAI = "openai-agents-sdk-fixture"

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
	ID           string         `json:"id,omitempty"`
	Type         string         `json:"type"`
	Provider     string         `json:"provider,omitempty"`
	SessionID    string         `json:"sessionId,omitempty"`
	TraceID      string         `json:"traceId,omitempty"`
	TraceRefs    []string       `json:"traceRefs,omitempty"`
	EvidenceRefs []string       `json:"evidenceRefs,omitempty"`
	ToolName     string         `json:"toolName,omitempty"`
	ToolUseID    string         `json:"toolUseId,omitempty"`
	CallID       string         `json:"callId,omitempty"`
	Input        map[string]any `json:"input,omitempty"`
	Output       string         `json:"output,omitempty"`
	IsError      bool           `json:"isError,omitempty"`
	RequestID    string         `json:"requestId,omitempty"`
	RiskLevel    string         `json:"riskLevel,omitempty"`
	Reason       string         `json:"reason,omitempty"`
	Decision     string         `json:"decision,omitempty"`
	Guardrail    string         `json:"guardrail,omitempty"`
	Action       string         `json:"action,omitempty"`
	TargetAgent  string         `json:"targetAgent,omitempty"`
	NextWorker   string         `json:"nextWorker,omitempty"`
	Instructions string         `json:"instructions,omitempty"`
	Path         string         `json:"path,omitempty"`
	Kind         string         `json:"kind,omitempty"`
	Diff         string         `json:"diff,omitempty"`
	ArtifactID   string         `json:"artifactId,omitempty"`
	SizeBytes    int64          `json:"sizeBytes,omitempty"`
	Summary      string         `json:"summary,omitempty"`
	Success      *bool          `json:"success,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
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
	var mapped []SDKMappedEvent
	for _, fixtureEvent := range stream.Events {
		eventProvider := provider
		if fixtureEvent.Provider != "" {
			eventProvider = fixtureEvent.Provider
		}
		if eventProvider == "" {
			eventProvider = "sdk-fixture"
		}
		for _, evt := range mapSDKFixtureEvent(fixtureEvent, eventProvider, scope) {
			mapped = append(mapped, evt)
		}
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

func mapSDKFixtureEvent(event SDKFixtureEvent, provider string, scope map[string]any) []SDKMappedEvent {
	switch normalizeSDKFixtureType(event.Type) {
	case "tool_call":
		return oneSDKMappedEvent(BusEventToolCall, scope, commonSDKPayload(event, provider, map[string]any{
			"callId":   firstNonEmpty(event.CallID, event.ToolUseID, event.ID),
			"toolName": event.ToolName,
			"input":    sanitizeSDKValue(event.Input),
			"status":   "pending",
		}))
	case "tool_result":
		return oneSDKMappedEvent(BusEventToolResult, scope, commonSDKPayload(event, provider, map[string]any{
			"callId":   firstNonEmpty(event.CallID, event.ToolUseID, event.ID),
			"toolName": event.ToolName,
			"content":  event.Output,
			"isError":  event.IsError,
		}))
	case "permission_request", "guardrail_signal":
		return oneSDKMappedEvent(BusEventPermissionRequested, scope, commonSDKPayload(event, provider, map[string]any{
			"requestId": firstNonEmpty(event.RequestID, event.ID),
			"toolName":  event.ToolName,
			"toolUseId": firstNonEmpty(event.ToolUseID, event.CallID),
			"input":     sanitizeSDKValue(event.Input),
			"riskLevel": firstNonEmpty(event.RiskLevel, "medium"),
			"reason":    event.Reason,
			"guardrail": event.Guardrail,
			"decision":  event.Decision,
		}))
	case "handoff", "handoff_suggestion", "route_suggestion":
		nextWorker := firstNonEmpty(event.NextWorker, event.TargetAgent)
		return oneSDKMappedEvent(BusEventRouteDecision, scope, commonSDKPayload(event, provider, map[string]any{
			"action":       firstNonEmpty(event.Action, "delegate"),
			"next_worker":  nextWorker,
			"targetAgent":  event.TargetAgent,
			"instructions": event.Instructions,
			"reasoning":    event.Reason,
			"summary":      event.Summary,
		}))
	case "file_change", "artifact_file":
		payload := commonSDKPayload(event, provider, map[string]any{
			"callId":   firstNonEmpty(event.CallID, event.ToolUseID),
			"toolName": event.ToolName,
			"path":     normalizeSDKWorkspacePath(event.Path),
			"kind":     firstNonEmpty(event.Kind, "modified"),
			"diff":     event.Diff,
		})
		return oneSDKMappedEvent(BusEventFileChange, scope, payload)
	case "artifact", "artifact_created":
		payload := commonSDKPayload(event, provider, map[string]any{
			"id":         firstNonEmpty(event.ArtifactID, event.ID),
			"artifactId": firstNonEmpty(event.ArtifactID, event.ID),
			"path":       normalizeSDKWorkspacePath(event.Path),
			"kind":       firstNonEmpty(event.Kind, "file"),
			"sizeBytes":  event.SizeBytes,
			"summary":    event.Summary,
		})
		return oneSDKMappedEvent(sdkFixtureEventArtifactCreated, scope, payload)
	case "trace_ref", "result", "run_result":
		success := true
		if event.Success != nil {
			success = *event.Success
		}
		payload := commonSDKPayload(event, provider, map[string]any{
			"success": success,
			"summary": event.Summary,
		})
		return oneSDKMappedEvent(BusEventResult, scope, payload)
	default:
		return nil
	}
}

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
		payload["traceId"] = event.TraceID
	}
	if len(event.TraceRefs) > 0 {
		payload["traceRefs"] = append([]string(nil), event.TraceRefs...)
	}
	if len(event.EvidenceRefs) > 0 {
		payload["evidenceRefs"] = append([]string(nil), event.EvidenceRefs...)
	}
	if len(event.Metadata) > 0 {
		payload["metadata"] = sanitizeSDKValue(event.Metadata)
	}
	for key, value := range fields {
		switch v := value.(type) {
		case string:
			if strings.TrimSpace(v) == "" {
				continue
			}
		case int64:
			if v == 0 {
				continue
			}
		case map[string]any:
			if len(v) == 0 {
				continue
			}
		case nil:
			continue
		}
		payload[key] = sanitizeSDKValue(value)
	}
	return payload
}

func oneSDKMappedEvent(eventType string, scope map[string]any, payload map[string]any) []SDKMappedEvent {
	return []SDKMappedEvent{{
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

func normalizeSDKFixtureType(value string) string {
	normalized := strings.TrimSpace(strings.ToLower(value))
	normalized = strings.ReplaceAll(normalized, ".", "_")
	normalized = strings.ReplaceAll(normalized, "-", "_")
	switch normalized {
	case "function_call", "tool_invocation", "tool_use":
		return "tool_call"
	case "function_result", "tool_output":
		return "tool_result"
	case "approval_request", "permission", "can_use_tool":
		return "permission_request"
	case "guardrail", "guardrail_triggered", "approval_signal":
		return "guardrail_signal"
	case "route", "handoff_suggestion":
		return "handoff_suggestion"
	case "file", "file_update", "file_changed":
		return "file_change"
	case "artifact_created":
		return "artifact"
	case "trace", "evidence_ref":
		return "trace_ref"
	default:
		return normalized
	}
}

func sanitizeSDKValue(value any) any {
	switch v := value.(type) {
	case map[string]any:
		sanitized := make(map[string]any, len(v))
		for key, child := range v {
			if isSDKSecretKey(key) {
				sanitized[key] = "[redacted]"
				continue
			}
			if isSDKPathKey(key) {
				if text, ok := child.(string); ok {
					sanitized[key] = normalizeSDKWorkspacePath(text)
					continue
				}
			}
			sanitized[key] = sanitizeSDKValue(child)
		}
		return sanitized
	case []any:
		sanitized := make([]any, len(v))
		for i, child := range v {
			sanitized[i] = sanitizeSDKValue(child)
		}
		return sanitized
	case []string:
		return append([]string(nil), v...)
	default:
		return value
	}
}

func isSDKSecretKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", ""))
	return strings.Contains(normalized, "secret") ||
		strings.Contains(normalized, "token") ||
		strings.Contains(normalized, "apikey") ||
		strings.Contains(normalized, "credential") ||
		strings.Contains(normalized, "authorization") ||
		strings.Contains(normalized, "password") ||
		strings.Contains(normalized, "privatekey")
}

func isSDKPathKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(key, "_", ""))
	return normalized == "path" ||
		normalized == "filepath" ||
		normalized == "filename" ||
		normalized == "workspacepath" ||
		normalized == "artifactpath" ||
		normalized == "cwd" ||
		normalized == "workdir" ||
		strings.HasSuffix(normalized, "path")
}

func normalizeSDKWorkspacePath(value string) string {
	cleaned := strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if cleaned == "" {
		return ""
	}
	cleaned = path.Clean(cleaned)
	if cleaned == "." {
		return ""
	}
	if path.IsAbs(cleaned) || filepath.IsAbs(value) || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return path.Base(cleaned)
	}
	return strings.TrimPrefix(cleaned, "./")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
