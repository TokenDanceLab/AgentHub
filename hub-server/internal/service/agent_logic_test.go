package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"github.com/agenthub/hub-server/internal/ws"
)

// --- normalizeRuntimeAgentType ---

func TestNormalizeRuntimeAgentType(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "claude-code exact", input: "claude-code", want: "claude-code"},
		{name: "claude short", input: "claude", want: "claude-code"},
		{name: "claude-4-6", input: "claude-4-6", want: "claude-code"},
		{name: "codex exact", input: "codex", want: "codex"},
		{name: "codex-gpt", input: "gpt-5.1-codex", want: "codex"},
		{name: "opencode exact", input: "opencode", want: "opencode"},
		{name: "opencode variant", input: "opencode-v2", want: "opencode"},
		{name: "empty", input: "", want: ""},
		{name: "whitespace", input: "  ", want: ""},
		{name: "unknown", input: "custom-runtime", want: "custom-runtime"},
		{name: "mixed case CLAUDE", input: "CLAUDE-CODE", want: "claude-code"},
		{name: "codEX mixed", input: "CodEX", want: "codex"},
		{name: "gpt prefix", input: "gpt-4o", want: "codex"}, // gpt substring match returns codex
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, dispatch.NormalizeRuntimeAgentType(tt.input))
		})
	}
}

// --- mapSenderType ---

func TestMapSenderType(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		expect string
	}{
		{name: "user", input: model.SenderTypeUser, expect: "user"},
		{name: "agent", input: model.SenderTypeAgent, expect: "assistant"},
		{name: "unknown", input: "system", expect: "system"},
		{name: "empty", input: "", expect: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expect, dispatch.MapSenderType(tt.input))
		})
	}
}

// --- extractMessageText ---

func TestExtractMessageText(t *testing.T) {
	t.Run("nil message", func(t *testing.T) {
		assert.Equal(t, "", dispatch.ExtractMessageText(nil))
	})

	t.Run("text content", func(t *testing.T) {
		msg := &model.Message{ContentType: model.ContentTypeText, Content: `{"text":"hello world"}`}
		assert.Equal(t, "hello world", dispatch.ExtractMessageText(msg))
	})

	t.Run("code content", func(t *testing.T) {
		msg := &model.Message{ContentType: model.ContentTypeCode, Content: `{"text":"fmt.Println(\"hi\")"}`}
		assert.Equal(t, `fmt.Println("hi")`, dispatch.ExtractMessageText(msg))
	})

	t.Run("diff content", func(t *testing.T) {
		msg := &model.Message{ContentType: model.ContentTypeDiff, Content: `{"text":"+added line"}`}
		assert.Equal(t, "+added line", dispatch.ExtractMessageText(msg))
	})

	t.Run("empty text in content", func(t *testing.T) {
		msg := &model.Message{ContentType: model.ContentTypeText, Content: `{"text":""}`}
		assert.Equal(t, `{"text":""}`, dispatch.ExtractMessageText(msg))
	})

	t.Run("non-text content type", func(t *testing.T) {
		msg := &model.Message{ContentType: model.ContentTypeImage, Content: `{"url":"https://example.com/img.png"}`}
		assert.Equal(t, `{"url":"https://example.com/img.png"}`, dispatch.ExtractMessageText(msg))
	})

	t.Run("unparseable content", func(t *testing.T) {
		msg := &model.Message{ContentType: model.ContentTypeText, Content: `not-json`}
		assert.Equal(t, "not-json", dispatch.ExtractMessageText(msg))
	})
}

// --- validateRunEventType ---

func TestValidateRunEventType(t *testing.T) {
	tests := []struct {
		name      string
		eventType string
		wantErr   bool
	}{
		{name: "valid dot notation", eventType: "run.agent.result", wantErr: false},
		{name: "valid with underscore", eventType: "run_agent_result", wantErr: false},
		{name: "valid with dash", eventType: "run-agent-result", wantErr: false},
		{name: "valid alphanumeric", eventType: "run1", wantErr: false},
		{name: "empty", eventType: "", wantErr: true},
		{name: "invalid chars", eventType: "run agent!", wantErr: true},
		{name: "spaces only", eventType: "   ", wantErr: true},
		{name: "slash", eventType: "run/agent", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateRunEventType(tt.eventType)
			if tt.wantErr {
				assert.ErrorIs(t, err, errcode.ErrBadRequest)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// --- inferRunEventType ---

func TestInferRunEventType(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		want    string
	}{
		{name: "event_type field", payload: `{"event_type":"run.agent.result"}`, want: "run.agent.result"},
		{name: "type field", payload: `{"type":"run.agent.permission_requested"}`, want: "run.agent.permission_requested"},
		{name: "event_type takes precedence", payload: `{"event_type":"run.agent.result","type":"other"}`, want: "run.agent.result"},
		{name: "no matching fields", payload: `{"data":"hello"}`, want: ""},
		{name: "invalid json", payload: `not-json`, want: ""},
		{name: "empty string", payload: "", want: ""},
		{name: "empty object", payload: `{}`, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, inferRunEventType(tt.payload))
		})
	}
}

// --- firstNonEmpty ---

func TestFirstNonEmpty(t *testing.T) {
	tests := []struct {
		name   string
		values []string
		want   string
	}{
		{name: "first non-empty", values: []string{"", "b", "c"}, want: "b"},
		{name: "all empty", values: []string{"", "", ""}, want: ""},
		{name: "no values", values: nil, want: ""},
		{name: "all non-empty", values: []string{"a", "b"}, want: "a"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, firstNonEmpty(tt.values...))
		})
	}
}

// --- firstRuntimeString ---

func TestFirstRuntimeString(t *testing.T) {
	t.Run("finds first matching key", func(t *testing.T) {
		payload := map[string]any{"model": "claude-sonnet-4-6", "version": "1.0"}
		assert.Equal(t, "claude-sonnet-4-6", firstRuntimeString(payload, "model", "name"))
	})

	t.Run("falls back to second key", func(t *testing.T) {
		payload := map[string]any{"name": "Codex", "label": "test"}
		assert.Equal(t, "Codex", firstRuntimeString(payload, "model", "name", "label"))
	})

	t.Run("empty payload", func(t *testing.T) {
		assert.Equal(t, "", firstRuntimeString(map[string]any{}, "key"))
	})

	t.Run("non-string value skipped", func(t *testing.T) {
		payload := map[string]any{"count": 42, "name": "found"}
		assert.Equal(t, "found", firstRuntimeString(payload, "count", "name"))
	})

	t.Run("trims whitespace", func(t *testing.T) {
		payload := map[string]any{"name": "  trimmed  "}
		assert.Equal(t, "trimmed", firstRuntimeString(payload, "name"))
	})

	t.Run("empty string skipped for next key", func(t *testing.T) {
		payload := map[string]any{"name": "", "label": "Label"}
		assert.Equal(t, "Label", firstRuntimeString(payload, "name", "label"))
	})
}

// --- firstRuntimeInt ---

func TestFirstRuntimeInt(t *testing.T) {
	tests := []struct {
		name    string
		payload map[string]any
		keys    []string
		want    int
	}{
		{name: "int value", payload: map[string]any{"count": 42}, keys: []string{"count"}, want: 42},
		{name: "int64 value", payload: map[string]any{"count": int64(100)}, keys: []string{"count"}, want: 100},
		{name: "float64 value", payload: map[string]any{"count": 99.9}, keys: []string{"count"}, want: 99},
		{name: "string number", payload: map[string]any{"count": "55"}, keys: []string{"count"}, want: 55},
		{name: "json.Number", payload: map[string]any{"count": json.Number("77")}, keys: []string{"count"}, want: 77},
		{name: "missing key", payload: map[string]any{"other": 42}, keys: []string{"count"}, want: 0},
		{name: "fallback key", payload: map[string]any{"input_tokens": 100}, keys: []string{"total", "input_tokens"}, want: 100},
		{name: "negative int", payload: map[string]any{"delta": -5}, keys: []string{"delta"}, want: -5},
		{name: "invalid string", payload: map[string]any{"count": "abc"}, keys: []string{"count"}, want: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, firstRuntimeInt(tt.payload, tt.keys...))
		})
	}
}

// --- validateAgentCallbackPayloadSize ---

func TestValidateAgentCallbackPayloadSize(t *testing.T) {
	t.Run("within limit", func(t *testing.T) {
		assert.NoError(t, validateAgentCallbackPayloadSize("small payload"))
	})

	t.Run("exceeds limit", func(t *testing.T) {
		big := make([]byte, model.RunEventPayloadMaxBytes+1)
		err := validateAgentCallbackPayloadSize(string(big))
		assert.Error(t, err)
		assert.ErrorIs(t, err, errcode.ErrBadRequest)
	})
}

// --- validateAgentCallbackEdgeRunID ---

func TestValidateAgentCallbackEdgeRunID(t *testing.T) {
	t.Run("within limit", func(t *testing.T) {
		assert.NoError(t, validateAgentCallbackEdgeRunID("run-123"))
	})

	t.Run("exceeds limit", func(t *testing.T) {
		big := make([]byte, model.AgentCallbackEdgeRunIDMaxLength+1)
		err := validateAgentCallbackEdgeRunID(string(big))
		assert.Error(t, err)
		assert.ErrorIs(t, err, errcode.ErrBadRequest)
	})
}

// --- DispatchService residual ports (#617) ---

type recordingDispatchBus struct {
	events []bus.Event
}

func (b *recordingDispatchBus) Publish(ctx context.Context, event bus.Event) error {
	b.events = append(b.events, event)
	return nil
}

type recordingDispatchCache struct {
	routes map[string]string
	pushed []string
}

func (c *recordingDispatchCache) GetRoute(ctx context.Context, userID, deviceType string) (string, error) {
	if c.routes == nil {
		return "", nil
	}
	return c.routes[userID+":"+deviceType], nil
}

func (c *recordingDispatchCache) GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error) {
	if c.routes == nil {
		return "", nil
	}
	return c.routes[userID+":"+deviceType+":"+deviceID], nil
}

func (c *recordingDispatchCache) PushPendingTask(ctx context.Context, userID, taskJSON string) error {
	c.pushed = append(c.pushed, userID+":"+taskJSON)
	return nil
}

func (c *recordingDispatchCache) PushPendingTargetTask(ctx context.Context, userID, targetID, deviceID, taskJSON string) error {
	c.pushed = append(c.pushed, userID+":"+targetID+":"+deviceID+":"+taskJSON)
	return nil
}

type recordingDispatchWS struct {
	conn   *ws.Conn
	pushed int
}

func (m *recordingDispatchWS) FindByConnID(connID string) *ws.Conn {
	if m.conn == nil || m.conn.ID != connID {
		return nil
	}
	return m.conn
}

func (m *recordingDispatchWS) PushToConn(connID string, frame ws.Frame) ws.DeliveryResult {
	m.pushed++
	return ws.DeliveryResult{Queued: true, Status: ws.DeliveryStatusQueued}
}

type recordingDispatchOutbox struct {
	recorded  int
	marked    int
	dead      int
	lastError string
}

func (o *recordingDispatchOutbox) RecordDelivery(ctx context.Context, taskID, payload, edgeDeviceID string) (string, error) {
	o.recorded++
	return "deliv-1", nil
}

func (o *recordingDispatchOutbox) MarkDeliverySent(ctx context.Context, deliveryID string) error {
	o.marked++
	return nil
}

func (o *recordingDispatchOutbox) MoveDeliveryToDeadLetter(ctx context.Context, deliveryID string, lastError string) error {
	o.dead++
	o.lastError = lastError
	return nil
}

func TestDispatchService_NilBusPublishIsNoop(t *testing.T) {
	svc := &DispatchService{}
	// Must not panic when b port is unset (partial construction).
	svc.publish(context.Background(), bus.Event{Type: "agent.cancel", Payload: "x"})
}

func TestDispatchService_NilOutboxWrappers(t *testing.T) {
	svc := &DispatchService{}
	_, err := svc.recordDelivery(context.Background(), "t1", "{}", "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "dispatch outbox unavailable")
	require.Error(t, svc.markDeliverySent(context.Background(), "d1"))
	// dead-letter is a no-op when outbox is unset
	svc.moveDeliveryToDeadLetter(context.Background(), "d1", "boom")
}

func TestDispatchService_SetPortsComposition(t *testing.T) {
	b := &recordingDispatchBus{}
	cachePort := &recordingDispatchCache{routes: map[string]string{"u1:desktop": "conn-1"}}
	wsPort := &recordingDispatchWS{conn: &ws.Conn{ID: "conn-1", UserID: "u1", DeviceType: "desktop", DeviceID: "dev-1"}}
	outbox := &recordingDispatchOutbox{}

	svc := NewDispatchService(nil, nil, nil, nil, nil, nil)
	require.NotNil(t, svc)

	svc.SetBus(b)
	svc.SetCache(cachePort)
	svc.SetManager(wsPort)
	svc.SetOutbox(outbox)
	svc.SetRelay(nil)

	svc.publish(context.Background(), bus.Event{Type: "agent.regenerate", Payload: map[string]string{"k": "v"}})
	require.Len(t, b.events, 1)
	assert.Equal(t, "agent.regenerate", b.events[0].Type)

	id, err := svc.recordDelivery(context.Background(), "task-1", `{"task_id":"task-1"}`, "dev-1")
	require.NoError(t, err)
	assert.Equal(t, "deliv-1", id)
	require.NoError(t, svc.markDeliverySent(context.Background(), id))
	svc.moveDeliveryToDeadLetter(context.Background(), id, "hard-fail")
	assert.Equal(t, 1, outbox.recorded)
	assert.Equal(t, 1, outbox.marked)
	assert.Equal(t, 1, outbox.dead)
	assert.Equal(t, "hard-fail", outbox.lastError)

	got := svc.cachePort()
	route, err := got.GetRoute(context.Background(), "u1", "desktop")
	require.NoError(t, err)
	assert.Equal(t, "conn-1", route)
	assert.Same(t, wsPort.conn, svc.mgr.FindByConnID("conn-1"))
}

func TestIsLoopback(t *testing.T) {
	assert.True(t, dispatch.IsLoopback("http://127.0.0.1:3210"))
	assert.True(t, dispatch.IsLoopback("http://localhost:3210"))
	assert.True(t, dispatch.IsLoopback("http://[::1]:3210"))
	assert.False(t, dispatch.IsLoopback("http://localhost.evil.com"))
	assert.False(t, dispatch.IsLoopback("http://edge.example.com"))
	assert.False(t, dispatch.IsLoopback("not a url"))
}
