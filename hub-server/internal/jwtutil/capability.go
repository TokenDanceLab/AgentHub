package jwtutil

import (
	"time"

	sharedjwt "github.com/agenthub/pkg/jwtutil"
)

// The capability-token contract (AH-SR-046) is owned by pkg/jwtutil — Hub
// mints, Edge validates, one authoritative definition. This file re-exports
// the shared symbols so hub callers keep their existing jwtutil.* imports.
type CapabilityClaims = sharedjwt.CapabilityClaims
type CapabilityIssueOptions = sharedjwt.CapabilityIssueOptions

var (
	ErrCapabilitySecretEmpty    = sharedjwt.ErrCapabilitySecretEmpty
	ErrCapabilitySecretTooShort = sharedjwt.ErrCapabilitySecretTooShort
	ErrCapabilityClaimsInvalid  = sharedjwt.ErrCapabilityClaimsInvalid
)

// IssueCapabilityToken mints a short-lived HS256 capability JWT for Edge
// dual-token auth. Optional bindings (action/target/thread) tighten
// AH-SR-046 route-scoped authorization.
func IssueCapabilityToken(secret []byte, userID, deviceID, projectID, purpose string, ttl time.Duration, opts ...CapabilityIssueOptions) (string, error) {
	return sharedjwt.IssueCapabilityToken(secret, userID, deviceID, projectID, purpose, ttl, opts...)
}
