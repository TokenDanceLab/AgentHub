package reqlog

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
)

// AccessLog returns a Gin middleware that logs every request with structured fields.
// It expects the RequestID middleware to have already set X-Request-ID on the context.
func AccessLogGin() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		// Unmatched routes (404/405) have no FullPath template, so the raw URL
		// path is logged as-is. That is intentional and must not be "fixed" by
		// borrowing the bounded "unmatched" label from the metrics middleware:
		// a log line is per-request and rotated, while a Prometheus series is
		// permanent and unbounded cardinality there is an OOM vector. Debugging
		// a 404 requires the path that was actually requested.
		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}

		slog.Info("access",
			"request_id", GetRequestID(c.Request.Context()),
			"method", c.Request.Method,
			"path", path,
			"status", c.Writer.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
			"client_ip", c.ClientIP(),
		)
	}
}
