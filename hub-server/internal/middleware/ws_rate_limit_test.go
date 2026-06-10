package middleware

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/gin-gonic/gin"
)

func TestWSIPRateLimit_AllowsWithinLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(WSIPRateLimit())
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
	r := gin.New()
	r.Use(WSIPRateLimit())
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

	// One more should kick the oldest.
	limiter.Acquire("u1", "conn-extra")
	time.Sleep(50 * time.Millisecond) // Allow goroutine to run.

	if kicked.Load() != 1 {
		t.Fatalf("kicked = %d, want 1", kicked.Load())
	}

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
