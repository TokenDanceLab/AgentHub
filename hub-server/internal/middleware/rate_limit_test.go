package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func rateLimitTestClient(t *testing.T) *cache.Client {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return cache.NewClient(rdb)
}

func TestRateLimitWindowExpiry(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := rateLimitTestClient(t)

	// Use a very short window to verify the sliding window mechanism.
	handler := RateLimit(client, 3, 50*time.Millisecond, IPKey)

	// Send 2 requests immediately — both pass.
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
		c.Request.RemoteAddr = "10.5.5.5:0"
		handler(c)
		assert.False(t, c.IsAborted(), "request %d should pass", i+1)
	}

	// After window expires, 3rd request still passes.
	time.Sleep(100 * time.Millisecond)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	c.Request.RemoteAddr = "10.5.5.5:0"
	handler(c)
	assert.False(t, c.IsAborted(), "request after window expires should pass")
}

func TestRateLimitDifferentIPs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := rateLimitTestClient(t)

	handler := RateLimit(client, 1, time.Minute, IPKey)

	// IP-A uses its quota.
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	c.Request.RemoteAddr = "10.2.2.2:0"
	handler(c)
	assert.False(t, c.IsAborted())

	// IP-B should still pass.
	w = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	c.Request.RemoteAddr = "10.3.3.3:0"
	handler(c)
	assert.False(t, c.IsAborted())
}

func TestRateLimitExpiryBuffer(t *testing.T) {
	assert.Equal(t, 10*time.Second, config.RateLimitExpiryBuffer)
}

func TestRateLimitCustomKeyFn(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := rateLimitTestClient(t)

	headersKey := func(c *gin.Context) string {
		return c.GetHeader("X-Team-ID")
	}

	handler := RateLimit(client, 1, time.Minute, headersKey)

	// Team red uses its quota.
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	c.Request.Header.Set("X-Team-ID", "red")
	handler(c)
	assert.False(t, c.IsAborted())

	// Team blue still passes.
	w = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
	c.Request.Header.Set("X-Team-ID", "blue")
	handler(c)
	assert.False(t, c.IsAborted())
}

func TestFailHelper(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("writes json with correct status", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)

		fail(c, errcode.SessionNotFound)

		assert.True(t, c.IsAborted())
		assert.Equal(t, http.StatusNotFound, w.Code)
		assert.Contains(t, w.Body.String(), "session_not_found")
	})

	t.Run("defaults to 500 when status is 0", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)

		e := errcode.New("custom", "some message", 0)
		fail(c, e)

		assert.True(t, c.IsAborted())
		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}

// TestRateLimitFailClosed_NonAuthWhenDisabled verifies that the sliding-window rate
// limiter fails closed on non-auth paths when AGENTHUB_RATE_LIMIT_FAIL_OPEN=false,
// returning 503 rate_limit_unavailable (aligned with api/conventions.md and global_rate_limit.go).
func TestRateLimitFailClosed_NonAuthWhenDisabled(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := redisDownClient(t)
	t.Setenv("AGENTHUB_RATE_LIMIT_FAIL_OPEN", "false")

	handler := RateLimit(client, 10, time.Minute, IPKey)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/contacts/search", nil)
	c.Request.RemoteAddr = "10.0.0.99:12345"

	handler(c)

	assert.True(t, c.IsAborted(), "non-auth sliding window should fail-closed when RATE_LIMIT_FAIL_OPEN=false")
	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, w.Body.String(), "rate_limit_unavailable")
}

// TestSlidingWindowRateLimitFailClosed_AuthPath verifies the sliding-window
// limiter returns 503 rate_limit_unavailable on a distinct auth sub-path
// (/client/auth/login) to complement TestRateLimitFailClosed_AuthPath which
// tests /client/auth/refresh in global_rate_limit_test.go.
func TestSlidingWindowRateLimitFailClosed_AuthPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := redisDownClient(t)

	handler := RateLimit(client, 10, time.Minute, IPKey)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/client/auth/login", nil)
	c.Request.RemoteAddr = "10.0.0.99:12345"

	handler(c)

	assert.True(t, c.IsAborted(), "auth sliding window should always fail-closed on Redis fault")
	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, w.Body.String(), "rate_limit_unavailable")
}
