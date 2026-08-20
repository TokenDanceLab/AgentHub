package agentprofile

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
	svc := NewService(db)

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
	svc := NewService(db)

	profile, err := svc.GetPublic(context.Background(), "public-profile")
	require.NoError(t, err)
	require.Equal(t, "public-profile", profile.ID)

	_, err = svc.GetPublic(context.Background(), "private-profile")
	require.ErrorIs(t, err, errcode.AgentNotFound)
}

func TestAgentProfileUpdateNormalizesJSONLikeFields(t *testing.T) {
	db := newAgentProfileTestDB(t)
	seedAgentProfile(t, db, "profile-1", "owner-1", false)
	svc := NewService(db)

	profile, err := svc.Update(context.Background(), "profile-1", "owner-1", map[string]interface{}{
		"name":                      "Updated profile",
		"description":               "Production profile",
		"runtime_id":                "codex",
		"model":                     "gpt-5-codex",
		"provider":                  "codex",
		"reasoning_effort":          "high",
		"permission_mode":           "trusted",
		"model_mapping":             map[string]interface{}{"codex": "gpt-5-codex"},
		"skills":                    []interface{}{"skill-1"},
		"mcp_servers":               `["mcp-1"]`,
		"tool_allowlist":            []string{"shell"},
		"approval_policy":           map[string]interface{}{"mode": "default"},
		"target_preferences":        map[string]interface{}{"edge": "local"},
		"context_budget_max_tokens": float64(128000),
	})

	require.NoError(t, err)
	require.Equal(t, "Updated profile", profile.Name)
	require.Equal(t, "Production profile", profile.Description)
	require.Equal(t, "codex", profile.RuntimeID)
	require.Equal(t, "gpt-5-codex", profile.Model)
	require.Equal(t, "codex", profile.Provider)
	require.Equal(t, "high", profile.ReasoningEffort)
	require.Equal(t, "trusted", profile.PermissionMode)
	require.JSONEq(t, `{"codex":"gpt-5-codex"}`, profile.ModelMapping)
	require.JSONEq(t, `["skill-1"]`, profile.Skills)
	require.JSONEq(t, `["mcp-1"]`, profile.MCPServers)
	require.JSONEq(t, `["shell"]`, profile.ToolAllowlist)
	require.JSONEq(t, `{"mode":"default"}`, profile.ApprovalPolicy)
	require.JSONEq(t, `{"edge":"local"}`, profile.TargetPreferences)
	require.Equal(t, 128000, profile.ContextBudgetMaxTokens)
}

func TestAgentProfileUpdateRejectsInvalidFieldTypesWithoutPanic(t *testing.T) {
	tests := []struct {
		name    string
		updates map[string]interface{}
	}{
		{name: "string field", updates: map[string]interface{}{"description": 123}},
		{name: "object field", updates: map[string]interface{}{"model_mapping": []interface{}{"not-object"}}},
		{name: "array field", updates: map[string]interface{}{"skills": map[string]interface{}{"not": "array"}}},
		{name: "integer field", updates: map[string]interface{}{"context_budget_max_tokens": "128000"}},
		{name: "fractional integer field", updates: map[string]interface{}{"context_budget_max_tokens": 10.5}},
		{name: "malformed JSON string", updates: map[string]interface{}{"approval_policy": `["not-object"]`}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newAgentProfileTestDB(t)
			seedAgentProfile(t, db, "profile-1", "owner-1", false)
			svc := NewService(db)

			var err error
			require.NotPanics(t, func() {
				_, err = svc.Update(context.Background(), "profile-1", "owner-1", tt.updates)
			})
			require.ErrorIs(t, err, errcode.ErrBadRequest)
		})
	}
}
