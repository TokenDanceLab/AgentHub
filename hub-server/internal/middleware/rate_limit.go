package middleware

import (
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
)

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

		pipe := client.GetRDB().Pipeline()

		// Remove expired entries (outside the sliding window).
		pipe.ZRemRangeByScore(ctx, key, "0", fmt.Sprint(windowStart))

		// Count current entries.
		countCmd := pipe.ZCard(ctx, key)

		// Add current request.
		member := fmt.Sprintf("%d-%d", now, time.Now().UnixNano())
		pipe.ZAdd(ctx, key, redis.Z{Score: float64(now), Member: member})

		// Set key expiry (window + buffer).
		pipe.Expire(ctx, key, window+config.RateLimitExpiryBuffer)

		if _, err := pipe.Exec(ctx); err != nil {
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
			return
		}

		if countCmd.Val() >= int64(limit) {
			// Determine how long until the window resets.
			ttl, _ := client.GetRDB().TTL(ctx, key).Result()
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

// IPKey returns the client IP for rate limiting.
func IPKey(c *gin.Context) string {
	return c.ClientIP()
}
