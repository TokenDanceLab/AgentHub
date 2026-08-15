package jwtutil

import (
	sharedjwt "github.com/agenthub/pkg/jwtutil"
)

// The capability-token contract (AH-SR-046) is owned by pkg/jwtutil — Hub
// mints, Edge validates, one authoritative definition. This file re-exports
// the shared symbols so edge callers keep their existing jwtutil.* imports.
type CapabilityClaims = sharedjwt.CapabilityClaims

var (
	ErrCapabilityTokenExpired   = sharedjwt.ErrCapabilityTokenExpired
	ErrCapabilityTokenInvalid   = sharedjwt.ErrCapabilityTokenInvalid
	ErrCapabilityTokenEmpty     = sharedjwt.ErrCapabilityTokenEmpty
	ErrCapabilitySecretEmpty    = sharedjwt.ErrCapabilitySecretEmpty
	ErrCapabilitySecretTooShort = sharedjwt.ErrCapabilitySecretTooShort
)

// ValidateCapabilityToken validates a Hub-issued capability JWT against the
// shared Hub JWT secret. expectedDeviceID must match the device_id claim in
// the token — this binds the capability to the specific Edge device that Hub
// authorized.
func ValidateCapabilityToken(tokenStr string, secret []byte, expectedDeviceID string) (*CapabilityClaims, error) {
	return sharedjwt.ValidateCapabilityToken(tokenStr, secret, expectedDeviceID)
}
