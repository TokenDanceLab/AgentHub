package dispatchsvc

import (
	"context"
	"testing"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
)

// TestDispatchTargetBound_RouteUnavailable_QueuesTargetTask verifies the
// architecture red line: when the route for the target device is unavailable
// (offline / no WS connection), the task is pushed to the TARGET's offline
// queue (PushPendingTargetTask), NOT the inviter desktop queue
// (PushPendingTask). See docs/architecture/01-hub-server.md §Runtime And
// Team Routing: "must not silently fallback to another Desktop/Edge when a
// target-bound device is offline."
func TestDispatchTargetBound_RouteUnavailable_QueuesTargetTask(t *testing.T) {
	cache := &recordingDispatchCache{
		routes: map[string]string{}, // no route for this device → empty connID
	}
	ws := &recordingDispatchWS{conn: nil} // no active conn

	ds := NewDispatchService(
		nil,   // db — not reached on this failure path
		nil,   // bus
		ws,    // mgr
		cache, // cacheClient
		nil,   // relay
		nil,   // outbox
		config.EdgeDispatchConfig{},
		nil, // edgeClient
		"",  // jwtSecret
	)

	task := &model.PendingAgentTask{
		ID:       "task-target-1",
		TargetID: "target-desktop-1",
	}
	userID := "user-1"
	deviceID := "device-1"
	payload := []byte(`{"task_id":"task-target-1"}`)

	delivered := ds.dispatchTargetBoundTask(context.Background(), cache, task, userID, deviceID, payload)

	assert.False(t, delivered, "target-bound task with unavailable route must not be delivered")
	assert.Len(t, cache.pushed, 1, "must push to target queue exactly once")
	assert.Contains(t, cache.pushed[0], userID, "push must include userID")
	assert.Contains(t, cache.pushed[0], "target-desktop-1", "push must include targetID")
	assert.Contains(t, cache.pushed[0], deviceID, "push must include deviceID")
	assert.Contains(t, cache.pushed[0], string(payload), "push must include the original task JSON, not an altered copy")
	assert.Equal(t, 0, ws.pushed, "must NOT push to WS conn (target is offline)")
}

// TestDispatchTargetBound_ConnMismatch_QueuesTargetTask verifies that when
// the device route returns a connID but no matching connection is found
// (stale route / conn dropped between lookup and dispatch), the task still
// goes to the target queue, not the inviter desktop queue.
func TestDispatchTargetBound_ConnMismatch_QueuesTargetTask(t *testing.T) {
	cache := &recordingDispatchCache{
		routes: map[string]string{
			"user-1:desktop:device-1": "conn-stale-1", // route exists but conn is gone
		},
	}
	ws := &recordingDispatchWS{conn: nil} // FindByConnID returns nil

	ds := NewDispatchService(
		nil, nil, ws, cache, nil, nil, config.EdgeDispatchConfig{}, nil, "",
	)

	task := &model.PendingAgentTask{
		ID:       "task-target-2",
		TargetID: "target-desktop-2",
	}
	payload := []byte(`{"task_id":"task-target-2"}`)

	delivered := ds.dispatchTargetBoundTask(context.Background(), cache, task, "user-1", "device-1", payload)

	assert.False(t, delivered, "target-bound task with stale conn must not be delivered")
	assert.Len(t, cache.pushed, 1, "must push to target queue exactly once")
	assert.Contains(t, cache.pushed[0], "target-desktop-2", "push must include targetID")
	assert.Contains(t, cache.pushed[0], string(payload), "push must include the original task JSON, not an altered copy")
	assert.Equal(t, 0, ws.pushed, "must NOT push to WS conn (conn not found)")
}
