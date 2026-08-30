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

func newTestService(t *testing.T) (*Service, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	c := cache.NewClient(rdb)
	mgr := ws.NewManager()
	return NewService(c, mgr), mr
}

func TestCreateAndGetCommand(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	payload := json.RawMessage(`{"action":"ping"}`)
	cmd, err := svc.CreateCommand(ctx, "edge-1", "test_cmd", payload, "user-1")
	require.NoError(t, err)
	assert.NotEmpty(t, cmd.ID)
	assert.Equal(t, "pending", cmd.Status)

	got, err := svc.GetCommand(ctx, cmd.ID, "user-1")
	require.NoError(t, err)
	assert.Equal(t, cmd.ID, got.ID)
	assert.Equal(t, "edge-1", got.TargetEdgeID)
}

func TestGetCommand_WrongUserReturnsNotFound(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	cmd, err := svc.CreateCommand(ctx, "edge-1", "test_cmd", nil, "user-1")
	require.NoError(t, err)

	_, err = svc.GetCommand(ctx, cmd.ID, "user-other")
	assert.Error(t, err, "wrong user should not be able to read the command")
}

// P2 audit #2119: AckCommand must remove the key from Redis.
func TestAckCommand_DeletesKey(t *testing.T) {
	svc, mr := newTestService(t)
	ctx := context.Background()

	cmd, err := svc.CreateCommand(ctx, "edge-1", "test_cmd", nil, "user-1")
	require.NoError(t, err)

	key := "relay:cmd:" + cmd.ID
	assert.True(t, mr.Exists(key), "command key should exist before ack")

	require.NoError(t, svc.AckCommand(ctx, cmd.ID, "user-1"))
	assert.False(t, mr.Exists(key), "command key should be deleted after ack")

	// Subsequent GetCommand should fail
	_, err = svc.GetCommand(ctx, cmd.ID, "user-1")
	assert.Error(t, err, "acked command should no longer be retrievable")
}

func TestAckCommand_WrongUserDoesNotDelete(t *testing.T) {
	svc, mr := newTestService(t)
	ctx := context.Background()

	cmd, err := svc.CreateCommand(ctx, "edge-1", "test_cmd", nil, "user-1")
	require.NoError(t, err)

	key := "relay:cmd:" + cmd.ID
	err = svc.AckCommand(ctx, cmd.ID, "user-other")
	assert.Error(t, err, "wrong user ack should fail")
	assert.True(t, mr.Exists(key), "command key must survive unauthorized ack attempt")
}

func TestAckCommand_NonExistentCommandReturnsError(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	err := svc.AckCommand(ctx, "relay_nonexistent", "user-1")
	assert.Error(t, err)
}
