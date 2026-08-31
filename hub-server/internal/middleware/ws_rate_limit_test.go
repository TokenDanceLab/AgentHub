package middleware

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestWSIPRateLimit_AllowsWithinLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	limiter := NewWSIPRateLimiter()
	t.Cleanup(limiter.Stop)
	r := gin.New()
	r.Use(WSIPRateLimitWithLimiter(limiter))
	r.GET("/ws", func(c *gin.Context) {
		c.Status(http.StatusSwitchingProtocols)
	})

	for i := 0; i < config.WSIPRateLimitPerMinute; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/ws", nil)
		r.ServeHTTP(w, req)
		if w.Code != http.StatusSwitchingProtocols {
			t.Fatalf("request %d: status = %d, want %d", i, w.Code, http.StatusSwitchingProtocols)
		}
	}
}

func TestWSIPRateLimit_BlocksOverLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	limiter := NewWSIPRateLimiter()
	t.Cleanup(limiter.Stop)
	r := gin.New()
	r.Use(WSIPRateLimitWithLimiter(limiter))
	r.GET("/ws", func(c *gin.Context) {
		c.Status(http.StatusSwitchingProtocols)
	})

	// Exhaust the limit.
	for i := 0; i < config.WSIPRateLimitPerMinute; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/ws", nil)
		r.ServeHTTP(w, req)
	}

	// Next request should be rejected.
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusTooManyRequests)
	}
}

func TestWSUserConnLimiter_AcquireAndRelease(t *testing.T) {
	var kicked atomic.Int32
	limiter := NewWSUserConnLimiter(func(connID string) {
		kicked.Add(1)
	})

	// Acquire max connections for user "u1".
	for i := 0; i < config.WSMaxConnsPerUser; i++ {
		limiter.Acquire("u1", "conn-"+string(rune('a'+i)))
	}

	// One more should kick the oldest. The kick runs in a spawned goroutine,
	// so poll for the side-effect instead of a fixed time.Sleep: a fixed sleep
	// is flaky under CI scheduler jitter (P1: time.Sleep → poll).
	limiter.Acquire("u1", "conn-extra")
	require.Eventually(t, func() bool { return kicked.Load() == 1 },
		time.Second, time.Millisecond,
		"expected exactly one connection to be kicked after exceeding the per-user limit")

	// Release all.
	for i := 0; i < config.WSMaxConnsPerUser; i++ {
		limiter.Acquire("u1", "rel-conn-"+string(rune('a'+i)))
	}
	for i := 0; i < config.WSMaxConnsPerUser; i++ {
		limiter.Release("u1", "rel-conn-"+string(rune('a'+i)))
	}

	// Verify internal map is cleaned up.
	limiter.mu.Lock()
	count := len(limiter.conns["u1"])
	limiter.mu.Unlock()
	if count != 0 {
		t.Fatalf("remaining conns for u1 = %d, want 0", count)
	}
}

func TestWSUserConnLimiter_EmptyUserID_Noop(t *testing.T) {
	limiter := NewWSUserConnLimiter(nil)
	// Should not panic or track empty user.
	limiter.Acquire("", "conn-1")
	limiter.Release("", "conn-1")
}

func TestWSUserConnLimiter_ReleaseIdempotent(t *testing.T) {
	limiter := NewWSUserConnLimiter(nil)
	limiter.Acquire("u1", "conn-1")
	// Release twice should not panic.
	limiter.Release("u1", "conn-1")
	limiter.Release("u1", "conn-1")
}

// TestStopWSIPRateLimiterIdempotent covers the process-wide singleton stop
// wired into App.Shutdown (#2154): it no-ops when the limiter was never
// initialized and stops the cleanup goroutine once initialized, without
// panicking on repeat calls.
func TestStopWSIPRateLimiterIdempotent(t *testing.T) {
	// Never-initialized singleton: must be a safe no-op.
	StopWSIPRateLimiter()
	StopWSIPRateLimiter()

	// Initialize the singleton the same way the production middleware does,
	// then stop it; repeat stops must stay safe.
	limiter := newDefaultWSIPRateLimiter()
	if limiter == nil {
		t.Fatal("newDefaultWSIPRateLimiter returned nil")
	}
	StopWSIPRateLimiter()
	StopWSIPRateLimiter()
}
