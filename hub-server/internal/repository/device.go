package repository

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

<<<<<<< HEAD
	"github.com/agenthub/server-hub/internal/model"
=======
	"github.com/agenthub/hub-server/internal/model"
>>>>>>> origin/master
)

func UpsertDevice(db *gorm.DB, device *model.Device) error {
	return db.Clauses(clause.OnConflict{
<<<<<<< HEAD
		Columns:   []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{"app_version", "capabilities", "last_active_at", "device_type"}),
=======
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "device_type"}},
		DoUpdates: clause.AssignmentColumns([]string{"app_version", "capabilities", "last_active_at"}),
>>>>>>> origin/master
	}).Create(device).Error
}

func GetDeviceByID(db *gorm.DB, deviceID string) (*model.Device, error) {
	var device model.Device
	err := db.Where("id = ?", deviceID).First(&device).Error
	if err != nil {
		return nil, err
	}
	return &device, nil
}
