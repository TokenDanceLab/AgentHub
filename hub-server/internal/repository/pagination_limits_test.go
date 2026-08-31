package repository

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
)

// TestListCustomAgentsByOwner_Capped verifies the #2136 P0 cap: the repo was
// unbounded and could return every custom agent of an owner.
func TestListCustomAgentsByOwner_Capped(t *testing.T) {
	db := setupSQLite(t)
	const n = config.MaxPageLimit + 5
	for i := 0; i < n; i++ {
		ca := &model.CustomAgent{
			OwnerUserID:  "user-ca-cap",
			Name:         fmt.Sprintf("agent-%03d", i),
			AgentType:    "code-reviewer",
			SystemPrompt: "p",
		}
		require.NoError(t, CreateCustomAgent(db, ca))
	}
	list, err := ListCustomAgentsByOwner(db, "user-ca-cap")
	require.NoError(t, err)
	require.Len(t, list, config.MaxPageLimit, "custom-agents list must be capped at MaxPageLimit")
}

// TestListDocumentsByOwner_RespectsMaxPageLimit verifies the #2136 P1
// alignment: repo cap was 200 while the API layer accepts up to 500.
func TestListDocumentsByOwner_RespectsMaxPageLimit(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`CREATE TABLE documents (
		id TEXT PRIMARY KEY,
		owner_id TEXT NOT NULL,
		project_id TEXT,
		title TEXT NOT NULL,
		type TEXT NOT NULL DEFAULT 'md',
		source TEXT NOT NULL,
		source_ref TEXT,
		tag TEXT,
		location TEXT NOT NULL DEFAULT '',
		content TEXT,
		status TEXT NOT NULL DEFAULT 'active',
		metadata TEXT NOT NULL DEFAULT '{}',
		created_at DATETIME,
		updated_at DATETIME
	)`).Error)

	const n = 501
	for i := 0; i < n; i++ {
		doc := &model.Document{
			ID:       fmt.Sprintf("doc-%03d", i),
			OwnerID:  "user-doc",
			Title:    fmt.Sprintf("d %d", i),
			Type:     "md",
			Source:   "upload",
			Location: "库",
			Status:   model.DocumentStatusActive,
		}
		require.NoError(t, db.Create(doc).Error)
	}

	list, err := ListDocumentsByOwner(db, "user-doc", model.DocumentFilter{Limit: 1000})
	require.NoError(t, err)
	require.Len(t, list, 500, "documents cap must be MaxPageLimit, not 200")
}
