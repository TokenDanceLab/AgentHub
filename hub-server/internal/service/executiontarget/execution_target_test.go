package executiontarget

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/egress"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

// assertLatestEvidence asserts the recorded evidence for a target without
// coupling to the projected readable fields (#1544): health writes go to the
// evidence table, the target row fields are projections only.
func assertLatestEvidence(t *testing.T, db *gorm.DB, targetID string, wantSource, wantStatus, wantRouteKey string) {
	t.Helper()
	ev, err := repository.GetExecutionTargetEvidence(db, targetID)
	require.NoError(t, err)
	require.Equal(t, wantSource, ev.Source)
	require.Equal(t, wantStatus, ev.Status)
	require.Equal(t, wantRouteKey, ev.RouteKey)
	require.NotNil(t, ev.ExpiresAt)
}

// newExecutionTargetSvc builds the service with a test-only egress policy:
// loopback + plain http allowed (httptest servers listen on 127.0.0.1).
// Tests of the default-deny behavior pass an explicit config instead.
func newExecutionTargetSvc(t *testing.T, db *gorm.DB) *Service {
	t.Helper()
	svc, err := NewService(db, egress.Config{
		AllowCIDRs:     []string{"127.0.0.0/8"},
		AllowPlainHTTP: true,
	})
	require.NoError(t, err)
	return svc
}

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
	require.NoError(t, db.Exec(`
		CREATE TABLE execution_target_evidence (
			id TEXT PRIMARY KEY,
			target_id TEXT NOT NULL UNIQUE,
			source TEXT NOT NULL,
			status TEXT NOT NULL,
			failure_category TEXT DEFAULT '',
			observed_target_id TEXT DEFAULT '',
			route_key TEXT DEFAULT '',
			observed_at DATETIME NOT NULL,
			expires_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)
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
	svc := newExecutionTargetSvc(t, db)

	target, err := svc.Get(context.Background(), "target-1", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "target-1", target.ID)

	_, err = svc.Get(context.Background(), "target-1", "other-owner")
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)
}

func TestExecutionTargetPingIsOwnerScoped(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-1", "owner-1")
	svc := newExecutionTargetSvc(t, db)

	err := svc.Ping(context.Background(), "target-1", "other-owner")
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)

	var target model.ExecutionTarget
	require.NoError(t, db.Where("id = ?", "target-1").First(&target).Error)
	require.False(t, target.IsOnline)

	// 未绑定 local_edge：Ping 只触发 probe，不得产生 online（#1544）。
	// seed 的 target 无 DeviceID → probe 无 route 可查 → 不可路由。
	err = svc.Ping(context.Background(), "target-1", "owner-1")
	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	require.ErrorContains(t, err, "not bound to a device")

	// 失败 probe 写 offline evidence（missing_device_binding），投影仍非 online。
	assertLatestEvidence(t, db, "target-1", dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOffline, "")
	require.NoError(t, db.Where("id = ?", "target-1").First(&target).Error)
	require.False(t, target.IsOnline)
}

func TestExecutionTargetPingRejectsUnsupportedTargetType(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	require.NoError(t, db.Exec(`
		INSERT INTO execution_targets (id, owner_id, name, target_type, workspace_allowlist, trust_level, health_state, capabilities, metadata)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, "target-unknown", "owner-1", "Unknown target", "unknown", "[]", "local", "unknown", "{}", "{}").Error)
	svc := newExecutionTargetSvc(t, db)

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
			svc := newExecutionTargetSvc(t, db)

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

// TestExecutionTargetPingRefusedWithoutEgressAllowlist proves the core
// #1540 decision: with the default (empty) egress policy, hub-initiated
// pings to user-supplied addresses fail closed — even to localhost.
func TestExecutionTargetPingRefusedWithoutEgressAllowlist(t *testing.T) {
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
		Capabilities:       "{}",
		Metadata:           "{}",
	}).Error)

	svc, err := NewService(db, egress.Config{}) // default-deny
	require.NoError(t, err)

	err = svc.Ping(context.Background(), "target-cloud", "owner-1")
	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	require.Contains(t, err.Error(), "not allowed", "error must name the egress policy denial")

	var target model.ExecutionTarget
	require.NoError(t, db.Where("id = ?", "target-cloud").First(&target).Error)
	require.False(t, target.IsOnline, "target must not be marked online after a refused ping")
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
	svc := newExecutionTargetSvc(t, db)

	require.NoError(t, svc.Ping(context.Background(), "target-cloud", "owner-1"))
	require.Empty(t, gotAuth, "auth_method is a public strategy enum and must not be reused as a bearer credential")
}

func TestExecutionTargetPingMarksMismatchWhenEdgeReportsDifferentTarget(t *testing.T) {
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","target_id":"target-other"}`))
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
		WorkspaceAllowlist: `["/workspace"]`,
		TrustLevel:         "cloud",
		HealthState:        "unknown",
		Capabilities:       "{}",
		Metadata:           "{}",
	}).Error)
	svc := newExecutionTargetSvc(t, db)

	err = svc.Ping(context.Background(), "target-cloud", "owner-1")

	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	// observed target id mismatch 写入 mismatch evidence（#1544）；投影层
	// 将其映射为 mismatch 状态（Get/List 与调度器共享同一投影）。
	assertLatestEvidence(t, db, "target-cloud", dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusMismatch, "")

	got, err := svc.Get(context.Background(), "target-cloud", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "mismatch", got.HealthState)
	require.False(t, got.IsOnline)
}

func TestExecutionTargetCreateDefaultsPolicyFields(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	svc := newExecutionTargetSvc(t, db)

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
	svc := newExecutionTargetSvc(t, db)
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
	svc := newExecutionTargetSvc(t, db)

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
	svc := newExecutionTargetSvc(t, db)

	_, err := svc.Update(context.Background(), "target-1", "owner-1", &model.ExecutionTargetPatch{
		Name:        model.Patch("Forged healthy target"),
		HealthState: model.Patch("healthy"),
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	var target model.ExecutionTarget
	require.NoError(t, db.Where("id = ?", "target-1").First(&target).Error)
	require.Equal(t, "Owner target", target.Name)
	require.Equal(t, "unknown", target.HealthState)
}

func TestExecutionTargetUpdateRejectsTargetTypeChange(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-1", "owner-1")
	svc := newExecutionTargetSvc(t, db)

	_, err := svc.Update(context.Background(), "target-1", "owner-1", &model.ExecutionTargetPatch{
		TargetType: model.Patch("hub_relay"),
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	require.ErrorContains(t, err, "target_type is fixed at creation")

	var target model.ExecutionTarget
	require.NoError(t, db.Where("id = ?", "target-1").First(&target).Error)
	require.Equal(t, "local_edge", target.TargetType)
}

func TestExecutionTargetUpdateRejectsForeignDeviceBinding(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-1", "owner-1")
	seedDevice(t, db, "55555555-5555-4555-8555-555555555555", "owner-2", "desktop")
	svc := newExecutionTargetSvc(t, db)
	deviceID := "55555555-5555-4555-8555-555555555555"

	_, err := svc.Update(context.Background(), "target-1", "owner-1", &model.ExecutionTargetPatch{
		DeviceID: model.Patch(deviceID),
	})
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)

	var target model.ExecutionTarget
	require.NoError(t, db.Where("id = ?", "target-1").First(&target).Error)
	require.Nil(t, target.DeviceID)
}

func TestExecutionTargetRejectsInvalidWorkspaceAllowlist(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	svc := newExecutionTargetSvc(t, db)

	_, err := svc.Create(context.Background(), "owner-1", &model.ExecutionTarget{
		Name:               "Invalid",
		WorkspaceAllowlist: `{"path":"/workspace"}`,
	})
	require.Error(t, err)
}

func TestExecutionTargetUpdateClearsJSONLikeFields(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-1", "owner-1")
	svc := newExecutionTargetSvc(t, db)

	target, err := svc.Update(context.Background(), "target-1", "owner-1", &model.ExecutionTargetPatch{
		WorkspaceAllowlist: model.Patch(json.RawMessage(`[]`)),
		Capabilities:       model.Patch(json.RawMessage(`{}`)),
		Metadata:           model.Patch(json.RawMessage(`{}`)),
	})
	require.NoError(t, err)
	require.JSONEq(t, `[]`, target.WorkspaceAllowlist)
	require.JSONEq(t, `{}`, target.Capabilities)
	require.JSONEq(t, `{}`, target.Metadata)
}

func TestExecutionTargetUpdateRejectsInvalidJSONLikeFields(t *testing.T) {
	tests := []struct {
		name    string
		updates model.ExecutionTargetPatch
	}{
		{name: "workspace allowlist object", updates: model.ExecutionTargetPatch{WorkspaceAllowlist: model.Patch(json.RawMessage(`{"path":"/repo"}`))}},
		{name: "capabilities array", updates: model.ExecutionTargetPatch{Capabilities: model.Patch(json.RawMessage(`["not-object"]`))}},
		{name: "metadata malformed", updates: model.ExecutionTargetPatch{Metadata: model.Patch(json.RawMessage(`{not-json}`))}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newExecutionTargetTestDB(t)
			seedExecutionTarget(t, db, "target-1", "owner-1")
			svc := newExecutionTargetSvc(t, db)

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
	svc := newExecutionTargetSvc(t, db)
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
	require.JSONEq(t, `[]`, target.WorkspaceAllowlist)
	require.JSONEq(t, `{"device_capabilities":["local_edge","agent.dispatch","agent.control"]}`, target.Capabilities)
	require.JSONEq(t, `{"source":"desktop_device_registration","device_type":"desktop","app_version":"0.2.0","health_basis":"desktop_check_in_freshness_not_ws_route"}`, target.Metadata)

	// 注册 check-in 写 registration evidence；健康由投影得出（#1544）。
	assertLatestEvidence(t, db, target.ID, dispatch.EvidenceSourceRegistration, dispatch.EvidenceStatusOnline, "owner-1:desktop:11111111-1111-4111-8111-111111111111")
	got, err := svc.Get(context.Background(), target.ID, "owner-1")
	require.NoError(t, err)
	require.Equal(t, "online", got.HealthState)
	require.True(t, got.IsOnline)
	require.NotNil(t, got.LastSeenAt)

	var count int64
	require.NoError(t, db.Model(&model.ExecutionTarget{}).Count(&count).Error)
	require.Equal(t, int64(1), count)
}

func TestExecutionTargetUpsertLocalEdgeForDesktopDeviceRefreshesWinnerAfterCreateConflict(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	svc := newExecutionTargetSvc(t, db)
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
	assertLatestEvidence(t, db, target.ID, dispatch.EvidenceSourceRegistration, dispatch.EvidenceStatusOnline, "owner-1:desktop:"+deviceID)
	got, err := svc.Get(context.Background(), target.ID, "owner-1")
	require.NoError(t, err)
	require.True(t, got.IsOnline)
	require.Equal(t, "online", got.HealthState)
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
	svc := newExecutionTargetSvc(t, db)

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
	svc := newExecutionTargetSvc(t, db)

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
	assertLatestEvidence(t, db, target.ID, dispatch.EvidenceSourceRegistration, dispatch.EvidenceStatusOnline, "owner-1:desktop:"+deviceID)
	got, err := svc.Get(context.Background(), target.ID, "owner-1")
	require.NoError(t, err)
	require.True(t, got.IsOnline)
	require.Equal(t, "online", got.HealthState)

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
	svc := newExecutionTargetSvc(t, db)

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
	svc := newExecutionTargetSvc(t, db)

	target, err := svc.UpsertLocalEdgeForDesktopDevice(context.Background(), &model.Device{
		ID:           deviceID,
		UserID:       "owner-1",
		DeviceType:   "desktop",
		AppVersion:   "0.2.1",
		Capabilities: `["local_edge"]`,
	})
	require.NoError(t, err)
	require.Equal(t, "target-existing", target.ID)
	assertLatestEvidence(t, db, target.ID, dispatch.EvidenceSourceRegistration, dispatch.EvidenceStatusOnline, "owner-1:desktop:"+deviceID)
	got, err := svc.Get(context.Background(), target.ID, "owner-1")
	require.NoError(t, err)
	require.Equal(t, "online", got.HealthState)
	require.True(t, got.IsOnline)
	require.NotNil(t, got.LastSeenAt)
	require.True(t, got.LastSeenAt.After(oldSeenAt))
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
	svc := newExecutionTargetSvc(t, db)

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

// TestExecutionTargetUpdateIsOwnerScoped ensures PATCH by a non-owner returns
// AuthDeviceMismatch (403) and does not mutate the row (#2100 P1 audit).
func TestExecutionTargetUpdateIsOwnerScoped(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-1", "owner-1")
	svc := newExecutionTargetSvc(t, db)

	newName := "renamed-by-other"
	_, err := svc.Update(context.Background(), "target-1", "other-owner", &model.ExecutionTargetPatch{
		Name: model.Patch(newName),
	})
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)

	var target model.ExecutionTarget
	require.NoError(t, db.Where("id = ?", "target-1").First(&target).Error)
	require.Equal(t, "Owner target", target.Name, "name must not be mutated by non-owner")
}

// TestExecutionTargetDeleteIsOwnerScoped ensures DELETE by a non-owner returns
// AuthDeviceMismatch (403) and leaves the row intact (#2100 P1 audit).
func TestExecutionTargetDeleteIsOwnerScoped(t *testing.T) {
	db := newExecutionTargetTestDB(t)
	seedExecutionTarget(t, db, "target-1", "owner-1")
	svc := newExecutionTargetSvc(t, db)

	err := svc.Delete(context.Background(), "target-1", "other-owner")
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)

	var count int64
	require.NoError(t, db.Model(&model.ExecutionTarget{}).Where("id = ? AND deleted_at IS NULL", "target-1").Count(&count).Error)
	require.Equal(t, int64(1), count, "target must not be soft-deleted by non-owner")
}
