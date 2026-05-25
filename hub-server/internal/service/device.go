package service

import (
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// DeviceService encapsulates device business logic, keeping DB access
// out of the HTTP handler layer.
type DeviceService struct {
	db *gorm.DB
}

// NewDeviceService creates a new DeviceService backed by the given database.
func NewDeviceService(db *gorm.DB) *DeviceService {
	return &DeviceService{db: db}
}

// Register creates or updates a device record for the given user and returns it.
// The handler layer should not construct model.Device directly — all DB logic
// lives here.
func (s *DeviceService) Register(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
	capsBytes, _ := json.Marshal(capabilities)

	device := &model.Device{
		ID:           deviceID,
		UserID:       userID,
		DeviceType:   deviceType,
		AppVersion:   appVersion,
		Capabilities: string(capsBytes),
		LastActiveAt: time.Now(),
	}

	if err := repository.UpsertDevice(s.db, device); err != nil {
		if errors.Is(err, repository.ErrDeviceOwnershipMismatch) {
			return nil, errcode.ErrBadRequest
		}
		return nil, err
	}

	return device, nil
}

// Get returns a single device by its ID.
func (s *DeviceService) Get(deviceID string) (*model.Device, error) {
	return repository.GetDeviceByID(s.db, deviceID)
}

// List returns all devices belonging to the given user, ordered by most
// recently active first.
func (s *DeviceService) List(userID string) ([]model.Device, error) {
	var devices []model.Device
	err := s.db.Where("user_id = ?", userID).Order("last_active_at DESC").Find(&devices).Error
	return devices, err
}

// Update refreshes a device’s last-active timestamp, app version, and
// capabilities.  Only fields that are provided should change.
func (s *DeviceService) Update(deviceID, appVersion string, capabilities []string) error {
	updates := map[string]interface{}{
		"last_active_at": time.Now(),
	}
	if appVersion != "" {
		updates["app_version"] = appVersion
	}
	if capabilities != nil {
		capsBytes, _ := json.Marshal(capabilities)
		updates["capabilities"] = string(capsBytes)
	}
	return s.db.Model(&model.Device{}).
		Where("id = ?", deviceID).
		Updates(updates).Error
}

// Unregister removes a device record by ID.
func (s *DeviceService) Unregister(deviceID string) error {
	return s.db.Where("id = ?", deviceID).Delete(&model.Device{}).Error
}
