package sdk

import (
	"time"

	"github.com/agenthub/edge-server/internal/httputil"
)

// retryAfterCeiling caps provider-supplied Retry-After hints: runs carry
// their own deadlines and only a handful of retries, so an extreme hint
// (e.g. 120s) must not stall the attempt budget.
//
// This is the SDK adapter's own policy, handed to the shared parser as an
// explicit argument. The Hub callback client passes httputil.NoCeiling instead
// and bounds a hint with its wall-clock retry budget — that difference used to
// be invisible, encoded only as a side effect of two byte-identical parser
// copies living in two packages (#2244).
const retryAfterCeiling = 30 * time.Second

// retryDelayWithHint returns the backoff to sleep before the next attempt:
// the larger of the scheduled backoff and the server-supplied Retry-After
// hint, capped at retryAfterCeiling. Ignoring the hint made every retry
// collide with provider throttle windows longer than the fixed 1s/2s/4s
// backoff (#2154).
//
// The parsing and capping live in internal/httputil so this adapter and the
// Hub callback client cannot drift apart again.
func retryDelayWithHint(backoff time.Duration, header string) time.Duration {
	return httputil.DelayWithHint(backoff, header, retryAfterCeiling)
}
