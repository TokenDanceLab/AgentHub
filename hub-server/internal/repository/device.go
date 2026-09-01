package repository

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/agenthub/hub-server/internal/model"
)

var ErrDeviceOwnershipMismatch = errors.New("device id belongs to a different user or device type")

func UpsertDevice(db *gorm.DB, device *model.Device) error {
	result := db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		Where: clause.Where{Exprs: []clause.Expression{
			clause.Expr{
				SQL:  "devices.user_id = ? AND devices.device_type = ?",
				Vars: []interface{}{device.UserID, device.DeviceType},
			},
		}},
		DoUpdates: clause.AssignmentColumns([]string{
			"app_version",
			"capabilities",
			"last_active_at",
		}),
	}).Create(device)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrDeviceOwnershipMismatch
	}
	return nil
}

// CountDevicesByUserAndType returns how many devices of the given type the
// user currently owns. Used to enforce the per-user cloud_edge quota.
func CountDevicesByUserAndType(db *gorm.DB, userID, deviceType string) (int64, error) {
	var count int64
	err := db.Model(&model.Device{}).
		Where("user_id = ? AND device_type = ?", userID, deviceType).
		Count(&count).Error
	return count, err
}

// DeviceExistsForUser reports whether deviceID is currently owned by the
// given (userID, deviceType) pair. Used to distinguish an upsert refresh of
// an already-owned device from a brand-new registration when enforcing the
// per-user cloud_edge quota (updates must not be blocked by the cap).
func DeviceExistsForUser(db *gorm.DB, deviceID, userID, deviceType string) (bool, error) {
	var count int64
	err := db.Model(&model.Device{}).
		Where("id = ? AND user_id = ? AND device_type = ?", deviceID, userID, deviceType).
		Count(&count).Error
	return count > 0, err
}

func GetDeviceByID(db *gorm.DB, deviceID string) (*model.Device, error) {
	var device model.Device
	err := db.Where("id = ?", deviceID).First(&device).Error
	if err != nil {
		return nil, err
	}
	return &device, nil
}

func ListDevicesByUser(db *gorm.DB, userID string) ([]model.Device, error) {
	var devices []model.Device
	err := db.Where("user_id = ?", userID).Order("last_active_at DESC").Limit(100).Find(&devices).Error
	return devices, err
}

func UpdateDevice(db *gorm.DB, deviceID string, updates map[string]interface{}) error {
	return db.Model(&model.Device{}).
		Where("id = ?", deviceID).
		Updates(updates).Error
}

func DeleteDevice(db *gorm.DB, deviceID string) error {
	return db.Where("id = ?", deviceID).Delete(&model.Device{}).Error
}
