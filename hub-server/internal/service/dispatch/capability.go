package dispatch

import "strings"

// ResolveCapabilityDeviceID prefers the payload edge device, then the env
// fallback. Empty result means capability minting should be skipped.
func ResolveCapabilityDeviceID(payloadDeviceID, envDeviceID string) string {
	deviceID := strings.TrimSpace(payloadDeviceID)
	if deviceID != "" {
		return deviceID
	}
	return strings.TrimSpace(envDeviceID)
}

// ResolveCapabilityUserID returns the trigger user or FallbackCapabilityUserID.
func ResolveCapabilityUserID(triggerUserID string) string {
	userID := strings.TrimSpace(triggerUserID)
	if userID == "" {
		return FallbackCapabilityUserID
	}
	return userID
}

// EdgeAuthBearerToken returns a trimmed shared secret for Authorization: Bearer,
// or empty when unset (dev / unauthenticated Edge).
func EdgeAuthBearerToken(envToken string) string {
	return strings.TrimSpace(envToken)
}
