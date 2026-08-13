package dispatchsvc

import (
	"context"
	"testing"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/stretchr/testify/require"
)

// TestResolveDispatchCacheNilFallback mirrors the service-layer cache-fallback
// contract: typed-nil and untyped-nil dispatch cache ports fall back to
// cache.NoOpCache.
func TestResolveDispatchCacheNilFallback(t *testing.T) {
	ctx := context.Background()

	var typedNil *cache.Client
	port := resolveDispatchCache(typedNil)
	require.IsType(t, cache.NoOpCache{}, port)
	_, err := port.GetRoute(ctx, "user-1", "desktop")
	require.ErrorIs(t, err, cache.ErrCacheUnavailable)
	require.ErrorIs(t, port.PushPendingTask(ctx, "user-1", "{}"), cache.ErrCacheUnavailable)
}
