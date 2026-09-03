package repository

import (
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestListDevicesByUserOrdersMostRecentFirst(t *testing.T) {
	db := setupSQLite(t)
	now := time.Now()
	require.NoError(t, CreateUser(db, &model.User{ID: "user-a", Username: "user-a", Nickname: "User A"}))
	require.NoError(t, CreateUser(db, &model.User{ID: "user-b", Username: "user-b", Nickname: "User B"}))
	require.NoError(t, db.Create(&model.Device{
		ID:           "device-old",
		UserID:       "user-a",
		DeviceType:   "desktop",
		Capabilities: "[]",
		LastActiveAt: now.Add(-time.Hour),
	}).Error)
	require.NoError(t, db.Create(&model.Device{
		ID:           "device-new",
		UserID:       "user-a",
		DeviceType:   "desktop",
		Capabilities: "[]",
		LastActiveAt: now,
	}).Error)
	require.NoError(t, db.Create(&model.Device{
		ID:           "device-other",
		UserID:       "user-b",
		DeviceType:   "desktop",
		Capabilities: "[]",
		LastActiveAt: now.Add(time.Hour),
	}).Error)

	devices, err := ListDevicesByUser(db, "user-a")
	require.NoError(t, err)
	require.Len(t, devices, 2)
	assert.Equal(t, "device-new", devices[0].ID)
	assert.Equal(t, "device-old", devices[1].ID)
}

func TestUpdateDeviceAppliesProvidedFields(t *testing.T) {
	db := setupSQLite(t)
	oldLastActive := time.Now().Add(-time.Hour)
	newLastActive := time.Now()
	require.NoError(t, db.Create(&model.Device{
		ID:           "device-update",
		UserID:       "user-a",
		DeviceType:   "desktop",
		AppVersion:   "1.0.0",
		Capabilities: `["shell"]`,
		LastActiveAt: oldLastActive,
	}).Error)

	err := UpdateDevice(db, "device-update", map[string]interface{}{
		"app_version":    "1.1.0",
		"capabilities":   `["shell","browser"]`,
		"last_active_at": newLastActive,
	})
	require.NoError(t, err)

	device, err := GetDeviceByID(db, "device-update")
	require.NoError(t, err)
	assert.Equal(t, "1.1.0", device.AppVersion)
	assert.Equal(t, `["shell","browser"]`, device.Capabilities)
	assert.WithinDuration(t, newLastActive, device.LastActiveAt, time.Second)
}

func TestDeleteDeviceRemovesOnlyTargetDevice(t *testing.T) {
	db := setupSQLite(t)
	now := time.Now()
	require.NoError(t, db.Create(&model.Device{
		ID:           "device-delete",
		UserID:       "user-a",
		DeviceType:   "desktop",
		Capabilities: "[]",
		LastActiveAt: now,
	}).Error)
	require.NoError(t, db.Create(&model.Device{
		ID:           "device-keep",
		UserID:       "user-a",
		DeviceType:   "mobile",
		Capabilities: "[]",
		LastActiveAt: now,
	}).Error)

	require.NoError(t, DeleteDevice(db, "device-delete"))

	_, err := GetDeviceByID(db, "device-delete")
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
	kept, err := GetDeviceByID(db, "device-keep")
	require.NoError(t, err)
	assert.Equal(t, "device-keep", kept.ID)
}

// =============================================================================
// Device repository tests
// =============================================================================

func TestDeviceRepo_Upsert(t *testing.T) {
	db := setupSQLite(t)

	device := &model.Device{
		ID:           "dev-001",
		UserID:       "user-001",
		DeviceType:   "desktop",
		AppVersion:   "1.0.0",
		Capabilities: `["chat","agent"]`,
	}

	// First upsert: creates
	err := UpsertDevice(db, device)
	require.NoError(t, err)

	fetched, err := GetDeviceByID(db, "dev-001")
	require.NoError(t, err)
	assert.Equal(t, "desktop", fetched.DeviceType)
	assert.Equal(t, "1.0.0", fetched.AppVersion)

	// Second upsert: same physical device updates by device ID.
	device2 := &model.Device{
		ID:           "dev-001",
		UserID:       "user-001",
		DeviceType:   "desktop",
		AppVersion:   "2.0.0",
		Capabilities: `["chat","agent","file"]`,
	}
	err = UpsertDevice(db, device2)
	require.NoError(t, err)

	// ON CONFLICT preserves the original row's ID but updates other columns.
	// Verify the original row was updated.
	fetched, err = GetDeviceByID(db, "dev-001")
	require.NoError(t, err)
	assert.Equal(t, "2.0.0", fetched.AppVersion)

	// A second desktop for the same user is a distinct device and must keep its
	// own row so refresh_tokens.device_id can reference it.
	device3 := &model.Device{
		ID:           "dev-001-second-desktop",
		UserID:       "user-001",
		DeviceType:   "desktop",
		AppVersion:   "1.0.0",
		Capabilities: `["chat"]`,
	}
	require.NoError(t, UpsertDevice(db, device3))
	fetched, err = GetDeviceByID(db, "dev-001-second-desktop")
	require.NoError(t, err)
	assert.Equal(t, "user-001", fetched.UserID)
	assert.Equal(t, "desktop", fetched.DeviceType)

	stolen := &model.Device{
		ID:           "dev-001",
		UserID:       "user-attacker",
		DeviceType:   "desktop",
		AppVersion:   "9.9.9",
		Capabilities: `[]`,
	}
	require.Error(t, UpsertDevice(db, stolen))
	fetched, err = GetDeviceByID(db, "dev-001")
	require.NoError(t, err)
	assert.Equal(t, "user-001", fetched.UserID)
	assert.Equal(t, "2.0.0", fetched.AppVersion)
}

func TestDeviceRepo_GetByID(t *testing.T) {
	db := setupSQLite(t)

	device := &model.Device{
		ID:         "dev-002",
		UserID:     "user-002",
		DeviceType: "mobile",
	}
	require.NoError(t, UpsertDevice(db, device))

	fetched, err := GetDeviceByID(db, "dev-002")
	require.NoError(t, err)
	assert.Equal(t, "user-002", fetched.UserID)
	assert.Equal(t, "mobile", fetched.DeviceType)

	_, err = GetDeviceByID(db, "nonexistent")
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
}
