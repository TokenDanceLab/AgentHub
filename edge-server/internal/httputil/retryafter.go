// Package httputil holds HTTP protocol helpers that more than one Edge
// outbound client needs.
//
// It exists because the Retry-After parser had been copied verbatim into two
// packages — internal/adapters/sdk (parseRetryAfterHeader) and internal/hub
// (parseRetryAfter) — and the copies had already drifted exactly where it
// matters: the SDK adapter capped a server-supplied hint at 30s while the
// callback client did not cap it at all. The adapter's comment justified the
// copy with "kept local so adapters do not import the hub package", but both
// packages live under edge-server/internal/, so a shared leaf package is
// available without any layering cost. Sharing the parser turns that ceiling
// difference into an explicit argument at each call site instead of a side
// effect of which copy you happened to call (#2244).
package httputil

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// NoCeiling is the ceiling value for callers that deliberately do not cap a
// server-supplied Retry-After hint.
//
// Pass it explicitly rather than relying on a zero default meaning "uncapped"
// by accident: not capping is a policy choice that has to be visible at the
// call site and pinned by a test. The Hub callback client uses it because it
// bounds a hint with a wall-clock retry budget (and the caller's deadline)
// rather than with a fixed cap.
const NoCeiling time.Duration = 0

// ParseRetryAfter parses an HTTP Retry-After header, accepting both the
// delta-seconds and the HTTP-date form.
//
// ok=false when the header is absent, empty, or unparseable — callers must not
// guess a delay in that case, because a guessed delay is indistinguishable
// from a server instruction. A date in the past yields (0, true): "retry
// immediately" is a real instruction, not a parse failure.
func ParseRetryAfter(value string) (time.Duration, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	if n, err := strconv.Atoi(value); err == nil && n >= 0 {
		return time.Duration(n) * time.Second, true
	}
	if t, err := http.ParseTime(value); err == nil {
		delay := time.Until(t)
		if delay < 0 {
			delay = 0
		}
		return delay, true
	}
	return 0, false
}

// CapHint applies ceiling to a server-supplied delay. A ceiling of NoCeiling
// (or any non-positive value) means "no cap" and returns hint unchanged.
func CapHint(hint, ceiling time.Duration) time.Duration {
	if ceiling > NoCeiling && hint > ceiling {
		return ceiling
	}
	return hint
}

// DelayWithHint returns the backoff to sleep before the next attempt: the
// larger of the scheduled backoff and the server-supplied Retry-After hint
// after ceiling has been applied.
//
// Ignoring the hint made every retry collide with provider throttle windows
// longer than the fixed 1s/2s/4s backoff (#2154); capping it is what keeps an
// extreme hint (e.g. 3600s) from stalling a caller that carries its own
// deadline. Which of the two applies is the caller's decision, expressed as
// the ceiling argument.
func DelayWithHint(backoff time.Duration, header string, ceiling time.Duration) time.Duration {
	hint, ok := ParseRetryAfter(header)
	if !ok {
		return backoff
	}
	if hint = CapHint(hint, ceiling); hint > backoff {
		return hint
	}
	return backoff
}
