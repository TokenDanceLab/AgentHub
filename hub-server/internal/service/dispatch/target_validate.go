package dispatch

import "github.com/agenthub/hub-server/internal/errcode"

// PreDeviceTargetValidation runs ownership / type / health checks for an
// execution target before device-row lookup. Order matches historical
// validateDispatchTarget so error precedence stays stable.
func PreDeviceTargetValidation(ownerID, userID, targetType, healthState string) error {
	if err := ValidateTargetOwner(ownerID, userID); err != nil {
		return err
	}
	if err := ValidateTargetType(targetType); err != nil {
		return err
	}
	if err := ValidateTargetHealth(healthState); err != nil {
		return err
	}
	return nil
}

// DeviceMissingNotRoutable is the historical TargetNotRoutable when the bound
// device row is missing (gorm.ErrRecordNotFound path).
func DeviceMissingNotRoutable() error {
	return errcode.TargetNotRoutable.WithMessage(DeviceNotRoutableErrorMessage)
}

// PostDeviceTargetValidation checks bound-device ownership / type after the
// device row is loaded.
func PostDeviceTargetValidation(userID, deviceUserID, deviceType string) error {
	return ValidateTargetDevice(userID, deviceUserID, deviceType)
}
