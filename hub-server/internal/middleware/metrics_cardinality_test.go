package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"
)

// gatherHTTPPathLabels snapshots http_requests_total series for one
// (method, status) pair as path label → counter value.
func gatherHTTPPathLabels(t *testing.T, method, status string) map[string]float64 {
	t.Helper()
	families, err := prometheus.DefaultGatherer.Gather()
	require.NoError(t, err)
	out := map[string]float64{}
	for _, mf := range families {
		if mf.GetName() != "http_requests_total" {
			continue
		}
		for _, m := range mf.GetMetric() {
			var path string
			methodOK, statusOK := false, false
			for _, lp := range m.GetLabel() {
				switch lp.GetName() {
				case "path":
					path = lp.GetValue()
				case "method":
					methodOK = lp.GetValue() == method
				case "status":
					statusOK = lp.GetValue() == status
				}
			}
			if methodOK && statusOK {
				out[path] = m.GetCounter().GetValue()
			}
		}
	}
	return out
}

func newCardinalityRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(PrometheusMiddleware())
	r.GET("/api/v1/sessions/:id", func(c *gin.Context) { c.Status(http.StatusOK) })
	r.NoRoute(func(c *gin.Context) { c.String(http.StatusNotFound, "not found") })
	r.NoMethod(func(c *gin.Context) { c.String(http.StatusMethodNotAllowed, "method not allowed") })
	return r
}

// TestPrometheusMiddlewareUnmatchedPathsShareOneBoundedSeries is the regression
// guard for unbounded metric cardinality: c.FullPath() is empty for every
// request that matches no route, and using the raw URL path there lets a
// scanner mint one permanent time series per probe (~13-15 counting the
// histogram buckets). All unmatched requests must collapse onto "unmatched".
func TestPrometheusMiddlewareUnmatchedPathsShareOneBoundedSeries(t *testing.T) {
	metrics.Register()
	r := newCardinalityRouter()

	const probes = 25
	probePaths := make([]string, 0, probes)
	for i := 0; i < probes; i++ {
		probePaths = append(probePaths, fmt.Sprintf("/probe-%d/.env", i))
	}

	before := gatherHTTPPathLabels(t, http.MethodGet, "404")
	for _, p := range probePaths {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, p, nil))
		require.Equal(t, http.StatusNotFound, w.Code)
	}
	after := gatherHTTPPathLabels(t, http.MethodGet, "404")

	require.InDelta(t, before[unmatchedPathLabel]+probes, after[unmatchedPathLabel], 0.001,
		"%d distinct unmatched paths must all increment the single bounded series", probes)
	for _, p := range probePaths {
		_, leaked := after[p]
		require.False(t, leaked, "raw URL path %q must never become a metric label", p)
	}
	require.Len(t, after, 1, "unmatched 404s must not grow path label cardinality")
}

// TestPrometheusMiddlewareMatchedRouteKeepsPathTemplate pins the other half of
// the contract: registered routes must still be labelled with their gin path
// template (bounded by the route table), not the concrete request path and not
// "unmatched".
func TestPrometheusMiddlewareMatchedRouteKeepsPathTemplate(t *testing.T) {
	metrics.Register()
	r := newCardinalityRouter()

	const tmpl = "/api/v1/sessions/:id"
	before := gatherHTTPPathLabels(t, http.MethodGet, "200")
	for _, id := range []string{"aaa", "bbb", "ccc"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+id, nil))
		require.Equal(t, http.StatusOK, w.Code)
	}
	after := gatherHTTPPathLabels(t, http.MethodGet, "200")

	require.InDelta(t, before[tmpl]+3, after[tmpl], 0.001,
		"matched requests must be attributed to the route template")
	for _, p := range []string{"/api/v1/sessions/aaa", "/api/v1/sessions/bbb", unmatchedPathLabel} {
		require.NotContains(t, after, p, "concrete/unmatched path %q must not appear for matched routes", p)
	}
}

// TestPrometheusMiddlewareMethodMismatchStaysBounded covers requests whose
// method matches no route. Note the router never sets
// gin's HandleMethodNotAllowed, so these fall through to NoRoute and answer 404
// rather than 405 (registered separately in #2154 as dead r.NoMethod wiring);
// the assertion here is only that distinct method+path combinations still
// collapse onto the one bounded label instead of minting per-path series.
func TestPrometheusMiddlewareMethodMismatchStaysBounded(t *testing.T) {
	metrics.Register()
	r := newCardinalityRouter()

	const probes = 5
	statuses := make([]string, 0, probes)
	before := map[string]float64{}
	for i := 0; i < probes; i++ {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/v1/sessions/s-%d", i), nil))
		status := fmt.Sprintf("%d", w.Code)
		if i == 0 {
			before = gatherHTTPPathLabels(t, http.MethodDelete, status)
		}
		statuses = append(statuses, status)
	}
	require.Equal(t, probes, len(statuses))
	for _, s := range statuses {
		require.Equal(t, statuses[0], s, "method mismatch must answer uniformly")
	}
	after := gatherHTTPPathLabels(t, http.MethodDelete, statuses[0])

	require.InDelta(t, before[unmatchedPathLabel]+float64(probes-1), after[unmatchedPathLabel], 0.001)
	require.Len(t, after, 1, "method-mismatch probes must not grow path label cardinality")
}
