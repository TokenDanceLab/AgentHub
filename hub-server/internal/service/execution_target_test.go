package service

import (
	"context"
	"testing"

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
	return db
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
