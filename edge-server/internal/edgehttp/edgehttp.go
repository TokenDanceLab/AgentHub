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

// DefaultMaxIdleConnsPerHost is the per-host idle connection pool each
// outbound client carries. Go's DefaultTransport keeps only 2 idle
// connections per host; Edge→Hub callbacks burst concurrently (merged
// stream chunks post at sem=10), so every client built here carries its own
// cloned transport with a wider per-host pool.
const DefaultMaxIdleConnsPerHost = 32

// NewClient builds an outbound http.Client with the Edge default policy.
// Redirects are refused (ErrUseLastResponse): a callback must land on the
// exact configured URL.
func NewClient(timeout time.Duration) *http.Client {
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: newTransport(),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// newTransport clones http.DefaultTransport (preserving proxy and TLS
// defaults) and widens the per-host idle pool. Cloning also isolates each
// client's pool from the process-global DefaultTransport.
func newTransport() *http.Transport {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.MaxIdleConnsPerHost = DefaultMaxIdleConnsPerHost
	return tr
}
