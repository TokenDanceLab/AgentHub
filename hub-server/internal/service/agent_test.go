package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/ws"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/dispatch"
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

func TestAddAgentToSessionReturnsCreatedInstance(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Session{}, &model.SessionMember{}, &model.AgentInstance{}))

	userID := "00000000-0000-0000-0000-00000000a101"
	session := &model.Session{
		Type:        model.SessionTypeGroup,
		OwnerUserID: &userID,
	}
	require.NoError(t, db.Create(session).Error)
	require.NoError(t, db.Create(&model.SessionMember{
		SessionID:   session.ID,
		MemberType:  model.MemberTypeUser,
		MemberID:    userID,
		Role:        model.MemberRoleOwner,
		LastReadSeq: 0,
	}).Error)

	svc := &AgentService{db: db}
	agent, err := svc.AddAgentToSession(context.Background(), userID, session.ID, "claude-code", "", "Hub Builder")

	require.NoError(t, err)
	require.NotNil(t, agent)
	require.NotEmpty(t, agent.ID)
	assert.Equal(t, "claude-code", agent.AgentType)
	assert.Equal(t, session.ID, agent.SessionID)
	assert.Equal(t, userID, agent.InviterUserID)
	assert.Equal(t, "Hub Builder", agent.DisplayName)

	var member model.SessionMember
	require.NoError(t, db.Where("session_id = ? AND member_type = ? AND member_id = ?", session.ID, model.MemberTypeAgent, agent.ID).First(&member).Error)
	assert.Equal(t, model.MemberRoleMember, member.Role)
}

func TestPromptFromMessage_TextPayload(t *testing.T) {
	msg := &model.Message{
		ContentType: model.ContentTypeText,
		Content:     `{"text":"Run real Codex against this repo"}`,
	}

	require.Equal(t, "Run real Codex against this repo", dispatch.PromptFromMessage(msg))
}

func TestDispatchTaskIncludesPrompt(t *testing.T) {
	db, _, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "claude-code",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Claude",
	}

	// Point Edge dispatch at a dead port so it always falls back to Redis.
	t.Setenv("AGENTHUB_EDGE_URL", "http://127.0.0.1:1")

	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Run the real runtime", `{"model":"claude-sonnet-4-6"}`, "", nil)

	snapshot := cache.snapshot()
	require.Equal(t, "user-1", snapshot.pushedUser)
	require.Len(t, snapshot.pushed, 1)
	var payload dispatch.Payload
	require.NoError(t, json.Unmarshal([]byte(snapshot.pushed[0]), &payload))
	require.Equal(t, "Run the real runtime", payload.Prompt)
	require.Equal(t, "claude-code", payload.AgentType)
	require.Equal(t, `{"model":"claude-sonnet-4-6"}`, payload.ModelParams)
	require.Equal(t, "sess-1", payload.SessionID)
}

func TestDispatchTaskIncludesTargetID(t *testing.T) {
	db, _, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		TargetID:          "target-1",
		EdgeDeviceID:      "dev-1",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Run the selected target", "", "", nil)

	snapshot := cache.snapshot()
	require.Equal(t, "user-1", snapshot.pushedUser)
	require.Len(t, snapshot.pushedTarget, 1)
	var payload dispatch.Payload
	require.NoError(t, json.Unmarshal([]byte(snapshot.pushedTarget[0]), &payload))
	require.Equal(t, "target-1", payload.TargetID)
	require.Equal(t, "dev-1", payload.EdgeDeviceID)
}

func TestDispatchTaskIncludesTeamRunContext(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	for _, ddl := range []string{
		`CREATE TABLE custom_agents (
			id TEXT PRIMARY KEY,
			owner_user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			avatar_url TEXT DEFAULT '',
			agent_type TEXT NOT NULL,
			system_prompt TEXT NOT NULL,
			capability_tags TEXT DEFAULT '[]',
			tool_whitelist TEXT DEFAULT '[]',
			model_params TEXT DEFAULT '{}',
			output_schema TEXT DEFAULT NULL,
			deleted_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)`,
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
			role TEXT NOT NULL,
			position INTEGER DEFAULT 0,
			created_at DATETIME
		)`,
		`CREATE TABLE agent_team_runs (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			session_id TEXT NOT NULL,
			trigger_user_id TEXT NOT NULL,
			trigger_message TEXT DEFAULT '',
			target_id TEXT,
			mode TEXT NOT NULL DEFAULT 'supervisor',
			status TEXT NOT NULL,
			created_at DATETIME,
			updated_at DATETIME
		)`,
	} {
		require.NoError(t, db.Exec(ddl).Error)
	}
	now := time.Now()
	require.NoError(t, db.Exec(`INSERT INTO custom_agents (id, owner_user_id, name, agent_type, system_prompt, capability_tags, tool_whitelist, model_params, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"profile-supervisor", "user-1", "Supervisor", "claude-code", "Coordinate the team", "[]", "[]", `{"model":"claude-sonnet-4-6"}`, now, now).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_teams (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		"team-1", "user-1", "Backend Team", now, now).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_team_members (id, team_id, agent_profile_id, role, position, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"member-supervisor", "team-1", "profile-supervisor", model.TeamMemberRoleSupervisor, 0, now).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_team_runs (id, team_id, session_id, trigger_user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"run-team-1", "team-1", "sess-1", "user-1", model.TeamRunStatusRunning, now, now).Error)

	profileID := "profile-supervisor"
	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "claude-code",
		CustomAgentID: &profileID,
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Supervisor",
	}

	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Route this team run", "", "", nil)

	snapshot := cache.snapshot()
	require.Len(t, snapshot.pushed, 1)
	var payload dispatch.Payload
	require.NoError(t, json.Unmarshal([]byte(snapshot.pushed[0]), &payload))
	require.Equal(t, "team-1", payload.TeamID)
	require.Equal(t, "run-team-1", payload.TeamRunID)
	require.Equal(t, "member-supervisor", payload.TeamMemberID)
	require.Equal(t, model.TeamMemberRoleSupervisor, payload.TeamMemberRole)
	require.Equal(t, "profile-supervisor", payload.CustomAgentID)
	// ModelParams from profile not populated when customAgent is nil (only TriggerAgentTask pre-queries it).
	require.Empty(t, payload.ModelParams)
}

// ==================== T2-D10: OutputSchema dispatch tests ====================

func TestDispatchTaskIncludesOutputSchema(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	// Add custom_agents table (not part of the default target contract schema).
	require.NoError(t, db.Exec(`CREATE TABLE IF NOT EXISTS custom_agents (
		id TEXT PRIMARY KEY,
		owner_user_id TEXT NOT NULL,
		name TEXT NOT NULL,
		avatar_url TEXT DEFAULT '',
		agent_type TEXT NOT NULL,
		system_prompt TEXT NOT NULL,
		capability_tags TEXT DEFAULT '[]',
		tool_whitelist TEXT DEFAULT '[]',
		model_params TEXT DEFAULT '{}',
		output_schema TEXT DEFAULT NULL,
		deleted_at DATETIME,
		created_at DATETIME,
		updated_at DATETIME
	)`).Error)

	now := time.Now()
	outputSchema := `{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}`
	require.NoError(t, db.Exec(
		`INSERT INTO custom_agents (id, owner_user_id, name, agent_type, system_prompt, capability_tags, tool_whitelist, model_params, output_schema, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"profile-outputschema", "user-1", "Structured Agent", "claude-code", "You produce structured JSON.", "[]", "[]", `{"model":"claude-sonnet-4-6"}`, outputSchema, now, now,
	).Error)

	// Build a *model.CustomAgent with OutputSchema populated for direct dispatchTask call.
	raw := json.RawMessage(outputSchema)
	customAgent := &model.CustomAgent{
		ID:           "profile-outputschema",
		OwnerUserID:  "user-1",
		Name:         "Structured Agent",
		AgentType:    "claude-code",
		SystemPrompt: "You produce structured JSON.",
		ModelParams:  `{"model":"claude-sonnet-4-6"}`,
		OutputSchema: &raw,
	}

	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-output-schema",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
	}
	profileID := "profile-outputschema"
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "claude-code",
		CustomAgentID: &profileID,
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Structured Agent",
	}

	// Point Edge dispatch at a dead port so it always falls back to Redis.
	t.Setenv("AGENTHUB_EDGE_URL", "http://127.0.0.1:1")

	// Dispatch WITH the CustomAgent (non-TeamRun scenario).
	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Give me a summary", "", "", customAgent)

	snapshot := cache.snapshot()
	require.Len(t, snapshot.pushed, 1)
	var payload dispatch.Payload
	require.NoError(t, json.Unmarshal([]byte(snapshot.pushed[0]), &payload))

	// Verify OutputSchema is present in the dispatch payload.
	require.NotNil(t, payload.OutputSchema, "OutputSchema should be set when CustomAgent has OutputSchema")
	require.Equal(t, outputSchema, string(*payload.OutputSchema))
	// Verify the CustomAgent fields are also passed.
	require.Equal(t, "profile-outputschema", payload.CustomAgentID)
	require.Equal(t, "You produce structured JSON.", payload.SystemPrompt)
	require.Equal(t, `{"model":"claude-sonnet-4-6"}`, payload.ModelParams)
}

func TestDispatchTaskIncludesOutputSchemaWithTeamRunContext(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	for _, ddl := range []string{
		`CREATE TABLE IF NOT EXISTS custom_agents (
			id TEXT PRIMARY KEY,
			owner_user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			avatar_url TEXT DEFAULT '',
			agent_type TEXT NOT NULL,
			system_prompt TEXT NOT NULL,
			capability_tags TEXT DEFAULT '[]',
			tool_whitelist TEXT DEFAULT '[]',
			model_params TEXT DEFAULT '{}',
			output_schema TEXT DEFAULT NULL,
			deleted_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE IF NOT EXISTS agent_teams (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			avatar_url TEXT DEFAULT '',
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE IF NOT EXISTS agent_team_members (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			agent_profile_id TEXT,
			role TEXT NOT NULL,
			position INTEGER DEFAULT 0,
			created_at DATETIME
		)`,
		`CREATE TABLE IF NOT EXISTS agent_team_runs (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			session_id TEXT NOT NULL,
			trigger_user_id TEXT NOT NULL,
			trigger_message TEXT DEFAULT '',
			target_id TEXT,
			mode TEXT NOT NULL DEFAULT 'supervisor',
			status TEXT NOT NULL,
			created_at DATETIME,
			updated_at DATETIME
		)`,
	} {
		require.NoError(t, db.Exec(ddl).Error)
	}

	now := time.Now()
	outputSchema := `{"type":"object","properties":{"action":{"type":"string","enum":["delegate","finish"]}},"required":["action"]}`

	// Insert CustomAgent with OutputSchema.
	require.NoError(t, db.Exec(
		`INSERT INTO custom_agents (id, owner_user_id, name, agent_type, system_prompt, capability_tags, tool_whitelist, model_params, output_schema, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"profile-supervisor", "user-1", "Supervisor", "claude-code", "Coordinate the team", "[]", "[]", `{"model":"claude-sonnet-4-6"}`, outputSchema, now, now,
	).Error)

	// Insert TeamRun context.
	require.NoError(t, db.Exec(
		`INSERT INTO agent_teams (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		"team-1", "user-1", "Backend Team", now, now).Error)
	require.NoError(t, db.Exec(
		`INSERT INTO agent_team_members (id, team_id, agent_profile_id, role, position, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"member-supervisor", "team-1", "profile-supervisor", model.TeamMemberRoleSupervisor, 0, now).Error)
	require.NoError(t, db.Exec(
		`INSERT INTO agent_team_runs (id, team_id, session_id, trigger_user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"run-team-1", "team-1", "sess-1", "user-1", model.TeamRunStatusRunning, now, now).Error)

	// Build the CustomAgent model for direct dispatchTask call.
	raw := json.RawMessage(outputSchema)
	customAgent := &model.CustomAgent{
		ID:           "profile-supervisor",
		OwnerUserID:  "user-1",
		Name:         "Supervisor",
		AgentType:    "claude-code",
		SystemPrompt: "Coordinate the team",
		ModelParams:  `{"model":"claude-sonnet-4-6"}`,
		OutputSchema: &raw,
	}

	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-teamrun-outputschema",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
	}
	profileID := "profile-supervisor"
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "claude-code",
		CustomAgentID: &profileID,
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Supervisor",
	}

	// Point Edge dispatch at a dead port so it always falls back to Redis.
	t.Setenv("AGENTHUB_EDGE_URL", "http://127.0.0.1:1")

	// Dispatch WITH the CustomAgent (TeamRun scenario — backward compatibility).
	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Route this team run", "", "", customAgent)

	snapshot := cache.snapshot()
	require.Len(t, snapshot.pushed, 1)
	var payload dispatch.Payload
	require.NoError(t, json.Unmarshal([]byte(snapshot.pushed[0]), &payload))

	// TeamRun context is preserved (backward compatibility).
	require.Equal(t, "team-1", payload.TeamID)
	require.Equal(t, "run-team-1", payload.TeamRunID)
	require.Equal(t, "member-supervisor", payload.TeamMemberID)
	require.Equal(t, model.TeamMemberRoleSupervisor, payload.TeamMemberRole)
	require.Equal(t, "profile-supervisor", payload.CustomAgentID)

	// OutputSchema is also present (new behavior, backward compatible).
	require.NotNil(t, payload.OutputSchema, "OutputSchema should be set for TeamRun agents when CustomAgent has it")
	require.Equal(t, outputSchema, string(*payload.OutputSchema))
	require.Equal(t, "Coordinate the team", payload.SystemPrompt)
	require.Equal(t, `{"model":"claude-sonnet-4-6"}`, payload.ModelParams)
}

func TestDispatchTaskWithoutCustomAgentOmitsOutputSchema(t *testing.T) {
	// Verify that OutputSchema is NOT set when the agent has no CustomAgent.
	db, _, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-no-ca",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "claude-code",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Claude",
		// CustomAgentID is nil — no CustomAgent.
	}

	t.Setenv("AGENTHUB_EDGE_URL", "http://127.0.0.1:1")
	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Run without custom agent", "", "", nil)

	snapshot := cache.snapshot()
	require.Len(t, snapshot.pushed, 1)
	var payload dispatch.Payload
	require.NoError(t, json.Unmarshal([]byte(snapshot.pushed[0]), &payload))

	// OutputSchema MUST be nil when no CustomAgent is associated.
	require.Nil(t, payload.OutputSchema, "OutputSchema should be nil when no CustomAgent exists")
	require.Empty(t, payload.CustomAgentID)
}

func TestDispatchTaskWithTargetIDButNoDeviceFailsClosed(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	mgr := ws.NewManager()
	connA := ws.NewConn(nil)
	require.NoError(t, mgr.Register(connA))
	mgr.SetAuth(connA.ID, "user-1", "desktop", "dev-a")

	cache := &mockAgentCache{routeID: connA.ID}
	svc := &AgentService{db: db, mgr: mgr, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-target-no-device",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		TargetID:          "target-no-device",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Run invalid target", "", "", nil)

	select {
	case <-connA.Send:
		t.Fatal("target task without edge device fell back to online desktop")
	default:
	}
	snapshot := cache.snapshot()
	require.Empty(t, snapshot.pushed)
	require.Empty(t, snapshot.pushedTarget)
}

func TestDispatchTaskDoesNotPushWhenDispatchedStateMissing(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	mgr := ws.NewManager()
	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-1", "desktop", "dev-a")

	cache := &mockAgentCache{routeID: conn.ID}
	svc := &AgentService{db: db, mgr: mgr, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "missing-dispatch-task",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Run missing task", "", "", nil)

	select {
	case <-conn.Send:
		t.Fatal("dispatch was pushed before task dispatch state was persisted")
	case <-time.After(100 * time.Millisecond):
	}
}

func TestDispatchTaskDoesNotPushTerminalTask(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, edge_device_id, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"task-cancelled-dispatch", "agent-1", "user-1", "msg-1", model.TaskStatusCancelled, "dev-a", "2030-01-01T00:00:00Z").Error)

	mgr := ws.NewManager()
	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-1", "desktop", "dev-a")

	cache := &mockAgentCache{routeID: conn.ID}
	svc := &AgentService{db: db, mgr: mgr, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-cancelled-dispatch",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Run cancelled task", "", "", nil)

	select {
	case <-conn.Send:
		t.Fatal("terminal task was pushed after cancellation")
	case <-time.After(100 * time.Millisecond):
	}
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, model.TaskStatusCancelled, stored.Status)
}

func TestDispatchTaskPreservesNonTargetTaskWhenDeliveryBufferFull(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, status, edge_device_id, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"task-dispatch-full", "agent-1", "user-1", "msg-1", model.TaskStatusQueued, "dev-a", "2030-01-01T00:00:00Z").Error)

	mgr := ws.NewManager()
	conn := ws.NewConn(nil)
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, "user-1", "desktop", "dev-a")
	for i := 0; i < cap(conn.Send); i++ {
		conn.Send <- []byte("already queued")
	}

	cache := &mockAgentCache{routeID: conn.ID}
	svc := &AgentService{db: db, mgr: mgr, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-dispatch-full",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Run on online desktop", "", "", nil)

	snapshot := cache.snapshot()
	require.Equal(t, "user-1", snapshot.pushedUser)
	require.Len(t, snapshot.pushed, 1)
	var payload dispatch.Payload
	require.NoError(t, json.Unmarshal([]byte(snapshot.pushed[0]), &payload))
	require.Equal(t, task.ID, payload.TaskID)
}

func TestDispatchTaskRoutesTargetBoundTaskToBoundDevice(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, target_id, status, edge_device_id, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-target", "agent-1", "user-1", "msg-1", "target-dev-b", model.TaskStatusQueued, "dev-b", "2030-01-01T00:00:00Z").Error)

	mgr := ws.NewManager()
	connA := ws.NewConn(nil)
	connB := ws.NewConn(nil)
	require.NoError(t, mgr.Register(connA))
	require.NoError(t, mgr.Register(connB))
	mgr.SetAuth(connA.ID, "user-1", "desktop", "dev-a")
	mgr.SetAuth(connB.ID, "user-1", "desktop", "dev-b")

	cache := &mockAgentCache{
		routeID: connA.ID,
		deviceRoutes: map[string]string{
			"user-1|desktop|dev-b": connB.ID,
		},
	}
	svc := &AgentService{db: db, mgr: mgr, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-target",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		TargetID:          "target-dev-b",
		EdgeDeviceID:      "dev-b",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Run on B", "", "", nil)

	select {
	case data := <-connB.Send:
		var frame struct {
			Type    string           `json:"type"`
			Payload dispatch.Payload `json:"payload"`
		}
		require.NoError(t, json.Unmarshal(data, &frame))
		require.Equal(t, ws.TypeAgentDispatch, frame.Type)
		require.Equal(t, "target-dev-b", frame.Payload.TargetID)
		require.Equal(t, "dev-b", frame.Payload.EdgeDeviceID)
	default:
		t.Fatal("target-bound dispatch was not sent to device B")
	}
	select {
	case <-connA.Send:
		t.Fatal("target-bound dispatch fell back to device A")
	default:
	}

	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", "task-target").First(&stored).Error)
	require.Equal(t, model.TaskStatusDispatched, stored.Status)
	require.Equal(t, "dev-b", stored.EdgeDeviceID)
	require.Empty(t, cache.snapshot().pushedTarget)
}

func TestDispatchTaskQueuesTargetBoundTaskWhenDeliveryBufferFull(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, target_id, status, edge_device_id, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-target-full", "agent-1", "user-1", "msg-1", "target-dev-b", model.TaskStatusQueued, "dev-b", "2030-01-01T00:00:00Z").Error)

	mgr := ws.NewManager()
	connB := ws.NewConn(nil)
	require.NoError(t, mgr.Register(connB))
	mgr.SetAuth(connB.ID, "user-1", "desktop", "dev-b")
	for i := 0; i < cap(connB.Send); i++ {
		connB.Send <- []byte("already queued")
	}

	cache := &mockAgentCache{
		deviceRoutes: map[string]string{
			"user-1|desktop|dev-b": connB.ID,
		},
	}
	svc := &AgentService{db: db, mgr: mgr, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-target-full",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		TargetID:          "target-dev-b",
		EdgeDeviceID:      "dev-b",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Run on B", "", "", nil)

	snapshot := cache.snapshot()
	require.Len(t, snapshot.pushedTarget, 1)
	require.Equal(t, "target-dev-b", snapshot.pushedTargetID)
	require.Equal(t, "dev-b", snapshot.pushedDeviceID)
}

func TestDispatchTaskDoesNotPushTargetWhenDispatchedStateMissing(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	mgr := ws.NewManager()
	connB := ws.NewConn(nil)
	require.NoError(t, mgr.Register(connB))
	mgr.SetAuth(connB.ID, "user-1", "desktop", "dev-b")

	cache := &mockAgentCache{
		deviceRoutes: map[string]string{
			"user-1|desktop|dev-b": connB.ID,
		},
	}
	svc := &AgentService{db: db, mgr: mgr, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "missing-target-dispatch-task",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		TargetID:          "target-dev-b",
		EdgeDeviceID:      "dev-b",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Run missing target task", "", "", nil)

	select {
	case <-connB.Send:
		t.Fatal("target dispatch was pushed before task dispatch state was persisted")
	case <-time.After(100 * time.Millisecond):
	}
}

func TestDispatchTaskDoesNotPushTerminalTargetTask(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, target_id, status, edge_device_id, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-cancelled-target", "agent-1", "user-1", "msg-1", "target-dev-b", model.TaskStatusCancelled, "dev-b", "2030-01-01T00:00:00Z").Error)

	mgr := ws.NewManager()
	connB := ws.NewConn(nil)
	require.NoError(t, mgr.Register(connB))
	mgr.SetAuth(connB.ID, "user-1", "desktop", "dev-b")

	cache := &mockAgentCache{
		deviceRoutes: map[string]string{
			"user-1|desktop|dev-b": connB.ID,
		},
	}
	svc := &AgentService{db: db, mgr: mgr, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-cancelled-target",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		TargetID:          "target-dev-b",
		EdgeDeviceID:      "dev-b",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Run cancelled target", "", "", nil)

	select {
	case <-connB.Send:
		t.Fatal("terminal target task was pushed after cancellation")
	case <-time.After(100 * time.Millisecond):
	}
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, model.TaskStatusCancelled, stored.Status)
}

func TestDispatchTaskQueuesTargetBoundTaskWhenBoundDeviceOffline(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	mgr := ws.NewManager()
	connA := ws.NewConn(nil)
	require.NoError(t, mgr.Register(connA))
	mgr.SetAuth(connA.ID, "user-1", "desktop", "dev-a")

	cache := &mockAgentCache{routeID: connA.ID}
	svc := &AgentService{db: db, mgr: mgr, cacheClient: cache}
	task := &model.PendingAgentTask{
		ID:                "task-target-offline",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		TargetID:          "target-dev-b",
		EdgeDeviceID:      "dev-b",
	}
	agent := &model.AgentInstance{
		ID:            "agent-1",
		AgentType:     "codex",
		SessionID:     "sess-1",
		InviterUserID: "user-1",
		DisplayName:   "Codex",
	}

	svc.dispatchService().DispatchTask(context.Background(), task, agent, "Run on offline B", "", "", nil)

	select {
	case <-connA.Send:
		t.Fatal("target-bound dispatch fell back to online device A")
	default:
	}
	snapshot := cache.snapshot()
	require.Empty(t, snapshot.pushed)
	require.Len(t, snapshot.pushedTarget, 1)
	require.Equal(t, "target-dev-b", snapshot.pushedTargetID)
	require.Equal(t, "dev-b", snapshot.pushedDeviceID)
}

func TestMergeModelParamsLetsDispatchOverrideProfileDefaults(t *testing.T) {
	merged := dispatch.MergeModelParams(
		`{"model":"claude-sonnet-4-6","reasoning_effort":"medium","permission_mode":"default"}`,
		`{"reasoning_effort":"high","work_dir":"D:\\Projects\\ExampleAgentHub"}`,
	)

	var got map[string]any
	require.NoError(t, json.Unmarshal([]byte(merged), &got))
	require.Equal(t, "claude-sonnet-4-6", got["model"])
	require.Equal(t, "high", got["reasoning_effort"])
	require.Equal(t, "default", got["permission_mode"])
	require.Equal(t, `D:\Projects\ExampleAgentHub`, got["work_dir"])
}

func TestSelectAgentInstanceHonorsRequestedRuntime(t *testing.T) {
	agents := []model.AgentInstance{
		{ID: "agent-claude", AgentType: "claude-code"},
		{ID: "agent-codex", AgentType: "codex"},
		{ID: "agent-opencode", AgentType: "opencode"},
	}

	selected, err := dispatch.SelectAgentInstance(agents, "", "codex", "")

	require.NoError(t, err)
	require.Equal(t, "agent-codex", selected.ID)
}

func TestSelectAgentInstanceRejectsMissingRequestedRuntime(t *testing.T) {
	agents := []model.AgentInstance{
		{ID: "agent-claude", AgentType: "claude-code"},
	}

	_, err := dispatch.SelectAgentInstance(agents, "", "opencode", "")

	require.ErrorIs(t, err, errcode.AgentNotFound)
}

// ==================== CancelTask ====================

func TestCancelTask_AtomicFailClosed(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	svc := &AgentService{db: db, bus: b}

	taskID := "task-cancel-atomic"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.CancelTask(context.Background(), "user-1", taskID)
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestCancelTask_AlreadyTerminal(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	svc := &AgentService{db: db, bus: b}

	taskID := "task-done"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDone))

	err := svc.CancelTask(context.Background(), "user-1", taskID)
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== HandleTaskAck ====================

func TestHandleTaskAck_DispatchedToRunningAtomic(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-ack"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDispatched, "dev-1", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-001")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_AlreadyRunningIdempotent(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-already-running"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	// Already running with edgeRunID set → idempotent, no DB update needed.
	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-001")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_OfflineQueuedUnboundDeviceClaim(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-offline-unbound"
	// #99 offline-replay task: queued, no edge device binding yet.
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued, "", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-001")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_OfflineQueuedUnboundRejectsWrongUser(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "taskx-offline-wrong-user"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued, "", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	err := svc.HandleTaskAck(context.Background(), "user-2", "dev-1", taskID, "run-001")
	require.Error(t, err)
	var taskErr *errcode.Error
	require.True(t, errors.As(err, &taskErr))
	require.Equal(t, errcode.AgentTaskNotFound.Code, taskErr.Code)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_EdgeRunIDBackfill(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-backfill"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(`UPDATE "pending_agent_tasks" SET "edge_run_id"`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-002")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_EdgeRunIDBackfillConflictAcceptsSameRunID(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-backfill-same-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(`UPDATE "pending_agent_tasks" SET "edge_run_id"`).
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-002"))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-002")
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_EdgeRunIDBackfillConflictRejectsMismatch(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-backfill-mismatch-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(`UPDATE "pending_agent_tasks" SET "edge_run_id"`).
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-other"))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-002")
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAckRejectsOversizedEdgeRunID(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", "task-ack", strings.Repeat("x", 129))
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskStream_DispatchedTransitionConflictDoesNotPersist(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	streamEvents := make(chan bus.Event, 1)
	b.Subscribe(ws.TypeAgentStream, func(ctx context.Context, event bus.Event) {
		streamEvents <- event
	})
	svc := &AgentService{db: db, bus: b, cacheClient: &mockAgentCache{}}

	taskID := "task-stream-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDispatched, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "codex", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDone, "dev-1", "run-001"))

	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", taskID, "run-001", model.AgentRunEventInput{
		Payload: json.RawMessage(`{"type":"run.output.batch","content":"hello"}`),
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	select {
	case <-streamEvents:
		t.Fatal("agent.stream was published after dispatched transition conflict")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

// ==================== HandleTaskDone ====================

func TestHandleTaskDone_AtomicTransition(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	svc := &AgentService{db: db, bus: b}

	taskID := "task-done-atomic"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectBegin()
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskDone_AtomicConflictDoesNotPublish(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	doneEvents := make(chan bus.Event, 1)
	b.Subscribe("agent.done", func(ctx context.Context, event bus.Event) {
		doneEvents <- event
	})
	svc := &AgentService{db: db, bus: b}

	taskID := "task-done-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectBegin()
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "")
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	select {
	case <-doneEvents:
		t.Fatal("agent.done was published after atomic update conflict")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

// ==================== HandleTaskFail ====================

func TestHandleTaskFail_AtomicTransition(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	svc := &AgentService{db: db, bus: b}

	taskID := "task-fail-atomic"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", taskID, "run-001", "model error")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskFail_AtomicConflictDoesNotPublish(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	failedEvents := make(chan bus.Event, 1)
	b.Subscribe("agent.failed", func(ctx context.Context, event bus.Event) {
		failedEvents <- event
	})
	svc := &AgentService{db: db, bus: b}

	taskID := "task-fail-conflict"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 0))

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", taskID, "run-001", "model error")
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	select {
	case <-failedEvents:
		t.Fatal("agent.failed was published after atomic update conflict")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskFail_AlreadyTerminal(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-already-done"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDone, "dev-1", "run-001"))

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", taskID, "run-001", "error")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== #109: lifecycle enforcement ====================

func TestHandleTaskDone_RejectsQueuedTask(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-queued"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued, "dev-1", "run-001"))

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "final")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskFail_RejectsQueuedTask(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-queued-fail"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued, "dev-1", "run-001"))

	err := svc.HandleTaskFail(context.Background(), "user-1", "dev-1", taskID, "run-001", "error")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskDone_AcceptsDispatchedTask(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	svc := &AgentService{db: db, bus: b}

	taskID := "task-dispatched-done"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusDispatched, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	mock.ExpectBegin()
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== #99: offline-replayed tasks ====================

func TestHandleTaskAck_QueuedToRunning(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	svc := &AgentService{db: db}

	taskID := "task-queued-ack"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusQueued, "dev-1", ""))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	// queued → running (offline-replayed task)
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", taskID, "run-001")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskAck_QueuedOfflineReplayTransitionsToRunning(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	task := &model.PendingAgentTask{
		ID:                "task-queued-ack-real",
		AgentInstanceID:   "agent-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		Status:            model.TaskStatusQueued,
		EdgeDeviceID:      "dev-1",
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(task).Error)
	svc := &AgentService{db: db}

	err := svc.HandleTaskAck(context.Background(), "user-1", "dev-1", task.ID, "run-queued")

	require.NoError(t, err)
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, model.TaskStatusRunning, stored.Status)
	require.Equal(t, "run-queued", stored.EdgeRunID)
}

func TestTimeoutExpiredTaskMarksScannedStatus(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	task := &model.PendingAgentTask{
		ID:                "task-timeout-running",
		AgentInstanceID:   "agent-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		Status:            model.TaskStatusRunning,
		EdgeDeviceID:      "dev-1",
		EdgeRunID:         "run-1",
		ExpireAt:          time.Now().Add(-time.Hour),
	}
	require.NoError(t, db.Create(task).Error)
	svc := &AgentService{db: db}

	timedOut, err := svc.TimeoutExpiredTask(task.ID, model.TaskStatusRunning)

	require.NoError(t, err)
	require.True(t, timedOut)
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, model.TaskStatusTimeout, stored.Status)
	require.NotNil(t, stored.FinishedAt)
}

func TestTimeoutExpiredTaskDoesNotOverwriteTerminalRace(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	task := &model.PendingAgentTask{
		ID:                "task-timeout-race",
		AgentInstanceID:   "agent-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-1",
		Status:            model.TaskStatusRunning,
		EdgeDeviceID:      "dev-1",
		EdgeRunID:         "run-1",
		ExpireAt:          time.Now().Add(-time.Hour),
	}
	require.NoError(t, db.Create(task).Error)
	finishedAt := time.Now()
	require.NoError(t, db.Model(&model.PendingAgentTask{}).
		Where("id = ?", task.ID).
		Updates(map[string]interface{}{"status": model.TaskStatusDone, "finished_at": &finishedAt}).Error)
	svc := &AgentService{db: db}

	timedOut, err := svc.TimeoutExpiredTask(task.ID, model.TaskStatusRunning)

	require.NoError(t, err)
	require.False(t, timedOut)
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, model.TaskStatusDone, stored.Status)
	require.NotNil(t, stored.FinishedAt)
}

// ==================== B5: #116 reject agent tasks for dissolved sessions ====================

func TestTriggerAgentTask_RejectsDissolvedSession(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	triggerMsgID := "trigger-msg-dissolved"

	// GetMessageByID
	mock.ExpectQuery(`FROM "messages" WHERE id =`).
		WithArgs(triggerMsgID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "sender_type", "sender_id", "content_type", "content", "seq_id", "client_msg_id"}).
			AddRow(triggerMsgID, "session-dissolved", "user", "user-1", "text", `{"text":"hello"}`, int64(1), "client-1"))

	// GetSessionByID returns dissolved session
	mock.ExpectQuery(`FROM "sessions" WHERE id =`).
		WithArgs("session-dissolved", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("session-dissolved", "group", true, "owner-1"))

	svc := &AgentService{db: db}
	_, err := svc.TriggerAgentTask(context.Background(), "user-1", triggerMsgID, "", "", "", "", "")
	require.ErrorIs(t, err, errcode.SessionDissolved)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestTriggerAgentTask_MemberActiveLookupErrorSurfaces pins the honest error
// path for the membership gate: a session_members lookup failure must surface
// as an error to the caller instead of being misread as "not a member"
// (previously `active, _ :=` collapsed DB faults into SessionNotMember).
func TestTriggerAgentTask_MemberActiveLookupErrorSurfaces(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	triggerMsgID := "trigger-msg-member-err"
	memberCheckErr := fmt.Errorf("session_members lookup failed")

	// GetMessageByID
	mock.ExpectQuery(`FROM "messages" WHERE id =`).
		WithArgs(triggerMsgID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "sender_type", "sender_id", "content_type", "content", "seq_id", "client_msg_id"}).
			AddRow(triggerMsgID, "session-live", "user", "user-1", "text", `{"text":"hello"}`, int64(1), "client-1"))

	// GetSessionByID returns a live group session
	mock.ExpectQuery(`FROM "sessions" WHERE id =`).
		WithArgs("session-live", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("session-live", "group", false, "owner-1"))

	// ListAgentInstancesByInviter returns one agent so selection succeeds
	mock.ExpectQuery(`FROM "agent_instances" WHERE session_id =`).
		WithArgs("session-live", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id", "display_name"}).
			AddRow("agent-1", "claude-code", "session-live", "user-1", "Agent One"))

	// IsMemberActive fails at the DB layer
	mock.ExpectQuery(`FROM "session_members" WHERE session_id =`).
		WithArgs("session-live", "user", "user-1").
		WillReturnError(memberCheckErr)

	svc := &AgentService{db: db}
	_, err := svc.TriggerAgentTask(context.Background(), "user-1", triggerMsgID, "", "", "", "", "")
	require.ErrorIs(t, err, memberCheckErr)
	require.NotErrorIs(t, err, errcode.SessionNotMember)
	// No further queries: the task must not be created after a failed member check.
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestTriggerAgentTaskRejectsTargetOwnedByAnotherUser(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	svc := &AgentService{db: db, cacheClient: &mockAgentCache{}}

	_, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-other")

	require.ErrorIs(t, err, errcode.TargetNotFound)
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
	require.Equal(t, int64(0), count)
}

func TestTriggerAgentTaskRejectsTargetWithoutBoundDevice(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, name, target_type, workspace_allowlist, trust_level, health_state, is_online, last_seen_at, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-no-device", "user-1", "Local workstation", "local_edge", `["/workspace"]`, "local", "online", true, time.Now(), "{}", "{}").Error)
	svc := &AgentService{db: db, cacheClient: &mockAgentCache{}}

	_, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-no-device")

	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
	require.Equal(t, int64(0), count)
}

func TestTriggerAgentTaskRejectsNonLocalEdgeTarget(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO devices (id, user_id, device_type, app_version, capabilities, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"dev-remote", "user-1", "desktop", "0.1.0", "[]", "2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z").Error)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, device_id, name, target_type, workspace_allowlist, trust_level, health_state, is_online, last_seen_at, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-remote", "user-1", "dev-remote", "Remote SSH target", "remote_ssh", `["/workspace"]`, "remote", "online", true, time.Now(), "{}", "{}").Error)
	svc := &AgentService{db: db, cacheClient: &mockAgentCache{}}

	_, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-remote")

	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
	require.Equal(t, int64(0), count)
}

func TestTriggerAgentTaskStoresAndDispatchesOwnedTarget(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO devices (id, user_id, device_type, app_version, capabilities, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"dev-target", "user-1", "desktop", "0.1.0", "[]", "2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z").Error)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, device_id, name, target_type, workspace_allowlist, trust_level, health_state, is_online, last_seen_at, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-local", "user-1", "dev-target", "Local workstation", "local_edge", `["/workspace"]`, "local", "online", true, time.Now(), "{}", "{}").Error)
	seedEvidenceForTarget(t, db, "target-local", "online", -time.Minute, dispatch.DesktopTargetStaleAfter)
	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}

	task, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-local")

	require.NoError(t, err)
	require.Equal(t, "target-local", task.TargetID)
	require.Equal(t, "dev-target", task.EdgeDeviceID)
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, "target-local", stored.TargetID)
	require.Equal(t, "dev-target", stored.EdgeDeviceID)
	require.Eventually(t, func() bool {
		return len(cache.snapshot().pushedTarget) == 1
	}, time.Second, 10*time.Millisecond)
	snapshot := cache.snapshot()
	var payload dispatch.Payload
	require.NoError(t, json.Unmarshal([]byte(snapshot.pushedTarget[0]), &payload))
	require.Equal(t, "target-local", payload.TargetID)
	require.Equal(t, "dev-target", payload.EdgeDeviceID)
}

func TestTriggerAgentTaskPrebindsOwnedTargetDevice(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO devices (id, user_id, device_type, app_version, capabilities, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"dev-local", "user-1", "desktop", "0.1.0", "[]", "2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z").Error)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, device_id, name, target_type, workspace_allowlist, trust_level, health_state, is_online, last_seen_at, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-local-device", "user-1", "dev-local", "Local workstation", "local_edge", `["/workspace"]`, "local", "online", true, time.Now(), "{}", "{}").Error)
	seedEvidenceForTarget(t, db, "target-local-device", "online", -time.Minute, dispatch.DesktopTargetStaleAfter)
	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}

	task, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-local-device")

	require.NoError(t, err)
	require.Equal(t, "target-local-device", task.TargetID)
	require.Equal(t, "dev-local", task.EdgeDeviceID)
	var stored model.PendingAgentTask
	require.NoError(t, db.Where("id = ?", task.ID).First(&stored).Error)
	require.Equal(t, "dev-local", stored.EdgeDeviceID)
}

func TestTriggerAgentTaskRejectsStaleTargetHealth(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO devices (id, user_id, device_type, app_version, capabilities, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"dev-stale", "user-1", "desktop", "0.1.0", "[]", "2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z").Error)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, device_id, name, target_type, workspace_allowlist, trust_level, health_state, is_online, last_seen_at, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-stale", "user-1", "dev-stale", "Stale workstation", "local_edge", `["/workspace"]`, "local", "online", true, time.Now().Add(-dispatch.DesktopTargetStaleAfter-time.Second), "{}", "{}").Error)
	// 证据窗口已过期 → 投影 stale → 调度拒绝。
	seedEvidenceForTarget(t, db, "target-stale", "online", -3*time.Minute, -time.Minute)
	svc := &AgentService{db: db, cacheClient: &mockAgentCache{}}

	_, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-stale")

	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
	require.Equal(t, int64(0), count)
}

func TestTriggerAgentTaskRejectsMismatchTargetHealth(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO devices (id, user_id, device_type, app_version, capabilities, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"dev-mismatch", "user-1", "desktop", "0.1.0", "[]", "2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z").Error)
	require.NoError(t, db.Exec(`INSERT INTO execution_targets (id, owner_id, device_id, name, target_type, workspace_allowlist, trust_level, health_state, is_online, last_seen_at, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"target-mismatch", "user-1", "dev-mismatch", "Mismatched workstation", "local_edge", `["/workspace"]`, "local", "mismatch", false, time.Now(), "{}", "{}").Error)
	// observed identity mismatch 证据 → 投影 mismatch → 调度拒绝。
	seedEvidenceForTarget(t, db, "target-mismatch", "mismatch", -time.Minute, dispatch.DesktopTargetStaleAfter)
	svc := &AgentService{db: db, cacheClient: &mockAgentCache{}}

	_, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "", "codex", "", "", "target-mismatch")

	require.ErrorIs(t, err, errcode.TargetNotRoutable)
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
	require.Equal(t, int64(0), count)
}

// seedEvidenceForTarget seeds a health evidence row for dispatch-contract
// tests (#1544): health validation reads evidence, not the legacy columns.
func seedEvidenceForTarget(t *testing.T, db *gorm.DB, targetID, status string, observedAgo, expiresIn time.Duration) {
	t.Helper()
	observed := time.Now().Add(observedAgo)
	expires := time.Now().Add(expiresIn)
	require.NoError(t, db.Exec(`INSERT INTO execution_target_evidence (id, target_id, source, status, observed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"ev-"+targetID, targetID, "registration", status, observed, expires).Error)
}

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

// ==================== B6: #1430 TurnInProgress per-agent_instance gate ====================

// TestTriggerAgentTaskTurnInProgressRejectsActiveTask seeds an active (queued)
// task for agent-1 and verifies a second trigger for the same agent_instance is
// rejected with errcode.TurnInProgress (HTTP 409). The already-persisted
// trigger message is not rolled back (SendMessage is independent — IM model).
func TestTriggerAgentTaskTurnInProgressRejectsActiveTask(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}

	// Pre-seed an active queued task so the gate fires without spawning a
	// dispatch goroutine for the first task.
	activeTask := &model.PendingAgentTask{
		AgentInstanceID:   "agent-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-active",
		Status:            model.TaskStatusQueued,
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(activeTask).Error)

	_, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "agent-1", "", "", "", "")

	require.ErrorIs(t, err, errcode.TurnInProgress)
	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Where("agent_instance_id = ?", "agent-1").Count(&count).Error)
	require.Equal(t, int64(1), count, "second trigger must not create a duplicate task")
}

// TestTriggerAgentTaskTurnInProgressDifferentAgentInstanceNotBlocked verifies
// that the gate is per agent_instance: an active task for agent-1 must not
// block a trigger for agent-2 in the same session.
func TestTriggerAgentTaskTurnInProgressDifferentAgentInstanceNotBlocked(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name) VALUES (?, ?, ?, ?, ?)`,
		"agent-2", "claude-code", "sess-1", "user-1", "Claude").Error)
	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}

	activeTask := &model.PendingAgentTask{
		AgentInstanceID:   "agent-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-active",
		Status:            model.TaskStatusQueued,
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(activeTask).Error)

	task, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "agent-2", "", "", "", "")

	require.NoError(t, err)
	require.Equal(t, "agent-2", task.AgentInstanceID)
	require.NotEqual(t, activeTask.ID, task.ID)

	var count int64
	require.NoError(t, db.Table("pending_agent_tasks").Count(&count).Error)
	require.Equal(t, int64(2), count, "agent-1 active + agent-2 new task")
}

// TestTriggerAgentTaskTurnInProgressTerminalTaskDoesNotBlock verifies that a
// terminal (done) task does not block a new trigger for the same agent_instance.
func TestTriggerAgentTaskTurnInProgressTerminalTaskDoesNotBlock(t *testing.T) {
	db := newAgentTaskTargetContractDB(t)
	cache := &mockAgentCache{}
	svc := &AgentService{db: db, cacheClient: cache}

	doneTask := &model.PendingAgentTask{
		AgentInstanceID:   "agent-1",
		TriggeredByUserID: "user-1",
		TriggerMessageID:  "msg-done",
		Status:            model.TaskStatusDone,
		ExpireAt:          time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(doneTask).Error)

	task, err := svc.TriggerAgentTask(context.Background(), "user-1", "msg-1", "agent-1", "", "", "", "")

	require.NoError(t, err)
	require.NotEqual(t, doneTask.ID, task.ID)
}

// ==================== #1408 done-final duplicate suppression ====================

func TestShouldSkipDoneFinalInsert_IdenticalLatestAgentMessage(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	mock.ExpectQuery(`FROM "messages"`).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content"}).
			AddRow("msg-9", "sess-1", int64(9), "cmid-9", model.SenderTypeAgent, "agent-1", "text", `{"content":"ANSWER"}`))

	got := shouldSkipDoneFinalInsert(db, "sess-1", "agent-1", "ANSWER")
	assert.True(t, got)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestShouldSkipDoneFinalInsert_PartialStreamDoesNotSuppress(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	mock.ExpectQuery(`FROM "messages"`).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content"}).
			AddRow("msg-9", "sess-1", int64(9), "cmid-9", model.SenderTypeAgent, "agent-1", "text", `{"content":"PARTIAL"}`))

	got := shouldSkipDoneFinalInsert(db, "sess-1", "agent-1", "PARTIAL ANSWER")
	assert.False(t, got)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestShouldSkipDoneFinalInsert_UserMessageAfterAgentDoesNotSuppress(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	mock.ExpectQuery(`FROM "messages"`).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content"}).
			AddRow("msg-9", "sess-1", int64(9), "cmid-9", model.SenderTypeUser, "user-1", "text", `{"text":"follow-up"}`))

	got := shouldSkipDoneFinalInsert(db, "sess-1", "agent-1", "follow-up")
	assert.False(t, got)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestShouldSkipDoneFinalInsert_NoMessages(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	mock.ExpectQuery(`FROM "messages"`).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content"}))

	got := shouldSkipDoneFinalInsert(db, "sess-1", "agent-1", "ANSWER")
	assert.False(t, got)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestShouldSkipDoneFinalInsert_EmptyFinalContent(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	// Empty final content short-circuits before any DB read.
	got := shouldSkipDoneFinalInsert(db, "sess-1", "agent-1", "")
	assert.False(t, got)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestUnwrapMessageContentText(t *testing.T) {
	assert.Equal(t, "plain answer", unwrapMessageContentText(`{"content":"plain answer"}`))
	assert.Equal(t, `{"text":"user text"}`, unwrapMessageContentText(`{"text":"user text"}`))
	assert.Equal(t, "not json at all", unwrapMessageContentText("not json at all"))
	assert.Equal(t, `{"content":""}`, unwrapMessageContentText(`{"content":""}`))
}

func TestHandleTaskDone_SkipsDuplicateFinalMessage(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	svc := &AgentService{db: db, bus: b}

	taskID := "task-done-dedup"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	// Latest agent message already carries the exact final text (stream path).
	mock.ExpectQuery(`FROM "messages"`).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content"}).
			AddRow("msg-9", "sess-1", int64(9), "cmid-9", model.SenderTypeAgent, "agent-1", "text", `{"content":"FINAL ANSWER"}`))

	// Transaction must contain only the status update — no message insert.
	mock.ExpectBegin()
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "FINAL ANSWER")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleTaskDone_InsertsDistinctFinalMessage(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	b := newTestBus(t)
	svc := &AgentService{db: db, bus: b}

	taskID := "task-done-distinct"
	mock.ExpectQuery(sqlmTaskByID).
		WithArgs(taskID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_instance_id", "triggered_by_user_id", "status", "edge_device_id", "edge_run_id"}).
			AddRow(taskID, "agent-1", "user-1", model.TaskStatusRunning, "dev-1", "run-001"))

	mock.ExpectQuery(sqlmAgentByID).
		WithArgs("agent-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id"}).
			AddRow("agent-1", "claude", "sess-1", "user-1"))

	// Latest agent message differs from the final content → insert proceeds.
	mock.ExpectQuery(`FROM "messages"`).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content"}).
			AddRow("msg-9", "sess-1", int64(9), "cmid-9", model.SenderTypeAgent, "agent-1", "text", `{"content":"partial"}`))

	// Message insert requires a seq allocation; Redis is absent so the
	// allocator falls back to the DB sequence bump in its own transaction.
	mock.ExpectBegin()
	mock.ExpectQuery(`UPDATE sessions SET next_seq`).
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(10))
	mock.ExpectCommit()

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO "messages"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(sqlmUpdateTask).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := svc.HandleTaskDone(context.Background(), "user-1", "dev-1", taskID, "run-001", "FINAL ANSWER")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== #1411 seq continuity recovery ====================

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

func TestAllocateSeqRecoversFreshRedisKeyFromDB(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	// Redis key freshly recreated (INCR returns 1) while sessions.next_seq
	// already mirrors a higher value: allocation must recover continuity
	// instead of returning a colliding seq.
	mock.ExpectQuery(`SELECT next_seq FROM sessions`).
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(7))

	cache := &seqRecoveryCache{}
	svc := &AgentService{db: db, cacheClient: cache}

	seq, err := svc.allocateSeq(context.Background(), "sess-1")
	require.NoError(t, err)
	require.Equal(t, int64(8), seq)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestAllocateSeqFreshRedisKeyWithoutDBMirrorKeepsOne(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	// Fresh key but the DB mirror is empty (new session): seq 1 is correct.
	mock.ExpectQuery(`SELECT next_seq FROM sessions`).
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(0))

	cache := &seqRecoveryCache{}
	svc := &AgentService{db: db, cacheClient: cache}

	seq, err := svc.allocateSeq(context.Background(), "sess-1")
	require.NoError(t, err)
	require.Equal(t, int64(1), seq)
	require.NoError(t, mock.ExpectationsWereMet())
}

// #1414: jsonb re-serialization (whitespace/key order) must not defeat the
// done-final dedup for JSON-shaped stream content.
func TestShouldSkipDoneFinalInsert_JSONCanonicalMatch(t *testing.T) {
	db, mock, sqlDB := newMockDBAgent(t)
	defer sqlDB.Close()

	mock.ExpectQuery(`FROM "messages"`).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content"}).
			AddRow("msg-9", "sess-1", int64(9), "cmid-9", model.SenderTypeAgent, "agent-1", "text", `{"summary":"42","action":"finish"}`))

	got := shouldSkipDoneFinalInsert(db, "sess-1", "agent-1", `{"action":"finish","summary":"42"}`)
	assert.True(t, got)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestCanonicalContent(t *testing.T) {
	assert.Equal(t, `{"action":"finish","summary":"42"}`, canonicalContent(`{"summary":"42",  "action": "finish"}`))
	assert.Equal(t, "plain text", canonicalContent("plain text"))
	// The projection wrapper {"content": X} unwraps to X.
	assert.Equal(t, "x", canonicalContent(`{"content":"x"}`))
}
