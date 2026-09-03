// Shared fixtures and mocks for the agent package test suite: mock DB,
// mock cache, dispatch-contract sqlite DB, and seq-recovery cache.

package agent

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

func newMockDBAgent(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, *sql.DB) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(
		sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(
			func(expectedSQL, actualSQL string) error {
				if strings.Contains(actualSQL, expectedSQL) {
					return nil
				}
				return fmt.Errorf("expected SQL to contain %q, but got %q", expectedSQL, actualSQL)
			},
		)),
	)
	require.NoError(t, err)
	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		SkipDefaultTransaction: true,
		PrepareStmt:            false,
	})
	require.NoError(t, err)
	return gormDB, mock, sqlDB
}

type mockAgentCache struct {
	mu             sync.Mutex
	routeID        string
	deviceRoutes   map[string]string
	pushedUser     string
	pushed         []string
	pushedTarget   []string
	pushedDeviceID string
	pushedTargetID string
}

func (m *mockAgentCache) GetRoute(ctx context.Context, userID, deviceType string) (string, error) {
	return m.routeID, nil
}

func (m *mockAgentCache) GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error) {
	if m.deviceRoutes == nil {
		return "", gorm.ErrRecordNotFound
	}
	connID, ok := m.deviceRoutes[userID+"|"+deviceType+"|"+deviceID]
	if !ok {
		return "", gorm.ErrRecordNotFound
	}
	return connID, nil
}

func (m *mockAgentCache) PushPendingTask(ctx context.Context, userID, taskJSON string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pushedUser = userID
	m.pushed = append(m.pushed, taskJSON)
	return nil
}

func (m *mockAgentCache) PushPendingTargetTask(ctx context.Context, userID, targetID, deviceID, taskJSON string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pushedUser = userID
	m.pushedTargetID = targetID
	m.pushedDeviceID = deviceID
	m.pushedTarget = append(m.pushedTarget, taskJSON)
	return nil
}

func (m *mockAgentCache) snapshot() mockAgentCacheSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	return mockAgentCacheSnapshot{
		pushedUser:     m.pushedUser,
		pushed:         append([]string(nil), m.pushed...),
		pushedTarget:   append([]string(nil), m.pushedTarget...),
		pushedDeviceID: m.pushedDeviceID,
		pushedTargetID: m.pushedTargetID,
	}
}

type mockAgentCacheSnapshot struct {
	pushedUser     string
	pushed         []string
	pushedTarget   []string
	pushedDeviceID string
	pushedTargetID string
}

func (m *mockAgentCache) AllocateSeq(ctx context.Context, sessionID string) (int64, error) {
	return 0, nil
}

func (m *mockAgentCache) SetSeq(ctx context.Context, sessionID string, seq int64) error {
	return nil
}

const (
	sqlmTaskByID   = `FROM "pending_agent_tasks" WHERE id =`
	sqlmAgentByID  = `FROM "agent_instances" WHERE id =`
	sqlmUpdateTask = `UPDATE "pending_agent_tasks" SET`
)

func newAgentTaskTargetContractDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	for _, ddl := range []string{
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			dissolved BOOLEAN DEFAULT FALSE,
			owner_user_id TEXT,
			workspace_id TEXT
		)`,
		`CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			sender_type TEXT NOT NULL,
			sender_id TEXT NOT NULL,
			content_type TEXT NOT NULL,
			content TEXT NOT NULL,
			seq_id INTEGER NOT NULL,
			client_msg_id TEXT NOT NULL,
			reply_to_message_id TEXT,
			recalled BOOLEAN NOT NULL DEFAULT FALSE,
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
		`CREATE TABLE session_members (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			member_type TEXT NOT NULL,
			member_id TEXT NOT NULL,
			role TEXT NOT NULL,
			left_at DATETIME
		)`,
		`CREATE TABLE agent_instances (
			id TEXT PRIMARY KEY,
			agent_type TEXT NOT NULL,
			custom_agent_id TEXT,
			session_id TEXT NOT NULL,
			inviter_user_id TEXT NOT NULL,
			display_name TEXT NOT NULL
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
		`CREATE TABLE devices (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			device_type TEXT NOT NULL,
			app_version TEXT DEFAULT '',
			capabilities TEXT DEFAULT '[]',
			last_active_at DATETIME,
			created_at DATETIME
		)`,
		`CREATE TABLE execution_targets (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			device_id TEXT,
			name TEXT NOT NULL,
			target_type TEXT NOT NULL DEFAULT 'local_edge',
			workspace_allowlist TEXT DEFAULT '[]',
			trust_level TEXT DEFAULT 'local',
			health_state TEXT DEFAULT 'unknown',
			is_online BOOLEAN DEFAULT FALSE,
			last_seen_at DATETIME,
			capabilities TEXT DEFAULT '{}',
			metadata TEXT DEFAULT '{}',
			deleted_at DATETIME
		)`,
		`CREATE TABLE execution_target_evidence (
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
		)`,
	} {
		require.NoError(t, db.Exec(ddl).Error)
	}
	require.NoError(t, db.Exec(`INSERT INTO sessions (id, type, dissolved, owner_user_id) VALUES (?, ?, ?, ?)`, "sess-1", model.SessionTypeGroup, false, "user-1").Error)
	require.NoError(t, db.Exec(`INSERT INTO messages (id, session_id, sender_type, sender_id, content_type, content, seq_id, client_msg_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"msg-1", "sess-1", model.SenderTypeUser, "user-1", model.ContentTypeText, `{"text":"run"}`, int64(1), "client-1").Error)
	require.NoError(t, db.Exec(`INSERT INTO session_members (id, session_id, member_type, member_id, role) VALUES (?, ?, ?, ?, ?)`,
		"member-1", "sess-1", model.MemberTypeUser, "user-1", model.MemberRoleMember).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name) VALUES (?, ?, ?, ?, ?)`,
		"agent-1", "codex", "sess-1", "user-1", "Codex").Error)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, name, target_type, workspace_allowlist, trust_level, health_state, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-other", "other-user", "Other target", "local_edge", `["/workspace"]`, "local", "unknown", "{}", "{}").Error)
	return db
}

// seqRecoveryCache simulates a Redis cache whose session seq key was freshly
// recreated: the first AllocateSeq returns 1 (fresh key INCR), SetSeq stores
// the value, and the following AllocateSeq returns stored+1.
type seqRecoveryCache struct {
	seq int64
}

func (c *seqRecoveryCache) GetRoute(ctx context.Context, userID, deviceType string) (string, error) {
	return "", errors.New("not used")
}

func (c *seqRecoveryCache) GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error) {
	return "", errors.New("not used")
}

func (c *seqRecoveryCache) PushPendingTask(ctx context.Context, userID, taskJSON string) error {
	return nil
}

func (c *seqRecoveryCache) PushPendingTargetTask(ctx context.Context, userID, targetID, deviceID, taskJSON string) error {
	return nil
}

func (c *seqRecoveryCache) AllocateSeq(ctx context.Context, sessionID string) (int64, error) {
	if c.seq == 0 {
		return 1, nil // fresh Redis key: INCR recreates at 1
	}
	c.seq++
	return c.seq, nil
}

func (c *seqRecoveryCache) SetSeq(ctx context.Context, sessionID string, seq int64) error {
	c.seq = seq
	return nil
}
