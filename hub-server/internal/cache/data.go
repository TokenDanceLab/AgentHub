package cache

import (
	"context"
	"time"
)

// Deprecated: use getOrLoad(defaultClient, ...) or migrate callers to accept *Client.
// Will be removed in Phase 5.
func GetOrLoad[T any](ctx context.Context, key string, ttl time.Duration, loader func(context.Context) (T, error)) (T, error) {
	return getOrLoad(defaultClient, ctx, key, ttl, loader)
}

// Deprecated: use Client.Invalidate instead. Will be removed in Phase 5.
func Invalidate(ctx context.Context, keys ...string) error {
	return defaultClient.Invalidate(ctx, keys...)
}
