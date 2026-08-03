package cache

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand/v2"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// Residual pure-helper peel #1123: keep Client core surface here; routes,
// pending queues, auth/tokens/rate-limit, and NoOpCache live in companions.

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
		// #nosec G404 -- TTL jitter only; randomness is not used for security
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

// PoolStats exposes the underlying Redis connection pool statistics.
func (c *Client) PoolStats() *redis.PoolStats {
	return c.rdb.PoolStats()
}

// Close closes the underlying Redis connection pool.
func (c *Client) Close() error {
	return c.rdb.Close()
}
