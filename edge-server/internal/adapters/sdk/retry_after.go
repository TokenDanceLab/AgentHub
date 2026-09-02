package sdk

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// retryAfterCeiling caps provider-supplied Retry-After hints: runs carry
// their own deadlines and only a handful of retries, so an extreme hint
// (e.g. 120s) must not stall the attempt budget.
const retryAfterCeiling = 30 * time.Second

// parseRetryAfterHeader parses the Retry-After response header
// (delta-seconds or HTTP-date). Mirrors parseRetryAfter in
// internal/hub/callback.go; kept local so adapters do not import the hub
// package.
func parseRetryAfterHeader(value string) (time.Duration, bool) {
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

// retryDelayWithHint returns the backoff to sleep before the next attempt:
// the larger of the scheduled backoff and the server-supplied Retry-After
// hint (capped). Ignoring the hint made every retry collide with provider
// throttle windows longer than the fixed 1s/2s/4s backoff (#2154).
func retryDelayWithHint(backoff time.Duration, header string) time.Duration {
	hint, ok := parseRetryAfterHeader(header)
	if !ok {
		return backoff
	}
	if hint > retryAfterCeiling {
		hint = retryAfterCeiling
	}
	if hint > backoff {
		return hint
	}
	return backoff
}
