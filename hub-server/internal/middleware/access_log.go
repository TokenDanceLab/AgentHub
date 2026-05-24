package middleware

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
)

func AccessLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}

		slog.Info("access",
			"request_id", GetRequestID(c),
			"method", c.Request.Method,
			"path", path,
			"status", c.Writer.Status(),
			"duration_ms", int(time.Since(start).Milliseconds()),
			"client_ip", c.ClientIP(),
		)
	}
}
