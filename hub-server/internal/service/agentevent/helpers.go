package agentevent

import (
	"encoding/json"
	"strconv"
	"strings"
)

// ValidApprovalDecision reports whether decision is an allowed approval outcome.
func ValidApprovalDecision(decision string) bool {
	switch decision {
	case "allow", "deny":
		return true
	default:
		return false
	}
}

// PendingApprovalStatus reports whether status still requires a decision.
func PendingApprovalStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "", "pending", "requested", "awaiting":
		return true
	default:
		return false
	}
}

// ApprovalIDFor prefers toolUseID, then requestID, as the stable approval key.
func ApprovalIDFor(requestID, toolUseID string) string {
	if strings.TrimSpace(toolUseID) != "" {
		return toolUseID
	}
	return requestID
}

// FirstNonEmptyString returns the first non-whitespace string.
func FirstNonEmptyString(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// FirstJSONString returns the first string value for any of the given map keys.
func FirstJSONString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		v, ok := values[key]
		if !ok {
			continue
		}
		if text, ok := v.(string); ok {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

// FirstNonEmpty returns the first non-empty string without trimming.
func FirstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// FirstRuntimeString returns the first non-empty trimmed string for any key.
func FirstRuntimeString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := payload[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// RuntimeString returns the first non-empty (untrimmed) string for any key.
func RuntimeString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := payload[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

// firstJSONInt extracts the first int64 value for any of the given map keys,
// accepting float64/int/int64/json.Number/string representations. Mirrors the
// agentteam projection's firstJSONInt so the counter increment and the
// projection read path agree on token accounting.
func firstJSONInt(values map[string]any, keys ...string) int64 {
	for _, key := range keys {
		value, ok := values[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return int64(typed)
		case int:
			return int64(typed)
		case int64:
			return typed
		case json.Number:
			if parsed, err := typed.Int64(); err == nil {
				return parsed
			}
		case string:
			if parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64); err == nil {
				return parsed
			}
		}
	}
	return 0
}

// tokenUsageFields extracts input/output/total token counts from a usage map,
// accepting the snake_case and camelCase variants emitted by edge run events.
// When total is zero but input or output is present, total is derived as
// input+output so callers always see a non-zero total for partial reports.
func tokenUsageFields(values map[string]any) (input, output, total int64) {
	input = firstJSONInt(values, "input", "inputTokens", "input_tokens")
	output = firstJSONInt(values, "output", "outputTokens", "output_tokens")
	total = firstJSONInt(values, "total", "totalTokens", "total_tokens")
	if total == 0 && (input > 0 || output > 0) {
		total = input + output
	}
	return input, output, total
}

// tokenUsageFromMap computes the total token delta for a single event payload
// map, inspecting nested "tokenUsage"/"token_usage"/"usage" objects first and
// falling back to direct top-level token fields. This mirrors the agentteam
// projection's teamEventTokenUsage so the write-side counter and the read-side
// projection never disagree on what counts as token usage.
func tokenUsageFromMap(payload map[string]any) int64 {
	sawNestedUsage := false
	var input, output, total int64
	for _, key := range []string{"tokenUsage", "token_usage", "usage"} {
		if nested, ok := payload[key].(map[string]any); ok {
			sawNestedUsage = true
			nestedInput, nestedOutput, nestedTotal := tokenUsageFields(nested)
			input += nestedInput
			output += nestedOutput
			total += nestedTotal
		}
	}
	if !sawNestedUsage {
		directInput, directOutput, directTotal := tokenUsageFields(payload)
		input += directInput
		output += directOutput
		total += directTotal
	}
	if total == 0 && (input > 0 || output > 0) {
		total = input + output
	}
	return total
}

// TokenUsageTotalFromPayload parses a JSON agent run event payload string and
// returns the total token delta that should be added to the owning team run's
// token_usage_total counter. Returns 0 for payloads that carry no token usage
// or fail to parse, so the caller can skip the increment with a single check.
// Used by the edge stream callback (agent_edge_callback.go) to maintain the
// counter that the budget guard (agent_team_guard.go) reads in O(1).
//
// This mirrors the agentteam projection's teamEventTokenUsage accounting
// (nested tokenUsage/token_usage/usage + direct fields) so the write-side
// counter and the read-side projection never disagree on what counts as
// token usage. Distinct from agentevent.TokenUsageFromPayload (project.go)
// which is the narrower input/output extractor for a different projection.
func TokenUsageTotalFromPayload(payload string) int64 {
	if payload == "" {
		return 0
	}
	var values map[string]any
	if err := json.Unmarshal([]byte(payload), &values); err != nil {
		return 0
	}
	return tokenUsageFromMap(values)
}
