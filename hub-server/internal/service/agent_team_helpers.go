package service

import "strings"

// validApprovalDecision checks whether the approval decision is a valid value.
func validApprovalDecision(decision string) bool {
	switch decision {
	case "allow", "deny":
		return true
	default:
		return false
	}
}

// pendingApprovalStatus returns true if the status string represents a pending
// (not-yet-decided) approval state.
func pendingApprovalStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "", "pending", "requested", "awaiting":
		return true
	default:
		return false
	}
}

// approvalIDFor derives a stable approval identifier from request and tool-use IDs.
func approvalIDFor(requestID, toolUseID string) string {
	if strings.TrimSpace(toolUseID) != "" {
		return toolUseID
	}
	return requestID
}

// firstNonEmptyString returns the first non-empty, trimmed string from the given
// values. Returns "" if all values are empty.
func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// firstJSONString returns the first non-empty string value for any of the given
// JSON keys in the provided map. Returns "" if none match.
func firstJSONString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := values[key]
		if !ok {
			continue
		}
		if text, ok := value.(string); ok {
			return strings.TrimSpace(text)
		}
	}
	return ""
}
