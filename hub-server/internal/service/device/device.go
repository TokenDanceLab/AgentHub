package device

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// Service encapsulates device business logic, keeping DB access
// out of the HTTP handler layer.
type Service struct {
	db                     *gorm.DB
	desktopTargetRegistrar desktopTargetRegistrar
}

type desktopTargetRegistrar interface {
	UpsertLocalEdgeForDesktopDevice(ctx context.Context, device *model.Device) (*model.ExecutionTarget, error)
}

// NewService creates a new Service backed by the given database.
func NewService(db *gorm.DB, registrar desktopTargetRegistrar) *Service {
	return &Service{db: db, desktopTargetRegistrar: registrar}
}

// Register creates or updates a device record for the given user and returns it.
// The handler layer should not construct model.Device directly — all DB logic
// lives here.
func (s *Service) Register(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
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

	if device.DeviceType == "desktop" && s.desktopTargetRegistrar != nil {
		if _, err := s.desktopTargetRegistrar.UpsertLocalEdgeForDesktopDevice(ctx, device); err != nil {
			return nil, err
		}
	}

	return device, nil
}

// Get returns a single device by its ID.
func (s *Service) Get(deviceID string) (*model.Device, error) {
	return repository.GetDeviceByID(s.db, deviceID)
}

// List returns all devices belonging to the given user, ordered by most
// recently active first.
func (s *Service) List(userID string) ([]model.Device, error) {
	return repository.ListDevicesByUser(s.db, userID)
}

// ListDevices is an alias for List to match the handler interface.
func (s *Service) ListDevices(userID string) ([]model.Device, error) {
	return s.List(userID)
}

// Update refreshes a device’s last-active timestamp, app version, and
// capabilities.  Only fields that are provided should change.
func (s *Service) Update(deviceID, appVersion string, capabilities []string) error {
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
	return repository.UpdateDevice(s.db, deviceID, updates)
}

// Unregister removes a device record by ID.
func (s *Service) Unregister(deviceID string) error {
	return repository.DeleteDevice(s.db, deviceID)
}
