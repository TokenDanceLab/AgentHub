package agent

import (
	"context"
	"encoding/json"
	"reflect"
	"strconv"
	"strings"
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
//
// The DDL column types mirror the gorm `type:` tags declared in the production
// model structs (hub-server/internal/model/*.go). The
// TestSubagentStreamTestDB_DDLMatchesProductionModels drift test asserts they
// stay in sync; when you change a model's gorm type tag, update the matching
// DDL line here in the same commit.
func newSubagentStreamTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	now := time.Now()
	ddl := subagentStreamTestDDL()
	for _, stmt := range ddl {
		require.NoError(t, db.Exec(stmt).Error)
	}
	require.NoError(t, db.Exec(`INSERT INTO sessions (id, type, next_seq, dissolved, created_at) VALUES (?, ?, ?, ?, ?)`, "sess-1", "group", 0, false, now).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`, "agent-1", "codex", "sess-1", "user-1", "Codex", now).Error)
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, target_id, status, edge_run_id, edge_device_id, created_at, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, "task-1", "agent-1", "user-1", "msg-1", "target-1", model.TaskStatusRunning, "run-1", "dev-1", now, now.Add(time.Hour)).Error)
	return db
}

// subagentStreamTestDDL returns the hand-written DDL for the subagent stream
// test schema. It is shared by newSubagentStreamTestDB and the drift test so
// both stay anchored to the same source.
func subagentStreamTestDDL() []string {
	return []string{
		`CREATE TABLE sessions (id uuid PRIMARY KEY, type varchar(16) NOT NULL, workspace_id uuid, next_seq INTEGER NOT NULL DEFAULT 0, last_message_at DATETIME, dissolved BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME)`,
		`CREATE TABLE agent_instances (id uuid PRIMARY KEY, agent_type varchar(64) NOT NULL, custom_agent_id uuid, session_id uuid NOT NULL, inviter_user_id uuid NOT NULL, workspace_id uuid, display_name varchar(64) NOT NULL, created_at DATETIME)`,
		`CREATE TABLE pending_agent_tasks (id uuid PRIMARY KEY, agent_instance_id uuid NOT NULL, triggered_by_user_id uuid NOT NULL, trigger_message_id uuid NOT NULL, target_id uuid, status varchar(16) NOT NULL, edge_run_id varchar(128), edge_device_id uuid, error_message text, model_params jsonb DEFAULT '{}', created_at DATETIME, dispatched_at DATETIME, finished_at DATETIME, expire_at DATETIME NOT NULL)`,
		`CREATE TABLE messages (id uuid PRIMARY KEY, session_id uuid NOT NULL, seq_id INTEGER NOT NULL, client_msg_id uuid NOT NULL, sender_type varchar(16) NOT NULL, sender_id uuid NOT NULL, content_type varchar(32) NOT NULL, content jsonb NOT NULL, reply_to_message_id uuid, recalled BOOLEAN NOT NULL DEFAULT FALSE, edited BOOLEAN NOT NULL DEFAULT FALSE, edited_at DATETIME, created_at DATETIME)`,
		`CREATE UNIQUE INDEX idx_messages_session_client_msg ON messages (session_id, client_msg_id)`,
		`CREATE TABLE agent_run_events (id uuid PRIMARY KEY, task_id uuid NOT NULL, edge_run_id varchar(128), session_id uuid NOT NULL, agent_instance_id uuid NOT NULL, event_seq INTEGER NOT NULL, event_type varchar(96) NOT NULL, payload jsonb NOT NULL, created_at DATETIME)`,
		`CREATE TABLE agent_team_runs (id uuid PRIMARY KEY, team_id uuid NOT NULL, session_id uuid NOT NULL, trigger_user_id uuid NOT NULL, trigger_message text, target_id uuid, mode varchar(20) NOT NULL DEFAULT 'supervisor', status varchar(20) NOT NULL DEFAULT 'queued', created_at DATETIME, updated_at DATETIME)`,
		`CREATE TABLE agent_team_assignments (id uuid PRIMARY KEY, team_run_id uuid NOT NULL, from_member_id uuid NOT NULL, to_member_id uuid NOT NULL, type varchar(20) NOT NULL DEFAULT 'delegate', task_prompt text NOT NULL, context text DEFAULT '', status varchar(20) NOT NULL DEFAULT 'pending', run_id uuid, result text DEFAULT '', depth INTEGER NOT NULL DEFAULT 0, created_at DATETIME, updated_at DATETIME)`,
		`CREATE TABLE agent_team_tasks (id uuid PRIMARY KEY, team_run_id uuid NOT NULL, assignment_id uuid, assignee_member_id uuid NOT NULL, parent_task_id uuid, status varchar(20) NOT NULL DEFAULT 'pending', objective text NOT NULL, input_refs jsonb NOT NULL DEFAULT '{}', run_id varchar(128), attempt INTEGER NOT NULL DEFAULT 1, risk_level varchar(20) NOT NULL DEFAULT 'normal', created_at DATETIME, updated_at DATETIME)`,
	}
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

	svc := &Service{db: db, bus: b, cacheClient: &mockAgentCache{}}
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

	svc := &Service{db: db, bus: b, cacheClient: &mockAgentCache{}}
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
	// transient makes every lookup report an inconclusive (query-error) result
	// so tests can assert a transient failure is never cached.
	transient bool
	// calls counts lookups that actually reached the port, which is how the
	// positive and negative cache assertions are made.
	calls atomic.Int32
}

func (s *stubTeamRunLookup) lookupTeamRunContext(ctx context.Context, sessionID, taskID string) (teamRunContext, teamRunLookupOutcome) {
	s.calls.Add(1)
	if s.transient {
		return teamRunContext{}, teamRunLookupTransient
	}
	c, ok := s.known[taskID]
	if !ok {
		return teamRunContext{}, teamRunLookupNoTeam
	}
	c.isTeam = true
	return c, teamRunLookupTeam
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

// TestSubagentStreamTestDB_DDLMatchesProductionModels is a fixture drift
// guard. It reflects over the production model structs (model/*.go), extracts
// every field with an explicit gorm `type:` tag, and asserts the hand-written
// DDL in subagentStreamTestDDL declares the same type for that column. This
// catches drift such as target_id TEXT in the test DDL while the model says
// `type:uuid`, which would mask type bugs that only surface against a real
// Postgres schema. Columns without an explicit model `type:` tag (e.g.
// created_at with only autoCreateTime) are skipped — gorm infers those and the
// DDL's DATETIME is acceptable for sqlite.
func TestSubagentStreamTestDB_DDLMatchesProductionModels(t *testing.T) {
	expected := map[string]map[string]string{
		"sessions":               gormTypeTags(reflect.TypeOf(model.Session{})),
		"agent_instances":        gormTypeTags(reflect.TypeOf(model.AgentInstance{})),
		"pending_agent_tasks":    gormTypeTags(reflect.TypeOf(model.PendingAgentTask{})),
		"messages":               gormTypeTags(reflect.TypeOf(model.Message{})),
		"agent_run_events":       gormTypeTags(reflect.TypeOf(model.AgentRunEvent{})),
		"agent_team_runs":        gormTypeTags(reflect.TypeOf(model.AgentTeamRun{})),
		"agent_team_assignments": gormTypeTags(reflect.TypeOf(model.AgentTeamAssignment{})),
		"agent_team_tasks":       gormTypeTags(reflect.TypeOf(model.AgentTeamTask{})),
	}

	for _, stmt := range subagentStreamTestDDL() {
		tableName, ddlCols, ok := parseCreateTableColumns(stmt)
		if !ok {
			continue // skip CREATE INDEX and other non-CREATE-TABLE statements
		}
		expCols, hasModel := expected[tableName]
		require.True(t, hasModel, "DDL table %q has no model mapping in drift test", tableName)
		for col, actualType := range ddlCols {
			expType, hasExp := expCols[col]
			if !hasExp {
				continue // column has no explicit model type tag; skip
			}
			require.Equal(t, canonicalType(expType), canonicalType(actualType),
				"table %q column %q: DDL type %q drifts from model gorm type %q — "+
					"update subagentStreamTestDDL to match the model tag",
				tableName, col, actualType, expType)
		}
	}
}

// gormTypeTags reflects over a struct and returns a map of column-name → gorm
// `type:` tag value for every field that declares one. Column names respect an
// explicit `column:` override; otherwise the Go field name is converted to
// snake_case (matching gorm's default NamingStrategy).
func gormTypeTags(structType reflect.Type) map[string]string {
	out := make(map[string]string)
	for i := 0; i < structType.NumField(); i++ {
		field := structType.Field(i)
		tag := field.Tag.Get("gorm")
		if tag == "" {
			continue
		}
		columnName := toSnakeCase(field.Name)
		var typeValue string
		for _, seg := range strings.Split(tag, ";") {
			seg = strings.TrimSpace(seg)
			switch {
			case strings.HasPrefix(seg, "column:"):
				columnName = strings.TrimPrefix(seg, "column:")
			case strings.HasPrefix(seg, "type:"):
				typeValue = strings.TrimPrefix(seg, "type:")
			}
		}
		if typeValue == "" {
			continue
		}
		out[strings.ToLower(columnName)] = typeValue
	}
	return out
}

// parseCreateTableColumns parses a `CREATE TABLE name (col type ..., ...)` DDL
// statement into a column-name → declared-type map. Returns ok=false for
// non-CREATE-TABLE statements (indexes, etc.) or malformed input.
func parseCreateTableColumns(stmt string) (tableName string, cols map[string]string, ok bool) {
	trimmed := strings.TrimSpace(stmt)
	lowerHead := strings.ToLower(trimmed)
	if !strings.HasPrefix(lowerHead, "create table ") {
		return "", nil, false
	}
	open := strings.Index(trimmed, "(")
	closeIdx := strings.LastIndex(trimmed, ")")
	if open == -1 || closeIdx == -1 || closeIdx < open {
		return "", nil, false
	}
	// "CREATE TABLE <name> (" — extract the table name token between the prefix
	// and the opening paren.
	headSegment := strings.TrimSpace(trimmed[len("create table"):open])
	tableName = strings.TrimSpace(headSegment)
	body := trimmed[open+1 : closeIdx]
	cols = make(map[string]string)
	for _, def := range strings.Split(body, ",") {
		def = strings.TrimSpace(def)
		if def == "" {
			continue
		}
		tokens := strings.Fields(def)
		if len(tokens) < 2 {
			continue
		}
		name := tokens[0]
		if isConstraintKeyword(name) {
			continue
		}
		cols[strings.ToLower(name)] = strings.ToLower(tokens[1])
	}
	return tableName, cols, true
}

// isConstraintKeyword reports whether a DDL token is a SQL constraint keyword
// (PRIMARY, NOT, DEFAULT, UNIQUE, FOREIGN, CONSTRAINT, CHECK, REFERENCES)
// rather than a column name. Our DDL uses lowercase column names, so any
// all-uppercase token inside a column-definition slot is a constraint keyword.
func isConstraintKeyword(token string) bool {
	switch strings.ToUpper(token) {
	case "PRIMARY", "NOT", "NULL", "DEFAULT", "UNIQUE", "FOREIGN", "KEY",
		"CONSTRAINT", "CHECK", "REFERENCES", "CREATE", "TABLE", "INDEX":
		return true
	}
	return false
}

// toSnakeCase converts a CamelCase Go identifier to the snake_case form gorm
// uses for default column names (e.g. AgentInstanceID → agent_instance_id,
// ID → id, TriggeredByUserID → triggered_by_user_id).
func toSnakeCase(name string) string {
	var b strings.Builder
	runes := []rune(name)
	for i, r := range runes {
		if !unicodeIsUpper(r) {
			b.WriteRune(r)
			continue
		}
		if i > 0 {
			prev := runes[i-1]
			if !unicodeIsUpper(prev) {
				b.WriteRune('_')
			} else if i+1 < len(runes) && !unicodeIsUpper(runes[i+1]) {
				b.WriteRune('_')
			}
		}
		b.WriteRune(unicodeToLower(r))
	}
	return b.String()
}

func unicodeIsUpper(r rune) bool { return r >= 'A' && r <= 'Z' }
func unicodeToLower(r rune) rune {
	if r >= 'A' && r <= 'Z' {
		return r + ('a' - 'A')
	}
	return r
}

// canonicalType collapses dialect-specific type names into a semantic
// category so the drift test treats sqlite and Postgres variants of the same
// logical type as equivalent. For example, a model tag `type:timestamptz`
// (Postgres) and the sqlite DDL `DATETIME` both map to "timestamp" because the
// sqlite driver requires DATETIME to scan into time.Time. Conversely, `uuid`
// vs `text` remain distinct so a real drift (TEXT where the model says uuid)
// is still caught.
func canonicalType(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	switch {
	case t == "uuid":
		return "uuid"
	case strings.HasPrefix(t, "varchar"):
		return "varchar"
	case t == "text":
		return "text"
	case t == "jsonb" || t == "json":
		return "json"
	case t == "timestamptz" || t == "datetime" || t == "timestamp" || strings.HasPrefix(t, "timestamp"):
		return "timestamp"
	case t == "boolean" || t == "bool":
		return "boolean"
	case strings.HasPrefix(t, "int"):
		return "integer"
	default:
		return t
	}
}

// ── Negative caching (#2154 P1-4) ─────────────────────────────────────────
//
// Non-team traffic is the majority of stream chunks, and before negative
// caching every chunk re-ran the team-run SELECT purely to get
// ErrRecordNotFound. These tests lock the three properties that make the
// negative entry safe: it short-circuits the lookup, it is bounded by the same
// LRU as positive entries, and an *inconclusive* lookup is never cached.

func TestCachedTeamRunContext_NegativeCachesDefinitiveNoTeam(t *testing.T) {
	lookup := &stubTeamRunLookup{known: map[string]teamRunContext{}}
	svc := &EdgeCallbackService{db: nil, bus: nil}
	svc.SetSubagentStreamLookup(lookup)

	for i := 0; i < 5; i++ {
		tctx, outcome := svc.cachedTeamRunContext(context.Background(), lookup, "sess-1", "task-neg")
		require.Equal(t, teamRunLookupNoTeam, outcome, "a non-team task must stay non-team")
		require.False(t, tctx.isTeam)
		require.Empty(t, tctx.teamRunID)
	}
	require.EqualValues(t, 1, lookup.calls.Load(),
		"a definitive negative must be cached: 5 chunks, 1 lookup (was 5 before #2154 P1-4)")
}

func TestCachedTeamRunContext_PositiveCacheStillWorks(t *testing.T) {
	lookup := &stubTeamRunLookup{known: map[string]teamRunContext{
		"task-pos": {teamRunID: "run-pos", teamID: "team-pos", assignmentID: "asg-pos"},
	}}
	svc := &EdgeCallbackService{}
	svc.SetSubagentStreamLookup(lookup)

	for i := 0; i < 3; i++ {
		tctx, outcome := svc.cachedTeamRunContext(context.Background(), lookup, "sess-1", "task-pos")
		require.Equal(t, teamRunLookupTeam, outcome)
		require.True(t, tctx.isTeam)
		require.Equal(t, "run-pos", tctx.teamRunID)
	}
	require.EqualValues(t, 1, lookup.calls.Load())
}

func TestCachedTeamRunContext_TransientLookupIsNeverCached(t *testing.T) {
	lookup := &stubTeamRunLookup{transient: true}
	svc := &EdgeCallbackService{}
	svc.SetSubagentStreamLookup(lookup)

	for i := 0; i < 3; i++ {
		tctx, outcome := svc.cachedTeamRunContext(context.Background(), lookup, "sess-1", "task-flaky")
		require.Equal(t, teamRunLookupTransient, outcome,
			"a query error must stay inconclusive so the next chunk retries")
		require.False(t, tctx.isTeam)
	}
	require.EqualValues(t, 3, lookup.calls.Load(),
		"caching a transient failure would disable team fan-out for the task's lifetime")
}

func TestCachedTeamRunContext_EmptyTaskIDIsNotCached(t *testing.T) {
	lookup := &stubTeamRunLookup{known: map[string]teamRunContext{}}
	svc := &EdgeCallbackService{}
	svc.SetSubagentStreamLookup(lookup)

	for i := 0; i < 3; i++ {
		_, outcome := svc.cachedTeamRunContext(context.Background(), lookup, "sess-1", "")
		require.Equal(t, teamRunLookupNoTeam, outcome)
	}
	require.EqualValues(t, 3, lookup.calls.Load(),
		"an empty task ID must not occupy (or be served from) a cache slot")
}

func TestTeamRunContextCache_NegativeEntriesShareTheSameBound(t *testing.T) {
	const max = 8
	c := newTeamRunContextCache(max)
	for i := 0; i < max*4; i++ {
		// Negative entries are the zero value with isTeam=false.
		c.put("task-"+strconv.Itoa(i), teamRunContext{})
	}
	require.LessOrEqual(t, c.len(), max,
		"negative entries must be bounded by the same LRU cap as positive ones")

	// The oldest entries are gone, the newest survive.
	_, ok := c.get("task-0")
	require.False(t, ok)
	got, ok := c.get("task-" + strconv.Itoa(max*4-1))
	require.True(t, ok)
	require.False(t, got.isTeam)
}

// TestPublishTeamSubagentStream_NegativeCacheSurvivesTeamRunAppearing is the
// DB-backed counterpart: the first chunk on a session with no team run caches
// the negative, and a later chunk does not re-query — proven by inserting the
// team run *after* the first chunk and observing that the fan-out still stays
// silent. Mirrors TestPublishTeamSubagentStream_UsesCacheOnSecondEvent, which
// proves the same property for the positive direction.
func TestPublishTeamSubagentStream_NegativeCacheSurvivesTeamRunAppearing(t *testing.T) {
	db := newSubagentStreamTestDB(t)
	b := newTestBus(t)
	var got atomic.Bool
	b.Subscribe(bus.EventTypeTeamSubagentStream, func(ctx context.Context, e bus.Event) {
		got.Store(true)
	})

	svc := &EdgeCallbackService{db: db, bus: b}
	runEvent := &model.AgentRunEvent{
		TaskID: "task-1", SessionID: "sess-1", AgentInstanceID: "agent-1",
		EventType: "run.agent.text_delta", Payload: "{}",
	}

	// Chunk 1: no team run → definitive negative, cached.
	svc.publishTeamSubagentStream(context.Background(), runEvent, "task-1")
	testkit.Eventually(t, 3*time.Second, func() bool {
		return b.Running() == 0 && b.Pending() == 0
	}, "bus did not drain", nil)
	require.False(t, got.Load())

	// A team run now exists for the session. A cached negative means chunk 2
	// still does not query, so nothing is published — the documented trade-off
	// (task IDs are never reused and the binding predates the first chunk).
	seedSubagentTeamRun(t, db, model.TeamRunStatusRunning)
	runEvent.EventSeq = 2
	svc.publishTeamSubagentStream(context.Background(), runEvent, "task-1")
	testkit.Eventually(t, 3*time.Second, func() bool {
		return b.Running() == 0 && b.Pending() == 0
	}, "bus did not drain", nil)
	require.False(t, got.Load(), "chunk 2 must be served from the negative cache without a re-query")

	// A *different* task on the same session is a different cache key, so it
	// resolves freshly and does fan out — the negative is per task, not global.
	var gotOther atomic.Bool
	b.Subscribe(bus.EventTypeTeamSubagentStream, func(ctx context.Context, e bus.Event) {
		gotOther.Store(true)
	})
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, target_id, status, edge_run_id, edge_device_id, created_at, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-2", "agent-1", "user-1", "msg-1", "target-1", model.TaskStatusRunning, "run-1", "dev-1", time.Now(), time.Now().Add(time.Hour)).Error)
	require.NoError(t, db.Exec(`UPDATE agent_team_assignments SET run_id = ? WHERE id = ?`, "task-2", "asg-1").Error)
	svc.publishTeamSubagentStream(context.Background(), &model.AgentRunEvent{
		TaskID: "task-2", SessionID: "sess-1", AgentInstanceID: "agent-1",
		EventType: "run.agent.text_delta", Payload: "{}",
	}, "task-2")
	testkit.Eventually(t, 3*time.Second, func() bool {
		return gotOther.Load()
	}, "a fresh task on the same session must resolve the now-present team run", nil)
}
