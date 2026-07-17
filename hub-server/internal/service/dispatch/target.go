package dispatch

import (
	"strings"

	"github.com/agenthub/hub-server/internal/errcode"
)

// LocalEdgeTargetType is the only execution-target type currently dispatchable
// via device-bound WebSocket / Edge routes.
const LocalEdgeTargetType = "local_edge"

// IsDispatchableTargetHealth reports whether a resolved health state allows
// dispatch (online / healthy).
func IsDispatchableTargetHealth(healthState string) bool {
	return healthState == "online" || healthState == "healthy"
}

// IsDesktopDevice reports whether the bound device is a desktop edge.
func IsDesktopDevice(deviceType string) bool {
	return deviceType == "desktop"
}

// ValidateTargetOwner returns TargetNotFound when ownerID != userID.
func ValidateTargetOwner(ownerID, userID string) error {
	if ownerID != userID {
		return errcode.TargetNotFound
	}
	return nil
}

// ValidateTargetType returns TargetNotRoutable when type is not local_edge.
func ValidateTargetType(targetType string) error {
	if targetType != LocalEdgeTargetType {
		return errcode.TargetNotRoutable.WithMessage("execution target type is not dispatchable yet")
	}
	return nil
}

// ValidateTargetHealth returns TargetNotRoutable when health is not dispatchable.
func ValidateTargetHealth(healthState string) error {
	if !IsDispatchableTargetHealth(healthState) {
		return errcode.TargetNotRoutable.WithMessage("execution target health is " + healthState)
	}
	return nil
}

// BoundDeviceID returns the trimmed device id when bound, or empty + error when
// the target has no device binding.
func BoundDeviceID(deviceID *string) (string, error) {
	if deviceID == nil || strings.TrimSpace(*deviceID) == "" {
		return "", errcode.TargetNotRoutable.WithMessage("execution target is not bound to a device")
	}
	return strings.TrimSpace(*deviceID), nil
}

// ValidateTargetDevice returns TargetNotRoutable when the bound device is not
// owned by userID or is not a desktop edge.
func ValidateTargetDevice(userID, deviceUserID, deviceType string) error {
	if deviceUserID != userID || !IsDesktopDevice(deviceType) {
		return errcode.TargetNotRoutable.WithMessage("execution target device is not routable")
	}
	return nil
}

// NewTargetSnapshot builds a TargetSnapshot after validation has succeeded.
func NewTargetSnapshot(id, targetType, deviceID string) *TargetSnapshot {
	return &TargetSnapshot{
		ID:         id,
		TargetType: targetType,
		DeviceID:   deviceID,
	}
}
