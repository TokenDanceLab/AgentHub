package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/cache"
)

func TestResolveCacheUsesNoopForTypedNilClient(t *testing.T) {
	ctx := context.Background()
	var typedNil *cache.Client

	auth := resolveAuthCache(typedNil)
	require.IsType(t, cache.NoOpCache{}, auth)
	require.NoError(t, auth.Invalidate(ctx, "user:profile:user-1"))

	agent := resolveAgentCache(typedNil)
	require.IsType(t, cache.NoOpCache{}, agent)
	_, err := agent.GetRoute(ctx, "user-1", "desktop")
	require.ErrorIs(t, err, cache.ErrCacheUnavailable)
	require.ErrorIs(t, agent.PushPendingTask(ctx, "user-1", "{}"), cache.ErrCacheUnavailable)
	_, err = agent.AllocateSeq(ctx, "session-1")
	require.ErrorIs(t, err, cache.ErrCacheUnavailable)

	dispatch := resolveDispatchCache(typedNil)
	require.IsType(t, cache.NoOpCache{}, dispatch)
	_, err = dispatch.GetRoute(ctx, "user-1", "desktop")
	require.ErrorIs(t, err, cache.ErrCacheUnavailable)
	require.ErrorIs(t, dispatch.PushPendingTask(ctx, "user-1", "{}"), cache.ErrCacheUnavailable)
}
