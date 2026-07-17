package dispatch

import (
	"strings"
	"time"
)

// CapabilityTokenTTL is the short-lived JWT TTL for Hub→Edge run-start capability.
const CapabilityTokenTTL = 5 * time.Minute

// CapabilityMintInput is the pure env + payload surface used to decide whether
// issueRunStartCapability should mint a token (and with which bindings).
type CapabilityMintInput struct {
	JWTSecret       string
	PayloadDeviceID string
	EnvDeviceID     string
	TriggerUserID   string
	TargetID        string
}

// CapabilityMintResolved holds pure bindings for jwtutil.IssueCapabilityToken.
// Ok is false when secret or device are unavailable (local/dev skip path).
type CapabilityMintResolved struct {
	Ok         bool
	Secret     string
	UserID     string
	DeviceID   string
	ProjectID  string
	Action     string
	TargetID   string
	ThreadID   string
	TTL        time.Duration
}

// ResolveCapabilityMint returns capability mint bindings or Ok=false when minting
// should be skipped (empty secret or unresolved device).
func ResolveCapabilityMint(in CapabilityMintInput) CapabilityMintResolved {
	secret := strings.TrimSpace(in.JWTSecret)
	if secret == "" {
		return CapabilityMintResolved{}
	}
	deviceID := ResolveCapabilityDeviceID(in.PayloadDeviceID, in.EnvDeviceID)
	if deviceID == "" {
		return CapabilityMintResolved{}
	}
	return CapabilityMintResolved{
		Ok:        true,
		Secret:    secret,
		UserID:    ResolveCapabilityUserID(in.TriggerUserID),
		DeviceID:  deviceID,
		ProjectID: LocalProjectID,
		Action:    DefaultCapabilityAction,
		TargetID:  strings.TrimSpace(in.TargetID),
		ThreadID:  LocalThreadID,
		TTL:       CapabilityTokenTTL,
	}
}
