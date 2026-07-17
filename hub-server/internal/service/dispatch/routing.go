package dispatch

// HubRelayTargetType is the execution-target type that routes through hub_relay
// CreateCommand instead of device-bound WebSocket.
const HubRelayTargetType = "hub_relay"

// DesktopDeviceType is the device type used for inviter / target-bound Edge routes.
const DesktopDeviceType = "desktop"

// AgentDispatchRelayCommand is the relay command name for hub_relay agent dispatch.
const AgentDispatchRelayCommand = "agent_dispatch"

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

// PinMessageIDs extracts MessageID values from pin rows in order.
func PinMessageIDs(messageIDs []string) []string {
	if len(messageIDs) == 0 {
		return nil
	}
	out := make([]string, len(messageIDs))
	copy(out, messageIDs)
	return out
}
