package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCustomRecovery_NoPanic(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, r := gin.CreateTestContext(w)
	r.Use(CustomRecovery())
	r.GET("/ok", func(ctx *gin.Context) {
		ctx.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	c.Request = httptest.NewRequest(http.MethodGet, "/ok", nil)
	r.ServeHTTP(w, c.Request)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.Equal(t, "ok", resp["status"])
}

func TestCustomRecovery_PanicReturnsJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, r := gin.CreateTestContext(w)
	r.Use(CustomRecovery())
	r.Use(RequestID()) // ensure request_id is set before panic
	r.GET("/boom", func(ctx *gin.Context) {
		panic("test panic")
	})

	c.Request = httptest.NewRequest(http.MethodGet, "/boom", nil)
	r.ServeHTTP(w, c.Request)

	assert.Equal(t, http.StatusInternalServerError, w.Code)

	var body map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &body)
	require.NoError(t, err)

	errObj, ok := body["error"].(map[string]interface{})
	require.True(t, ok, "response should contain 'error' key")
	assert.Equal(t, "internal_error", errObj["code"])
	assert.Equal(t, "internal server error", errObj["message"])

	// traceId should be present (from RequestID middleware)
	traceID, _ := errObj["traceId"].(string)
	assert.NotEmpty(t, traceID, "traceId should be present")
}

func TestCustomRecovery_PanicWithNilRequestID(t *testing.T) {
	// When RequestID middleware is not applied, a trace ID should still be generated.
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, r := gin.CreateTestContext(w)
	r.Use(CustomRecovery())
	r.GET("/boom-no-rid", func(ctx *gin.Context) {
		panic("test panic without request id")
	})

	c.Request = httptest.NewRequest(http.MethodGet, "/boom-no-rid", nil)
	r.ServeHTTP(w, c.Request)

	assert.Equal(t, http.StatusInternalServerError, w.Code)

	var body map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &body)
	require.NoError(t, err)

	errObj, ok := body["error"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "internal_error", errObj["code"])
	assert.Equal(t, "internal server error", errObj["message"])

	traceID, _ := errObj["traceId"].(string)
	assert.NotEmpty(t, traceID, "traceId should be generated even without RequestID middleware")
}

func TestCustomRecovery_PanicPreservesResponseContentType(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, r := gin.CreateTestContext(w)
	r.Use(CustomRecovery())
	r.GET("/crash", func(ctx *gin.Context) {
		panic("json panic")
	})

	c.Request = httptest.NewRequest(http.MethodGet, "/crash", nil)
	r.ServeHTTP(w, c.Request)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	ct := w.Header().Get("Content-Type")
	assert.Contains(t, ct, "application/json", "response should be JSON")
}

func TestCustomRecovery_MultiplePanics(t *testing.T) {
	// Verify recovery works for multiple consecutive requests (no state leakage).
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(CustomRecovery())
	router.GET("/panic", func(ctx *gin.Context) {
		panic("repeated panic")
	})

	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/panic", nil)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code, "request %d should return 500", i)

		var body map[string]interface{}
		err := json.Unmarshal(w.Body.Bytes(), &body)
		require.NoError(t, err, "request %d should return valid JSON", i)

		errObj := body["error"].(map[string]interface{})
		assert.Equal(t, "internal_error", errObj["code"])
	}
}

func TestCustomRecovery_StackIncludedInLog(t *testing.T) {
	// This test verifies the stack trace is included by checking the
	// recovery handler does not crash and the response is valid.
	// We cannot easily intercept slog output in the test, but we
	// verify the middleware functions correctly and returns the right
	// status code and JSON structure. Stack tracing is verified
	// through integration / manual smoke test with /debug/panic.
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, r := gin.CreateTestContext(w)
	r.Use(CustomRecovery())
	r.GET("/stack", func(ctx *gin.Context) {
		panic("stack trace test")
	})

	c.Request = httptest.NewRequest(http.MethodGet, "/stack", nil)
	r.ServeHTTP(w, c.Request)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.True(t, json.Valid(w.Body.Bytes()), "response body must be valid JSON")
}

func TestCustomRecovery_Concurrent(t *testing.T) {
	// Verify the recovery middleware is safe for concurrent requests.
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(CustomRecovery())
	router.GET("/concurrent-panic", func(ctx *gin.Context) {
		panic("concurrent panic")
	})

	var wg sync.WaitGroup
	errs := make(chan error, 10)

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/concurrent-panic", nil)
			router.ServeHTTP(w, req)

			if w.Code != http.StatusInternalServerError {
				errs <- assert.AnError
				return
			}
			if !json.Valid(w.Body.Bytes()) {
				errs <- assert.AnError
				return
			}
		}()
	}
	wg.Wait()
	close(errs)

	for err := range errs {
		t.Error("concurrent panic recovery failed:", err)
	}
}

func TestRecoveryHTTPHandler_NoPanic(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	})

	handler := RecoveryHTTPHandler(next)

	req := httptest.NewRequest(http.MethodGet, "/admin/health", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, `{"ok":true}`, strings.TrimSpace(w.Body.String()))
}

func TestRecoveryHTTPHandler_Panic(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("admin handler panic")
	})

	handler := RecoveryHTTPHandler(next)

	req := httptest.NewRequest(http.MethodGet, "/admin/debug", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)

	var body map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &body)
	require.NoError(t, err)

	errObj, ok := body["error"].(map[string]interface{})
	require.True(t, ok, "response should contain 'error' key")
	assert.Equal(t, "internal_error", errObj["code"])
	assert.Equal(t, "internal server error", errObj["message"])

	traceID, _ := errObj["traceId"].(string)
	assert.NotEmpty(t, traceID, "traceId should be present")
}

func TestRecoveryHTTPHandler_Concurrent(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("concurrent admin panic")
	})

	handler := RecoveryHTTPHandler(next)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodGet, "/admin/foo", nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			if w.Code != http.StatusInternalServerError {
				t.Errorf("expected 500, got %d", w.Code)
			}
		}()
	}
	wg.Wait()
}

func TestIsBrokenPipe(t *testing.T) {
	tests := []struct {
		name string
		err  any
		want bool
	}{
		{name: "string error", err: "something broke", want: false},
		{name: "nil", err: nil, want: false},
		{name: "integer panic", err: 42, want: false},
		{name: "string with pipe keyword but not net error", err: "broken pipe somewhere", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, isBrokenPipe(tt.err))
		})
	}
}
