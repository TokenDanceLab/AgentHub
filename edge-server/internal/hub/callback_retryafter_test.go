package hub

import (
	"net/http"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/httputil"
)

// TestClassifyCallbackResponse_RetryAfterIsNotCapped pins the callback
// client's half of the shared Retry-After contract (#2244 slice 3).
//
// The SDK adapter caps a server hint at 30s because a run carries its own
// deadline. The callback path deliberately does not: it bounds a hint with the
// wall-clock retry budget (retryBudget, itself clamped by the caller's
// deadline), which is why callbackRetryAfterCeiling is httputil.NoCeiling
// rather than a number. A 3600s hint therefore has to survive classification
// intact so the budget check — not a hidden constant — decides whether the
// sequence stops. Before the parser was shared, this behavior existed only as
// the absence of a cap in one of two copies.
func TestClassifyCallbackResponse_RetryAfterIsNotCapped(t *testing.T) {
	if got := callbackRetryAfterCeiling; got != httputil.NoCeiling {
		t.Fatalf("callbackRetryAfterCeiling = %v, want httputil.NoCeiling (budget, not a cap, bounds this path)", got)
	}

	tests := []struct {
		name      string
		status    int
		header    string
		wantDelay time.Duration
		wantRetr  bool
	}{
		{"429 with a hint far above the SDK ceiling stays uncapped", http.StatusTooManyRequests, "3600", time.Hour, true},
		{"503 with the same hint stays uncapped", http.StatusServiceUnavailable, "3600", time.Hour, true},
		{"429 with a short hint is passed through", http.StatusTooManyRequests, "5", 5 * time.Second, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, retryable, delay := classifyCallbackResponse(tc.status, tc.header)
			if delay != tc.wantDelay {
				t.Fatalf("retryAfter = %v, want %v", delay, tc.wantDelay)
			}
			if retryable != tc.wantRetr {
				t.Fatalf("retryable = %v, want %v", retryable, tc.wantRetr)
			}
		})
	}
}

// TestClassifyCallbackResponse_UnparseableHintKeepsContract guards the other
// half of the shared parser's contract: an absent or unparseable hint must
// never be guessed into a delay, and for 429 that means "not retryable".
func TestClassifyCallbackResponse_UnparseableHintKeepsContract(t *testing.T) {
	if _, retryable, delay := classifyCallbackResponse(http.StatusTooManyRequests, "soon"); retryable || delay != 0 {
		t.Fatalf("429 + garbage hint = (retryable %v, delay %v), want (false, 0)", retryable, delay)
	}
	if _, retryable, delay := classifyCallbackResponse(http.StatusInternalServerError, ""); !retryable || delay != 0 {
		t.Fatalf("500 + no hint = (retryable %v, delay %v), want (true, 0)", retryable, delay)
	}
}
