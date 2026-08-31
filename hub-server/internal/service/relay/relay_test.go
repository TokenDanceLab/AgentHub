package relay

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/ws"
)

// newTestService creates a Service backed by miniredis and a real ws.Manager
// with no registered connections (push will not reach anyone).
func newTestService(t *testing.T) (*Service, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { require.NoError(t, rdb.Close()) })

	c := cache.NewClient(rdb)
	mgr := ws.NewManager()
	return NewService(c, mgr), mr
}

func TestCreateCommand_NoConnection_PushReachedFalse(t *testing.T) {
	svc, _ := newTestService(t)

	res, err := svc.CreateCommand(context.Background(), "edge-offline", "test.cmd", json.RawMessage(`{}`), "user-1")
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.False(t, res.PushReached, "push must not report reached when no WS connection exists")
	assert.Equal(t, "edge-offline", res.Command.TargetEdgeID)
	assert.Equal(t, "pending", res.Command.Status)
}

func TestCreateCommand_WithActiveConnection_PushReachedTrue(t *testing.T) {
	svc, _ := newTestService(t)

	// Register a fake WS connection whose DeviceID matches the relay target so
	// PushToDevice (byDevice index) queues the frame (#2101 G6 routing).
	conn := &ws.Conn{
		ID:         "conn-1",
		UserID:     "owner-1",
		DeviceType: "desktop",
		DeviceID:   "edge-online",
		Send:       make(chan []byte, 8),
	}
	require.NoError(t, svc.mgr.Register(conn))

	res, err := svc.CreateCommand(context.Background(), "edge-online", "test.cmd", json.RawMessage(`{"k":"v"}`), "user-1")
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.True(t, res.PushReached, "push must report reached when an active WS connection queued the frame")
	assert.Equal(t, "edge-online", res.Command.TargetEdgeID)
}

func TestCreateCommand_RedisFailure_ReturnsError(t *testing.T) {
	svc, mr := newTestService(t)
	mr.Close() // close redis to force SET failure

	res, err := svc.CreateCommand(context.Background(), "edge-x", "test.cmd", json.RawMessage(`{}`), "user-1")
	require.Error(t, err)
	assert.Nil(t, res)
	assert.Contains(t, err.Error(), "store relay command")
}

func TestCreateAndGetCommand(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	payload := json.RawMessage(`{"action":"ping"}`)
	res, err := svc.CreateCommand(ctx, "edge-1", "test_cmd", payload, "user-1")
	require.NoError(t, err)
	assert.NotEmpty(t, res.Command.ID)
	assert.Equal(t, "pending", res.Command.Status)

	got, err := svc.GetCommand(ctx, res.Command.ID, "user-1")
	require.NoError(t, err)
	assert.Equal(t, res.Command.ID, got.ID)
	assert.Equal(t, "edge-1", got.TargetEdgeID)
}

func TestGetCommand_WrongUserReturnsNotFound(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	res, err := svc.CreateCommand(ctx, "edge-1", "test_cmd", nil, "user-1")
	require.NoError(t, err)

	_, err = svc.GetCommand(ctx, res.Command.ID, "user-other")
	assert.Error(t, err, "wrong user should not be able to read the command")
}

// P2 audit #2119: AckCommand must remove the key from Redis.
func TestAckCommand_DeletesKey(t *testing.T) {
	svc, mr := newTestService(t)
	ctx := context.Background()

	res, err := svc.CreateCommand(ctx, "edge-1", "test_cmd", nil, "user-1")
	require.NoError(t, err)

	key := "relay:cmd:" + res.Command.ID
	assert.True(t, mr.Exists(key), "command key should exist before ack")

	require.NoError(t, svc.AckCommand(ctx, res.Command.ID, "user-1"))
	assert.False(t, mr.Exists(key), "command key should be deleted after ack")

	// Subsequent GetCommand should fail
	_, err = svc.GetCommand(ctx, res.Command.ID, "user-1")
	assert.Error(t, err, "acked command should no longer be retrievable")
}

func TestAckCommand_WrongUserDoesNotDelete(t *testing.T) {
	svc, mr := newTestService(t)
	ctx := context.Background()

	res, err := svc.CreateCommand(ctx, "edge-1", "test_cmd", nil, "user-1")
	require.NoError(t, err)

	key := "relay:cmd:" + res.Command.ID
	err = svc.AckCommand(ctx, res.Command.ID, "user-other")
	assert.Error(t, err, "wrong user ack should fail")
	assert.True(t, mr.Exists(key), "command key must survive unauthorized ack attempt")
}

func TestAckCommand_NonExistentCommandReturnsError(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	err := svc.AckCommand(ctx, "relay_nonexistent", "user-1")
	assert.Error(t, err)
}
