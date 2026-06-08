package adapters

import (
	"encoding/json"
	"path"
	"path/filepath"
	"regexp"
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
	AdapterID           string           `json:"adapterId,omitempty"`
	CommandName         string           `json:"commandName,omitempty"`
	ArgFlags            []string         `json:"argFlags,omitempty"`
	ConfigKeys          []string         `json:"configKeys,omitempty"`
	PositionalArgCount  int              `json:"positionalArgCount,omitempty"`
	EnvNames            []string         `json:"envNames,omitempty"`
	WorkDir             string           `json:"workDir,omitempty"`
	PromptRedacted      bool             `json:"promptRedacted,omitempty"`
	Observed            bool             `json:"observed,omitempty"`
	RealTested          bool             `json:"realTested,omitempty"`
	RealTestedReason    string           `json:"realTestedReason,omitempty"`
	ExecutionMode       string           `json:"executionMode,omitempty"`
	NoSpendDefault      bool             `json:"noSpendDefault,omitempty"`
	RedactionApplied    bool             `json:"redactionApplied,omitempty"`
	ApprovalRequired    bool             `json:"approvalRequired,omitempty"`
	ApprovalEvidenceRef string           `json:"approvalEvidenceRef,omitempty"`
	TaskID              string           `json:"taskId,omitempty"`
	Description         string           `json:"description,omitempty"`
	LastToolName        string           `json:"lastToolName,omitempty"`
	Percent             float64          `json:"percent,omitempty"`
	Usage               *SDKFixtureUsage `json:"usage,omitempty"`
}

// SDKFixtureUsage is a provider-neutral usage/cost projection accepted only by
// fixture contract tests.
type SDKFixtureUsage struct {
	InputTokens  int64   `json:"inputTokens,omitempty"`
	OutputTokens int64   `json:"outputTokens,omitempty"`
	TotalTokens  int64   `json:"totalTokens,omitempty"`
	TotalCostUSD float64 `json:"totalCostUsd,omitempty"`
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
	case "invocation_plan", "cli_invocation_plan":
		return oneSDKMappedEvent(BusEventCLIInvocationPlan, scope, commonSDKPayload(event, provider, map[string]any{
			"adapterId":           event.AdapterID,
			"commandName":         commandNameOnly(event.CommandName),
			"argFlags":            event.ArgFlags,
			"configKeys":          event.ConfigKeys,
			"positionalArgCount":  event.PositionalArgCount,
			"envNames":            envNamesOnly(event.EnvNames),
			"workDir":             invocationPathNameOnly(event.WorkDir),
			"promptRedacted":      event.PromptRedacted,
			"observed":            false,
			"realTested":          false,
			"realTestedReason":    firstNonEmpty(event.RealTestedReason, "fixture plan only; no approved observed CLI chain"),
			"executionMode":       firstNonEmpty(event.ExecutionMode, "fixture"),
			"noSpendDefault":      true,
			"redactionApplied":    true,
			"approvalRequired":    true,
			"approvalEvidenceRef": event.ApprovalEvidenceRef,
		}))
	case "sidecar_session_ready", "session_ready":
		return oneSDKMappedEvent(BusEventSessionInit, scope, commonSDKPayload(event, provider, map[string]any{
			"sessionId":      event.SessionID,
			"model":          event.Model,
			"permissionMode": event.PermissionMode,
			"tools":          event.Tools,
		}))
	case "session_updated", "status", "status_change":
		return oneSDKMappedEvent(BusEventStatusChange, scope, commonSDKPayload(event, provider, map[string]any{
			"sessionId": event.SessionID,
			"status":    event.Status,
			"summary":   event.Summary,
			"reason":    event.Reason,
		}))
	case "progress", "task_progress":
		return oneSDKMappedEvent(BusEventTaskProgress, scope, commonSDKPayload(event, provider, map[string]any{
			"taskId":       firstNonEmpty(event.TaskID, event.ID),
			"description":  event.Description,
			"status":       event.Status,
			"percent":      event.Percent,
			"lastToolName": event.LastToolName,
			"summary":      event.Summary,
		}))
	case "usage", "context_usage":
		return oneSDKMappedEvent(BusEventContextUsage, scope, commonSDKPayload(event, provider, sdkUsagePayload(event)))
	case "error", "runtime_error":
		payload := commonSDKPayload(event, provider, map[string]any{
			"success":        false,
			"terminalReason": "error",
			"reason":         firstNonEmpty(event.Reason, "error"),
			"error":          sanitizeSDKText(event.Error),
			"sessionId":      event.SessionID,
		})
		return oneSDKMappedEvent(BusEventResult, scope, payload)
	case "cancelled", "canceled", "cancellation":
		payload := commonSDKPayload(event, provider, map[string]any{
			"success":        false,
			"cancelled":      true,
			"terminalReason": "cancelled",
			"reason":         firstNonEmpty(event.Reason, "cancelled"),
			"summary":        event.Summary,
			"sessionId":      event.SessionID,
		})
		return oneSDKMappedEvent(BusEventResult, scope, payload)
	case "tool_state":
		events := []SDKMappedEvent{{
			Type:  BusEventToolCall,
			Scope: cloneSDKScope(scope),
			Payload: commonSDKPayload(event, provider, map[string]any{
				"callId":   firstNonEmpty(event.CallID, event.ToolUseID, event.ID),
				"toolName": event.ToolName,
				"input":    sanitizeSDKValue(event.Input),
				"status":   firstNonEmpty(event.Status, "pending"),
			}),
		}}
		if event.Status == "completed" || event.Status == "error" || event.Output != "" || event.Error != "" {
			events = append(events, SDKMappedEvent{
				Type:  BusEventToolResult,
				Scope: cloneSDKScope(scope),
				Payload: commonSDKPayload(event, provider, map[string]any{
					"callId":      firstNonEmpty(event.CallID, event.ToolUseID, event.ID),
					"toolName":    event.ToolName,
					"content":     firstNonEmpty(event.Output, event.Error),
					"isError":     event.IsError || event.Status == "error",
					"attachments": sanitizeSDKValue(event.Attachments),
				}),
			})
		}
		return events
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
	case "trace_ref", "result", "run_result", "terminal_result":
		success := true
		if event.Success != nil {
			success = *event.Success
		}
		payload := commonSDKPayload(event, provider, map[string]any{
			"success":        success,
			"summary":        event.Summary,
			"terminalReason": terminalReasonForSDKEvent(event, success),
			"usage":          sdkUsagePayload(event),
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
		case []string:
			if len(v) == 0 {
				continue
			}
		case []map[string]any:
			if len(v) == 0 {
				continue
			}
		case float64:
			if v == 0 {
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
	case "permission_asked":
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
	case []map[string]any:
		sanitized := make([]map[string]any, len(v))
		for i, child := range v {
			mapped, _ := sanitizeSDKValue(child).(map[string]any)
			sanitized[i] = mapped
		}
		return sanitized
	case []string:
		return append([]string(nil), v...)
	default:
		return value
	}
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

func terminalReasonForSDKEvent(event SDKFixtureEvent, success bool) string {
	if event.Reason != "" {
		return event.Reason
	}
	switch normalizeSDKFixtureType(event.Type) {
	case "terminal_result", "run_result", "result":
		if success {
			return "completed"
		}
		return "error"
	default:
		if success {
			return "completed"
		}
		return "error"
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

var (
	sdkWindowsPathPattern = regexp.MustCompile(`(?i)[a-z]:[\\/](?:[^\\/\s"]+[\\/])*([^\\/\s"]+)`)
	sdkPOSIXPathPattern   = regexp.MustCompile(`/(?:[^/\s"]+/)+([^/\s"]+)`)
	sdkTokenPattern       = regexp.MustCompile(`(?i)\b(?:sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_a-z0-9]{6,}\b`)
)

func sanitizeSDKText(value string) string {
	if value == "" {
		return ""
	}
	sanitized := sdkWindowsPathPattern.ReplaceAllString(value, "$1")
	sanitized = sdkPOSIXPathPattern.ReplaceAllString(sanitized, "$1")
	sanitized = sdkTokenPattern.ReplaceAllString(sanitized, "[redacted]")
	return sanitized
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
