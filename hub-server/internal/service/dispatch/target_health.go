package dispatch

import (
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/model"
)

// DesktopTargetStaleAfter is how long a local_edge target's evidence window
// lasts before the projection degrades to stale (historical
// ExecutionTargetService constant).
const DesktopTargetStaleAfter = 2 * time.Minute

// Health evidence sources recorded by the service layer (#1544).
const (
	EvidenceSourceRegistration = "registration" // desktop device check-in, local_edge
	EvidenceSourceProbe        = "probe"        // explicit probe (manual ping)
	EvidenceSourceRelayRoute   = "relay_route"  // hub_relay exact-device route proof
)

// Evidence status values.
const (
	EvidenceStatusOnline   = "online"
	EvidenceStatusOffline  = "offline"
	EvidenceStatusMismatch = "mismatch"
	EvidenceStatusDegraded = "degraded"
	EvidenceStatusUnknown  = "unknown"
)

// ResolveExecutionTargetHealthState projects the effective health state of
// an execution target from its stored evidence + current time (#1544).
//
// Pure — no DB / WS / cache / env dependencies. Every online/healthy state
// traces back to a specific evidence row (source + observed_at + route_key
// or observed_target_id); a manual ping without a real probe can no longer
// produce online. Shared by DispatchService.validateDispatchTarget and
// ExecutionTargetService Get/List projection so scheduling, API and UI agree.
//
// Projection rules, in order:
//  1. mismatch evidence wins (observed identity disagrees with the target);
//  2. expired evidence degrades to stale;
//  3. offline / degraded evidence passes through;
//  4. fresh online evidence yields online;
//  5. no evidence at all: bound targets are "registered" (bound but not
//     proven live), unbound targets are "unknown".
func ResolveExecutionTargetHealthState(target *model.ExecutionTarget, evidence *model.ExecutionTargetEvidence, now time.Time) string {
	if target == nil {
		return "offline"
	}
	if evidence == nil {
		if target.DeviceID != nil && strings.TrimSpace(*target.DeviceID) != "" {
			return "registered"
		}
		return "unknown"
	}
	if evidence.Status == EvidenceStatusMismatch {
		return EvidenceStatusMismatch
	}
	if evidence.ExpiresAt != nil && now.After(*evidence.ExpiresAt) {
		return "stale"
	}
	switch evidence.Status {
	case EvidenceStatusOnline:
		return EvidenceStatusOnline
	case EvidenceStatusOffline, EvidenceStatusDegraded:
		return evidence.Status
	default:
		return EvidenceStatusUnknown
	}
}

// ResolveIsOnline derives the legacy is_online flag from a resolved health
// state — the single projection used by API reads.
func ResolveIsOnline(healthState string) bool {
	return healthState == "online" || healthState == "healthy"
}

// EvidenceFresh reports whether an evidence row is still inside its window.
func EvidenceFresh(evidence *model.ExecutionTargetEvidence, now time.Time) bool {
	return evidence != nil && (evidence.ExpiresAt == nil || !now.After(*evidence.ExpiresAt))
}
