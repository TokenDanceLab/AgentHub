package dispatch

import "github.com/agenthub/hub-server/internal/model"

// HubRelayTargetType is the execution-target type that routes through hub_relay
// CreateCommand instead of device-bound WebSocket.
const HubRelayTargetType = "hub_relay"

// DesktopDeviceType is the device type used for inviter / target-bound Edge routes.
const DesktopDeviceType = "desktop"

// AgentDispatchRelayCommand is the relay command name for hub_relay agent dispatch.
const AgentDispatchRelayCommand = "agent_dispatch"

// RouteKind is the pure primary route classification for dispatchTask (side-effects
// stay in orchestration: HTTP client, WS push, outbox, repo).
type RouteKind string

const (
	// RouteHTTP: unbound task may try local Edge HTTP first.
	RouteHTTP RouteKind = "http"
	// RouteHubRelay: target-bound hub_relay with relay service available.
	RouteHubRelay RouteKind = "hub_relay"
	// RouteTargetBound: target-bound device WS path (including hub_relay without relay).
	RouteTargetBound RouteKind = "target_bound"
	// RouteMissingEdge: target-bound but edge device id is missing (abort).
	RouteMissingEdge RouteKind = "missing_edge"
	// RouteInviterDesktop: unbound fallback via inviter desktop WebSocket.
	RouteInviterDesktop RouteKind = "inviter_desktop"
	// RouteOffline: unbound fallback to Redis pending queue.
	RouteOffline RouteKind = "offline"
)

// ClassifyPrimaryDispatchRoute decides the primary route for a task from pure
// routing inputs. HTTP is "try first" for unbound tasks; callers keep HTTP/WS/
// outbox side-effects. Inviter desktop vs offline is ClassifyUnboundFallbackRoute.
func ClassifyPrimaryDispatchRoute(targetID, targetType, edgeDeviceID string, relayOK bool) RouteKind {
	if ShouldTryHTTPDispatch(targetID) {
		return RouteHTTP
	}
	if MissingTargetEdgeDevice(targetID, edgeDeviceID) {
		return RouteMissingEdge
	}
	if IsHubRelayRoute(targetType, relayOK) {
		return RouteHubRelay
	}
	return RouteTargetBound
}

// ClassifyUnboundFallbackRoute classifies post-HTTP unbound routing (desktop vs offline).
func ClassifyUnboundFallbackRoute(connID string, mgrAvailable bool, routeErr error) RouteKind {
	if CanPushInviterDesktop(connID, mgrAvailable, routeErr) {
		return RouteInviterDesktop
	}
	return RouteOffline
}

// ShouldTryHTTPDispatch is true when an unbound task may attempt local Edge HTTP
// first (no explicit target binding).
func ShouldTryHTTPDispatch(targetID string) bool {
	return targetID == ""
}

// IsHubRelayRoute reports whether target-bound dispatch should use hub_relay.
func IsHubRelayRoute(targetType string, relayAvailable bool) bool {
	return targetType == HubRelayTargetType && relayAvailable
}

// MissingTargetEdgeDevice is true when a target-bound task has no edge device id.
func MissingTargetEdgeDevice(targetID, edgeDeviceID string) bool {
	return targetID != "" && edgeDeviceID == ""
}

// CanPushInviterDesktop is true when inviter desktop WS routing is available.
func CanPushInviterDesktop(connID string, mgrAvailable bool, routeErr error) bool {
	return routeErr == nil && connID != "" && mgrAvailable
}

// IsMatchingTargetBoundConn reports whether a looked-up WS connection matches the
// expected user / desktop / device for target-bound dispatch.
func IsMatchingTargetBoundConn(connUserID, connDeviceType, connDeviceID, userID, deviceID string) bool {
	return connUserID == userID &&
		IsDesktopDevice(connDeviceType) &&
		connDeviceID == deviceID
}

// IsMatchingRedeliveryConn reports whether a looked-up WS connection may receive
// a redelivery push (user match only — historical redispatch behavior).
func IsMatchingRedeliveryConn(connUserID, triggeredByUserID string) bool {
	return connUserID == triggeredByUserID
}

// PreferDeviceBoundRedelivery is true when redispatch should route by edge device.
func PreferDeviceBoundRedelivery(edgeDeviceID string) bool {
	return edgeDeviceID != ""
}

// TargetBoundRouteUnavailable is true when a target-bound route lookup cannot
// proceed to WebSocket push (lookup error, empty conn id, or missing manager).
// Mirrors the historical dispatchTargetBoundTask predicate.
func TargetBoundRouteUnavailable(routeErr error, connID string, mgrAvailable bool) bool {
	return !CanPushInviterDesktop(connID, mgrAvailable, routeErr)
}

// ClassifyRedeliveryPrimaryRoute is the pure first-choice redelivery path before
// connection lookups: try local Edge HTTP for unbound tasks, else device-bound
// WS when an edge device is present, else inviter desktop fallback.
// HTTP miss still falls through to inviter (preferDevice is false when edge id empty).
func ClassifyRedeliveryPrimaryRoute(targetID, edgeDeviceID string) RouteKind {
	if ShouldTryHTTPRedelivery(targetID, edgeDeviceID) {
		return RouteHTTP
	}
	if PreferDeviceBoundRedelivery(edgeDeviceID) {
		return RouteTargetBound
	}
	return RouteInviterDesktop
}

// ClassifyRedeliveryRoute classifies post-HTTP redelivery given pure connection
// facts. preferDevice is PreferDeviceBoundRedelivery(edgeDeviceID). Device path
// requires user-match; inviter path only requires a found conn. Side-effects
// (PushToConn / offline queue) stay orchestration-side. When WS push is attempted
// but not queued, callers still fall through to offline (historical behavior).
func ClassifyRedeliveryRoute(
	preferDevice bool,
	connID string,
	mgrAvailable bool,
	routeErr error,
	connFound bool,
	connUserMatch bool,
) RouteKind {
	if !CanPushInviterDesktop(connID, mgrAvailable, routeErr) {
		return RouteOffline
	}
	if preferDevice {
		if connFound && connUserMatch {
			return RouteTargetBound
		}
		return RouteOffline
	}
	if connFound {
		return RouteInviterDesktop
	}
	return RouteOffline
}

// PinMessageIDs extracts MessageID values from pin rows in order.
func PinMessageIDs(messageIDs []string) []string {
	if len(messageIDs) == 0 {
		return nil
	}
	out := make([]string, len(messageIDs))
	copy(out, messageIDs)
	return out
}

// PinMessageIDsFromModels extracts MessageID values from pin rows in order.
func PinMessageIDsFromModels(pins []model.MessagePin) []string {
	if len(pins) == 0 {
		return nil
	}
	raw := make([]string, len(pins))
	for i := range pins {
		raw[i] = pins[i].MessageID
	}
	return PinMessageIDs(raw)
}
