package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestTimeout_HandlerCompletesNormally(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Timeout(5 * time.Second))
	r.GET("/ok", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"msg": "ok"})
	})

	req := httptest.NewRequest(http.MethodGet, "/ok", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestTimeout_FlushesHeaderOnlyStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Timeout(5 * time.Second))
	r.GET("/gone", func(c *gin.Context) {
		c.Status(http.StatusGone)
	})

	req := httptest.NewRequest(http.MethodGet, "/gone", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusGone {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusGone)
	}
}

func TestTimeout_Returns504WhenHandlerSlow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Timeout(100 * time.Millisecond))
	r.GET("/slow", func(c *gin.Context) {
		time.Sleep(5 * time.Second)
		c.JSON(http.StatusOK, gin.H{"msg": "never"})
	})

	req := httptest.NewRequest(http.MethodGet, "/slow", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusGatewayTimeout)
	}
}

func TestTimeout_PreventsConcurrentWritePanic(t *testing.T) {
	// This test verifies that a slow handler does NOT cause a panic when the
	// timeout fires and both paths attempt to write a response. We set a very
	// short timeout and a handler that sleeps then writes. Without the
	// buffered writer, this would panic with "superfluous response.WriteHeader".
	gin.SetMode(gin.TestMode)

	// Drain the default panic handler — we are asserting NO panic.
	original := gin.DefaultWriter

	r := gin.New()
	r.Use(Timeout(10 * time.Millisecond))
	r.GET("/race", func(c *gin.Context) {
		time.Sleep(200 * time.Millisecond)
		// This write would race with the timeout's 504 write, but the
		// buffered writer discards it silently.
		c.JSON(http.StatusOK, gin.H{"msg": "too late"})
	})

	req := httptest.NewRequest(http.MethodGet, "/race", nil)
	w := httptest.NewRecorder()
	// ServeHTTP recovers panics; if there's a race, Gin/http internals
	// would panic on the second WriteHeader.
	r.ServeHTTP(w, req)

	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusGatewayTimeout)
	}

	// Restore
	gin.DefaultWriter = original
}

func TestTimeout_ZeroDurationPassthrough(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Timeout(0))
	r.GET("/zero", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"msg": "ok"})
	})

	req := httptest.NewRequest(http.MethodGet, "/zero", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestTimeout_HandlerRespectsContext(t *testing.T) {
	// Handler that checks context and returns early — no timeout needed.
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Timeout(2 * time.Second))
	r.GET("/ctx-aware", func(c *gin.Context) {
		select {
		case <-c.Request.Context().Done():
			c.AbortWithStatus(http.StatusGatewayTimeout)
			return
		case <-time.After(10 * time.Millisecond):
		}
		c.JSON(http.StatusOK, gin.H{"msg": "fast"})
	})

	req := httptest.NewRequest(http.MethodGet, "/ctx-aware", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestTimeout_HandlerWritesHeadersThenSlow(t *testing.T) {
	// The handler writes a 200 + partial headers quickly, then sleeps.
	// Since we buffer headers, the timeout should still return 504
	// without panic.
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Timeout(50 * time.Millisecond))
	r.GET("/headers-then-slow", func(c *gin.Context) {
		c.Header("X-Custom", "value")
		c.Status(http.StatusOK)
		// Flusher not available in test response recorder, but status is set.
		time.Sleep(5 * time.Second)
		c.JSON(http.StatusOK, gin.H{"msg": "late"})
	})

	req := httptest.NewRequest(http.MethodGet, "/headers-then-slow", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusGatewayTimeout)
	}
}
