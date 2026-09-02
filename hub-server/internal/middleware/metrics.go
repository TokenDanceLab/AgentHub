package middleware

import (
	"strconv"
	"time"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/gin-gonic/gin"
)

// unmatchedPathLabel is the metric label used for requests that matched no
// registered route — gin's FullPath() returns "" there, which covers both
// router.NoRoute (404) and router.NoMethod (405).
//
// The raw URL path must never become a label value. It is attacker-controlled
// and unbounded, so a scanner probing /.env, /wp-login.php or random UUID paths
// would mint one new http_requests_total series per probe plus ~13-15 more in
// http_request_duration_seconds (11 buckets + sum + count). Prometheus never
// evicts series: sustained scanning grows the heap until OOM and makes
// /metrics itself expensive to scrape (and the buffered Timeout middleware then
// reads that whole body into memory). Bounding the label keeps cardinality at
// "number of registered routes + 1".
//
// Access logs deliberately keep the real path (see pkg/reqlog/gin.go): a log
// record is per-request and rotated away, a metric series is permanent.
const unmatchedPathLabel = "unmatched"

func PrometheusMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		c.Next()

		path := c.FullPath()
		if path == "" {
			path = unmatchedPathLabel
		}
		status := strconv.Itoa(c.Writer.Status())

		metrics.HTTPRequestsTotal.WithLabelValues(c.Request.Method, path, status).Inc()
		metrics.HTTPDuration.WithLabelValues(c.Request.Method, path, status).Observe(time.Since(start).Seconds())
	}
}
