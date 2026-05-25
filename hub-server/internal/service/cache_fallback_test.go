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
	require.IsType(t, noopCache{}, auth)
	require.NoError(t, auth.Invalidate(ctx, "user:profile:user-1"))

	contact := resolveContactCache(typedNil)
	require.IsType(t, noopCache{}, contact)
	online, err := contact.IsOnline(ctx, "user-1")
	require.NoError(t, err)
	require.False(t, online)

	session := resolveSessionCache(typedNil)
	require.IsType(t, noopCache{}, session)
	require.NoError(t, session.InitSeqIfAbsent(ctx, "session-1", 0))

	message := resolveMessageCache(typedNil)
	require.IsType(t, noopCache{}, message)
	_, err = message.AllocateSeq(ctx, "session-1")
	require.ErrorIs(t, err, errCacheUnavailable)

	agent := resolveAgentCache(typedNil)
	require.IsType(t, noopCache{}, agent)
	_, err = agent.GetRoute(ctx, "user-1", "desktop")
	require.ErrorIs(t, err, errCacheUnavailable)
	require.ErrorIs(t, agent.PushPendingTask(ctx, "user-1", "{}"), errCacheUnavailable)
	_, err = agent.AllocateSeq(ctx, "session-1")
	require.ErrorIs(t, err, errCacheUnavailable)
}
