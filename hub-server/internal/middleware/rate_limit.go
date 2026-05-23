package middleware

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
)

// RateLimit returns a middleware that enforces a sliding-window rate limit
// using Redis. limit is the maximum number of requests allowed within window.
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
		pipe.Expire(ctx, key, window+10*time.Second)

		if _, err := pipe.Exec(ctx); err != nil {
			handler.Fail(c, errcode.ErrInternal)
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
			handler.Fail(c, errcode.New("RATE_LIMITED", "too many requests, please slow down", http.StatusTooManyRequests))
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
