package dispatch

import (
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/model"
)

// DesktopTargetStaleAfter is how long before a local_edge target's last_seen_at
// is considered stale (historical ExecutionTargetService constant).
const DesktopTargetStaleAfter = 2 * time.Minute

// ResolveExecutionTargetHealthState computes the effective health state for an
// execution target from its stored fields + current time. Pure — no DB / WS /
// cache / env dependencies. Historical logic from ExecutionTargetService; used
// by DispatchService.validateDispatchTarget and ExecutionTargetService health
// projection to share a single health-resolution surface.
func ResolveExecutionTargetHealthState(target *model.ExecutionTarget, now time.Time) string {
	if target == nil {
		return "offline"
	}
	state := strings.TrimSpace(strings.ToLower(target.HealthState))
	switch state {
	case "mismatch", "offline":
		return state
	}
	if target.TargetType != LocalEdgeTargetType {
		if target.IsOnline && (state == "healthy" || state == "online") {
			return "online"
		}
		if state == "degraded" || state == "unknown" || state == "stale" {
			return state
		}
		return "offline"
	}
	if !target.IsOnline {
		return "offline"
	}
	// A successful manual ping (Ping sets is_online + health_state="online" +
	// last_seen_at) is live evidence on its own, even before the edge device
	// has registered its heartbeat / binding. Dispatch still independently
	// rejects unbound targets via BoundDeviceID, so this does not weaken
	// routing safety — it just stops pinged targets from showing as offline.
	if state == "online" && target.LastSeenAt != nil && now.Sub(*target.LastSeenAt) <= DesktopTargetStaleAfter {
		return "online"
	}
	if target.DeviceID == nil || strings.TrimSpace(*target.DeviceID) == "" {
		return "mismatch"
	}
	if target.LastSeenAt == nil || now.Sub(*target.LastSeenAt) > DesktopTargetStaleAfter {
		return "stale"
	}
	if state == "degraded" || state == "unknown" {
		return state
	}
	return "online"
}
