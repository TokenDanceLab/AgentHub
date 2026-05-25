package middleware

import (
	"net/http"
	"strconv"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/gin-gonic/gin"
)

// GlobalRateLimit is a per-IP rate limiting middleware that uses a fixed-window
// counter in Redis.
// On Redis errors, the middleware fails closed (rejects the request).
func GlobalRateLimit(cacheClient *cache.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		_, exceeded, err := cacheClient.CheckRateLimit(c.Request.Context(), "global:"+ip, config.GlobalRateLimitPerMinute)
		if err != nil {
			// Fail closed: reject request when Redis is unavailable.
			handler.Fail(c, errcode.New("RATE_LIMIT_UNAVAILABLE", "rate limit service unavailable", http.StatusServiceUnavailable))
			c.Abort()
			return
		}
		if exceeded {
			c.Header("Retry-After", strconv.Itoa(config.GlobalRateLimitRetryAfterSeconds))
			handler.Fail(c, errcode.New("RATE_LIMITED", "too many requests, please slow down", http.StatusTooManyRequests))
			c.Abort()
			return
		}
		c.Next()
	}
}
