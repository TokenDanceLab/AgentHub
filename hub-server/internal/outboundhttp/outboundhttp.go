// Package outboundhttp provides the small set of transport policy primitives
// for Hub production outbound clients (#1564). Callers own their client
// instances — this package is not a service locator and never holds a
// process-global client. Policy: bounded timeout, redirects refused so
// headers/payload are never replayed to another origin, default TLS
// verification (no InsecureSkipVerify anywhere).
//
// Trust boundary (#1549): use outboundhttp only for dialing endpoints whose
// address comes from administrator configuration, not from request data.
// Concretely, all five production call sites are admin-configured endpoints:
//
//   - TokenDance ID OIDC token endpoint (service/oidc, token exchange —
//     the POST body carries client_secret, so redirect refusal is the
//     credential-replay defense)
//   - TokenDance ID JWKS endpoint (service/oidc + jwtutil TokenDanceVerifier)
//   - Hub→Edge dispatch URL, AGENTHUB_EDGE_URL (app/wiring, dispatchsvc)
//   - TokenDance ID verifier HTTP client (app.App.tdVerifier)
//
// For user-controllable target addresses (execution-target ping URLs) the
// correct dial path is internal/egress, which adds fail-closed address
// classification (default deny for loopback/RFC1918/metadata, DNS-rebinding
// re-check, admin allowlist). egress builds on this package's policy but is
// a distinct trust boundary — do not "simplify" the two into one client.
// There is deliberately no universal dial path (#1549): a small number of
// purpose-specific clients, all wired at the composition root.
package outboundhttp

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// DefaultTimeout is the fallback per-request timeout when a caller passes
// zero (10s, matching the historical OIDC/JWKS clients).
const DefaultTimeout = 10 * time.Second

// NewClient builds an outbound http.Client with the Hub default policy.
// Redirects are refused (ErrUseLastResponse): token exchange and JWKS fetches
// must answer at the exact configured URL.
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

// ErrBodyTooLarge is returned by ReadLimited when the source exceeds max.
var ErrBodyTooLarge = errors.New("outbound response body exceeds limit")

// ReadLimited reads at most max bytes and fails closed (ErrBodyTooLarge)
// without retaining body content past the cap.
func ReadLimited(r io.Reader, max int64) ([]byte, error) {
	if max <= 0 {
		max = 64 * 1024
	}
	body, err := io.ReadAll(io.LimitReader(r, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > max {
		return nil, fmt.Errorf("%w: max=%d", ErrBodyTooLarge, max)
	}
	return body, nil
}
