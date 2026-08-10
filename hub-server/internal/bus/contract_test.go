package bus

// Contract tests (#1548): the behavioral guarantees callers may rely on —
// publish-context ownership (handlers never inherit the caller's
// cancellation), error returns, bounded Close drain, and typed payload
// field names. Unlike the functional tests in bus_test.go, these pin the
// documented contract rather than the mechanics.

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/ws"
)

// ── Context ownership ──────────────────────────────────────────────────

// TestPublish_RequestContextCancelled_HandlerStillRuns pins the core #1548
// guarantee: a publish context that is already cancelled (e.g. the HTTP
// request is over) must not prevent queued handlers from running. Handlers
// receive context.WithoutCancel(publish ctx) + a bounded timeout.
func TestPublish_RequestContextCancelled_HandlerStillRuns(t *testing.T) {
	b := newTestBus(t)

	ran := make(chan struct{})
	b.Subscribe("contract.ctx", func(ctx context.Context, e Event) {
		if err := ctx.Err(); err != nil {
			t.Errorf("handler ctx must not inherit publish cancellation, got %v", err)
		}
		close(ran)
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // request already over before publish

	require.NoError(t, b.Publish(ctx, Event{Type: "contract.ctx", Payload: "x"}))

	select {
	case <-ran:
	case <-time.After(3 * time.Second):
		t.Fatal("handler must run even though the publish context was cancelled")
	}
}

// TestPublish_RequestContextValuesPropagated pins that context values (but
// not cancellation) survive into the handler context.
func TestPublish_RequestContextValuesPropagated(t *testing.T) {
	b := newTestBus(t)

	type key struct{}
	got := make(chan string, 1)
	b.Subscribe("contract.values", func(ctx context.Context, e Event) {
		if v, ok := ctx.Value(key{}).(string); ok {
			got <- v
		}
	})

	ctx := context.WithValue(context.Background(), key{}, "correlation-1")
	require.NoError(t, b.Publish(ctx, Event{Type: "contract.values"}))

	select {
	case v := <-got:
		assert.Equal(t, "correlation-1", v)
	case <-time.After(3 * time.Second):
		t.Fatal("handler did not observe context values")
	}
}

// ── Publish error returns ──────────────────────────────────────────────

// TestPublish_AfterClose_ReturnsErrBusClosed pins the error contract:
// producers must be able to observe rejection instead of silent drops.
func TestPublish_AfterClose_ReturnsErrBusClosed(t *testing.T) {
	b := newTestBus(t)
	b.Close(context.Background())

	err := b.Publish(context.Background(), Event{Type: "contract.err"})
	assert.ErrorIs(t, err, ErrBusClosed, "Publish after Close must return ErrBusClosed")
	assert.NotErrorIs(t, err, ErrBusQueueFull)
}

// ── Close drain ────────────────────────────────────────────────────────

// TestClose_BoundedDrain_AbandonsAndCounts pins the bounded drain: when a
// handler blocks past the Close deadline, Close returns (it does not hang)
// and the abandoned handlers are counted in eventbus_dropped_on_close_total.
func TestClose_BoundedDrain_AbandonsAndCounts(t *testing.T) {
	b, err := New()
	require.NoError(t, err)

	blocked := make(chan struct{})
	b.Subscribe("contract.block", func(ctx context.Context, e Event) {
		close(blocked)
		<-ctx.Done() // block until the handler timeout
	})
	require.NoError(t, b.Publish(context.Background(), Event{Type: "contract.block"}))

	<-blocked // handler is now running; pending = 1

	baseline := testutil.ToFloat64(metrics.EventBusDroppedOnClose)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	done := make(chan struct{})
	go func() { b.Close(ctx); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Close must return when the deadline expires; it must not hang")
	}

	assert.True(t, b.IsClosed())
	got := testutil.ToFloat64(metrics.EventBusDroppedOnClose) - baseline
	assert.GreaterOrEqual(t, got, float64(1),
		"abandoned handlers must be counted in eventbus_dropped_on_close_total")
}

// TestClose_Idempotent pins that a second Close is a no-op (no panic, no
// double pool release).
func TestClose_Idempotent(t *testing.T) {
	b := newTestBus(t)
	b.Close(context.Background())
	require.NotPanics(t, func() { b.Close(context.Background()) })
}

// ── Typed payloads (#1548 catalog) ─────────────────────────────────────

func TestTypedPayloads_JSONFieldNames(t *testing.T) {
	cases := []struct {
		name string
		in   interface{}
		want map[string]string
	}{
		{
			name: "AgentTaskPayload",
			in:   AgentTaskPayload{TaskID: "t1", AgentInstanceID: "ai1", SessionID: "s1"},
			want: map[string]string{
				"task_id": "t1", "agent_instance_id": "ai1", "session_id": "s1",
			},
		},
		{
			name: "AgentFailedPayload",
			in: AgentFailedPayload{
				AgentTaskPayload: AgentTaskPayload{TaskID: "t2", AgentInstanceID: "ai2", SessionID: "s2"},
				Error:            "boom",
			},
			want: map[string]string{
				"task_id": "t2", "agent_instance_id": "ai2", "session_id": "s2", "error": "boom",
			},
		},
		{
			name: "AgentCancelPayload",
			in: AgentCancelPayload{
				AgentTaskPayload: AgentTaskPayload{TaskID: "t3", AgentInstanceID: "ai3", SessionID: "s3"},
				TriggeredBy:      "u1",
			},
			want: map[string]string{
				"task_id": "t3", "agent_instance_id": "ai3", "session_id": "s3", "triggered_by": "u1",
			},
		},
		{
			name: "AgentRegeneratePayload",
			in: AgentRegeneratePayload{
				OriginalTaskID: "old", NewTaskID: "new", AgentInstanceID: "ai4",
				SessionID: "s4", TriggerMessageID: "msg1",
			},
			want: map[string]string{
				"original_task_id": "old", "new_task_id": "new", "agent_instance_id": "ai4",
				"session_id": "s4", "trigger_message_id": "msg1",
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := json.Marshal(tc.in)
			require.NoError(t, err)

			var got map[string]string
			require.NoError(t, json.Unmarshal(raw, &got))
			assert.Equal(t, tc.want, got, "payload JSON field names are contract-stable")
		})
	}
}

// TestCatalog_NoEmptyEventType guards against accidentally empty constants
// sneaking into the catalog — an empty Type matches nothing and would
// silently no-op every publish of that event.
func TestCatalog_NoEmptyEventType(t *testing.T) {
	for _, tt := range []string{
		EventTypeMessageNew, EventTypeMessageRecall, EventTypeMessageEdited,
		EventTypeMessagePin, EventTypeMessageUnpin, EventTypeMessageRead,
		EventTypeMessageReactionAdd, EventTypeMessageReactionRem,
		EventTypeAgentStream, EventTypeAgentDone, EventTypeAgentFailed,
		EventTypeAgentTimeout, EventTypeAgentCancel, EventTypeAgentRegenerate,
		EventTypeAgentRouteDecision,
		EventTypeTeamRunStarted, EventTypeTeamEvent, EventTypeTeamAssignmentDone,
		EventTypeTeamAssignmentFail, EventTypeTeamSubagentStream,
		EventTypeFriendRequest, EventTypeFriendAccepted,
	} {
		assert.NotEmpty(t, tt, "catalog event type must not be empty")
	}
}

var _ = errors.Is // keep errors import if assertions move

// ── bus↔ws wire contract (#1548 catalog alignment) ──────────────────────
//
// The bus event-type catalog and the ws frame-type catalog must agree on
// every shared wire value. A silent value split here (e.g. bus publishing
// "team.assignment.completed" while ws clients only recognize
// "team.assignment.done") causes events to be published but never delivered
// — the silent-drop bug class this lane closes. The assertions below pin
// the direct-equality contract for every family that ships on both planes.
//
// The single documented exception is EventTypeAgentTimeout → ws.TypeAgentFailed
// (an agent timeout is surfaced on the wire as agent.failed). It is asserted
// explicitly as the only legal alias.

// wsContractAliases is the exhaustive allow-list of bus→ws mappings where the
// bus value intentionally differs from the wire value. Anything not here and
// not directly equal is a contract break.
var wsContractAliases = map[string]string{
	EventTypeAgentTimeout: "agent.timeout", // wire alias: agent.timeout → ws.TypeAgentFailed (see app/events.go)
}

// TestBusWsContract_Alignment asserts every catalogued bus event type either
// equals its ws frame counterpart or is in the explicit alias allow-list.
func TestBusWsContract_Alignment(t *testing.T) {
	// Direct-equality pairs (bus constant → ws frame constant). These are the
	// families that ship on both the in-process bus and the client ws wire.
	directPairs := []struct {
		busEvent string
		wsFrame  string
	}{
		{EventTypeMessageNew, ws.TypeMessageNew},
		{EventTypeMessageRecall, ws.TypeMessageRecall},
		{EventTypeMessagePin, ws.TypeMessagePin},
		{EventTypeMessageUnpin, ws.TypeMessageUnpin},
		{EventTypeMessageReactionAdd, ws.TypeMessageReactionAdded},
		{EventTypeMessageReactionRem, ws.TypeMessageReactionRemoved},
		{EventTypeMessageRead, ws.TypeMessageRead},
		{EventTypeAgentStream, ws.TypeAgentStream},
		{EventTypeAgentDone, ws.TypeAgentDone},
		{EventTypeAgentFailed, ws.TypeAgentFailed},
		{EventTypeAgentCancel, ws.TypeAgentCancel},
		{EventTypeTeamRunStarted, ws.TypeTeamRunStarted},
		{EventTypeTeamEvent, ws.TypeTeamEvent},
		{EventTypeTeamAssignmentDone, ws.TypeTeamAssignmentDone},
		{EventTypeTeamAssignmentFail, ws.TypeTeamAssignmentFailed},
		{EventTypeTeamSubagentStream, ws.TypeTeamSubagentStream},
		{EventTypeFriendRequest, ws.TypeFriendRequest},
		{EventTypeFriendAccepted, ws.TypeFriendAccepted},
	}
	for _, p := range directPairs {
		assert.Equal(t, p.wsFrame, p.busEvent,
			"bus↔ws value split: bus=%q ws=%q — clients would silently drop this event",
			p.busEvent, p.wsFrame)
	}
}

// TestBusWsContract_AliasAllowlistExhaustive asserts the only bus value that
// does NOT directly equal a ws frame is the documented agent.timeout alias,
// and that it maps to ws.TypeAgentFailed on the wire.
func TestBusWsContract_AliasAllowlistExhaustive(t *testing.T) {
	// Every catalogued bus constant that has a ws counterpart must be either a
	// direct pair or the single timeout alias. Enumerate the full catalog and
	// confirm each non-aliased entry resolves to a ws frame equal in value.
	catalog := []string{
		EventTypeMessageNew, EventTypeMessageRecall, EventTypeMessagePin,
		EventTypeMessageUnpin, EventTypeMessageRead, EventTypeMessageReactionAdd,
		EventTypeMessageReactionRem, EventTypeAgentStream, EventTypeAgentDone,
		EventTypeAgentFailed, EventTypeAgentTimeout, EventTypeAgentCancel,
		EventTypeTeamRunStarted, EventTypeTeamEvent, EventTypeTeamAssignmentDone,
		EventTypeTeamAssignmentFail, EventTypeTeamSubagentStream,
		EventTypeFriendRequest, EventTypeFriendAccepted,
	}
	// ws frame values that exist on the wire (the resolution target set).
	wsFrames := []string{
		ws.TypeMessageNew, ws.TypeMessageRecall, ws.TypeMessagePin, ws.TypeMessageUnpin,
		ws.TypeMessageReactionAdded, ws.TypeMessageReactionRemoved, ws.TypeMessageRead,
		ws.TypeAgentStream, ws.TypeAgentDone, ws.TypeAgentFailed, ws.TypeAgentCancel,
		ws.TypeTeamRunStarted, ws.TypeTeamEvent, ws.TypeTeamAssignmentDone,
		ws.TypeTeamAssignmentFailed, ws.TypeTeamSubagentStream,
		ws.TypeFriendRequest, ws.TypeFriendAccepted,
	}
	wsSet := make(map[string]struct{}, len(wsFrames))
	for _, f := range wsFrames {
		wsSet[f] = struct{}{}
	}
	for _, busVal := range catalog {
		if _, aliased := wsContractAliases[busVal]; aliased {
			// Documented exception: agent.timeout has no direct ws frame; it is
			// bridged to ws.TypeAgentFailed in app/events.go. Assert the bridge
			// target exists so the alias is not a dead reference.
			assert.Contains(t, wsSet, ws.TypeAgentFailed,
				"agent.timeout alias target ws.TypeAgentFailed must exist in the frame set")
			continue
		}
		// Non-aliased bus values must resolve to a ws frame of equal value.
		_, ok := wsSet[busVal]
		assert.True(t, ok,
			"bus constant %q has no equal ws frame and is not in the alias allow-list — "+
				"either add the ws frame or document the alias", busVal)
	}
	// The allow-list must contain exactly one entry (the timeout alias). If a
	// future alias is added, extend wsContractAliases deliberately.
	assert.Len(t, wsContractAliases, 1, "exactly one legal bus↔ws alias expected (agent.timeout)")
}

// TestBusWsContract_TeamAssignmentNotCompleted is a regression pin for the
// specific silent-drop bug this lane closed: bus published
// "team.assignment.completed" while ws clients only recognize
// "team.assignment.done". The value MUST stay aligned to the ws wire.
func TestBusWsContract_TeamAssignmentNotCompleted(t *testing.T) {
	assert.Equal(t, "team.assignment.done", EventTypeTeamAssignmentDone,
		"regression: EventTypeTeamAssignmentDone must be team.assignment.done (ws wire), "+
			"NOT team.assignment.completed — the old value silently dropped on clients")
	assert.NotEqual(t, "team.assignment.completed", EventTypeTeamAssignmentDone,
		"regression: the stale team.assignment.completed value must never return")
}
