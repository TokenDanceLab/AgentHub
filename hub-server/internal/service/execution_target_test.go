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
		ID:            id,
		OwnerID:       ownerID,
		Name:          "Owner target",
		TargetType:    "local_edge",
		WorkspaceRoot: "/workspace",
		Capabilities:  "{}",
		Metadata:      "{}",
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
}
