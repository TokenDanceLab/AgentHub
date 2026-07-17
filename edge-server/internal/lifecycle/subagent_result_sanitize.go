package lifecycle

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Pre-compiled regex patterns for SanitizeSubAgentResult.
// These are compiled at package init time and are safe for concurrent use.
var (
	// reStackTrace matches lines containing stack trace markers:
	//   - "\tat " prefixed lines (Java/Python/Go traces)
	//   - "goroutine" prefixed lines (Go runtime traces)
	//   - "...path/file.go:line" file references in traces
	reStackTrace = regexp.MustCompile(`(?m)^\s*(?:\t+at\s.*|goroutine\s+\d+.*|\.\.\.[/\w.\-]+\.go:\d+(?:\s+.*)?)$`)

	// reFilePath matches absolute file paths that reveal project directory
	// structure, e.g. "D:/Code/TokenDance/..." or "/home/user/...".
	// The trailing character class includes backslash for Windows paths.
	// Directory set includes common project roots: Code, Users, home, tmp,
	// Projects, Work, Data, Documents, Desktop.
	reFilePath = regexp.MustCompile(`[A-Za-z]:[/\\](?:Code|Users|home|tmp|Projects|Work|Data|Documents|Desktop)[/\\\w.\-]*|/(?:home|Users|tmp)/[\w.\-/]*`)

	// reAPIKey matches common API key patterns:
	//   - "sk-" prefix (OpenAI, Anthropic, etc.)
	//   - "api-key-" prefix (various providers)
	//   - Google API keys (AIza...)
	//   - GitHub personal access tokens (ghp_..., github_pat_...)
	//   - GitLab tokens (glpat-...)
	//   - HuggingFace tokens (hf_...)
	//   - JWT tokens (eyJ... base64url with dots)
	//   - AWS access keys (AKIA...)
	//   - Bearer token headers
	reAPIKey = regexp.MustCompile(`(?:sk-[a-zA-Z0-9_\-\^=]{20,}|api-key-[a-zA-Z0-9_\-]{16,}|AIza[0-9A-Za-z\-_]{35}|ghp_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{22,}|glpat-[0-9A-Za-z\-_]{20,}|hf_[0-9A-Za-z]{34}|eyJ[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9_\-\\.=]{20,})`)
)

// ── Sub-Agent Result Sanitization Layer ─────────────────────────────────
//
// ARCHITECTURE NOTE (2026-06): This sanitization layer was added as a safety
// gate between sub-agent completion and the message queue / result aggregator.
// Before this layer, raw sub-agent output (including stack traces, absolute
// file paths, and API keys) could enter the message queue unredacted.
//
// The layer operates at exactly one chokepoint — sendSubAgentResult — and
// applies three transformations:
//   1. Regex-based redaction of stack traces, file paths, and API keys
//      (via pre-compiled regex patterns: reStackTrace, reFilePath, reAPIKey).
//   2. Recursive structured-data scanning (maps and slices are walked depth-first
//      so attackers cannot evade sanitization by nesting sensitive data).
//   3. UTF-8-safe truncation at 32KB to bound message queue payload sizes.
//
// The same sanitized payload is written to both the message queue (for parent
// orchestrator consumption) and the result aggregator (for persisted synthesis),
// ensuring no bypass path exists. The _sanitized / _sanitized_reason metadata
// fields on the message payload allow the parent orchestrator to detect when
// output has been modified.

// maxSanitizedResultBytes is the maximum size of a sub-agent result string
// before truncation is applied. Strings longer than this are truncated to
// keep message queue payloads bounded and prevent memory bloat from runaway
// agent outputs.
const maxSanitizedResultBytes = 32 * 1024 // 32KB

// recursiveSanitizeString applies all regex-based sanitization to a string
// and returns the sanitized result plus a comma-separated list of what was
// modified (empty means no changes). This is the core sanitization logic
// shared by both string and structured payload paths.
func recursiveSanitizeString(s string) (string, string) {
	if len(s) == 0 {
		return s, ""
	}
	var reasons []string

	if reStackTrace.MatchString(s) {
		s = reStackTrace.ReplaceAllString(s, "[redacted:stack-trace]")
		reasons = append(reasons, "stack-trace-redacted")
	}

	if reFilePath.MatchString(s) {
		s = reFilePath.ReplaceAllString(s, "[redacted:file-path]")
		reasons = append(reasons, "file-paths-redacted")
	}

	if reAPIKey.MatchString(s) {
		s = reAPIKey.ReplaceAllString(s, "[redacted:api-key]")
		reasons = append(reasons, "api-keys-redacted")
	}

	return s, strings.Join(reasons, ",")
}

// sanitizeHubStreamText redacts API keys / tokens from Hub TaskStream text.
// Unlike recursiveSanitizeString, it deliberately does not redact file paths
// or stack traces so streamed workdir paths remain useful in Hub chat.
func sanitizeHubStreamText(s string) string {
	if s == "" || !reAPIKey.MatchString(s) {
		return s
	}
	return reAPIKey.ReplaceAllString(s, "[redacted:api-key]")
}

// SanitizeSubAgentResult sanitizes a sub-agent result payload before it enters
// the message queue. It applies the following transformations:
//
//  1. For string payloads: redacts stack traces, file paths, API keys, and
//     truncates oversized output at a UTF-8-safe boundary.
//  2. For structured payloads (map[string]any, []any): recursively walks the
//     structure and sanitizes all string values using the same regex pipeline.
//     This prevents attackers from evading sanitization by wrapping sensitive
//     data in a map or slice.
//  3. For all payloads: truncates the result if it exceeds maxSanitizedResultBytes
//     when serializable as a string, keeping the head and appending a truncation
//     marker.
//
// The function is designed to be safe (never panics) and fast (<1ms for
// typical payloads). It returns the sanitized payload and a reason string
// describing what was modified (empty string means no changes were made).
// Design note: absolute file paths are redacted for security, which may reduce synthesis fidelity.
// Structured file change data is available via BusEventFileChange on a separate event bus channel.
// Relative paths and _sanitized metadata flags provide escape hatches for downstream consumers.
func SanitizeSubAgentResult(payload any) (any, string) {
	if payload == nil {
		return nil, ""
	}

	switch v := payload.(type) {
	case string:
		s, reason := recursiveSanitizeString(v)
		// Truncate if the result exceeds the maximum allowed size.
		s, truncReason := truncateUTF8Safe(s)
		if truncReason != "" {
			if reason != "" {
				reason = reason + "," + truncReason
			} else {
				reason = truncReason
			}
		}
		return s, reason

	case map[string]any:
		// Recursively sanitize all string values and keys in the map.
		sanitized := make(map[string]any, len(v))
		combinedReason := ""
		for k, val := range v {
			sanVal, r := SanitizeSubAgentResult(val)
			sanitizedKey, keyReason := recursiveSanitizeString(k)
			sanitized[sanitizedKey] = sanVal
			if keyReason != "" {
				if combinedReason != "" {
					combinedReason = combinedReason + "," + keyReason
				} else {
					combinedReason = keyReason
				}
			}
			if r != "" {
				if combinedReason != "" {
					combinedReason = combinedReason + "," + r
				} else {
					combinedReason = r
				}
			}
		}
		return sanitized, combinedReason

	case []any:
		// Recursively sanitize all string values in the slice.
		sanitized := make([]any, len(v))
		combinedReason := ""
		for i, val := range v {
			sanVal, r := SanitizeSubAgentResult(val)
			sanitized[i] = sanVal
			if r != "" {
				if combinedReason != "" {
					combinedReason = combinedReason + "," + r
				} else {
					combinedReason = r
				}
			}
		}
		return sanitized, combinedReason

	case json.RawMessage:
		var m map[string]any
		if err := json.Unmarshal(v, &m); err == nil {
			return SanitizeSubAgentResult(m)
		}
		return v, ""

	case []byte:
		s, reason := recursiveSanitizeString(string(v))
		s, truncReason := truncateUTF8Safe(s)
		if truncReason != "" {
			if reason != "" {
				reason = reason + "," + truncReason
			} else {
				reason = truncReason
			}
		}
		return s, reason

	default:
		// Non-string, non-map, non-slice payloads (e.g. numbers, bools)
		// are passed through unchanged.
		return payload, ""
	}
}

// truncateUTF8Safe truncates s to maxSanitizedResultBytes at a UTF-8
// character boundary to avoid slicing multi-byte code points. Returns the
// (possibly truncated) string and a reason string (empty if no truncation).
func truncateUTF8Safe(s string) (string, string) {
	if len(s) <= maxSanitizedResultBytes {
		return s, ""
	}

	headSize := maxSanitizedResultBytes - 2*1024 // reserve 2KB for tail
	if headSize < 1024 {
		headSize = 1024 // safety floor
	}

	// Walk backward from headSize to the start of a UTF-8 character.
	// This prevents slicing in the middle of a multi-byte code point (e.g.
	// CJK characters at 3 bytes each).
	for headSize > 0 && headSize < len(s) {
		if utf8.RuneStart(s[headSize]) {
			break
		}
		headSize--
	}

	tailSize := len(s) - headSize
	if tailSize > 2048 {
		tailSize = 2048
	}
	// Also align tail start to UTF-8 boundary.
	tailStart := len(s) - tailSize
	for tailStart > 0 && tailStart < len(s) {
		if utf8.RuneStart(s[tailStart]) {
			break
		}
		tailStart++
	}
	tailSize = len(s) - tailStart

	truncated := s[:headSize] + "\n... [truncated " + strconv.Itoa(len(s)-maxSanitizedResultBytes) + " bytes] ...\n" + s[tailStart:]
	return truncated, "truncated-32kb"
}
