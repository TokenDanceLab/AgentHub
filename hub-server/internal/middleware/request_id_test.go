package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestRequestID_EchoesInResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(RequestID())
	r.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	customID := "custom-id-12345"
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("X-Request-ID", customID)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, customID, w.Header().Get("X-Request-ID"))
}

func TestRequestID_GeneratedIDFormat(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(RequestID())

	var capturedID string
	r.GET("/test", func(c *gin.Context) {
		capturedID = GetRequestID(c)
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.NotEmpty(t, capturedID)
	assert.Len(t, capturedID, 36, "generated ID should be UUID format")
}

func TestRequestID_ConstantValues(t *testing.T) {
	assert.Equal(t, "X-Request-ID", requestIDHeader)
	assert.Equal(t, "request_id", RequestIDKey)
}
