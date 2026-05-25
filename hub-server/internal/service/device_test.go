package service

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
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

	svc := NewDeviceService(db)
	deviceID := "44444444-4444-4444-8444-444444444444"

	_, err = svc.Register(deviceID, "user-a", "desktop", "1.0.0", []string{"tasks"})
	require.NoError(t, err)

	_, err = svc.Register(deviceID, "user-b", "desktop", "1.0.1", []string{"tasks"})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
}
