package auth

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/cache"
)

func TestResolveAuthCacheUsesNoopForTypedNilClient(t *testing.T) {
	ctx := context.Background()
	var typedNil *cache.Client

	resolved := resolveAuthCache(typedNil)
	require.IsType(t, cache.NoOpCache{}, resolved)
	require.NoError(t, resolved.Invalidate(ctx, "user:profile:user-1"))
}
