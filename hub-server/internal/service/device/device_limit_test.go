package device

import (
	"context"
	"fmt"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/repository"
)

func setupDeviceLimitDB(t *testing.T) *gorm.DB {
	t.Helper()
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
	return db
}

func cloudEdgeDeviceID(n int) string {
	return fmt.Sprintf("99999999-0000-4000-8000-%012d", n)
}

// TestCloudEdgeRegisterRejectedAtLimit: once the user owns
// AGENTHUB_MAX_CLOUD_EDGE_DEVICES cloud_edge devices, registering a brand-new
// device_id fails with DeviceLimitExceeded (HTTP 403 semantics).
func TestCloudEdgeRegisterRejectedAtLimit(t *testing.T) {
	t.Setenv("AGENTHUB_MAX_CLOUD_EDGE_DEVICES", "3")
	svc := NewService(setupDeviceLimitDB(t), nil)
	ctx := context.Background()

	for i := 1; i <= 3; i++ {
		_, err := svc.Register(ctx, cloudEdgeDeviceID(i), "user-a", "cloud_edge", "1.0.0", nil)
		require.NoError(t, err, "registration %d within the cap must succeed", i)
	}

	_, err := svc.Register(ctx, cloudEdgeDeviceID(4), "user-a", "cloud_edge", "1.0.0", nil)
	require.ErrorIs(t, err, errcode.DeviceLimitExceeded)
	require.Equal(t, "device_limit_exceeded", errcode.DeviceLimitExceeded.Code)

	// A different user's quota is independent.
	_, err = svc.Register(ctx, cloudEdgeDeviceID(5), "user-b", "cloud_edge", "1.0.0", nil)
	require.NoError(t, err)
}

// TestCloudEdgeRegisterExistingDeviceUpdateNotBlocked: re-registering an
// already-owned device_id is an upsert refresh, not a new registration, and
// must succeed even when the cap is reached.
func TestCloudEdgeRegisterExistingDeviceUpdateNotBlocked(t *testing.T) {
	t.Setenv("AGENTHUB_MAX_CLOUD_EDGE_DEVICES", "2")
	svc := NewService(setupDeviceLimitDB(t), nil)
	ctx := context.Background()

	require.NoError(t, mustRegister(svc, ctx, cloudEdgeDeviceID(1), "user-a"))
	require.NoError(t, mustRegister(svc, ctx, cloudEdgeDeviceID(2), "user-a"))

	// Cap now reached; refresh device #1 with a new app version.
	device, err := svc.Register(ctx, cloudEdgeDeviceID(1), "user-a", "cloud_edge", "2.0.0", []string{"refreshed"})
	require.NoError(t, err)
	require.Equal(t, "2.0.0", device.AppVersion)

	// Still exactly two rows — the refresh did not grow the table.
	count, err := repository.CountDevicesByUserAndType(svc.db, "user-a", "cloud_edge")
	require.NoError(t, err)
	require.Equal(t, int64(2), count)

	// A genuinely new device_id is still rejected.
	_, err = svc.Register(ctx, cloudEdgeDeviceID(3), "user-a", "cloud_edge", "1.0.0", nil)
	require.ErrorIs(t, err, errcode.DeviceLimitExceeded)
}

func mustRegister(svc *Service, ctx context.Context, deviceID, userID string) error {
	_, err := svc.Register(ctx, deviceID, userID, "cloud_edge", "1.0.0", nil)
	return err
}

// TestCloudEdgeLimitEnvOverride: AGENTHUB_MAX_CLOUD_EDGE_DEVICES overrides the
// default, and <= 0 disables the cap entirely.
func TestCloudEdgeLimitEnvOverride(t *testing.T) {
	require.Equal(t, config.DefaultMaxCloudEdgeDevicesPerUser, config.MaxCloudEdgeDevicesPerUser())

	t.Setenv("AGENTHUB_MAX_CLOUD_EDGE_DEVICES", "1")
	require.Equal(t, 1, config.MaxCloudEdgeDevicesPerUser())
	svc := NewService(setupDeviceLimitDB(t), nil)
	ctx := context.Background()
	require.NoError(t, mustRegister(svc, ctx, cloudEdgeDeviceID(1), "user-a"))
	_, err := svc.Register(ctx, cloudEdgeDeviceID(2), "user-a", "cloud_edge", "1.0.0", nil)
	require.ErrorIs(t, err, errcode.DeviceLimitExceeded)

	t.Setenv("AGENTHUB_MAX_CLOUD_EDGE_DEVICES", "0") // cap disabled
	require.Equal(t, 0, config.MaxCloudEdgeDevicesPerUser())
	for i := 2; i <= 4; i++ {
		require.NoError(t, mustRegister(svc, ctx, cloudEdgeDeviceID(i), "user-a"), "cap disabled must allow registration %d", i)
	}

	t.Setenv("AGENTHUB_MAX_CLOUD_EDGE_DEVICES", "not-a-number") // invalid → default
	require.Equal(t, config.DefaultMaxCloudEdgeDevicesPerUser, config.MaxCloudEdgeDevicesPerUser())
}

// TestDesktopRegisterNotAffectedByCloudEdgeLimit: the quota gates only the
// cloud_edge device type; desktop registrations bypass it.
func TestDesktopRegisterNotAffectedByCloudEdgeLimit(t *testing.T) {
	t.Setenv("AGENTHUB_MAX_CLOUD_EDGE_DEVICES", "1")
	svc := NewService(setupDeviceLimitDB(t), nil)
	ctx := context.Background()

	// One cloud_edge device fills the cap...
	require.NoError(t, mustRegister(svc, ctx, cloudEdgeDeviceID(1), "user-a"))
	// ...but desktop registrations keep working (two distinct desktops).
	_, err := svc.Register(ctx, "88888888-0000-4000-8000-000000000001", "user-a", "desktop", "1.0.0", nil)
	require.NoError(t, err)
	_, err = svc.Register(ctx, "88888888-0000-4000-8000-000000000002", "user-a", "desktop", "1.0.0", nil)
	require.NoError(t, err)
}
