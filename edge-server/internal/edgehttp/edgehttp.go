// Package edgehttp provides transport policy primitives for Edge production
// outbound clients (#1564). Callers own their client instances — this
// package is not a service locator and never holds a process-global client.
// Policy: bounded timeout, redirects refused so headers/payload are never
// replayed to another origin, default TLS verification.
package edgehttp

import (
	"net/http"
	"time"
)

// DefaultTimeout is the fallback per-request timeout when a caller passes
// zero (30s, matching the historical callback client).
const DefaultTimeout = 30 * time.Second

// NewClient builds an outbound http.Client with the Edge default policy.
// Redirects are refused (ErrUseLastResponse): a callback must land on the
// exact configured URL.
func NewClient(timeout time.Duration) *http.Client {
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	return &http.Client{
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}
