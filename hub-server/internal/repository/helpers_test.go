package repository

import (
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// setupSQLite creates an in-memory SQLite database with tables matching the
// production PostgreSQL schema. Raw SQL is used instead of AutoMigrate because
// GORM's SQLite driver mishandles PostgreSQL-specific GORM tags (jsonb with
// default:'[]' produces SQLite-invalid DEFAULT "[]").
func setupSQLite(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)

	tables := []string{
		`CREATE TABLE users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT,
			nickname TEXT NOT NULL,
			avatar_url TEXT DEFAULT '',
			tokendance_sub TEXT DEFAULT NULL,
			tokendance_sub_linked_at DATETIME DEFAULT NULL,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE UNIQUE INDEX idx_users_tokendance_sub ON users(tokendance_sub)
			WHERE tokendance_sub IS NOT NULL AND tokendance_sub != ''`,
		`CREATE TABLE devices (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			device_type TEXT NOT NULL,
			app_version TEXT DEFAULT '',
			capabilities TEXT DEFAULT '[]',
			last_active_at DATETIME NOT NULL DEFAULT (datetime('now')),
			created_at DATETIME
		)`,
		`CREATE INDEX idx_devices_user_type ON devices(user_id, device_type)`,
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			name TEXT DEFAULT '',
			avatar_url TEXT DEFAULT '',
			tokendance_sub TEXT DEFAULT NULL,
			tokendance_sub_linked_at DATETIME DEFAULT NULL,
			announcement TEXT DEFAULT '',
			owner_user_id TEXT,
			workspace_id TEXT,
			next_seq INTEGER NOT NULL DEFAULT 0,
			last_message_at DATETIME,
			dissolved INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME
		)`,
		`CREATE TABLE session_members (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			member_type TEXT NOT NULL,
			member_id TEXT NOT NULL,
			role TEXT NOT NULL,
			pinned INTEGER NOT NULL DEFAULT 0,
			archived INTEGER NOT NULL DEFAULT 0,
			muted INTEGER NOT NULL DEFAULT 0,
			last_read_seq INTEGER NOT NULL DEFAULT 0,
			joined_at DATETIME,
			left_at DATETIME
		)`,
		`CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			seq_id INTEGER NOT NULL,
			client_msg_id TEXT NOT NULL,
			sender_type TEXT NOT NULL,
			sender_id TEXT NOT NULL,
			content_type TEXT NOT NULL,
			content TEXT NOT NULL DEFAULT '',
			reply_to_message_id TEXT,
			recalled INTEGER NOT NULL DEFAULT 0,
			edited BOOLEAN NOT NULL DEFAULT FALSE,
			edited_at DATETIME,
			created_at DATETIME
		)`,
		`CREATE TABLE message_pins (
			session_id TEXT NOT NULL,
			message_id TEXT NOT NULL,
			pinned_by_user_id TEXT NOT NULL,
			pinned_at DATETIME,
			PRIMARY KEY (session_id, message_id)
		)`,
		`CREATE TABLE message_attachments (
			session_id TEXT NOT NULL,
			message_id TEXT NOT NULL,
			attachment_id TEXT NOT NULL,
			created_at DATETIME,
			PRIMARY KEY (message_id, attachment_id)
		)`,
		`CREATE TABLE message_reactions (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			message_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			emoji TEXT NOT NULL,
			created_at DATETIME,
			UNIQUE (session_id, message_id, user_id, emoji)
		)`,
		`CREATE TABLE friendships (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			friend_id TEXT NOT NULL,
			status TEXT NOT NULL,
			remark TEXT DEFAULT '',
			request_message TEXT DEFAULT '',
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE UNIQUE INDEX idx_friendships_user_friend ON friendships(user_id, friend_id)`,
		// Additional models for full coverage
		`CREATE TABLE notifications (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			type TEXT NOT NULL,
			payload TEXT NOT NULL DEFAULT '',
			read INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME
		)`,
		`CREATE TABLE attachments (
			id TEXT PRIMARY KEY,
			hash TEXT NOT NULL UNIQUE,
			size INTEGER NOT NULL,
			mime_type TEXT NOT NULL,
			original_name TEXT DEFAULT '',
			uploader_user_id TEXT NOT NULL,
			metadata TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME
		)`,
		`CREATE TABLE agent_instances (
			id TEXT PRIMARY KEY,
			agent_type TEXT NOT NULL,
			custom_agent_id TEXT,
			session_id TEXT NOT NULL,
			inviter_user_id TEXT NOT NULL,
			workspace_id TEXT,
			display_name TEXT NOT NULL,
			created_at DATETIME
		)`,
		`CREATE TABLE custom_agents (
			id TEXT PRIMARY KEY,
			owner_user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			avatar_url TEXT DEFAULT '',
			tokendance_sub TEXT DEFAULT NULL,
			tokendance_sub_linked_at DATETIME DEFAULT NULL,
			agent_type TEXT NOT NULL,
			system_prompt TEXT NOT NULL DEFAULT '',
			capability_tags TEXT DEFAULT '[]',
			tool_whitelist TEXT DEFAULT '[]',
			model_params TEXT DEFAULT '{}',
			output_schema TEXT DEFAULT NULL,
			deleted_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE pending_agent_tasks (
			id TEXT PRIMARY KEY,
			agent_instance_id TEXT NOT NULL,
			triggered_by_user_id TEXT NOT NULL,
			trigger_message_id TEXT NOT NULL,
			target_id TEXT,
			status TEXT NOT NULL,
			edge_run_id TEXT DEFAULT '',
			edge_device_id TEXT DEFAULT '',
			error_message TEXT DEFAULT '',
			model_params TEXT DEFAULT '{}',
			created_at DATETIME,
			dispatched_at DATETIME,
			finished_at DATETIME,
			expire_at DATETIME NOT NULL
		)`,
		`CREATE TABLE refresh_tokens (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			device_type TEXT NOT NULL DEFAULT '',
			device_id TEXT NOT NULL DEFAULT '',
			token_hash TEXT NOT NULL UNIQUE,
			expires_at DATETIME NOT NULL,
			revoked INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME
		)`,
		`CREATE UNIQUE INDEX idx_rt_user_device ON refresh_tokens(user_id, device_type, device_id)`,
		`CREATE TABLE agent_teams (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			avatar_url TEXT DEFAULT '',
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_members (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			agent_profile_id TEXT,
			role TEXT NOT NULL DEFAULT 'executor',
			position INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME,
			FOREIGN KEY (team_id) REFERENCES agent_teams(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE agent_team_runs (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			session_id TEXT,
			trigger_user_id TEXT NOT NULL,
			trigger_message TEXT DEFAULT '',
			target_id TEXT,
			mode TEXT NOT NULL DEFAULT 'supervisor',
			status TEXT NOT NULL DEFAULT 'queued',
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_assignments (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			from_member_id TEXT NOT NULL,
			to_member_id TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'delegate',
			task_prompt TEXT NOT NULL,
			context TEXT DEFAULT '',
			status TEXT NOT NULL DEFAULT 'pending',
			run_id TEXT,
			result TEXT DEFAULT '',
			depth INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_tasks (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			assignment_id TEXT,
			assignee_member_id TEXT NOT NULL,
			parent_task_id TEXT,
			status TEXT NOT NULL DEFAULT 'pending',
			objective TEXT NOT NULL,
			input_refs TEXT NOT NULL DEFAULT '{}',
			run_id TEXT,
			attempt INTEGER NOT NULL DEFAULT 1,
			risk_level TEXT NOT NULL DEFAULT 'normal',
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE agent_team_events (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			seq INTEGER NOT NULL,
			type TEXT NOT NULL,
			payload TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME
		)`,
		// Mirrors migration 0056: seq must be unique per run so concurrent
		// appends surface as unique violations instead of silent duplicates.
		`CREATE UNIQUE INDEX uq_agent_team_events_run_seq ON agent_team_events(team_run_id, seq)`,
		`CREATE TABLE agent_profiles (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			runtime_id TEXT NOT NULL DEFAULT '',
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
			is_public INTEGER DEFAULT 0,
			install_count INTEGER DEFAULT 0,
			rating_avg REAL DEFAULT 0,
			rating_count INTEGER DEFAULT 0,
			version INTEGER DEFAULT 1,
			created_at DATETIME,
			updated_at DATETIME,
			deleted_at DATETIME
		)`,
		`CREATE TABLE agent_run_events (
			id TEXT PRIMARY KEY,
			task_id TEXT NOT NULL,
			edge_run_id TEXT DEFAULT '',
			session_id TEXT NOT NULL,
			agent_instance_id TEXT NOT NULL,
			event_seq INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			payload TEXT NOT NULL DEFAULT '',
			created_at DATETIME
		)`,
		`CREATE TABLE agent_team_artifacts (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			team_task_id TEXT,
			assignment_id TEXT,
			member_id TEXT,
			agent_task_id TEXT,
			edge_run_id TEXT DEFAULT '',
			source_event_id TEXT,
			event_seq INTEGER NOT NULL DEFAULT 0,
			path TEXT NOT NULL,
			normalized_path TEXT NOT NULL,
			action TEXT DEFAULT '',
			tool_name TEXT DEFAULT '',
			status TEXT DEFAULT '',
			conflict_id TEXT,
			created_at DATETIME,
			updated_at DATETIME
		)`,
	}
	for _, ddl := range tables {
		require.NoError(t, db.Exec(ddl).Error, "DDL: %s", ddl[:60])
	}
	return db
}

// =============================================================================
// Message repository tests
// =============================================================================

func createTestSession(t *testing.T, db *gorm.DB) *model.Session {
	t.Helper()
	s := &model.Session{Type: model.SessionTypeGroup, Name: "MsgTest"}
	require.NoError(t, CreateSession(db, s))
	return s
}

// =============================================================================
// Helpers
// =============================================================================

func strPtr(s string) *string {
	return &s
}
