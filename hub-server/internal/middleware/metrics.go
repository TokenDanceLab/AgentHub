package middleware

import (
	"strconv"
	"time"

<<<<<<< HEAD
	"github.com/gin-gonic/gin"
	"github.com/agenthub/server-hub/internal/metrics"
=======
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/gin-gonic/gin"
>>>>>>> origin/master
)

func PrometheusMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		c.Next()

		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}
		status := strconv.Itoa(c.Writer.Status())

		metrics.HTTPRequestsTotal.WithLabelValues(c.Request.Method, path, status).Inc()
		metrics.HTTPDuration.WithLabelValues(c.Request.Method, path, status).Observe(time.Since(start).Seconds())
	}
}
