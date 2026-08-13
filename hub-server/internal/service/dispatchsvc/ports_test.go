package dispatchsvc

import (
	"context"
	"testing"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ── Port mocks (#617 residual, moved with the dispatch package) ─────────────

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
	conn   *ConnPort
	pushed int
}

func (m *recordingDispatchWS) FindByConnID(connID string) *ConnPort {
	if m.conn == nil || m.conn.ID != connID {
		return nil
	}
	return m.conn
}

func (m *recordingDispatchWS) PushToConn(connID string, frame FramePort) DeliveryResultPort {
	m.pushed++
	return DeliveryResultPort{Queued: true, Status: "queued"}
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

// ── Port tests ──────────────────────────────────────────────────────────────

func TestDispatchService_NilBusPublishIsNoop(t *testing.T) {
	svc := &DispatchService{}
	// Must not panic when the bus port is unset (partial construction).
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

func TestDispatchService_ConstructorPortsComposition(t *testing.T) {
	b := &recordingDispatchBus{}
	cachePort := &recordingDispatchCache{routes: map[string]string{"u1:desktop": "conn-1"}}
	wsPort := &recordingDispatchWS{conn: &ConnPort{ID: "conn-1", UserID: "u1", DeviceType: "desktop", DeviceID: "dev-1"}}
	outbox := &recordingDispatchOutbox{}

	svc := NewDispatchService(nil, b, wsPort, cachePort, nil, outbox, config.EdgeDispatchConfig{}, nil, "")
	require.NotNil(t, svc)

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
