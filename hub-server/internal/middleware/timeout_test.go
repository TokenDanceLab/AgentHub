package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestTimeout_WebSocketUpgradeBypassesBuffer(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// 极短 deadline：若 upgrade 请求被 timeoutWriter 包装会直接超时；
	// 修复后 upgrade 请求绕过包装，handler 正常完成。
	r.Use(Timeout(10 * time.Millisecond))
	r.GET("/ws", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"msg": "upgrade-passed"})
	})

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (upgrade request must not hit timeout wrapper)", w.Code, http.StatusOK)
	}
}

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

// TestTimeout_HandlerPanicReturns500 verifies the goroutine recover in the
// Timeout middleware: a handler that panics inside the spawned goroutine is
// recovered and the client receives a 500 JSON error instead of a process
// crash or an empty 200. CustomRecovery's defer-recover lives in the request
// goroutine and cannot catch a panic that escapes the spawned goroutine, so
// the Timeout goroutine owns its own recover.
func TestTimeout_HandlerPanicReturns500(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Timeout(5 * time.Second))
	r.GET("/boom", func(c *gin.Context) {
		panic("timeout goroutine panic")
	})

	req := httptest.NewRequest(http.MethodGet, "/boom", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d (goroutine recover must synthesize 500)", w.Code, http.StatusInternalServerError)
	}
	body := w.Body.String()
	if !strings.Contains(body, `"code":"internal_error"`) {
		t.Fatalf("response body = %q, want JSON envelope with internal_error code", body)
	}
}

func TestTimeoutStream_ReturnsTimeoutWhenNothingWritten(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(TimeoutStream(50 * time.Millisecond))
	r.GET("/slow", func(c *gin.Context) {
		// Block until the deadline fires and return without writing anything:
		// the client must still receive the timeout error.
		<-c.Request.Context().Done()
	})

	req := httptest.NewRequest(http.MethodGet, "/slow", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusGatewayTimeout)
	}
	body := w.Body.String()
	if !strings.Contains(body, `"code":"request_timeout"`) {
		t.Fatalf("body = %q, want request_timeout envelope", body)
	}
}

func TestTimeoutStream_NormalResponsePasses(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(TimeoutStream(5 * time.Second))
	r.GET("/ok", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"msg": "ok"})
	})

	req := httptest.NewRequest(http.MethodGet, "/ok", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if !strings.Contains(w.Body.String(), `"msg":"ok"`) {
		t.Fatalf("body = %q, want unbuffered normal response", w.Body.String())
	}
}

func TestTimeoutStream_KeepsResponseOnceWritten(t *testing.T) {
	// Once the handler has written a response, a fired deadline cannot
	// rewrite it to a timeout error — the stream is left to finish.
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(TimeoutStream(50 * time.Millisecond))
	r.GET("/written", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"msg": "early"})
		<-c.Request.Context().Done()
	})

	req := httptest.NewRequest(http.MethodGet, "/written", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (written response must survive the deadline)", w.Code, http.StatusOK)
	}
}

func TestTimeoutStream_ZeroDurationPassthrough(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(TimeoutStream(0))
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

func TestTimeoutStream_WebSocketUpgradeBypass(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(TimeoutStream(10 * time.Millisecond))
	r.GET("/ws", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"msg": "upgrade-passed"})
	})

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (upgrade request must bypass timeout)", w.Code, http.StatusOK)
	}
}
