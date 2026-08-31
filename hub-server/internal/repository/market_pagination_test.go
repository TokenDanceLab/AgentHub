package repository

import (
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// TestListPublicMCPServers_CursorIsLastID guards the exploratory-audit P0-2
// regression: the service used InstallCount as cursor while the repo filters
// `id < cursor` (uuid) — page 2+ would 500 on PostgreSQL.
func TestListPublicMCPServers_CursorIsLastID(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`CREATE TABLE mcp_servers (
		id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
		transport TEXT DEFAULT 'stdio', command TEXT DEFAULT '', args TEXT DEFAULT '[]',
		env_vars TEXT DEFAULT '{}', url TEXT DEFAULT '', auth_type TEXT DEFAULT 'none',
		auth_config TEXT DEFAULT '{}', tool_schema TEXT DEFAULT '{}',
		is_public INTEGER DEFAULT 0, install_count INTEGER DEFAULT 0,
		created_at DATETIME, updated_at DATETIME, deleted_at DATETIME
	)`).Error)

	for _, id := range []string{"srv-1", "srv-2", "srv-3"} {
		require.NoError(t, db.Create(&model.MCPServer{ID: id, OwnerID: "u", Name: id, IsPublic: true}).Error)
	}

	page1, hasMore, err := ListPublicMCPServers(db, "", "", "", 2)
	require.NoError(t, err)
	require.True(t, hasMore)
	require.Len(t, page1, 2)

	// cursor = last row ID (service contract)
	page2, hasMore2, err := ListPublicMCPServers(db, "", "", page1[1].ID, 2)
	require.NoError(t, err)
	require.False(t, hasMore2)
	require.Len(t, page2, 1)
	require.NotEqual(t, page1[0].ID, page2[0].ID)
	require.NotEqual(t, page1[1].ID, page2[0].ID)
}

// TestListPublicProfiles_CompositeCursor guards the exploratory-audit P0-3:
// non-recent sorts used InstallCount as cursor against rating_avg/uuid tie-break
// columns — wrong results or PostgreSQL 500 on page 2.
func TestListPublicProfiles_CompositeCursor(t *testing.T) {
	db := setupSQLite(t)
	mk := func(id string, count int, rating float64) {
		require.NoError(t, db.Create(&model.AgentProfile{
			ID: id, OwnerID: "u", Name: id, RuntimeID: "codex", IsPublic: true,
			InstallCount: count, RatingAvg: rating,
		}).Error)
	}
	mk("p-a", 5, 4.5)
	mk("p-b", 5, 4.5)
	mk("p-c", 1, 1.0)

	// install_count page 1: p-a, p-b (tie-break id ASC)
	page1, hasMore, err := ListPublicProfiles(db, "", "", "install_count", "", 2)
	require.NoError(t, err)
	require.True(t, hasMore)
	require.Len(t, page1, 2)
	require.Equal(t, "p-a", page1[0].ID)
	require.Equal(t, "p-b", page1[1].ID)

	// service composite cursor "5|p-b" → page 2 = p-c only
	page2, hasMore2, err := ListPublicProfiles(db, "", "", "install_count", "5|p-b", 2)
	require.NoError(t, err)
	require.False(t, hasMore2)
	require.Len(t, page2, 1)
	require.Equal(t, "p-c", page2[0].ID)

	// rating page 2 with "4.5|p-b"
	pageR, hasMoreR, err := ListPublicProfiles(db, "", "", "rating", "4.5|p-b", 2)
	require.NoError(t, err)
	require.False(t, hasMoreR)
	require.Len(t, pageR, 1)
	require.Equal(t, "p-c", pageR[0].ID)
}
