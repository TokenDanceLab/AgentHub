package cache

import (
	"context"
	"errors"
	"time"
)

// Residual pure-helper peel #1123: NoOpCache interface stubs.

// NoOpCache is a fail-closed cache stub: mutation/read methods return
// ErrCacheUnavailable and the offline-queue methods surface that error to
// callers instead of silently succeeding. Bookkeeping methods (Invalidate,
// seq mirror setters, IsOnline) succeed as no-ops. Tests and offline paths
// can use this explicitly. Production constructors MUST receive a real
// *Client — passing nil will panic.
type NoOpCache struct{}

func (NoOpCache) Invalidate(ctx context.Context, keys ...string) error      { return nil }
func (NoOpCache) IsOnline(ctx context.Context, userID string) (bool, error) { return false, nil }
func (NoOpCache) AreOnline(ctx context.Context, userIDs []string) (map[string]bool, error) {
	return map[string]bool{}, nil
}
func (NoOpCache) InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error { return nil }
func (NoOpCache) SetSeq(ctx context.Context, sessionID string, seq int64) error          { return nil }
func (NoOpCache) AllocateSeq(ctx context.Context, sessionID string) (int64, error) {
	return 0, ErrCacheUnavailable
}
func (NoOpCache) GetRoute(ctx context.Context, userID, deviceType string) (string, error) {
	return "", ErrCacheUnavailable
}
func (NoOpCache) GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error) {
	return "", ErrCacheUnavailable
}
func (NoOpCache) PushPendingTask(ctx context.Context, userID, taskJSON string) error {
	return ErrCacheUnavailable
}
func (NoOpCache) PushPendingTargetTask(ctx context.Context, userID, targetID, deviceID, taskJSON string) error {
	return ErrCacheUnavailable
}
func (NoOpCache) PopPendingTargetTasksForDevice(ctx context.Context, userID, deviceID string) ([]string, error) {
	return nil, ErrCacheUnavailable
}
func (NoOpCache) PushPendingAgentControl(ctx context.Context, userID, deviceID, controlJSON string) error {
	return ErrCacheUnavailable
}
func (NoOpCache) ListPendingAgentControlsForDevice(ctx context.Context, userID, deviceID string) ([]string, error) {
	return nil, ErrCacheUnavailable
}
func (NoOpCache) AckPendingAgentControl(ctx context.Context, userID, deviceID, controlJSON string) error {
	return ErrCacheUnavailable
}
func (NoOpCache) PopPendingAgentControlsForDevice(ctx context.Context, userID, deviceID string) ([]string, error) {
	return nil, ErrCacheUnavailable
}
func (NoOpCache) BlacklistRefreshToken(ctx context.Context, tokenHash string, ttl time.Duration) error {
	return nil
}
func (NoOpCache) IsRefreshTokenBlacklisted(ctx context.Context, key string) (bool, error) {
	return false, nil
}
func (NoOpCache) BlacklistAccessToken(ctx context.Context, jti string, ttl time.Duration) error {
	return nil
}
func (NoOpCache) IsAccessTokenBlacklisted(ctx context.Context, jti string) (bool, error) {
	return false, nil
}

// ErrCacheUnavailable is returned by NoOpCache methods that cannot operate
// without a real Redis connection (e.g. AllocateSeq, GetRoute).
var ErrCacheUnavailable = errors.New("cache unavailable")
