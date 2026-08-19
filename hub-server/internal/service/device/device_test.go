package device

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

func TestDeviceRegisterMapsOwnershipMismatchToBadRequest(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`
		CREATE TABLE devices (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			device_type TEXT NOT NULL,
			app_version TEXT DEFAULT '',
			capabilities TEXT DEFAULT '[]',
			last_active_at DATETIME NOT NULL,
			created_at DATETIME
		)
	`).Error)
	require.NoError(t, db.Exec(`CREATE INDEX idx_devices_user_type ON devices(user_id, device_type)`).Error)

	svc := NewService(db, nil)
	deviceID := "44444444-4444-4444-8444-444444444444"

	_, err = svc.Register(deviceID, "user-a", "desktop", "1.0.0", []string{"tasks"})
	require.NoError(t, err)

	_, err = svc.Register(deviceID, "user-b", "desktop", "1.0.1", []string{"tasks"})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
}

type recordingDesktopTargetRegistrar struct {
	calls   int
	devices []*model.Device
	err     error
}

func (r *recordingDesktopTargetRegistrar) UpsertLocalEdgeForDesktopDevice(ctx context.Context, device *model.Device) (*model.ExecutionTarget, error) {
	r.calls++
	r.devices = append(r.devices, device)
	if r.err != nil {
		return nil, r.err
	}
	return &model.ExecutionTarget{ID: "target-1", OwnerID: device.UserID, DeviceID: &device.ID}, nil
}

func TestDeviceRegisterUpsertsDesktopLocalEdgeTargetAfterSuccessfulRegister(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`
		CREATE TABLE devices (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			device_type TEXT NOT NULL,
			app_version TEXT DEFAULT '',
			capabilities TEXT DEFAULT '[]',
			last_active_at DATETIME NOT NULL,
			created_at DATETIME
		)
	`).Error)
	require.NoError(t, db.Exec(`CREATE INDEX idx_devices_user_type ON devices(user_id, device_type)`).Error)

	registrar := &recordingDesktopTargetRegistrar{}
	svc := NewService(db, registrar)

	deviceID := "55555555-5555-4555-8555-555555555555"
	device, err := svc.Register(deviceID, "user-a", "desktop", "1.0.0", []string{"local_edge", "agent.dispatch"})
	require.NoError(t, err)
	require.Equal(t, deviceID, device.ID)
	require.Equal(t, 1, registrar.calls)
	require.Equal(t, deviceID, registrar.devices[0].ID)
	require.Equal(t, "user-a", registrar.devices[0].UserID)
	require.Equal(t, "desktop", registrar.devices[0].DeviceType)
	require.JSONEq(t, `["local_edge","agent.dispatch"]`, registrar.devices[0].Capabilities)
}

func TestDeviceRegisterDoesNotUpsertTargetAfterOwnershipMismatch(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`
		CREATE TABLE devices (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			device_type TEXT NOT NULL,
			app_version TEXT DEFAULT '',
			capabilities TEXT DEFAULT '[]',
			last_active_at DATETIME NOT NULL,
			created_at DATETIME
		)
	`).Error)
	require.NoError(t, db.Exec(`CREATE INDEX idx_devices_user_type ON devices(user_id, device_type)`).Error)

	registrar := &recordingDesktopTargetRegistrar{}
	svc := NewService(db, registrar)

	deviceID := "66666666-6666-4666-8666-666666666666"
	_, err = svc.Register(deviceID, "user-a", "desktop", "1.0.0", []string{"local_edge"})
	require.NoError(t, err)
	require.Equal(t, 1, registrar.calls)

	_, err = svc.Register(deviceID, "user-b", "desktop", "1.0.1", []string{"local_edge"})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	require.Equal(t, 1, registrar.calls)
}
