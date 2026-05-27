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

func newAgentProfileTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`
		CREATE TABLE agent_profiles (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			runtime_id TEXT NOT NULL,
			model TEXT DEFAULT '',
			provider TEXT DEFAULT '',
			reasoning_effort TEXT DEFAULT 'medium',
			model_mapping TEXT DEFAULT '{}',
			skills TEXT DEFAULT '[]',
			mcp_servers TEXT DEFAULT '[]',
			tool_allowlist TEXT DEFAULT '[]',
			approval_policy TEXT DEFAULT '{}',
			permission_mode TEXT DEFAULT 'default',
			target_preferences TEXT DEFAULT '{}',
			context_budget_max_tokens INTEGER DEFAULT 200000,
			is_public BOOLEAN DEFAULT FALSE,
			install_count INTEGER DEFAULT 0,
			rating_avg REAL DEFAULT 0,
			rating_count INTEGER DEFAULT 0,
			version INTEGER DEFAULT 1,
			created_at DATETIME,
			updated_at DATETIME,
			deleted_at DATETIME
		)
	`).Error)
	return db
}

func seedAgentProfile(t *testing.T, db *gorm.DB, id, ownerID string, public bool) {
	t.Helper()

	require.NoError(t, db.Create(&model.AgentProfile{
		ID:                id,
		OwnerID:           ownerID,
		Name:              "Review profile",
		RuntimeID:         "codex",
		Skills:            "[]",
		MCPServers:        "[]",
		ToolAllowlist:     "[]",
		ModelMapping:      "{}",
		ApprovalPolicy:    "{}",
		TargetPreferences: "{}",
		IsPublic:          public,
	}).Error)
}

func TestAgentProfileGetIsOwnerScoped(t *testing.T) {
	db := newAgentProfileTestDB(t)
	seedAgentProfile(t, db, "profile-1", "owner-1", false)
	svc := NewAgentProfileService(db)

	profile, err := svc.Get(context.Background(), "profile-1", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "profile-1", profile.ID)

	_, err = svc.Get(context.Background(), "profile-1", "other-owner")
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)
}

func TestAgentProfileGetPublicOnlyReturnsPublishedProfiles(t *testing.T) {
	db := newAgentProfileTestDB(t)
	seedAgentProfile(t, db, "public-profile", "owner-1", true)
	seedAgentProfile(t, db, "private-profile", "owner-1", false)
	svc := NewAgentProfileService(db)

	profile, err := svc.GetPublic(context.Background(), "public-profile")
	require.NoError(t, err)
	require.Equal(t, "public-profile", profile.ID)

	_, err = svc.GetPublic(context.Background(), "private-profile")
	require.ErrorIs(t, err, errcode.AgentNotFound)
}
