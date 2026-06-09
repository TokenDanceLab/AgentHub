package repository

import (
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func newExecutionTargetPreflightTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`
		CREATE TABLE execution_targets (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			device_id TEXT,
			name TEXT NOT NULL,
			target_type TEXT NOT NULL DEFAULT 'local_edge',
			deleted_at DATETIME
		)
	`).Error)
	return db
}

func executionTargetPreflightDeviceID(value string) *string {
	return &value
}

func insertExecutionTargetPreflightRow(t *testing.T, db *gorm.DB, id, ownerID string, deviceID *string, targetType string, deletedAt *time.Time) {
	t.Helper()

	require.NoError(t, db.Exec(`
		INSERT INTO execution_targets (id, owner_id, device_id, name, target_type, deleted_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, id, ownerID, deviceID, id, targetType, deletedAt).Error)
}

func TestFindActiveLocalEdgeDeviceDuplicatesReportsOnlyIndexConflicts(t *testing.T) {
	db := newExecutionTargetPreflightTestDB(t)
	deletedAt := time.Now()

	insertExecutionTargetPreflightRow(t, db, "target-b", "owner-1", executionTargetPreflightDeviceID("device-1"), "local_edge", nil)
	insertExecutionTargetPreflightRow(t, db, "target-a", "owner-1", executionTargetPreflightDeviceID("device-1"), "local_edge", nil)
	insertExecutionTargetPreflightRow(t, db, "target-deleted", "owner-1", executionTargetPreflightDeviceID("device-1"), "local_edge", &deletedAt)
	insertExecutionTargetPreflightRow(t, db, "target-remote", "owner-1", executionTargetPreflightDeviceID("device-1"), "remote_ssh", nil)
	insertExecutionTargetPreflightRow(t, db, "target-other-device", "owner-1", executionTargetPreflightDeviceID("device-2"), "local_edge", nil)
	insertExecutionTargetPreflightRow(t, db, "target-other-owner", "owner-2", executionTargetPreflightDeviceID("device-1"), "local_edge", nil)
	insertExecutionTargetPreflightRow(t, db, "target-null-device-a", "owner-1", nil, "local_edge", nil)
	insertExecutionTargetPreflightRow(t, db, "target-null-device-b", "owner-1", nil, "local_edge", nil)

	duplicates, err := FindActiveLocalEdgeDeviceDuplicates(db)

	require.NoError(t, err)
	require.Equal(t, []ActiveLocalEdgeDeviceDuplicate{
		{
			OwnerID:   "owner-1",
			DeviceID:  "device-1",
			TargetIDs: []string{"target-a", "target-b"},
		},
	}, duplicates)
}

func TestFindActiveLocalEdgeDeviceDuplicatesReturnsEmptyWhenClean(t *testing.T) {
	db := newExecutionTargetPreflightTestDB(t)

	insertExecutionTargetPreflightRow(t, db, "target-1", "owner-1", executionTargetPreflightDeviceID("device-1"), "local_edge", nil)
	insertExecutionTargetPreflightRow(t, db, "target-2", "owner-1", executionTargetPreflightDeviceID("device-2"), "local_edge", nil)
	insertExecutionTargetPreflightRow(t, db, "target-3", "owner-2", executionTargetPreflightDeviceID("device-1"), "local_edge", nil)

	duplicates, err := FindActiveLocalEdgeDeviceDuplicates(db)

	require.NoError(t, err)
	require.Empty(t, duplicates)
}
