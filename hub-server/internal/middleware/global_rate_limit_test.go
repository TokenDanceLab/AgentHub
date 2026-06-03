package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func miniredisClient(t *testing.T) *cache.Client {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return cache.NewClient(rdb)
}

func TestGlobalRateLimitAllow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := miniredisClient(t)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)

	GlobalRateLimit(client)(c)

	assert.False(t, c.IsAborted())
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGlobalRateLimitBlocksAfterExceedingLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := miniredisClient(t)

	// Pre-fill the fixed window counter so the next request is rejected.
	ip := "10.0.0.1"
	for i := int64(0); i < config.GlobalRateLimitPerMinute; i++ {
		_, _, err := client.CheckRateLimit(t.Context(), "global:"+ip, config.GlobalRateLimitPerMinute)
		require.NoError(t, err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	c.Request.RemoteAddr = ip + ":12345"

	GlobalRateLimit(client)(c)

	assert.True(t, c.IsAborted())
	assert.Equal(t, http.StatusTooManyRequests, w.Code)
	assert.Contains(t, w.Body.String(), "RATE_LIMITED")
	assert.NotEmpty(t, w.Header().Get("Retry-After"))
}

func TestRateLimitAllow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := miniredisClient(t)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	c.Request.RemoteAddr = "10.0.0.2:1234"

	RateLimit(client, 5, time.Minute, IPKey)(c)

	assert.False(t, c.IsAborted())
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRateLimitBlocksWhenExceeded(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := miniredisClient(t)

	handler := RateLimit(client, 2, time.Minute, IPKey)

	// First two requests should pass.
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
		c.Request.RemoteAddr = "10.0.0.3:0"
		handler(c)
		assert.False(t, c.IsAborted(), "request %d should pass", i+1)
	}

	// Third request should be blocked.
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	c.Request.RemoteAddr = "10.0.0.3:0"
	handler(c)

	assert.True(t, c.IsAborted())
	assert.Equal(t, http.StatusTooManyRequests, w.Code)
	assert.NotEmpty(t, w.Header().Get("Retry-After"))
}

func TestRateLimitRespectsKeyFn(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := miniredisClient(t)

	userKey := func(c *gin.Context) string { return "user-" + c.GetHeader("X-User-ID") }

	handler := RateLimit(client, 1, time.Minute, userKey)

	// User A passes.
	w1 := httptest.NewRecorder()
	c1, _ := gin.CreateTestContext(w1)
	c1.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	c1.Request.Header.Set("X-User-ID", "alice")
	handler(c1)
	assert.False(t, c1.IsAborted())

	// User B also passes (different key).
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	c2.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	c2.Request.Header.Set("X-User-ID", "bob")
	handler(c2)
	assert.False(t, c2.IsAborted())
}

func TestIPKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	c.Request.RemoteAddr = "192.168.1.100:54321"

	assert.Equal(t, "192.168.1.100", IPKey(c))
}
