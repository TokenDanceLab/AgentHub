package service

import "strings"

func validApprovalDecision(decision string) bool {
	switch decision {
	case "allow", "deny":
		return true
	default:
		return false
	}
}

func pendingApprovalStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "", "pending", "requested", "awaiting":
		return true
	default:
		return false
	}
}

func approvalIDFor(requestID, toolUseID string) string {
	if strings.TrimSpace(toolUseID) != "" {
		return toolUseID
	}
	return requestID
}

func firstNonEmptyString(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func firstJSONString(values map[string]any, keys ...string) string {
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

