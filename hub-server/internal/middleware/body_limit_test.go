package middleware

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBodyLimit_Behavior(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name         string
		maxBytes     int64
		bodySize     int
		expectError  bool
		expectedCode int
	}{
		{
			name:         "small body within limit",
			maxBytes:     1024,
			bodySize:     100,
			expectError:  false,
			expectedCode: http.StatusOK,
		},
		{
			name:         "exact limit body",
			maxBytes:     100,
			bodySize:     100,
			expectError:  false,
			expectedCode: http.StatusOK,
		},
		{
			name:         "body exceeds limit",
			maxBytes:     50,
			bodySize:     100,
			expectError:  true,
			expectedCode: http.StatusBadRequest,
		},
		{
			name:         "empty body",
			maxBytes:     1024,
			bodySize:     0,
			expectError:  false,
			expectedCode: http.StatusOK,
		},
		{
			name:         "1MB limit with small body",
			maxBytes:     1024 * 1024,
			bodySize:     1000,
			expectError:  false,
			expectedCode: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := gin.New()
			r.Use(BodyLimit(tt.maxBytes))

			var readErr error
			r.POST("/test", func(c *gin.Context) {
				_, err := io.ReadAll(c.Request.Body)
				if err != nil {
					readErr = err
					c.Status(http.StatusBadRequest)
					return
				}
				c.Status(http.StatusOK)
			})

			body := strings.Repeat("a", tt.bodySize)
			req := httptest.NewRequest(http.MethodPost, "/test", bytes.NewBufferString(body))
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if tt.expectError {
				require.Error(t, readErr, "expected read error when body exceeds limit")
			} else {
				require.NoError(t, readErr, "unexpected read error")
				assert.Equal(t, tt.expectedCode, w.Code)
			}
		})
	}
}

func TestBodyLimit_ZeroLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(BodyLimit(0)) // Zero limit - any body should fail

	r.POST("/test", func(c *gin.Context) {
		_, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.Status(http.StatusBadRequest)
			return
		}
		c.Status(http.StatusOK)
	})

	body := "any content"
	req := httptest.NewRequest(http.MethodPost, "/test", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// With 0 limit, reading any body should cause an error
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestBodyLimit_GETRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(BodyLimit(100))

	r.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}
