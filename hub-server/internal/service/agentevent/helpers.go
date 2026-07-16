package agentevent

import "strings"

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
