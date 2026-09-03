package agentteam

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
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

// newMockAgentTeamDB creates a sqlmock-backed gorm.DB for agent team tests.
func newMockAgentTeamDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, _ := newMockDBAgent(t)
	return db, mock
}

// mockAgentTeamAgentSvc implements agentTeamAgentSvc for tests.
type mockAgentTeamAgentSvc struct {
	triggerMessageID string
	targetID         string
	modelParams      string
	returnTaskID     string
}

func (m *mockAgentTeamAgentSvc) AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error) {
	return &model.AgentInstance{}, nil
}

func (m *mockAgentTeamAgentSvc) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	m.triggerMessageID = triggerMessageID
	m.targetID = targetID
	m.modelParams = modelParams
	taskID := m.returnTaskID
	if taskID == "" {
		taskID = "task-1"
	}
	return &model.PendingAgentTask{ID: taskID}, nil
}

type mockAgentTeamControlSvc struct {
	calls []agentTeamControlCall
}

type agentTeamControlCall struct {
	userID   string
	deviceID string
	payload  model.AgentControlPayload
}

func (m *mockAgentTeamControlSvc) DeliverToDesktopDevice(ctx context.Context, userID, deviceID string, payload model.AgentControlPayload) error {
	m.calls = append(m.calls, agentTeamControlCall{
		userID:   userID,
		deviceID: deviceID,
		payload:  payload,
	})
	return nil
}

func readAgentTeamEvent(t *testing.T, events <-chan bus.Event) bus.Event {
	t.Helper()
	select {
	case event := <-events:
		return event
	case <-time.After(time.Second):
		t.Fatal("agent team event was not published")
	}
	return bus.Event{}
}

func setupAgentTeamStateSQLite(t *testing.T) *gorm.DB {
	t.Helper()
	return setupAgentTeamStateSQLiteDSN(t, ":memory:", 1)
}

func setupAgentTeamConcurrentSQLite(t *testing.T) *gorm.DB {
	t.Helper()
	path := filepath.ToSlash(filepath.Join(t.TempDir(), "agentteam-concurrency.db"))
	dsn := fmt.Sprintf("file:%s?cache=shared&_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)", path)
	return setupAgentTeamStateSQLiteDSN(t, dsn, 8)
}

func setupAgentTeamStateSQLiteDSN(t *testing.T, dsn string, maxOpenConns int) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	sqlDB.SetMaxOpenConns(maxOpenConns)
	tables := []string{
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
			created_at DATETIME
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
		`CREATE TABLE agent_team_artifacts (
			id TEXT PRIMARY KEY,
			team_run_id TEXT NOT NULL,
			team_task_id TEXT,
			assignment_id TEXT,
			member_id TEXT,
			agent_task_id TEXT,
			edge_run_id TEXT,
			source_event_id TEXT,
			event_seq INTEGER NOT NULL DEFAULT 0,
			path TEXT NOT NULL,
			normalized_path TEXT NOT NULL,
			action TEXT,
			tool_name TEXT,
			status TEXT,
			conflict_id TEXT,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			name TEXT DEFAULT '',
			owner_user_id TEXT,
			workspace_id TEXT,
			next_seq INTEGER NOT NULL DEFAULT 0,
			last_message_at DATETIME,
			dissolved BOOLEAN NOT NULL DEFAULT FALSE,
			created_at DATETIME
		)`,
		`CREATE TABLE session_members (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			member_type TEXT NOT NULL,
			member_id TEXT NOT NULL,
			role TEXT NOT NULL,
			pinned BOOLEAN NOT NULL DEFAULT FALSE,
			archived BOOLEAN NOT NULL DEFAULT FALSE,
			muted BOOLEAN NOT NULL DEFAULT FALSE,
			last_read_seq INTEGER NOT NULL DEFAULT 0,
			joined_at DATETIME,
			left_at DATETIME
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
			agent_type TEXT NOT NULL,
			system_prompt TEXT DEFAULT '',
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
			edge_device_id TEXT,
			error_message TEXT,
			model_params TEXT DEFAULT '{}',
			created_at DATETIME,
			dispatched_at DATETIME,
			finished_at DATETIME,
			expire_at DATETIME NOT NULL
		)`,
		`CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			seq_id INTEGER NOT NULL,
			client_msg_id TEXT NOT NULL,
			sender_type TEXT NOT NULL,
			sender_id TEXT NOT NULL,
			content_type TEXT NOT NULL,
			content TEXT NOT NULL,
			reply_to_message_id TEXT,
			recalled BOOLEAN NOT NULL DEFAULT FALSE,
			edited BOOLEAN NOT NULL DEFAULT FALSE,
			edited_at DATETIME,
			created_at DATETIME
		)`,
		`CREATE UNIQUE INDEX idx_messages_session_client_msg ON messages (session_id, client_msg_id)`,
		`CREATE TABLE agent_run_events (
			id TEXT PRIMARY KEY,
			task_id TEXT NOT NULL,
			edge_run_id TEXT,
			session_id TEXT NOT NULL,
			agent_instance_id TEXT NOT NULL,
			event_seq INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			payload TEXT NOT NULL,
			created_at DATETIME
		)`,
	}
	for _, ddl := range tables {
		require.NoError(t, db.Exec(ddl).Error)
	}
	return db
}

func seedAgentTeamRun(t *testing.T, db *gorm.DB) (*model.AgentTeam, *model.AgentTeamMember, *model.AgentTeamMember, *model.AgentTeamRun) {
	t.Helper()
	team := &model.AgentTeam{OwnerID: "user-1", Name: "Route Team"}
	require.NoError(t, repository.CreateTeam(db, team))

	supervisorProfileID := "profile-supervisor"
	executorProfileID := "profile-executor"
	supervisor := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: &supervisorProfileID,
		Role:           model.TeamMemberRoleSupervisor,
	}
	executor := &model.AgentTeamMember{
		TeamID:         team.ID,
		AgentProfileID: &executorProfileID,
		Role:           model.TeamMemberRoleExecutor,
	}
	require.NoError(t, repository.AddTeamMember(db, supervisor))
	require.NoError(t, repository.AddTeamMember(db, executor))

	run := &model.AgentTeamRun{
		TeamID:         team.ID,
		SessionID:      "session-1",
		TriggerUserID:  "user-1",
		TriggerMessage: "ship it",
		Status:         model.TeamRunStatusRunning,
	}
	require.NoError(t, repository.CreateTeamRun(db, run))
	return team, supervisor, executor, run
}

func addReadableTeamMemberForUser(t *testing.T, db *gorm.DB, teamID, userID string) *model.AgentTeamMember {
	t.Helper()
	agent := &model.CustomAgent{
		OwnerUserID:  userID,
		Name:         "Readable Member Agent",
		AgentType:    "codex",
		SystemPrompt: "Read shared team state",
	}
	require.NoError(t, repository.CreateCustomAgent(db, agent))
	member := &model.AgentTeamMember{
		TeamID:         teamID,
		AgentProfileID: &agent.ID,
		Role:           model.TeamMemberRoleExecutor,
	}
	require.NoError(t, repository.AddTeamMember(db, member))
	return member
}

func addTeamSupervisor(t *testing.T, db *gorm.DB, teamID, profileID string) *model.AgentTeamMember {
	t.Helper()
	member := &model.AgentTeamMember{
		TeamID:         teamID,
		AgentProfileID: &profileID,
		Role:           model.TeamMemberRoleSupervisor,
	}
	require.NoError(t, repository.AddTeamMember(db, member))
	return member
}

func stringPtr(value string) *string {
	return &value
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	require.NoError(t, err)
	return string(data)
}

func seedTeamRunSession(t *testing.T, db *gorm.DB, sessionID, userID string, executor *model.AgentTeamMember) {
	t.Helper()
	now := time.Now()
	require.NoError(t, db.Exec(
		`INSERT INTO sessions (id, type, name, owner_user_id, next_seq, dissolved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		sessionID, model.SessionTypeGroup, "Team session", userID, 0, false, now,
	).Error)
	require.NoError(t, db.Exec(
		`INSERT INTO session_members (id, session_id, member_type, member_id, role, joined_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"session-member-user", sessionID, model.MemberTypeUser, userID, model.MemberRoleOwner, now,
	).Error)
	customAgentID := ""
	if executor.AgentProfileID != nil {
		customAgentID = *executor.AgentProfileID
	}
	require.NoError(t, db.Exec(
		`INSERT INTO agent_instances (id, agent_type, custom_agent_id, session_id, inviter_user_id, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"agent-executor", "codex", customAgentID, sessionID, userID, "Executor", now,
	).Error)
	require.NoError(t, db.Exec(
		`INSERT INTO session_members (id, session_id, member_type, member_id, role, joined_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"session-member-agent", sessionID, model.MemberTypeAgent, "agent-executor", model.MemberRoleMember, now,
	).Error)
}

func entryMemberIDs(entries []model.CompeteSummaryEntry) []string {
	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = e.MemberID
	}
	return ids
}

func strPtr(s string) *string {
	return &s
}
