package dispatch

// Target-bound offline-queue reason strings (historical dispatchTargetBoundTask).
const (
	TargetBoundReasonRouteUnavailable = "route unavailable"
	TargetBoundReasonConnMismatch     = "connection mismatch"
	TargetBoundReasonWSNotQueued      = "websocket delivery not queued"
)

// IsTargetBoundConnUsable reports whether a looked-up WS connection may receive a
// target-bound agent_dispatch frame (present + user/desktop/device match).
func IsTargetBoundConnUsable(connFound bool, connUserID, connDeviceType, connDeviceID, userID, deviceID string) bool {
	return connFound && IsMatchingTargetBoundConn(connUserID, connDeviceType, connDeviceID, userID, deviceID)
}
