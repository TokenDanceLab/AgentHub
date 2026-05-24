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
// On Redis errors, the middleware fails open (allows the request through).
func GlobalRateLimit(cacheClient *cache.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		_, exceeded, err := cacheClient.CheckRateLimit(c.Request.Context(), "global:"+ip, config.GlobalRateLimitPerMinute)
		if err != nil {
			// Fail open: allow the request through on Redis errors.
			c.Next()
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
