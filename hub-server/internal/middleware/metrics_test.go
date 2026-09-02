package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestPrometheusMiddlewareRecordsMetrics(t *testing.T) {
	metrics.Register()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(PrometheusMiddleware())
	r.GET("/api/v1/health", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})
	r.POST("/api/v1/sessions", func(c *gin.Context) {
		c.JSON(http.StatusCreated, gin.H{"id": "s1"})
	})

	// Send several requests to accumulate metrics.
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, http.StatusOK, w.Code)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusCreated, w.Code)
}

// TestPrometheusMiddlewareUnmatchedRouteUsesBoundedLabel asserts the label
// chosen when gin has no route template for the request. It used to be the raw
// (attacker-controlled, unbounded) URL path; see metrics_cardinality_test.go.
func TestPrometheusMiddlewareUnmatchedRouteUsesBoundedLabel(t *testing.T) {
	metrics.Register()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(PrometheusMiddleware())
	r.NoRoute(func(c *gin.Context) {
		c.String(http.StatusNotFound, "not found")
	})

	// Request a path not matching any route (FullPath is empty).
	req := httptest.NewRequest(http.MethodGet, "/unknown/route", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)

	labels := gatherHTTPPathLabels(t, http.MethodGet, "404")
	assert.NotContains(t, labels, "/unknown/route", "raw URL path must not become a metric label")
	assert.Contains(t, labels, "unmatched", "unmatched requests must be labelled \"unmatched\"")
}

func TestGlobalRateLimitExceededConfig(t *testing.T) {
	assert.Equal(t, int64(100), config.GlobalRateLimitPerMinute)
	assert.Equal(t, 60, config.GlobalRateLimitRetryAfterSeconds)
}
