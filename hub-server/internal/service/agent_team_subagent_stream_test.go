package service

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/testkit"
	"github.com/agenthub/hub-server/internal/ws"
)

// newSubagentStreamTestDB builds an in-memory sqlite DB with the tables
// HandleTaskStream + team-run ownership lookup need. Mirrors the schema in
// agent_run_event_test.go plus agent_team_assignments / agent_team_tasks so
// dbTeamRunLookup can resolve RunID → assignment/team_task/member.
func newSubagentStreamTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	now := time.Now()
	ddl := []string{
		`CREATE TABLE sessions (id TEXT PRIMARY KEY, type TEXT NOT NULL, workspace_id TEXT, next_seq INTEGER NOT NULL DEFAULT 0, last_message_at DATETIME, dissolved BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME)`,
		`CREATE TABLE agent_instances (id TEXT PRIMARY KEY, agent_type TEXT NOT NULL, custom_agent_id TEXT, session_id TEXT NOT NULL, inviter_user_id TEXT NOT NULL, workspace_id TEXT, display_name TEXT NOT NULL, created_at DATETIME)`,
		`CREATE TABLE pending_agent_tasks (id TEXT PRIMARY KEY, agent_instance_id TEXT NOT NULL, triggered_by_user_id TEXT NOT NULL, trigger_message_id TEXT NOT NULL, target_id TEXT, status TEXT NOT NULL, edge_run_id TEXT, edge_device_id TEXT, error_message TEXT, created_at DATETIME, dispatched_at DATETIME, finished_at DATETIME, expire_at DATETIME NOT NULL)`,
		`CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, seq_id INTEGER NOT NULL, client_msg_id TEXT NOT NULL, sender_type TEXT NOT NULL, sender_id TEXT NOT NULL, content_type TEXT NOT NULL, content TEXT NOT NULL, reply_to_message_id TEXT, recalled BOOLEAN NOT NULL DEFAULT FALSE, edited BOOLEAN NOT NULL DEFAULT FALSE, edited_at DATETIME, created_at DATETIME)`,
		`CREATE UNIQUE INDEX idx_messages_session_client_msg ON messages (session_id, client_msg_id)`,
		`CREATE TABLE agent_run_events (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, edge_run_id TEXT, session_id TEXT NOT NULL, agent_instance_id TEXT NOT NULL, event_seq INTEGER NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at DATETIME)`,
		`CREATE TABLE agent_team_runs (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, session_id TEXT NOT NULL, trigger_user_id TEXT NOT NULL, trigger_message TEXT, target_id TEXT, mode TEXT NOT NULL DEFAULT 'supervisor', status TEXT NOT NULL, created_at DATETIME, updated_at DATETIME)`,
		`CREATE TABLE agent_team_assignments (id TEXT PRIMARY KEY, team_run_id TEXT NOT NULL, from_member_id TEXT NOT NULL, to_member_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'delegate', task_prompt TEXT NOT NULL, context TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', run_id TEXT, result TEXT DEFAULT '', depth INTEGER NOT NULL DEFAULT 0, created_at DATETIME, updated_at DATETIME)`,
		`CREATE TABLE agent_team_tasks (id TEXT PRIMARY KEY, team_run_id TEXT NOT NULL, assignment_id TEXT, assignee_member_id TEXT NOT NULL, parent_task_id TEXT, status TEXT NOT NULL DEFAULT 'pending', objective TEXT NOT NULL, input_refs TEXT NOT NULL DEFAULT '{}', run_id TEXT, attempt INTEGER NOT NULL DEFAULT 1, risk_level TEXT NOT NULL DEFAULT 'normal', created_at DATETIME, updated_at DATETIME)`,
	}
	for _, stmt := range ddl {
		require.NoError(t, db.Exec(stmt).Error)
	}
	require.NoError(t, db.Exec(`INSERT INTO sessions (id, type, next_seq, dissolved, created_at) VALUES (?, ?, ?, ?, ?)`, "sess-1", "group", 0, false, now).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`, "agent-1", "codex", "sess-1", "user-1", "Codex", now).Error)
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, target_id, status, edge_run_id, edge_device_id, created_at, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, "task-1", "agent-1", "user-1", "msg-1", "target-1", model.TaskStatusRunning, "run-1", "dev-1", now, now.Add(time.Hour)).Error)
	return db
}

// seedSubagentTeamRun inserts a team run + a dispatched assignment + team task
// bound to pending task "task-1", so dbTeamRunLookup resolves ownership.
func seedSubagentTeamRun(t *testing.T, db *gorm.DB, status string) {
	t.Helper()
	now := time.Now()
	require.NoError(t, db.Exec(`INSERT INTO agent_team_runs (id, team_id, session_id, trigger_user_id, trigger_message, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, "team-run-1", "team-1", "sess-1", "owner-1", "start", status, now, now).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_team_assignments (id, team_run_id, from_member_id, to_member_id, type, task_prompt, status, run_id, depth, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, "asg-1", "team-run-1", "member-1", "member-2", "delegate", "do thing", model.AssignmentStatusRunning, "task-1", 0, now, now).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_team_tasks (id, team_run_id, assignment_id, assignee_member_id, status, objective, input_refs, run_id, attempt, risk_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, "tt-1", "team-run-1", "asg-1", "member-2", model.TeamTaskStatusRunning, "objective", "{}", "task-1", 1, "normal", now, now).Error)
}

func TestTeamRunContextCache_PutGetInvalidate(t *testing.T) {
	c := newTeamRunContextCache(2)
	c.put("t1", teamRunContext{teamRunID: "r1"})
	c.put("t2", teamRunContext{teamRunID: "r2"})

	got, ok := c.get("t1")
	require.True(t, ok)
	require.Equal(t, "r1", got.teamRunID)

	// Evict LRU (t1 was accessed, so t2 is LRU). Put t3 -> evicts t2.
	c.put("t3", teamRunContext{teamRunID: "r3"})
	_, ok = c.get("t2")
	require.False(t, ok, "t2 should have been evicted as LRU")
	_, ok = c.get("t3")
	require.True(t, ok)

	// Invalidate removes explicitly.
	c.invalidate("t3")
	_, ok = c.get("t3")
	require.False(t, ok)
}

func TestTeamRunContextCache_UpdateExistingMovesToFront(t *testing.T) {
	c := newTeamRunContextCache(2)
	c.put("t1", teamRunContext{teamRunID: "r1"})
	c.put("t2", teamRunContext{teamRunID: "r2"})
	// Update t1 — it becomes MRU; t2 now LRU.
	c.put("t1", teamRunContext{teamRunID: "r1-updated"})
	c.put("t3", teamRunContext{teamRunID: "r3"})
	_, ok := c.get("t2")
	require.False(t, ok, "t2 should be evicted after t1 update + t3 insert")
	got, ok := c.get("t1")
	require.True(t, ok)
	require.Equal(t, "r1-updated", got.teamRunID)
}

func TestPublishTeamSubagentStream_NoTeamRun_NoEvent(t *testing.T) {
	db := newSubagentStreamTestDB(t)
	b := newTestBus(t)
	var got atomic.Bool
	b.Subscribe(bus.EventTypeTeamSubagentStream, func(ctx context.Context, e bus.Event) {
		got.Store(true)
	})

	svc := &EdgeCallbackService{db: db, bus: b}
	svc.publishTeamSubagentStream(context.Background(), &model.AgentRunEvent{
		TaskID: "task-1", SessionID: "sess-1", AgentInstanceID: "agent-1",
		EventType: "run.agent.text_delta", Payload: "{}",
	}, "task-1")

	testkit.Eventually(t, 3*time.Second, func() bool {
		return b.Running() == 0 && b.Pending() == 0
	}, "bus did not drain", nil)
	require.False(t, got.Load(), "no team.subagent.stream event when session has no team run")
}

func TestPublishTeamSubagentStream_TeamRun_PublishesOwnership(t *testing.T) {
	db := newSubagentStreamTestDB(t)
	seedSubagentTeamRun(t, db, model.TeamRunStatusRunning)
	b := newTestBus(t)
	events := make(chan TeamSubagentStreamPayload, 1)
	b.Subscribe(bus.EventTypeTeamSubagentStream, func(ctx context.Context, e bus.Event) {
		if p, ok := e.Payload.(TeamSubagentStreamPayload); ok {
			events <- p
		}
	})

	svc := &EdgeCallbackService{db: db, bus: b}
	svc.publishTeamSubagentStream(context.Background(), &model.AgentRunEvent{
		TaskID:          "task-1",
		SessionID:       "sess-1",
		AgentInstanceID: "agent-1",
		EdgeRunID:       "run-1",
		EventSeq:        7,
		EventType:       "run.agent.text_delta",
		Payload:         `{"text":"hi"}`,
	}, "task-1")

	select {
	case p := <-events:
		require.Equal(t, "team-run-1", p.TeamRunID)
		require.Equal(t, "team-1", p.TeamID)
		require.Equal(t, "sess-1", p.SessionID)
		require.Equal(t, "asg-1", p.AssignmentID)
		require.Equal(t, "tt-1", p.TeamTaskID)
		require.Equal(t, "member-2", p.MemberID)
		require.Equal(t, "task-1", p.AgentTaskID)
		require.Equal(t, "agent-1", p.AgentInstanceID)
		require.Equal(t, int64(7), p.EventSeq)
		require.Equal(t, "run.agent.text_delta", p.EventType)
		require.JSONEq(t, `{"text":"hi"}`, string(p.Payload))
	case <-time.After(time.Second):
		t.Fatal("team.subagent.stream event was not published")
	}
}

func TestPublishTeamSubagentStream_UsesCacheOnSecondEvent(t *testing.T) {
	db := newSubagentStreamTestDB(t)
	seedSubagentTeamRun(t, db, model.TeamRunStatusRunning)
	b := newTestBus(t)
	var count atomic.Int32
	b.Subscribe(bus.EventTypeTeamSubagentStream, func(ctx context.Context, e bus.Event) {
		count.Add(1)
	})

	svc := &EdgeCallbackService{db: db, bus: b}
	// First event resolves via DB and populates the cache.
	svc.publishTeamSubagentStream(context.Background(), &model.AgentRunEvent{
		TaskID: "task-1", SessionID: "sess-1", AgentInstanceID: "agent-1",
		EventSeq: 1, EventType: "run.agent.text_delta", Payload: "{}",
	}, "task-1")
	testkit.Eventually(t, 3*time.Second, func() bool {
		return b.Running() == 0 && b.Pending() == 0
	}, "bus did not drain", nil)
	require.Equal(t, int32(1), count.Load())

	// Mutate the DB to "lose" the team run. A second event for the same task
	// must still publish from the cache (cache hit), proving no re-query.
	require.NoError(t, db.Exec(`DELETE FROM agent_team_assignments WHERE id = ?`, "asg-1").Error)
	require.NoError(t, db.Exec(`DELETE FROM agent_team_tasks WHERE id = ?`, "tt-1").Error)
	require.NoError(t, db.Exec(`DELETE FROM agent_team_runs WHERE id = ?`, "team-run-1").Error)

	svc.publishTeamSubagentStream(context.Background(), &model.AgentRunEvent{
		TaskID: "task-1", SessionID: "sess-1", AgentInstanceID: "agent-1",
		EventSeq: 2, EventType: "run.agent.text_delta", Payload: "{}",
	}, "task-1")
	testkit.Eventually(t, 3*time.Second, func() bool {
		return b.Running() == 0 && b.Pending() == 0
	}, "bus did not drain", nil)
	require.Equal(t, int32(2), count.Load(), "second event should publish from cache without DB")
}

func TestHandleTaskStream_PublishesBothAgentStreamAndTeamSubagentStream(t *testing.T) {
	db := newSubagentStreamTestDB(t)
	seedSubagentTeamRun(t, db, model.TeamRunStatusRunning)
	b := newTestBus(t)
	agentStream := make(chan *model.AgentRunEvent, 1)
	teamStream := make(chan TeamSubagentStreamPayload, 1)
	b.Subscribe(ws.TypeAgentStream, func(ctx context.Context, event bus.Event) {
		if p, ok := event.Payload.(*model.AgentRunEvent); ok {
			agentStream <- p
		}
	})
	b.Subscribe(bus.EventTypeTeamSubagentStream, func(ctx context.Context, event bus.Event) {
		if p, ok := event.Payload.(TeamSubagentStreamPayload); ok {
			teamStream <- p
		}
	})

	svc := &AgentService{db: db, bus: b, cacheClient: &mockAgentCache{}}
	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
		EventType:   "run.agent.tool_call",
		Payload:     json.RawMessage(`{"toolName":"read_file"}`),
		ClientMsgID: "22222222-2222-4222-8222-222222222222",
	})
	require.NoError(t, err)

	select {
	case <-agentStream:
	case <-time.After(time.Second):
		t.Fatal("agent.stream event was not published")
	}
	select {
	case p := <-teamStream:
		require.Equal(t, "team-run-1", p.TeamRunID)
		require.Equal(t, "asg-1", p.AssignmentID)
		require.Equal(t, "tt-1", p.TeamTaskID)
		require.Equal(t, "task-1", p.AgentTaskID)
	case <-time.After(time.Second):
		t.Fatal("team.subagent.stream event was not published alongside agent.stream")
	}
}

func TestHandleTaskStream_NonTeamRun_PublishesOnlyAgentStream(t *testing.T) {
	db := newSubagentStreamTestDB(t)
	// No team run seeded for sess-1.
	b := newTestBus(t)
	agentStream := make(chan *model.AgentRunEvent, 1)
	var teamGot atomic.Bool
	b.Subscribe(ws.TypeAgentStream, func(ctx context.Context, event bus.Event) {
		if p, ok := event.Payload.(*model.AgentRunEvent); ok {
			agentStream <- p
		}
	})
	b.Subscribe(bus.EventTypeTeamSubagentStream, func(ctx context.Context, event bus.Event) {
		teamGot.Store(true)
	})

	svc := &AgentService{db: db, bus: b, cacheClient: &mockAgentCache{}}
	err := svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1", model.AgentRunEventInput{
		EventType:   "run.agent.tool_call",
		Payload:     json.RawMessage(`{"toolName":"read_file"}`),
		ClientMsgID: "33333333-3333-4333-8333-333333333333",
	})
	require.NoError(t, err)

	select {
	case <-agentStream:
	case <-time.After(time.Second):
		t.Fatal("agent.stream event was not published")
	}
	testkit.Eventually(t, 3*time.Second, func() bool {
		return b.Running() == 0 && b.Pending() == 0
	}, "bus did not drain", nil)
	require.False(t, teamGot.Load(), "team.subagent.stream must not fire for non-team-run session")
}

// stubTeamRunLookup substitutes the DB-backed lookup in tests that want to
// assert the cache + publish path without touching gorm.
type stubTeamRunLookup struct {
	known map[string]teamRunContext
}

func (s *stubTeamRunLookup) lookupTeamRunContext(ctx context.Context, sessionID, taskID string) (teamRunContext, bool) {
	c, ok := s.known[taskID]
	return c, ok
}

func TestSubagentStreamLookup_IsInjectable(t *testing.T) {
	b := newTestBus(t)
	events := make(chan TeamSubagentStreamPayload, 1)
	b.Subscribe(bus.EventTypeTeamSubagentStream, func(ctx context.Context, e bus.Event) {
		if p, ok := e.Payload.(TeamSubagentStreamPayload); ok {
			events <- p
		}
	})
	svc := &EdgeCallbackService{db: nil, bus: b}
	svc.SetSubagentStreamLookup(&stubTeamRunLookup{known: map[string]teamRunContext{
		"task-9": {teamRunID: "run-9", teamID: "team-9", assignmentID: "asg-9", memberID: "mem-9"},
	}})
	svc.publishTeamSubagentStream(context.Background(), &model.AgentRunEvent{
		TaskID: "task-9", SessionID: "sess-9", AgentInstanceID: "agent-9",
		EventSeq: 3, EventType: "run.agent.thinking", Payload: "{}",
	}, "task-9")
	select {
	case p := <-events:
		require.Equal(t, "run-9", p.TeamRunID)
		require.Equal(t, "asg-9", p.AssignmentID)
	case <-time.After(time.Second):
		t.Fatal("injectable lookup should have produced an event")
	}
}
