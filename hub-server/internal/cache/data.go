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

var sf singleflight.Group

// GetOrLoad returns the cached value at key, or calls loader to populate it.
// TTL is jittered by +/-10% to prevent cache stampede on mass expiry.
// On Redis errors (other than cache miss), the loader is still called —
// Redis is treated as a best-effort acceleration layer.
func GetOrLoad[T any](ctx context.Context, key string, ttl time.Duration, loader func(context.Context) (T, error)) (T, error) {
	// 1. Try Redis first.
	data, err := RDB.Get(ctx, key).Bytes()
	if err == nil {
		var v T
		err = json.Unmarshal(data, &v)
		if err == nil {
			return v, nil
		}
		slog.Warn("cache unmarshal failed, falling back to loader", "key", key, "error", err)
	} else if !errors.Is(err, redis.Nil) {
		slog.Warn("cache get failed, falling back to loader", "key", key, "error", err)
	}

	// 2. Singleflight to deduplicate concurrent loaders for the same key.
	val, errSf, _ := sf.Do(key, func() (any, error) {
		v, loadErr := loader(ctx)
		if loadErr != nil {
			return v, loadErr
		}

		jsonBytes, marshalErr := json.Marshal(v)
		if marshalErr != nil {
			slog.Warn("cache marshal failed, skipping set", "key", key, "error", marshalErr)
			return v, nil
		}

		// Jitter TTL: 0.9 ~ 1.1
		factor := 0.9 + rand.Float64()*0.2
		jittered := time.Duration(float64(ttl) * factor)

		if setErr := RDB.Set(ctx, key, jsonBytes, jittered).Err(); setErr != nil {
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
func Invalidate(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := RDB.Del(ctx, keys...).Err(); err != nil {
		slog.Warn("cache invalidate failed", "keys", keys, "error", err)
		return err
	}
	return nil
}
