package service

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/mcpserver"
	"github.com/agenthub/hub-server/internal/service/providerbinding"
	"github.com/agenthub/hub-server/internal/service/skill"
)

func newCatalogOwnershipTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`
		CREATE TABLE skills (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			skill_type TEXT NOT NULL DEFAULT 'agent_skill',
			runtime_ids TEXT DEFAULT '[]',
			entry_point TEXT DEFAULT '',
			config_schema TEXT DEFAULT '{}',
			is_public BOOLEAN DEFAULT FALSE,
			version TEXT DEFAULT '1.0.0',
			install_count INTEGER DEFAULT 0,
			created_at DATETIME,
			updated_at DATETIME,
			deleted_at DATETIME
		);
		CREATE TABLE mcp_servers (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			name TEXT NOT NULL,
			transport TEXT DEFAULT 'stdio',
			command TEXT DEFAULT '',
			args TEXT DEFAULT '[]',
			env_vars TEXT DEFAULT '{}',
			url TEXT DEFAULT '',
			auth_type TEXT DEFAULT 'none',
			auth_config TEXT DEFAULT '{}',
			tool_schema TEXT DEFAULT '{}',
			is_public BOOLEAN DEFAULT FALSE,
			install_count INTEGER DEFAULT 0,
			created_at DATETIME,
			updated_at DATETIME,
			deleted_at DATETIME
		);
		CREATE TABLE provider_bindings (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			binding_name TEXT DEFAULT '',
			provider TEXT NOT NULL,
			base_url TEXT DEFAULT '',
			is_available BOOLEAN DEFAULT TRUE,
			quota_used INTEGER DEFAULT 0,
			quota_limit INTEGER DEFAULT 0,
			last_checked DATETIME,
			metadata TEXT DEFAULT '{}',
			created_at DATETIME,
			updated_at DATETIME
		)
	`).Error)
	return db
}

func TestSkillGetIsOwnerScoped(t *testing.T) {
	db := newCatalogOwnershipTestDB(t)
	require.NoError(t, db.Create(&model.Skill{
		ID:           "skill-1",
		OwnerID:      "owner-1",
		Name:         "Local skill",
		SkillType:    "agent_skill",
		RuntimeIDs:   "[]",
		ConfigSchema: "{}",
	}).Error)
	svc := skill.NewService(db)

	skill, err := svc.Get(context.Background(), "skill-1", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "skill-1", skill.ID)

	_, err = svc.Get(context.Background(), "skill-1", "other-owner")
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)
}

func TestMCPServerGetIsOwnerScoped(t *testing.T) {
	db := newCatalogOwnershipTestDB(t)
	require.NoError(t, db.Create(&model.MCPServer{
		ID:         "mcp-1",
		OwnerID:    "owner-1",
		Name:       "Local MCP",
		Transport:  "stdio",
		Args:       "[]",
		EnvVars:    "{}",
		AuthConfig: "{}",
		ToolSchema: "{}",
	}).Error)
	svc := mcpserver.NewService(db)

	server, err := svc.Get(context.Background(), "mcp-1", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "mcp-1", server.ID)

	_, err = svc.Get(context.Background(), "mcp-1", "other-owner")
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)
}

func TestProviderBindingGetIsOwnerScoped(t *testing.T) {
	db := newCatalogOwnershipTestDB(t)
	require.NoError(t, db.Create(&model.ProviderBinding{
		ID:       "binding-1",
		OwnerID:  "owner-1",
		Provider: "openai",
		Metadata: "{}",
	}).Error)
	svc := providerbinding.NewService(db)

	binding, err := svc.Get(context.Background(), "binding-1", "owner-1")
	require.NoError(t, err)
	require.Equal(t, "binding-1", binding.ID)

	_, err = svc.Get(context.Background(), "binding-1", "other-owner")
	require.ErrorIs(t, err, errcode.AuthDeviceMismatch)
}
