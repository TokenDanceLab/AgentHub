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

func GetDeviceByID(db *gorm.DB, deviceID string) (*model.Device, error) {
	var device model.Device
	err := db.Where("id = ?", deviceID).First(&device).Error
	if err != nil {
		return nil, err
	}
	return &device, nil
}
