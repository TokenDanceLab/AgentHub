package sdk

import (
	"testing"
	"time"
)

// TestRetryDelayWithHint pins the SDK adapter's half of the shared Retry-After
// contract: the very header value that the Hub callback client leaves uncapped
// must come back capped at retryAfterCeiling here. The parser itself is tested
// once, in internal/httputil, together with the assertion that the two caller
// policies diverge on identical input (#2244).
func TestRetryDelayWithHint(t *testing.T) {
	tests := []struct {
		name    string
		backoff time.Duration
		header  string
		want    time.Duration
	}{
		{"no header keeps backoff", 2 * time.Second, "", 2 * time.Second},
		{"hint below backoff keeps backoff", 4 * time.Second, "1", 4 * time.Second},
		{"hint above backoff wins", 1 * time.Second, "5", 5 * time.Second},
		{"hint capped at ceiling", 1 * time.Second, "120", retryAfterCeiling},
		{"garbage header keeps backoff", 2 * time.Second, "soon", 2 * time.Second},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := retryDelayWithHint(tc.backoff, tc.header); got != tc.want {
				t.Fatalf("retryDelayWithHint(%v, %q) = %v, want %v", tc.backoff, tc.header, got, tc.want)
			}
		})
	}
}
