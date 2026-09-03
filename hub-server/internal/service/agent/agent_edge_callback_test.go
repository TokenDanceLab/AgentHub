package agent

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/pkg/testkit"
)

// ── Fixtures ──────────────────────────────────────────────────────────────

// sqlRecorder captures every statement gorm sends to the driver, which is how
// the round-trip reductions in #2154 P1-4 / P2-9 are asserted: the tests count
// statements per table/column instead of trusting a code reading.
type sqlRecorder struct {
	mu         sync.Mutex
	statements []string
}

func (r *sqlRecorder) LogMode(gormlogger.LogLevel) gormlogger.Interface { return r }
func (r *sqlRecorder) Info(context.Context, string, ...any)             {}
func (r *sqlRecorder) Warn(context.Context, string, ...any)             {}
func (r *sqlRecorder) Error(context.Context, string, ...any)            {}

func (r *sqlRecorder) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error) {
	statement, _ := fc()
	r.mu.Lock()
	defer r.mu.Unlock()
	r.statements = append(r.statements, statement)
}

// count returns how many recorded statements contain every one of substrings.
func (r *sqlRecorder) count(substrings ...string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, statement := range r.statements {
		if containsAll(statement, substrings) {
			n++
		}
	}
	return n
}

func (r *sqlRecorder) reset() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.statements = nil
}

func containsAll(haystack string, needles []string) bool {
	for _, needle := range needles {
		if !contains(haystack, needle) {
			return false
		}
	}
	return true
}

func contains(haystack, needle string) bool {
	return len(needle) == 0 || indexOf(haystack, needle) >= 0
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}

// newStreamPerfTestDB builds the subagent-stream sqlite fixture with a
// statement recorder attached, and seeds session/agent/task rows.
func newStreamPerfTestDB(t *testing.T) (*gorm.DB, *sqlRecorder) {
	t.Helper()
	rec := &sqlRecorder{}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: rec})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	// One connection: the fixture is a private in-memory DB.
	sqlDB.SetMaxOpenConns(1)
	now := time.Now()
	for _, stmt := range subagentStreamTestDDL() {
		require.NoError(t, db.Exec(stmt).Error)
	}
	require.NoError(t, db.Exec(`INSERT INTO sessions (id, type, next_seq, dissolved, created_at) VALUES (?, ?, ?, ?, ?)`, "sess-1", "group", 0, false, now).Error)
	require.NoError(t, db.Exec(`INSERT INTO agent_instances (id, agent_type, session_id, inviter_user_id, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`, "agent-1", "codex", "sess-1", "user-1", "Codex", now).Error)
	require.NoError(t, db.Exec(`INSERT INTO pending_agent_tasks (id, agent_instance_id, triggered_by_user_id, trigger_message_id, target_id, status, edge_run_id, edge_device_id, created_at, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-1", "agent-1", "user-1", "msg-1", "target-1", model.TaskStatusRunning, "run-1", "dev-1", now, now.Add(time.Hour)).Error)
	rec.reset() // fixture setup is not part of any assertion
	return db, rec
}

// fakeOutbox records auto-ack attempts and can be made to fail.
type fakeOutbox struct {
	calls  atomic.Int32
	err    error
	lastID atomic.Value // string
}

func (f *fakeOutbox) AutoAckDeliveriesForTask(_ context.Context, taskID string) error {
	f.calls.Add(1)
	f.lastID.Store(taskID)
	return f.err
}

// newStreamPerfService wires an EdgeCallbackService over the fixture with an
// injectable outbox and clock.
func newStreamPerfService(t *testing.T, db *gorm.DB, b *bus.Bus, outbox edgeCallbackOutbox, clock func() time.Time) *Service {
	t.Helper()
	svc := &Service{db: db, bus: b, cacheClient: &mockAgentCache{}}
	ecs := NewEdgeCallbackService(db, b, seqAllocatorFunc(svc.allocateSeq), outbox)
	ecs.clock = clock
	svc.edgeCallbacks = ecs
	return svc
}

func streamChunk(clientMsgID, payload string) model.AgentRunEventInput {
	return model.AgentRunEventInput{
		EventType:   "run.agent.text_delta",
		Payload:     []byte(payload),
		ClientMsgID: clientMsgID,
	}
}

// ── P1-4: per-chunk SELECT + Unmarshal ────────────────────────────────────

func TestPayloadHasActionKey(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		want    bool
	}{
		{"flat decision", `{"action":"delegate","next_worker":"m-2"}`, true},
		{"upper case key folds", `{"ACTION":"finish"}`, true},
		{"mixed case key folds", `{"Action":"review"}`, true},
		// An escaped "action" inside a *string value* is not a JSON key, and
		// encoding/json agrees: unmarshalling this into CoordinatorRouteDecision
		// leaves Action empty. Gate and unmarshal stay consistent.
		{"escaped key inside a string value", `{"content":"{\"action\":\"finish\"}"}`, false},
		{"key after other fields", `{"next_worker":"m-2","action":"review"}`, true},
		{"stream delta", `{"content":"hello"}`, false},
		{"edge text chunk", `{"runId":"r-1","content":"Hello"}`, false},
		{"empty", ``, false},
		{"empty object", `{}`, false},
		{"plural key is not the key", `{"actions":["a"]}`, false},
		{"word inside a string value", `{"content":"the word \"action\" appears"}`, false},
		// Interpreted string on purpose: a raw `{"action` followed by `, false`
		// would parse as a keyed struct element (key = the raw string).
		{"truncated", "{\"action", false},
		{"no quotes at all", `action`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, payloadHasActionKey(tt.payload))
		})
	}
}

// jsonUnmarshalForTest is a thin alias so the soundness test reads as a
// statement about encoding/json rather than about a helper.
func jsonUnmarshalForTest(payload string, out *model.CoordinatorRouteDecision) error {
	return json.Unmarshal([]byte(payload), out)
}

// TestPayloadHasActionKeyIsSoundAgainstUnmarshal is the property that makes the
// pre-filter a gate rather than a heuristic: whenever encoding/json can fill
// CoordinatorRouteDecision.Action, payloadHasActionKey must say true. Fuzzing
// the key casing/position space keeps the two in lockstep.
func TestPayloadHasActionKeyIsSoundAgainstUnmarshal(t *testing.T) {
	var decision model.CoordinatorRouteDecision
	for _, payload := range []string{
		`{"action":"delegate"}`, `{"ACTION":"delegate"}`, `{"Action":"delegate"}`,
		`{"aCtIoN":"delegate"}`, `{ "action" : "delegate" }`,
		`{"next_worker":"m","action":"finish"}`,
		`{"content":"x"}`, `{}`, `[]`, `null`, `{"actions":"x"}`, `{"action_x":"y"}`,
	} {
		decision = model.CoordinatorRouteDecision{}
		err := jsonUnmarshalForTest(payload, &decision)
		if err != nil {
			require.False(t, payloadHasActionKey(payload),
				"payload %q cannot parse, so the gate must not matter", payload)
			continue
		}
		if decision.Action != "" {
			require.True(t, payloadHasActionKey(payload),
				"payload %q filled Action=%q, so the gate must let it through", payload, decision.Action)
		}
	}
}

// TestHandleTaskStream_NonTeamSession_QueriesTeamRunOnceAcrossChunks is the
// P1-4 round-trip evidence: two consecutive chunks on a session with no team
// run must issue exactly ONE agent_team_runs SELECT in total (before the change
// each chunk issued two — one from the subagent-stream ownership lookup and one
// from the route-decision auto-parse — plus a guaranteed-futile Unmarshal).
func TestHandleTaskStream_NonTeamSession_QueriesTeamRunOnceAcrossChunks(t *testing.T) {
	db, rec := newStreamPerfTestDB(t)
	b := newTestBus(t)
	outbox := &fakeOutbox{}
	svc := newStreamPerfService(t, db, b, outbox, time.Now)

	for i, msgID := range []string{
		"aaaaaaaa-0000-4000-8000-000000000001",
		"aaaaaaaa-0000-4000-8000-000000000002",
	} {
		require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1",
			streamChunk(msgID, `{"content":"chunk"}`)), "chunk %d", i)
	}

	testkit.Eventually(t, 3*time.Second, func() bool {
		return b.Running() == 0 && b.Pending() == 0
	}, "bus did not drain", nil)

	require.Equal(t, 1, rec.count("agent_team_runs"),
		"the negative team-run verdict must be cached per task: 2 chunks, 1 SELECT (was 4)")
}

// TestHandleTaskStream_RouteDecisionStillPublishedForRunningTeamRun is the
// semantics guard for the gate: a supervisor decision payload on a running team
// run must still produce the agent.route_decision bus event, and — because the
// Edge callback client sends no event_type — the same must hold when the chunk
// arrives untyped and normalizes to run.output.batch.
func TestHandleTaskStream_RouteDecisionStillPublishedForRunningTeamRun(t *testing.T) {
	const decisionPayload = `{"action":"delegate","next_worker":"member-2","instructions":"Implement"}`

	tests := []struct {
		name      string
		eventType string
	}{
		{name: "explicit route_decision type", eventType: "run.agent.route_decision"},
		// Edge's TaskStream (edge-server/internal/hub/callback.go) posts only
		// `content`, so NormalizeRunEventInput falls back to run.output.batch.
		// This is the production shape the auto-parse exists for and the reason
		// run.output.batch must NOT be denied by an event-type gate.
		{name: "untyped edge chunk normalizes to run.output.batch", eventType: model.RunEventTypeOutputBatch},
		{name: "empty event type inferred as output batch", eventType: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, _ := newStreamPerfTestDB(t)
			seedSubagentTeamRun(t, db, model.TeamRunStatusRunning)
			b := newTestBus(t)
			decisions := make(chan RouteDecisionPayload, 1)
			b.Subscribe(bus.EventTypeAgentRouteDecision, func(_ context.Context, event bus.Event) {
				if payload, ok := event.Payload.(RouteDecisionPayload); ok {
					decisions <- payload
				}
			})
			svc := newStreamPerfService(t, db, b, &fakeOutbox{}, time.Now)

			require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1",
				model.AgentRunEventInput{EventType: tt.eventType, Payload: []byte(decisionPayload)}))

			select {
			case payload := <-decisions:
				require.Equal(t, "owner-1", payload.UserID)
				require.Equal(t, "team-1", payload.TeamID)
				require.Equal(t, "team-run-1", payload.RunID)
				require.Equal(t, "delegate", payload.Decision.Action)
			case <-time.After(5 * time.Second):
				t.Fatal("route decision was not published — the gate changed behavior")
			}
		})
	}
}

// TestHandleTaskStream_NonDecisionPayloadNeverReadsTeamRun proves the second
// half of P1-4 for team traffic: on a running team run, a chunk whose payload
// cannot carry a decision skips both the auto-parse's SELECT and its Unmarshal.
func TestHandleTaskStream_NonDecisionPayloadNeverReadsTeamRunForRouteParse(t *testing.T) {
	db, rec := newStreamPerfTestDB(t)
	seedSubagentTeamRun(t, db, model.TeamRunStatusRunning)
	rec.reset()
	b := newTestBus(t)
	svc := newStreamPerfService(t, db, b, &fakeOutbox{}, time.Now)

	require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1",
		streamChunk("bbbbbbbb-0000-4000-8000-000000000001", `{"content":"just text"}`)))

	testkit.Eventually(t, 3*time.Second, func() bool {
		return b.Running() == 0 && b.Pending() == 0
	}, "bus did not drain", nil)

	// The ownership lookup resolves the team run once (positive cache); the
	// route-decision auto-parse must not add a second read.
	require.Equal(t, 1, rec.count("agent_team_runs"),
		"a payload without an action key must not trigger the route-decision team-run read")
}

// ── P2-9: per-chunk writes ────────────────────────────────────────────────

func TestHandleTaskStream_AutoAcksOutboxOncePerTask(t *testing.T) {
	db, rec := newStreamPerfTestDB(t)
	b := newTestBus(t)
	outbox := &fakeOutbox{}
	svc := newStreamPerfService(t, db, b, outbox, time.Now)

	for i := 0; i < 4; i++ {
		require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1",
			streamChunk("cccccccc-0000-4000-8000-00000000000"+string(rune('1'+i)), `{"content":"x"}`)))
	}
	require.EqualValues(t, 1, outbox.calls.Load(),
		"the first authorized stream is the ack; later chunks must not repeat it")
	require.Equal(t, 0, rec.count("delivery_outbox"), "the fake outbox owns the write; no direct SQL")

	// The terminal callback still acks unconditionally so a late-created active
	// row (or a lost in-process entry after a restart) is picked up.
	require.NoError(t, svc.HandleTaskDone(context.Background(), "user-1", "dev-1", "task-1", "run-1", ""))
	require.EqualValues(t, 2, outbox.calls.Load(), "done must ack unconditionally")
}

func TestAutoAckOnce_RetriesAfterOutboxFailure(t *testing.T) {
	db, _ := newStreamPerfTestDB(t)
	b := newTestBus(t)
	outbox := &fakeOutbox{err: errors.New("store unavailable")}
	svc := newStreamPerfService(t, db, b, outbox, time.Now)

	require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1",
		streamChunk("dddddddd-0000-4000-8000-000000000001", `{"content":"x"}`)))
	require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1",
		streamChunk("dddddddd-0000-4000-8000-000000000002", `{"content":"y"}`)))
	require.EqualValues(t, 2, outbox.calls.Load(),
		"a failed ack must not be recorded, so the next chunk retries")

	outbox.err = nil
	require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1",
		streamChunk("dddddddd-0000-4000-8000-000000000003", `{"content":"z"}`)))
	require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1",
		streamChunk("dddddddd-0000-4000-8000-000000000004", `{"content":"w"}`)))
	require.EqualValues(t, 3, outbox.calls.Load(),
		"once the ack succeeds it is recorded and later chunks skip it")
}

func TestAckedTaskSet_IsBoundedAndFailOpen(t *testing.T) {
	set := newAckedTaskSet(4)
	for i := 0; i < 32; i++ {
		require.True(t, set.addIfAbsent("task-"+string(rune('a'+i%26))+string(rune('0'+i/26))))
	}
	require.LessOrEqual(t, set.len(), 4, "the dedupe set must be bounded")

	// Fail-open: an evicted key simply performs the ack again (idempotent).
	require.True(t, set.addIfAbsent("task-a0"), "an evicted task must be re-ackable")
	require.False(t, set.addIfAbsent("task-a0"), "the second call in a row is the dedupe")

	set.remove("task-a0")
	require.True(t, set.addIfAbsent("task-a0"), "terminal cleanup frees the slot")
	require.True(t, set.addIfAbsent(""), "an empty task ID is never deduped")
}

func TestHandleTaskStream_ThrottlesSessionTouchToOnePerSecond(t *testing.T) {
	db, rec := newStreamPerfTestDB(t)
	b := newTestBus(t)
	now := time.Now()
	svc := newStreamPerfService(t, db, b, &fakeOutbox{}, func() time.Time { return now })

	send := func(suffix string) {
		require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1",
			streamChunk("eeeeeeee-0000-4000-8000-00000000000"+suffix, `{"content":"x"}`)))
	}

	send("1")
	require.Equal(t, 1, rec.count(`UPDATE`, "sessions", "last_message_at"),
		"the first chunk of a session must touch last_message_at")

	// 20 more chunks inside the same second: no further touch.
	for i := 0; i < 20; i++ {
		now = now.Add(40 * time.Millisecond)
		send("2")
	}
	require.Equal(t, 1, rec.count(`UPDATE`, "sessions", "last_message_at"),
		"21 chunks inside one second must produce exactly one last_message_at write")

	// Crossing the one-second boundary allows the next touch.
	now = now.Add(time.Second)
	send("3")
	require.Equal(t, 2, rec.count(`UPDATE`, "sessions", "last_message_at"),
		"a chunk after the window must touch again")

	// The terminal callback is never throttled and clears the window, so the
	// settled last_message_at is exact.
	rec.reset()
	require.NoError(t, svc.HandleTaskDone(context.Background(), "user-1", "dev-1", "task-1", "run-1", "final"))
	require.Equal(t, 1, rec.count(`UPDATE`, "sessions", "last_message_at"),
		"done must touch unconditionally")
}

func TestSessionTouchThrottle_IsBoundedAndFailOpen(t *testing.T) {
	throttle := newSessionTouchThrottle(4, time.Second)
	now := time.Now()

	require.True(t, throttle.allow("sess-a", now))
	require.False(t, throttle.allow("sess-a", now.Add(500*time.Millisecond)))
	require.True(t, throttle.allow("sess-a", now.Add(time.Second)))

	for i := 0; i < 32; i++ {
		require.True(t, throttle.allow("sess-"+string(rune('a'+i%26))+string(rune('0'+i/26)), now))
	}
	require.LessOrEqual(t, throttle.len(), 4, "the throttle map must be bounded")

	// Fail-open: eviction lets the next touch through immediately.
	require.True(t, throttle.allow("sess-a", now.Add(10*time.Millisecond)))

	throttle.reset("sess-a")
	require.True(t, throttle.allow("sess-a", now.Add(11*time.Millisecond)),
		"reset clears the window so the terminal touch is never suppressed")
	require.True(t, throttle.allow("", now), "an empty session ID is never throttled")
}

func TestForgetTaskStreamState_ClearsBothStructures(t *testing.T) {
	db, _ := newStreamPerfTestDB(t)
	svc := newStreamPerfService(t, db, newTestBus(t), &fakeOutbox{}, time.Now)
	ecs := svc.edgeCallbacks

	ecs.ackedSet().addIfAbsent("task-1")
	ecs.touchThrottler().allow("sess-1", time.Now())
	require.Equal(t, 1, ecs.ackedSet().len())
	require.Equal(t, 1, ecs.touchThrottler().len())

	ecs.forgetTaskStreamState("task-1", "sess-1")
	require.Equal(t, 0, ecs.ackedSet().len())
	require.Equal(t, 0, ecs.touchThrottler().len())
}

// ── P2-9: heartbeat short-circuit ─────────────────────────────────────────

func TestHandleTaskStream_HeartbeatShortCircuitsInSQL(t *testing.T) {
	db, rec := newStreamPerfTestDB(t)
	// The fixture seeds expire_at = now+1h with status running. The first bump
	// must still land (it *lowers* the 24h-style dispatch deadline down to the
	// 10 min heartbeat TTL — the upper branch of the predicate).
	b := newTestBus(t)
	svc := newStreamPerfService(t, db, b, &fakeOutbox{}, time.Now)

	require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1",
		streamChunk("ffffffff-0000-4000-8000-000000000001", `{"content":"x"}`)))
	require.Equal(t, 1, rec.count(`UPDATE`, "pending_agent_tasks", "expire_at"),
		"the first heartbeat must narrow the dispatch deadline to the TTL")

	var afterFirst time.Time
	require.NoError(t, db.Raw(`SELECT expire_at FROM pending_agent_tasks WHERE id = ?`, "task-1").Scan(&afterFirst).Error)
	require.WithinDuration(t, time.Now().Add(config.RunningTaskHeartbeatTTL), afterFirst, time.Minute)

	// Subsequent chunks inside the skip window must not rewrite the row.
	for i := 0; i < 10; i++ {
		require.NoError(t, svc.HandleTaskStream(context.Background(), "user-1", "dev-1", "task-1", "run-1",
			streamChunk("ffffffff-0000-4000-8000-000000000001", `{"content":"x"}`)))
	}
	require.Equal(t, 1, rec.count(`UPDATE`, "pending_agent_tasks", "expire_at"),
		"10 more chunks must add no heartbeat UPDATE (SQL-level short-circuit)")

	var afterRepeat time.Time
	require.NoError(t, db.Raw(`SELECT expire_at FROM pending_agent_tasks WHERE id = ?`, "task-1").Scan(&afterRepeat).Error)
	require.True(t, afterRepeat.Equal(afterFirst), "expire_at must be untouched by a skipped bump")
}
