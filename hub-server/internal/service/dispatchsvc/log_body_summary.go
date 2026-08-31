package dispatchsvc

// Log-safe body summarizer for slog fields.
//
// Purpose: replace raw response bodies in warn/info logs with a fixed-shape
// summary that preserves troubleshooting signal (length, encoding shape,
// leading tokens) without persisting potentially sensitive task context or
// error payloads verbatim. Used by dispatchToEdgeHTTP for non-success Edge
// responses (#2120 slice 1).
//
// Why not hash? A hex digest carries no shape signal (JSON vs HTML vs plain,
// truncation, leading keyword) and is useless for triage. A sanitized prefix
// gives operators enough to classify the failure while being non-invertible
// and bounded.
//
// Why this is not a leak surface: output is capped at maxPrefixBytes, all
// non-ASCII and control bytes are replaced with `\xNN` escapes, and the
// result never contains a complete semantic fragment of the original beyond
// the first few ASCII tokens. Combined with the length field, it supports
// "was this JSON? was it truncated? did it start with an error code?"
// questions without exposing prompt/user content buried later in the body.

import (
	"fmt"
	"strings"
	"unicode"
)

const defaultBodySummaryPrefixBytes = 128

// SummarizeBodyForLog returns a log-safe summary of body suitable for use as
// a slog string field value. The format is stable and machine-parseable:
//
//	len=<n>;prefix="<sanitized>"
//
// Empty bodies return the literal "len=0;prefix=""".
func SummarizeBodyForLog(body []byte) string {
	return summarizeBodyForLogWithLimit(body, defaultBodySummaryPrefixBytes)
}

func summarizeBodyForLogWithLimit(body []byte, maxPrefix int) string {
	if len(body) == 0 {
		return `len=0;prefix=""`
	}
	prefix := body
	if len(prefix) > maxPrefix {
		prefix = prefix[:maxPrefix]
	}
	sanitized := sanitizePrintableASCII(prefix)
	return fmt.Sprintf("len=%d;prefix=\"%s\"", len(body), sanitized)
}

// sanitizePrintableASCII replaces any byte that is not an ASCII printable
// character (0x20..0x7E) with a \xNN escape. Double quotes and backslashes
// are escaped so the result can be embedded in a quoted slog field value.
func sanitizePrintableASCII(b []byte) string {
	var sb strings.Builder
	sb.Grow(len(b))
	for _, c := range b {
		switch {
		case c == '\\':
			sb.WriteString(`\\`)
		case c == '"':
			sb.WriteString(`\"`)
		case c >= 0x20 && c <= 0x7E && unicode.IsPrint(rune(c)):
			sb.WriteByte(c)
		default:
			fmt.Fprintf(&sb, `\x%02x`, c)
		}
	}
	return sb.String()
}
