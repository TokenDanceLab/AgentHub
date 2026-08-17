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
	assert.Contains(t, w.Body.String(), "rate_limited")
	assert.NotEmpty(t, w.Header().Get("Retry-After"))
}

// TestGlobalRateLimitFailOpen_NonAuthPath verifies that when Redis is down and the
// request is on a non-auth path, the middleware fails open (allows the request)
// and sets the X-Rate-Limit-Degraded header.
func TestGlobalRateLimitFailOpen_NonAuthPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := redisDownClient(t)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	c.Request.RemoteAddr = "10.0.0.99:12345"

	GlobalRateLimit(client)(c)

	assert.False(t, c.IsAborted(), "non-auth request should pass when Redis is down (fail-open)")
	assert.Equal(t, "true", w.Header().Get("X-Rate-Limit-Degraded"))
}

// TestGlobalRateLimitFailClosed_AuthPath verifies that auth paths always fail
// closed when Redis is unavailable, regardless of the fail-open env var.
func TestGlobalRateLimitFailClosed_AuthPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := redisDownClient(t)

	tests := []string{
		"/client/auth/refresh",
		"/client/auth/oidc/authorize",
		"/client/auth/oidc/callback",
		"/client/auth/me",
		"/client/auth/logout",
	}

	for _, path := range tests {
		t.Run("path="+path, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodPost, path, nil)
			c.Request.RemoteAddr = "10.0.0.99:12345"

			GlobalRateLimit(client)(c)

			assert.True(t, c.IsAborted(), "auth path %s should fail-closed when Redis is down", path)
			assert.Equal(t, http.StatusServiceUnavailable, w.Code)
			assert.Contains(t, w.Body.String(), "rate_limit_unavailable")
		})
	}
}

// TestGlobalRateLimitFailClosed_NonAuthWhenDisabled verifies that non-auth paths
// fail closed when AGENTHUB_RATE_LIMIT_FAIL_OPEN is explicitly set to false.
func TestGlobalRateLimitFailClosed_NonAuthWhenDisabled(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := redisDownClient(t)
	t.Setenv("AGENTHUB_RATE_LIMIT_FAIL_OPEN", "false")

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/contacts/search", nil)
	c.Request.RemoteAddr = "10.0.0.99:12345"

	GlobalRateLimit(client)(c)

	assert.True(t, c.IsAborted(), "non-auth request should fail-closed when RATE_LIMIT_FAIL_OPEN=false")
	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, w.Body.String(), "rate_limit_unavailable")
}

// TestIsAuthPath verifies the path classification helper.
func TestIsAuthPath(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		path     string
		expected bool
	}{
		{"/client/auth/refresh", true},
		{"/client/auth/oidc/authorize", true},
		{"/client/auth/oidc/callback", true},
		{"/client/auth/me", true},
		{"/client/auth/logout", true},
		{"/client/auth/", true},
		{"/api/test", false},
		{"/client/ws", false},
		{"/client/sessions", false},
		{"/client/contacts/search", false},
		{"/health", false},
		{"/edge/devices/register", false},
		{"/web/agent-tasks", false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodGet, tt.path, nil)

			assert.Equal(t, tt.expected, isAuthPath(c))
		})
	}
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

// TestRateLimitFailOpen_NonAuthPath verifies that the sliding-window rate limiter
// fails open on non-auth paths when Redis is unavailable.
func TestRateLimitFailOpen_NonAuthPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := redisDownClient(t)

	handler := RateLimit(client, 10, time.Minute, IPKey)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/messages/search", nil)
	c.Request.RemoteAddr = "10.0.0.99:12345"

	handler(c)

	assert.False(t, c.IsAborted(), "non-auth sliding window should fail-open when Redis is down")
	assert.Equal(t, "true", w.Header().Get("X-Rate-Limit-Degraded"))
}

// TestRateLimitFailClosed_AuthPath verifies that the sliding-window rate limiter
// always fails closed on auth paths when Redis is unavailable.
func TestRateLimitFailClosed_AuthPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := redisDownClient(t)

	handler := RateLimit(client, config.AuthLoginRateLimit, config.AuthRateLimitWindow, IPKey)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/client/auth/refresh", nil)
	c.Request.RemoteAddr = "10.0.0.99:12345"

	handler(c)

	assert.True(t, c.IsAborted(), "auth path sliding window should fail-closed when Redis is down")
	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, w.Body.String(), "rate_limit_unavailable")
}

// redisDownClient creates a cache client whose underlying Redis server is shut
// down so that all Redis operations return connection errors.
//
// MaxRetries=0 + a short DialTimeout turn off go-redis retry backoff: without
// these, every operation against the closed server retries with exponential
// backoff (~8.5s per fail-closed test). With them, each operation fails
// immediately on the first connection attempt (P1: redisDownClient 不关重试致
// 慢测试).
func redisDownClient(t *testing.T) *cache.Client {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	rdb := redis.NewClient(&redis.Options{
		Addr:        mr.Addr(),
		MaxRetries:  0,
		DialTimeout: 300 * time.Millisecond,
	})
	client := cache.NewClient(rdb)
	// Close the miniredis server so subsequent operations fail.
	mr.Close()
	return client
}

func TestIPKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	c.Request.RemoteAddr = "192.168.1.100:54321"

	assert.Equal(t, "192.168.1.100", IPKey(c))
}
