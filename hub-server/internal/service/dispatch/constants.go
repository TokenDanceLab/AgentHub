package dispatch

import (
	"strings"
)

// Edge HTTP dispatch defaults and synthetic routing markers.
// Orchestration (agent_dispatch.go) keeps behavior identical by calling these
// pure helpers / constants instead of re-embedding literals.
const (
	// DefaultEdgeHTTPURL is used when AGENTHUB_EDGE_URL is unset.
	DefaultEdgeHTTPURL = "http://127.0.0.1:3210"

	// LocalProjectID is the Edge project id for Hub→Edge HTTP dispatch.
	LocalProjectID = "proj_local"

	// LocalThreadID is the Edge thread id for Hub→Edge HTTP dispatch.
	// Capability tokens bind the same thread id for dual-token auth alignment.
	LocalThreadID = "thread_local"

	// SyntheticHTTPEdgeDeviceID marks tasks dispatched via local Edge HTTP.
	SyntheticHTTPEdgeDeviceID = "http-edge-local"

	// MaxThreadHistory is the max messages loaded for context continuity.
	MaxThreadHistory = 50

	// DefaultCapabilityAction is the JWT capability action for run-start.
	DefaultCapabilityAction = "run-start"

	// FallbackCapabilityUserID is used when the trigger user is empty.
	FallbackCapabilityUserID = "hub-dispatch"
)

// ResolveEdgeHTTPURL returns the configured Edge base URL or DefaultEdgeHTTPURL.
func ResolveEdgeHTTPURL(envURL string) string {
	if envURL == "" {
		return DefaultEdgeHTTPURL
	}
	return envURL
}

// IsInsecureNonLoopbackEdge reports whether edgeURL is non-HTTPS and not
// loopback — dispatch payloads would be sent in cleartext over the network
// (AH-SR-053). Returns true when the URL should be rejected for HTTP dispatch.
func IsInsecureNonLoopbackEdge(edgeURL string) bool {
	return !strings.HasPrefix(edgeURL, "https://") && !IsLoopback(edgeURL)
}
