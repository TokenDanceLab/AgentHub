package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

func newExecutionTargetTestDB(t *testing.T) *gorm.DB {
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
	require.NoError(t, db.Exec(`
		CREATE TABLE execution_targets (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			device_id TEXT,
			name TEXT NOT NULL,
			target_type TEXT NOT NULL DEFAULT 'local_edge',
			host TEXT DEFAULT '',
			port INTEGER DEFAULT 0,
			workspace_root TEXT DEFAULT '',
			workspace_allowlist TEXT DEFAULT '[]',
			trust_level TEXT DEFAULT 'local',
			health_state TEXT DEFAULT 'unknown',
			auth_method TEXT DEFAULT '',
			is_online BOOLEAN DEFAULT FALSE,
			last_seen_at DATETIME,
			capabilities TEXT DEFAULT '{}',
			metadata TEXT DEFAULT '{}',
			created_at DATETIME,
			updated_at DATETIME,
			deleted_at DATETIME
		)
	`).Error)
	require.NoError(t, db.Exec(`
		CREATE UNIQUE INDEX idx_execution_targets_active_local_edge_device_unique
		ON execution_targets(owner_id, target_type, device_id)
		WHERE deleted_at IS NULL AND target_type = 'local_edge' AND device_id IS NOT NULL
	`).Error)
	return db
}

func seedDevice(t *testing.T, db *gorm.DB, id, ownerID, deviceType string) {
	t.Helper()
	require.NoError(t, db.Create(&model.Device{
		ID:           id,
		UserID:       ownerID,
		DeviceType:   deviceType,
		AppVersion:   "0.2.0",
		Capabilities: `["local_edge"]`,
		LastActiveAt: time.Now(),
	}).Error)
}

func seedExecutionTarget(t *testing.T, db *gorm.DB, id, ownerID string) {
	t.Helper()
	require.NoError(t, db.Create(&model.ExecutionTarget{
		ID:                 id,
		OwnerID:            ownerID,
		Name:               "Owner target",
		TargetType:         "local_edge",
		WorkspaceRoot:      "/workspace",
		WorkspaceAllowlist: `["/workspace"]`,
		TrustLevel:         "local",
		HealthState:        "unknown",
		Capabilities:       "{}",
		Metadata:           "{}",
	}).Error)
}

func TestExecutionTargetGetIsOwnerScoped(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-1", "owner-1")
	svc := NewExecutionTargetService(db)

	target, err := svc.Get(context.Background(), "target-1", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "target-1", target.ID)

	_, err = svc.Get(context.Background(), "target-1", "other-owner")
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)
}

func TestExecutionTargetPingIsOwnerScoped(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-1", "owner-1")
	svc := NewExecutionTargetService(db)

	err := svc.Ping(context.Background(), "target-1", "other-owner")
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)

	var target model.ExecutionTarget
	require.NoError(t, db.Where("id = ?", "target-1").First(&target).Error)
	require.False(t, target.IsOnline)

	require.NoError(t, svc.Ping(context.Background(), "target-1", "owner-1"))
	require.NoError(t, db.Where("id = ?", "target-1").First(&target).Error)
	require.True(t, target.IsOnline)
	require.NotNil(t, target.LastSeenAt)
	require.Equal(t, "healthy", target.HealthState)
}

func TestExecutionTargetPingRejectsUnsupportedTargetType(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	require.NoError(t, db.Exec(`
		INSERT INTO execution_targets (id, owner_id, name, target_type, workspace_allowlist, trust_level, health_state, capabilities, metadata)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, "target-unknown", "owner-1", "Unknown target", "unknown", "[]", "local", "unknown", "{}", "{}").Error)
	svc := NewExecutionTargetService(db)

	err := svc.Ping(context.Background(), "target-unknown", "owner-1")
	require.Error(t, err)

	var target model.ExecutionTarget
	require.NoError(t, db.Where("id = ?", "target-unknown").First(&target).Error)
	require.False(t, target.IsOnline)
}

func TestExecutionTargetPingRequiresLiveProofForRemoteTargets(t *testing.T) {
	tests := []struct {
		targetType string
		trustLevel string
	}{
		{targetType: "remote_ssh", trustLevel: "remote"},
		{targetType: "tailscale", trustLevel: "remote"},
		{targetType: "cloud_edge", trustLevel: "cloud"},
		{targetType: "hub_relay", trustLevel: "relay"},
	}

	for _, tt := range tests {
		t.Run(tt.targetType, func(t *testing.T) {
			db := newExecutionTargetTestDB(t)
			require.NoError(t, db.Create(&model.ExecutionTarget{
				ID:                 "target-" + tt.targetType,
				OwnerID:            "owner-1",
				Name:               "Remote target",
				TargetType:         tt.targetType,
				WorkspaceRoot:      "/workspace",
				WorkspaceAllowlist: `["/workspace"]`,
				TrustLevel:         tt.trustLevel,
				HealthState:        "unknown",
				Capabilities:       "{}",
				Metadata:           "{}",
			}).Error)
			svc := NewExecutionTargetService(db)

			err := svc.Ping(context.Background(), "target-"+tt.targetType, "owner-1")
			require.ErrorIs(t, err, errcode.TargetNotRoutable)

			var target model.ExecutionTarget
			require.NoError(t, db.Where("id = ?", "target-"+tt.targetType).First(&target).Error)
			require.False(t, target.IsOnline)
			require.Nil(t, target.LastSeenAt)
			require.Equal(t, "unknown", target.HealthState)
		})
	}
}

func TestExecutionTargetPingDoesNotUseAuthMethodAsBearerCredential(t *testing.T) {
	var gotAuth string
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(edge.Close)

	edgeURL, err := url.Parse(edge.URL)
	require.NoError(t, err)
	port, err := strconv.Atoi(edgeURL.Port())
	require.NoError(t, err)

	db := newExecutionTargetTestDB(t)
	require.NoError(t, db.Create(&model.ExecutionTarget{
		ID:                 "target-cloud",
		OwnerID:            "owner-1",
		Name:               "Cloud target",
		TargetType:         "cloud_edge",
		Host:               edgeURL.Hostname(),
		Port:               port,
		WorkspaceRoot:      "/workspace",
		WorkspaceAllowlist: `["/workspace"]`,
		TrustLevel:         "cloud",
		HealthState:        "unknown",
		AuthMethod:         "hub_jwt",
		Capabilities:       "{}",
		Metadata:           "{}",
	}).Error)
	svc := NewExecutionTargetService(db)

	require.NoError(t, svc.Ping(context.Background(), "target-cloud", "owner-1"))
	require.Empty(t, gotAuth, "auth_method is a public strategy enum and must not be reused as a bearer credential")
}

func TestExecutionTargetCreateDefaultsPolicyFields(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	svc := NewExecutionTargetService(db)

	target, err := svc.Create(context.Background(), "owner-1", &model.ExecutionTarget{Name: "Local"})
	require.NoError(t, err)
	require.Equal(t, "local_edge", target.TargetType)
	require.Equal(t, "[]", target.WorkspaceAllowlist)
	require.Equal(t, "local", target.TrustLevel)
	require.Equal(t, "unknown", target.HealthState)
}

func TestExecutionTargetCreateRejectsForeignDeviceBinding(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedDevice(t, db, "44444444-4444-4444-8444-444444444444", "owner-2", "desktop")
	svc := NewExecutionTargetService(db)
	deviceID := "44444444-4444-4444-8444-444444444444"

	_, err := svc.Create(context.Background(), "owner-1", &model.ExecutionTarget{
		Name:               "Forged binding",
		DeviceID:           &deviceID,
		WorkspaceAllowlist: `[]`,
	})
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)

	var count int64
	require.NoError(t, db.Model(&model.ExecutionTarget{}).Count(&count).Error)
	require.Zero(t, count)
}

func TestExecutionTargetCreateRejectsClientManagedHealthState(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	svc := NewExecutionTargetService(db)

	_, err := svc.Create(context.Background(), "owner-1", &model.ExecutionTarget{
		Name:        "Forged healthy target",
		HealthState: "healthy",
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var count int64
	require.NoError(t, db.Model(&model.ExecutionTarget{}).Count(&count).Error)
	require.Zero(t, count)
}

func TestExecutionTargetUpdateRejectsClientManagedHealthState(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-1", "owner-1")
	svc := NewExecutionTargetService(db)

	_, err := svc.Update(context.Background(), "target-1", "owner-1", &model.ExecutionTarget{
		Name:        "Forged healthy target",
		HealthState: "healthy",
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var target model.ExecutionTarget
	require.NoError(t, db.Where("id = ?", "target-1").First(&target).Error)
	require.Equal(t, "Owner target", target.Name)
	require.Equal(t, "unknown", target.HealthState)
}

func TestExecutionTargetUpdateRejectsForeignDeviceBinding(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-1", "owner-1")
	seedDevice(t, db, "55555555-5555-4555-8555-555555555555", "owner-2", "desktop")
	svc := NewExecutionTargetService(db)
	deviceID := "55555555-5555-4555-8555-555555555555"

	_, err := svc.Update(context.Background(), "target-1", "owner-1", &model.ExecutionTarget{
		DeviceID: &deviceID,
	})
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)

	var target model.ExecutionTarget
	require.NoError(t, db.Where("id = ?", "target-1").First(&target).Error)
	require.Nil(t, target.DeviceID)
}

func TestExecutionTargetRejectsInvalidWorkspaceAllowlist(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	svc := NewExecutionTargetService(db)

	_, err := svc.Create(context.Background(), "owner-1", &model.ExecutionTarget{
		Name:               "Invalid",
		WorkspaceAllowlist: `{"path":"/workspace"}`,
	})
	require.Error(t, err)
}

func TestExecutionTargetUpdateClearsJSONLikeFields(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-1", "owner-1")
	svc := NewExecutionTargetService(db)

	target, err := svc.Update(context.Background(), "target-1", "owner-1", &model.ExecutionTarget{
		WorkspaceAllowlist: `[]`,
		Capabilities:       `{}`,
		Metadata:           `{}`,
	})
	require.NoError(t, err)
	require.JSONEq(t, `[]`, target.WorkspaceAllowlist)
	require.JSONEq(t, `{}`, target.Capabilities)
	require.JSONEq(t, `{}`, target.Metadata)
}

func TestExecutionTargetUpdateRejectsInvalidJSONLikeFields(t *testing.T) {
	tests := []struct {
		name    string
		updates model.ExecutionTarget
	}{
		{name: "workspace allowlist object", updates: model.ExecutionTarget{WorkspaceAllowlist: `{"path":"/repo"}`}},
		{name: "capabilities array", updates: model.ExecutionTarget{Capabilities: `["not-object"]`}},
		{name: "metadata malformed", updates: model.ExecutionTarget{Metadata: `{not-json}`}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newExecutionTargetTestDB(t)
			seedExecutionTarget(t, db, "target-1", "owner-1")
			svc := NewExecutionTargetService(db)

			var err error
			require.NotPanics(t, func() {
				_, err = svc.Update(context.Background(), "target-1", "owner-1", &tt.updates)
			})
			require.ErrorIs(t, err, errcode.ErrBadRequest)
		})
	}
}

func TestExecutionTargetUpsertLocalEdgeForDesktopDeviceCreatesOwnerScopedOnlineTarget(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	svc := NewExecutionTargetService(db)
	seedDevice(t, db, "11111111-1111-4111-8111-111111111111", "owner-1", "desktop")
	device := &model.Device{
		ID:           "11111111-1111-4111-8111-111111111111",
		UserID:       "owner-1",
		DeviceType:   "desktop",
		AppVersion:   "0.2.0",
		Capabilities: `["local_edge","agent.dispatch","agent.control"]`,
	}

	target, err := svc.UpsertLocalEdgeForDesktopDevice(context.Background(), device)
	require.NoError(t, err)
	require.Equal(t, "owner-1", target.OwnerID)
	require.NotNil(t, target.DeviceID)
	require.Equal(t, device.ID, *target.DeviceID)
	require.Equal(t, "local_edge", target.TargetType)
	require.Equal(t, "local", target.TrustLevel)
	require.Equal(t, "healthy", target.HealthState)
	require.True(t, target.IsOnline)
	require.NotNil(t, target.LastSeenAt)
	require.JSONEq(t, `[]`, target.WorkspaceAllowlist)
	require.JSONEq(t, `{"device_capabilities":["local_edge","agent.dispatch","agent.control"]}`, target.Capabilities)
	require.JSONEq(t, `{"source":"desktop_device_registration","device_type":"desktop","app_version":"0.2.0","health_basis":"desktop_check_in_freshness_not_ws_route"}`, target.Metadata)

	var count int64
	require.NoError(t, db.Model(&model.ExecutionTarget{}).Count(&count).Error)
	require.Equal(t, int64(1), count)
}

func TestExecutionTargetUpsertLocalEdgeForDesktopDeviceRefreshesWinnerAfterCreateConflict(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	svc := NewExecutionTargetService(db)
	deviceID := "15151515-1515-4151-8151-151515151515"
	seedDevice(t, db, deviceID, "owner-1", "desktop")

	insertedWinner := false
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:desktop_target_race_winner", func(tx *gorm.DB) {
		target, ok := tx.Statement.Dest.(*model.ExecutionTarget)
		if !ok || insertedWinner || target.DeviceID == nil {
			return
		}
		if target.OwnerID != "owner-1" || target.TargetType != "local_edge" || *target.DeviceID != deviceID {
			return
		}
		insertedWinner = true
		if err := tx.Exec(`
			INSERT INTO execution_targets
				(id, owner_id, device_id, name, target_type, workspace_allowlist, trust_level, health_state, is_online, capabilities, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, "target-race-winner", "owner-1", deviceID, "Desktop race winner", "local_edge", `["/old"]`, "local", "offline", false, `{}`, `{}`).Error; err != nil {
			tx.AddError(err)
		}
	}))

	target, err := svc.UpsertLocalEdgeForDesktopDevice(context.Background(), &model.Device{
		ID:           deviceID,
		UserID:       "owner-1",
		DeviceType:   "desktop",
		AppVersion:   "0.2.2",
		Capabilities: `["local_edge","agent.dispatch"]`,
	})
	require.NoError(t, err)
	require.True(t, insertedWinner, "test must inject a conflicting first-registration winner")
	require.Equal(t, "target-race-winner", target.ID)
	require.Equal(t, "Desktop Local Edge 15151515", target.Name)
	require.True(t, target.IsOnline)
	require.Equal(t, "healthy", target.HealthState)
	require.JSONEq(t, `[]`, target.WorkspaceAllowlist)
	require.JSONEq(t, `{"device_capabilities":["local_edge","agent.dispatch"]}`, target.Capabilities)

	var count int64
	require.NoError(t, db.Model(&model.ExecutionTarget{}).Where("owner_id = ? AND target_type = ? AND device_id = ?", "owner-1", "local_edge", deviceID).Count(&count).Error)
	require.Equal(t, int64(1), count)
}

func TestExecutionTargetUpsertLocalEdgeForDesktopDeviceRejectsAmbiguousDuplicateTargets(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	deviceID := "13131313-1313-4131-8131-131313131313"
	seedDevice(t, db, deviceID, "owner-1", "desktop")
	require.NoError(t, db.Create(&model.ExecutionTarget{
		ID:                 "target-by-device",
		OwnerID:            "owner-1",
		DeviceID:           &deviceID,
		Name:               "Manual desktop target",
		TargetType:         "local_edge",
		WorkspaceAllowlist: `[]`,
		TrustLevel:         "local",
		HealthState:        "healthy",
		Capabilities:       `{}`,
		Metadata:           `{}`,
	}).Error)
	require.NoError(t, db.Create(&model.ExecutionTarget{
		ID:                 "target-by-name",
		OwnerID:            "owner-1",
		Name:               "Desktop Local Edge 13131313",
		TargetType:         "local_edge",
		WorkspaceAllowlist: `[]`,
		TrustLevel:         "local",
		HealthState:        "offline",
		Capabilities:       `{}`,
		Metadata:           `{}`,
	}).Error)
	svc := NewExecutionTargetService(db)

	_, err := svc.UpsertLocalEdgeForDesktopDevice(context.Background(), &model.Device{
		ID:         deviceID,
		UserID:     "owner-1",
		DeviceType: "desktop",
	})
	require.ErrorIs(t, err, errcode.UserInvalidParam)

	var count int64
	require.NoError(t, db.Model(&model.ExecutionTarget{}).Where("owner_id = ? AND target_type = ?", "owner-1", "local_edge").Count(&count).Error)
	require.Equal(t, int64(2), count)
}

func TestExecutionTargetUpsertLocalEdgeForDesktopDeviceRefreshesGeneratedNameTarget(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	deviceID := "12121212-1212-4121-8121-121212121212"
	seedDevice(t, db, deviceID, "owner-1", "desktop")
	require.NoError(t, db.Create(&model.ExecutionTarget{
		ID:                 "target-generated-name",
		OwnerID:            "owner-1",
		Name:               "Desktop Local Edge 12121212",
		TargetType:         "local_edge",
		WorkspaceAllowlist: `["/old"]`,
		TrustLevel:         "local",
		HealthState:        "offline",
		IsOnline:           false,
		Capabilities:       `{}`,
		Metadata:           `{}`,
	}).Error)
	svc := NewExecutionTargetService(db)

	target, err := svc.UpsertLocalEdgeForDesktopDevice(context.Background(), &model.Device{
		ID:           deviceID,
		UserID:       "owner-1",
		DeviceType:   "desktop",
		AppVersion:   "0.2.1",
		Capabilities: `["local_edge"]`,
	})
	require.NoError(t, err)
	require.Equal(t, "target-generated-name", target.ID)
	require.NotNil(t, target.DeviceID)
	require.Equal(t, deviceID, *target.DeviceID)
	require.True(t, target.IsOnline)
	require.Equal(t, "healthy", target.HealthState)

	var count int64
	require.NoError(t, db.Model(&model.ExecutionTarget{}).Where("owner_id = ? AND target_type = ?", "owner-1", "local_edge").Count(&count).Error)
	require.Equal(t, int64(1), count)
}

func TestExecutionTargetUpsertLocalEdgeForDesktopDeviceRejectsGeneratedNameBoundToAnotherDevice(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	deviceID := "14141414-1414-4141-8141-141414141414"
	otherDeviceID := "14141414-9999-4999-8999-999999999999"
	seedDevice(t, db, deviceID, "owner-1", "desktop")
	seedDevice(t, db, otherDeviceID, "owner-1", "desktop")
	require.NoError(t, db.Create(&model.ExecutionTarget{
		ID:                 "target-name-collision",
		OwnerID:            "owner-1",
		DeviceID:           &otherDeviceID,
		Name:               "Desktop Local Edge 14141414",
		TargetType:         "local_edge",
		WorkspaceAllowlist: `[]`,
		TrustLevel:         "local",
		HealthState:        "healthy",
		Capabilities:       `{}`,
		Metadata:           `{}`,
	}).Error)
	svc := NewExecutionTargetService(db)

	_, err := svc.UpsertLocalEdgeForDesktopDevice(context.Background(), &model.Device{
		ID:         deviceID,
		UserID:     "owner-1",
		DeviceType: "desktop",
	})
	require.ErrorIs(t, err, errcode.UserInvalidParam)

	var target model.ExecutionTarget
	require.NoError(t, db.Where("id = ?", "target-name-collision").First(&target).Error)
	require.NotNil(t, target.DeviceID)
	require.Equal(t, otherDeviceID, *target.DeviceID)
}

func TestExecutionTargetUpsertLocalEdgeForDesktopDeviceRefreshesDuplicateOfflineTarget(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	deviceID := "22222222-2222-4222-8222-222222222222"
	seedDevice(t, db, deviceID, "owner-1", "desktop")
	oldSeenAt := time.Now().Add(-time.Hour)
	require.NoError(t, db.Create(&model.ExecutionTarget{
		ID:                 "target-existing",
		OwnerID:            "owner-1",
		DeviceID:           &deviceID,
		Name:               "Old desktop target",
		TargetType:         "local_edge",
		WorkspaceAllowlist: `["/old"]`,
		TrustLevel:         "local",
		HealthState:        "offline",
		IsOnline:           false,
		LastSeenAt:         &oldSeenAt,
		Capabilities:       `{"old":true}`,
		Metadata:           `{"source":"old"}`,
	}).Error)
	svc := NewExecutionTargetService(db)

	target, err := svc.UpsertLocalEdgeForDesktopDevice(context.Background(), &model.Device{
		ID:           deviceID,
		UserID:       "owner-1",
		DeviceType:   "desktop",
		AppVersion:   "0.2.1",
		Capabilities: `["local_edge"]`,
	})
	require.NoError(t, err)
	require.Equal(t, "target-existing", target.ID)
	require.Equal(t, "healthy", target.HealthState)
	require.True(t, target.IsOnline)
	require.NotNil(t, target.LastSeenAt)
	require.True(t, target.LastSeenAt.After(oldSeenAt))
	require.JSONEq(t, `[]`, target.WorkspaceAllowlist)
	require.JSONEq(t, `{"device_capabilities":["local_edge"]}`, target.Capabilities)
	require.JSONEq(t, `{"source":"desktop_device_registration","device_type":"desktop","app_version":"0.2.1","health_basis":"desktop_check_in_freshness_not_ws_route"}`, target.Metadata)

	var count int64
	require.NoError(t, db.Model(&model.ExecutionTarget{}).Where("owner_id = ? AND device_id = ?", "owner-1", deviceID).Count(&count).Error)
	require.Equal(t, int64(1), count)
}

func TestExecutionTargetUpsertLocalEdgeForDesktopDeviceIgnoresForgedForeignBindingForRightfulOwner(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	deviceID := "33333333-3333-4333-8333-333333333333"
	seedDevice(t, db, deviceID, "owner-2", "desktop")
	require.NoError(t, db.Create(&model.ExecutionTarget{
		ID:                 "target-owner-1",
		OwnerID:            "owner-1",
		DeviceID:           &deviceID,
		Name:               "Owner 1 desktop",
		TargetType:         "local_edge",
		WorkspaceAllowlist: `[]`,
		TrustLevel:         "local",
		HealthState:        "healthy",
		IsOnline:           true,
		Capabilities:       `{}`,
		Metadata:           `{}`,
	}).Error)
	svc := NewExecutionTargetService(db)

	target, err := svc.UpsertLocalEdgeForDesktopDevice(context.Background(), &model.Device{
		ID:         deviceID,
		UserID:     "owner-2",
		DeviceType: "desktop",
	})
	require.NoError(t, err)
	require.Equal(t, "owner-2", target.OwnerID)
	require.NotEqual(t, "target-owner-1", target.ID)
	require.NotNil(t, target.DeviceID)
	require.Equal(t, deviceID, *target.DeviceID)

	var count int64
	require.NoError(t, db.Model(&model.ExecutionTarget{}).Where("device_id = ?", deviceID).Count(&count).Error)
	require.Equal(t, int64(2), count)
}
