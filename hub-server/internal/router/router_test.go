package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
)

func TestNoRouteReturnsNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	metrics.Register()

	r := gin.New()
	SetupRoutes(
		r,
		&config.Config{},
		"",
		cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()})),
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
	)

	for _, path := range []string{"/does-not-exist", "/metrics", "/debug/pprof/"} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			w := httptest.NewRecorder()

			r.ServeHTTP(w, req)

			if w.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d; body=%q", w.Code, http.StatusNotFound, w.Body.String())
			}
		})
	}
}
