// DispatchTask composition tests: payload shape, target-bound routing,
// buffer-full fallback, terminal-state guards, and dispatch pre-flight
// helpers (MergeModelParams/SelectAgentInstance/PromptFromMessage). Mirrors
// agent_dispatch_facade.go + internal/service/dispatchsvc.

package agent

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"github.com/agenthub/hub-server/internal/ws"
)

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
	svc := &Service{db: db, cacheClient: cache}
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
	svc := &Service{db: db, cacheClient: cache}
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
	svc := &Service{db: db, cacheClient: cache}
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
	svc := &Service{db: db, cacheClient: cache}
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
	svc := &Service{db: db, cacheClient: cache}
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
	svc := &Service{db: db, cacheClient: cache}
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
	svc := &Service{db: db, mgr: mgr, cacheClient: cache}
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
	svc := &Service{db: db, mgr: mgr, cacheClient: cache}
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
	svc := &Service{db: db, mgr: mgr, cacheClient: cache}
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
	svc := &Service{db: db, mgr: mgr, cacheClient: cache}
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
	svc := &Service{db: db, mgr: mgr, cacheClient: cache}
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
	svc := &Service{db: db, mgr: mgr, cacheClient: cache}
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
	svc := &Service{db: db, mgr: mgr, cacheClient: cache}
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
	svc := &Service{db: db, mgr: mgr, cacheClient: cache}
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
	svc := &Service{db: db, mgr: mgr, cacheClient: cache}
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
