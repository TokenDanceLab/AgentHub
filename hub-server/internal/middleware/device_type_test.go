package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestDeviceTypeCheck(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name           string
		allowedTypes   []string
		deviceType     string
		expectedAbort  bool
		expectedStatus int
	}{
		{
			name:           "allowed device type passes",
			allowedTypes:   []string{"desktop", "mobile"},
			deviceType:     "desktop",
			expectedAbort:  false,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "second allowed type passes",
			allowedTypes:   []string{"desktop", "mobile"},
			deviceType:     "mobile",
			expectedAbort:  false,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "disallowed device type rejected",
			allowedTypes:   []string{"desktop", "mobile"},
			deviceType:     "unknown",
			expectedAbort:  true,
			expectedStatus: http.StatusForbidden,
		},
		{
			name:           "empty device type rejected",
			allowedTypes:   []string{"desktop", "mobile"},
			deviceType:     "",
			expectedAbort:  true,
			expectedStatus: http.StatusForbidden,
		},
		{
			name:           "single allowed type",
			allowedTypes:   []string{"web"},
			deviceType:     "web",
			expectedAbort:  false,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "single allowed type mismatch",
			allowedTypes:   []string{"web"},
			deviceType:     "mobile",
			expectedAbort:  true,
			expectedStatus: http.StatusForbidden,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := gin.New()

			// Set device_type in context before the check
			r.Use(func(c *gin.Context) {
				c.Set("device_type", tt.deviceType)
				c.Next()
			})
			r.Use(DeviceTypeCheck(tt.allowedTypes...))

			r.GET("/test", func(c *gin.Context) {
				c.Status(http.StatusOK)
			})

			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)
			if tt.expectedAbort {
				assert.Contains(t, w.Body.String(), "AUTH_DEVICE_MISMATCH")
			}
		})
	}
}

func TestDeviceTypeCheck_NoAllowedTypes(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("device_type", "desktop")
		c.Next()
	})
	// No allowed types means nothing passes
	r.Use(DeviceTypeCheck())

	r.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// With no allowed types, all requests should fail
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestDeviceTypeCheck_CaseSensitive(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("device_type", "Desktop") // Note: capital D
		c.Next()
	})
	r.Use(DeviceTypeCheck("desktop")) // lowercase

	r.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Should be case-sensitive
	assert.Equal(t, http.StatusForbidden, w.Code)
}
