package cache

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand/v2"
	"strconv"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// Client wraps Redis operations, replacing the package-level global RDB.
// Construct via NewClient; inject into services that need cache access.
type Client struct {
	rdb *redis.Client
	sf  singleflight.Group
}

// NewClient creates a new cache client backed by the given Redis connection.
// Passing nil will produce a non-functional client whose methods return
// errors rather than panicking; always pass a valid *redis.Client.
func NewClient(rdb *redis.Client) *Client {
	return &Client{rdb: rdb}
}

// isReady reports whether the underlying Redis connection is available.
func (c *Client) isReady() bool {
	return c != nil && c.rdb != nil
}

// GetRDB returns the underlying Redis client for advanced operations (e.g., rate limiting).
// Returns nil if called on a nil *Client (defensive guard against wiring errors).
func (c *Client) GetRDB() *redis.Client {
	if c == nil || c.rdb == nil {
		slog.Error("cache.Client.GetRDB called on nil or uninitialized client")
		return nil
	}
	return c.rdb
}

// GetOrLoad is a generic helper that performs cache-aside with singleflight
// deduplication. It is a package-level function (not a method) because Go does
// not support generic methods. Pass a *Client explicitly.
func GetOrLoad[T any](c *Client, ctx context.Context, key string, ttl time.Duration, loader func(context.Context) (T, error)) (T, error) {
	data, err := c.rdb.Get(ctx, key).Bytes()
	if err == nil {
		var v T
		if err = json.Unmarshal(data, &v); err == nil {
			return v, nil
		}
		slog.Warn("cache unmarshal failed, falling back to loader", "key", key, "error", err)
	} else if !errors.Is(err, redis.Nil) {
		slog.Warn("cache get failed, falling back to loader", "key", key, "error", err)
	}

	val, errSf, _ := c.sf.Do(key, func() (any, error) {
		v, loadErr := loader(ctx)
		if loadErr != nil {
			return v, loadErr
		}
		jsonBytes, marshalErr := json.Marshal(v)
		if marshalErr != nil {
			slog.Warn("cache marshal failed, skipping set", "key", key, "error", marshalErr)
			return v, nil
		}
		factor := 0.9 + rand.Float64()*0.2
		jittered := time.Duration(float64(ttl) * factor)
		if setErr := c.rdb.Set(ctx, key, jsonBytes, jittered).Err(); setErr != nil {
			slog.Warn("cache set failed", "key", key, "error", setErr)
		}
		return v, nil
	})
	if errSf != nil {
		var zero T
		return zero, errSf
	}
	return val.(T), nil
}

// Invalidate removes one or more keys from the cache.
func (c *Client) Invalidate(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := c.rdb.Del(ctx, keys...).Err(); err != nil {
		slog.Warn("cache invalidate failed", "keys", keys, "error", err)
		return err
	}
	return nil
}

// ── Route cache (from route.go) ───────────────────────────────────────

func routeKey(userID string) string { return "device_route:" + userID }

func routeField(deviceType, deviceID string) string {
	if deviceID == "" {
		return deviceType
	}
	return deviceType + ":" + deviceID
}

// SetRoute records the WebSocket connection for a user device.
func (c *Client) SetRoute(ctx context.Context, userID, deviceType, connID string) error {
	return c.rdb.HSet(ctx, routeKey(userID), deviceType, connID).Err()
}

// DeleteRoute removes the route entry for a user device.
func (c *Client) DeleteRoute(ctx context.Context, userID, deviceType string) error {
	return c.rdb.HDel(ctx, routeKey(userID), deviceType).Err()
}

// GetRoute returns the connection ID for a user device.
func (c *Client) GetRoute(ctx context.Context, userID, deviceType string) (string, error) {
	// Try exact match first (backward compatible)
	connID, err := c.rdb.HGet(ctx, routeKey(userID), deviceType).Result()
	if err == nil {
		return connID, nil
	}
	// Scan for compound keys (deviceType:deviceID)
	all, scanErr := c.rdb.HGetAll(ctx, routeKey(userID)).Result()
	if scanErr != nil {
		return "", scanErr
	}
	prefix := deviceType + ":"
	for field, val := range all {
		if strings.HasPrefix(field, prefix) {
			return val, nil
		}
	}
	return "", redis.Nil
}

// GetRouteForDevice returns the exact connection route for a device. It does
// not fall back to another device of the same type.
func (c *Client) GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error) {
	if deviceID == "" {
		return "", redis.Nil
	}
	return c.rdb.HGet(ctx, routeKey(userID), routeField(deviceType, deviceID)).Result()
}

// IsOnline reports whether the user has at least one active device route.
func (c *Client) IsOnline(ctx context.Context, userID string) (bool, error) {
	n, err := c.rdb.HLen(ctx, routeKey(userID)).Result()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// GetAllRoutes returns all device routes for a user.
func (c *Client) GetAllRoutes(ctx context.Context, userID string) (map[string]string, error) {
	return c.rdb.HGetAll(ctx, routeKey(userID)).Result()
}

// MarkKicked flags a connection ID as kicked (60s TTL).
func (c *Client) MarkKicked(ctx context.Context, connID string) error {
	return c.rdb.Set(ctx, "kicked:"+connID, "1", 60*time.Second).Err()
}

// IsKicked reports whether a connection ID has been kicked.
func (c *Client) IsKicked(ctx context.Context, connID string) (bool, error) {
	n, err := c.rdb.Exists(ctx, "kicked:"+connID).Result()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// ── Pending task offline queue ────────────────────────────────────────

func pendingTaskKey(userID string) string { return "pending_tasks:" + userID }

func pendingTargetTaskKey(userID, targetID, deviceID string) string {
	return "pending_tasks:" + userID + ":device:" + deviceID + ":target:" + targetID
}

func pendingTargetTaskIndexKey(userID, deviceID string) string {
	return "pending_tasks:" + userID + ":device:" + deviceID + ":targets"
}

func pendingAgentControlKey(userID, deviceID string) string {
	return "pending_controls:" + userID + ":device:" + deviceID
}

// PushPendingTask pushes a task JSON to the user's offline pending queue.
func (c *Client) PushPendingTask(ctx context.Context, userID, taskJSON string) error {
	key := pendingTaskKey(userID)
	pipe := c.rdb.TxPipeline()
	pipe.LPush(ctx, key, taskJSON)
	pipe.Expire(ctx, key, config.PendingTaskTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// PopPendingTasks pops all pending tasks for a user and clears the queue.
func (c *Client) PopPendingTasks(ctx context.Context, userID string) ([]string, error) {
	key := pendingTaskKey(userID)
	tasks, err := c.rdb.LRange(ctx, key, 0, -1).Result()
	if err != nil {
		return nil, err
	}
	if len(tasks) > 0 {
		c.rdb.Del(ctx, key)
	}
	result := make([]string, 0, len(tasks))
	for _, t := range tasks {
		var raw json.RawMessage
		if json.Unmarshal([]byte(t), &raw) == nil {
			result = append(result, t)
		}
	}
	return result, nil
}

// PendingTaskCount returns the number of pending tasks for a user.
func (c *Client) PendingTaskCount(ctx context.Context, userID string) (int64, error) {
	return c.rdb.LLen(ctx, pendingTaskKey(userID)).Result()
}

// PushPendingTargetTask pushes a task JSON to a target/device-specific offline
// queue so target-bound dispatch cannot be replayed to a different desktop.
func (c *Client) PushPendingTargetTask(ctx context.Context, userID, targetID, deviceID, taskJSON string) error {
	indexKey := pendingTargetTaskIndexKey(userID, deviceID)
	taskKey := pendingTargetTaskKey(userID, targetID, deviceID)
	pipe := c.rdb.TxPipeline()
	pipe.SAdd(ctx, indexKey, targetID)
	pipe.Expire(ctx, indexKey, config.PendingTaskTTL)
	pipe.LPush(ctx, taskKey, taskJSON)
	pipe.Expire(ctx, taskKey, config.PendingTaskTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// PopPendingTargetTasksForDevice pops all target-bound pending tasks for one
// device and clears only that device's target queues.
func (c *Client) PopPendingTargetTasksForDevice(ctx context.Context, userID, deviceID string) ([]string, error) {
	indexKey := pendingTargetTaskIndexKey(userID, deviceID)
	targetIDs, err := c.rdb.SMembers(ctx, indexKey).Result()
	if err != nil {
		return nil, err
	}
	result := make([]string, 0)
	for _, targetID := range targetIDs {
		key := pendingTargetTaskKey(userID, targetID, deviceID)
		tasks, err := c.rdb.LRange(ctx, key, 0, -1).Result()
		if err != nil {
			return nil, err
		}
		if len(tasks) > 0 {
			c.rdb.Del(ctx, key)
		}
		c.rdb.SRem(ctx, indexKey, targetID)
		for _, t := range tasks {
			var raw json.RawMessage
			if json.Unmarshal([]byte(t), &raw) == nil {
				result = append(result, t)
			}
		}
	}
	if len(targetIDs) == 0 {
		c.rdb.Del(ctx, indexKey)
	}
	return result, nil
}

// PushPendingAgentControl pushes a control JSON to a device-specific offline
// queue so approval decisions are never replayed to a different desktop.
func (c *Client) PushPendingAgentControl(ctx context.Context, userID, deviceID, controlJSON string) error {
	key := pendingAgentControlKey(userID, deviceID)
	pipe := c.rdb.TxPipeline()
	pipe.LRem(ctx, key, 0, controlJSON)
	pipe.LPush(ctx, key, controlJSON)
	pipe.LTrim(ctx, key, 0, int64(config.PendingAgentControlQueueMaxLen-1))
	pipe.Expire(ctx, key, config.PendingAgentControlQueueTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// PopPendingAgentControlsForDevice pops all queued controls for one device and
// clears only that device's control queue.
func (c *Client) PopPendingAgentControlsForDevice(ctx context.Context, userID, deviceID string) ([]string, error) {
	key := pendingAgentControlKey(userID, deviceID)
	controls, err := c.rdb.LRange(ctx, key, 0, -1).Result()
	if err != nil {
		return nil, err
	}
	if len(controls) > 0 {
		c.rdb.Del(ctx, key)
	}
	result := make([]string, 0, len(controls))
	for _, control := range controls {
		var raw json.RawMessage
		if json.Unmarshal([]byte(control), &raw) == nil {
			result = append(result, control)
		}
	}
	return result, nil
}

// ── Sequence numbers (from seq.go) ────────────────────────────────────

// AllocateSeq atomically increments and returns the next seq for a session.
func (c *Client) AllocateSeq(ctx context.Context, sessionID string) (int64, error) {
	return c.rdb.Incr(ctx, "session:seq:"+sessionID).Result()
}

// InitSeqIfAbsent initializes the seq key if it doesn't exist.
func (c *Client) InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error {
	return c.rdb.SetNX(ctx, "session:seq:"+sessionID, seq, 0).Err()
}

// PeekSeq returns the current seq value for a session (diagnostics only).
func (c *Client) PeekSeq(ctx context.Context, sessionID string) (int64, error) {
	s, err := c.rdb.Get(ctx, "session:seq:"+sessionID).Result()
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(s, 10, 64)
}

// BlacklistRefreshToken stores a refresh token hash in the Redis blacklist
// with the specified TTL. This allows fast revocation checks without hitting
// the database.
func (c *Client) BlacklistRefreshToken(ctx context.Context, tokenHash string, ttl time.Duration) error {
	return c.rdb.Set(ctx, "rt_blacklist:"+tokenHash, "1", ttl).Err()
}

// PoolStats exposes the underlying Redis connection pool statistics.
func (c *Client) PoolStats() *redis.PoolStats {
	return c.rdb.PoolStats()
}

// Close closes the underlying Redis connection pool.
func (c *Client) Close() error {
	return c.rdb.Close()
}

// ── Rate limiting ──────────────────────────────────────────────────────

// CheckRateLimit implements a simple sliding-window counter.  It atomically
// increments the counter for key, sets a 60-second TTL on first access, and
// returns whether the count exceeds the supplied limit.
func (c *Client) CheckRateLimit(ctx context.Context, key string, limit int64) (count int64, exceeded bool, err error) {
	count, err = c.rdb.Incr(ctx, "ratelimit:"+key).Result()
	if err != nil {
		return 0, false, err
	}
	// Set expiry only when the key is brand-new (count == 1).
	if count == 1 {
		// Use a 60-second window; the TTL is never refreshed on subsequent
		// requests, so the whole counter expires one minute after the very
		// first request in each time window.
		_ = c.rdb.Expire(ctx, "ratelimit:"+key, 60*time.Second).Err()
	}
	exceeded = count > limit
	return
}

// ── NoOpCache ───────────────────────────────────────────────────────────

// NoOpCache is a safe no-op implementation of all cache interfaces used by
// services. Tests and offline paths can use this explicitly. Production
// constructors MUST receive a real *Client — passing nil will panic.
type NoOpCache struct{}

func (NoOpCache) Invalidate(ctx context.Context, keys ...string) error                   { return nil }
func (NoOpCache) IsOnline(ctx context.Context, userID string) (bool, error)              { return false, nil }
func (NoOpCache) InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error { return nil }
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
func (NoOpCache) PopPendingAgentControlsForDevice(ctx context.Context, userID, deviceID string) ([]string, error) {
	return nil, ErrCacheUnavailable
}
func (NoOpCache) BlacklistRefreshToken(ctx context.Context, tokenHash string, ttl time.Duration) error {
	return nil
}

// ErrCacheUnavailable is returned by NoOpCache methods that cannot operate
// without a real Redis connection (e.g. AllocateSeq, GetRoute).
var ErrCacheUnavailable = errors.New("cache unavailable")
