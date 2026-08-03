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
			in: AgentTaskPayload{TaskID: "t1", AgentInstanceID: "ai1", SessionID: "s1"},
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
