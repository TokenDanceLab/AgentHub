package middleware

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/gin-gonic/gin"
)

// GlobalRateLimit is a per-IP rate limiting middleware that uses a fixed-window
// counter in Redis.
// When Redis is unavailable, auth paths always fail closed (reject the request
// with 503). Non-auth paths respect AGENTHUB_RATE_LIMIT_FAIL_OPEN (default:
// fail-open with a warning log).
func GlobalRateLimit(cacheClient *cache.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		_, exceeded, err := cacheClient.CheckRateLimit(c.Request.Context(), "global:"+ip, config.GlobalRateLimitPerMinute)
		if err != nil {
			if isAuthPath(c) {
				// Auth paths always fail closed.
				fail(c, errcode.New("RATE_LIMIT_UNAVAILABLE", "rate limit service unavailable", http.StatusServiceUnavailable))
				c.Abort()
				return
			}
			if config.RateLimitFailOpen() {
				slog.Warn("rate limit Redis unavailable, failing open",
					"path", c.Request.URL.Path,
					"method", c.Request.Method,
					"ip", ip,
					"error", err,
				)
				c.Header("X-Rate-Limit-Degraded", "true")
				c.Next()
				return
			}
			// Fail closed for non-auth when explicitly configured.
			fail(c, errcode.New("RATE_LIMIT_UNAVAILABLE", "rate limit service unavailable", http.StatusServiceUnavailable))
			c.Abort()
			return
		}
		if exceeded {
			c.Header("Retry-After", strconv.Itoa(config.GlobalRateLimitRetryAfterSeconds))
			fail(c, errcode.New("RATE_LIMITED", "too many requests, please slow down", http.StatusTooManyRequests))
			c.Abort()
			return
		}
		c.Next()
	}
}

// isAuthPath returns true if the request path is an authentication endpoint
// that must always fail closed when Redis is unavailable.
func isAuthPath(c *gin.Context) bool {
	return strings.HasPrefix(c.Request.URL.Path, "/client/auth/")
}
