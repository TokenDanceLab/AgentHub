package sdk

import (
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

// Residual pure-helper peel #1122: sanitize / normalize helpers for SDK fixture mapping.

func normalizeSDKFixtureType(value string) string {
	normalized := strings.TrimSpace(strings.ToLower(value))
	normalized = strings.ReplaceAll(normalized, ".", "_")
	normalized = strings.ReplaceAll(normalized, "-", "_")
	switch normalized {
	case "message_output", "output_text", "response_output_text":
		return "text_block"
	case "function_tool_call", "tool_call_item":
		return "tool_call"
	case "function_call", "tool_invocation", "tool_use":
		return "tool_call"
	case "function_tool_output", "tool_output_item":
		return "tool_result"
	case "function_result", "tool_output":
		return "tool_result"
	case "approval_request", "permission", "can_use_tool":
		return "permission_request"
	case "permission_asked", "permission_requested":
		return "permission_request"
	case "guardrail", "guardrail_triggered", "approval_signal":
		return "guardrail_signal"
	case "route", "route_decision", "handoff_suggestion":
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
		sanitized := make([]string, len(v))
		for i, child := range v {
			sanitized[i] = sanitizeSDKText(child)
		}
		return sanitized
	case string:
		return sanitizeSDKText(v)
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
	if isSDKAbsoluteOrEscapingPath(value, cleaned) {
		return path.Base(cleaned)
	}
	return strings.TrimPrefix(cleaned, "./")
}

func isSDKAbsoluteOrEscapingPath(original, cleaned string) bool {
	if path.IsAbs(cleaned) || filepath.IsAbs(original) || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return true
	}
	return hasSDKWindowsDriveRoot(cleaned) || hasSDKWindowsDriveRoot(strings.ReplaceAll(original, "\\", "/"))
}

func hasSDKWindowsDriveRoot(value string) bool {
	return len(value) >= 3 &&
		((value[0] >= 'a' && value[0] <= 'z') || (value[0] >= 'A' && value[0] <= 'Z')) &&
		value[1] == ':' &&
		value[2] == '/'
}

var (
	sdkAuthHeaderPattern       = regexp.MustCompile(`(?i)(authorization\s*:\s*bearer\s+)[^"'\s,;\\]+`)
	sdkBearerPattern           = regexp.MustCompile(`(?i)\bbearer\s+[-._~+/=a-z0-9]{8,}`)
	sdkSecretAssignmentPattern = regexp.MustCompile(`(?i)\b([a-z0-9_ -]*(?:api[_ -]?key|token|secret|password|private[_ -]?key|authorization)[a-z0-9_ -]*\s*[:=]\s*)(?:"[^"]*"|'[^']*'|-----BEGIN [^-]+ PRIVATE KEY-----|[^"'\s,;]+)`)
	sdkPromptBodyPattern       = regexp.MustCompile(`(?i)\b((?:system[_ -]?prompt|prompt|trace[_ -]?body|tracebody)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,;\n]+)`)
	sdkWindowsPathPattern      = regexp.MustCompile(`(?i)[a-z]:[\\/](?:[^\\/\s"]+[\\/])*([^\\/\s"]+)`)
	sdkPOSIXPathPattern        = regexp.MustCompile(`(^|[\s"'=])/(?:[^/\s"]+/)+([^/\s"]+)`)
	sdkTokenPattern            = regexp.MustCompile(`(?i)(^|[^a-z0-9])(?:sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_a-z0-9]{6,}\b`)
)

func sanitizeSDKText(value string) string {
	if len(value) < 2 {
		return value
	}
	sanitized := sdkAuthHeaderPattern.ReplaceAllString(value, "${1}[redacted-token]")
	sanitized = sdkBearerPattern.ReplaceAllString(sanitized, "Bearer [redacted-token]")
	sanitized = sdkSecretAssignmentPattern.ReplaceAllString(sanitized, "${1}[redacted-secret]")
	sanitized = sdkPromptBodyPattern.ReplaceAllString(sanitized, "${1}[redacted]")
	sanitized = sdkTokenPattern.ReplaceAllString(sanitized, "${1}[redacted-token]")
	sanitized = sdkWindowsPathPattern.ReplaceAllString(sanitized, "$1")
	sanitized = sdkPOSIXPathPattern.ReplaceAllString(sanitized, "${1}${2}")
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
