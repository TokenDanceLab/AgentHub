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
