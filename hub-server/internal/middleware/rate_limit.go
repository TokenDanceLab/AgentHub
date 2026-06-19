package middleware

import (
	"fmt"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
)

// rateLimitMemberID is an atomically incrementing counter used to guarantee
// unique ZSET members — time.Now().UnixNano() alone is insufficient on
// platforms with coarse timer resolution (e.g. ~15.6 ms on Windows).
var rateLimitMemberID atomic.Int64

// RateLimit returns a middleware that enforces a sliding-window rate limit
// using Redis. limit is the maximum number of requests allowed within window.
// When Redis is unavailable, auth paths always fail closed (reject the request
// with 500). Non-auth paths respect AGENTHUB_RATE_LIMIT_FAIL_OPEN (default:
// fail-open with a warning log).
func RateLimit(client *cache.Client, limit int, window time.Duration, keyFn func(c *gin.Context) string) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := fmt.Sprintf("rate_limit:%s", keyFn(c))
		ctx := c.Request.Context()

		now := time.Now().UnixMilli()
		windowStart := now - window.Milliseconds()

		rdb := client.GetRDB()

		// Remove expired entries (outside the sliding window).
		if err := rdb.ZRemRangeByScore(ctx, key, "0", fmt.Sprint(windowStart)).Err(); err != nil {
			handleRateLimitError(c, key, err)
			return
		}

		// Add current request before counting so the count includes it.
		// The atomic counter guarantees unique members even when two
		// requests land in the same nanosecond (essential on Windows).
		member := fmt.Sprintf("%d-%d-%d", now, time.Now().UnixNano(), rateLimitMemberID.Add(1))
		if err := rdb.ZAdd(ctx, key, redis.Z{Score: float64(now), Member: member}).Err(); err != nil {
			handleRateLimitError(c, key, err)
			return
		}

		// Set key expiry (window + buffer). Expire error is non-critical — the
		// key will still be cleaned eventually (or on next ZRemRangeByScore).
		rdb.Expire(ctx, key, window+config.RateLimitExpiryBuffer)

		// Count current entries (now includes the one just added).
		count, err := rdb.ZCard(ctx, key).Result()
		if err != nil {
			handleRateLimitError(c, key, err)
			return
		}

		// Strict comparison (>): since ZCard counts after ZAdd, we reject when
		// adding the current request would exceed the limit.
		if count > int64(limit) {
			// Determine how long until the window resets.
			ttl, _ := rdb.TTL(ctx, key).Result()
			retryAfter := int(ttl.Seconds())
			if retryAfter <= 0 {
				retryAfter = int(window.Seconds())
			}
			c.Header("Retry-After", fmt.Sprint(retryAfter))
			fail(c, errcode.New("RATE_LIMITED", "too many requests, please slow down", http.StatusTooManyRequests))
			c.Abort()
			return
		}

		c.Next()
	}
}

// handleRateLimitError handles Redis errors during rate limiting.
func handleRateLimitError(c *gin.Context, key string, err error) {
	if isAuthPath(c) {
		// Auth paths always fail closed.
		fail(c, errcode.ErrInternal)
		c.Abort()
		return
	}
	if config.RateLimitFailOpen() {
		slog.Warn("rate limit Redis unavailable, failing open",
			"path", c.Request.URL.Path,
			"method", c.Request.Method,
			"key", key,
			"error", err,
		)
		c.Header("X-Rate-Limit-Degraded", "true")
		c.Next()
		return
	}
	// Fail closed for non-auth when explicitly configured.
	fail(c, errcode.ErrInternal)
	c.Abort()
}

// IPKey returns the client IP for rate limiting.
func IPKey(c *gin.Context) string {
	return c.ClientIP()
}
