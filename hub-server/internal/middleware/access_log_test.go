package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestAccessLog(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name           string
		method         string
		path           string
		routePath      string
		expectedStatus int
	}{
		{
			name:           "normal GET request",
			method:         http.MethodGet,
			path:           "/api/test",
			routePath:      "/api/test",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "POST request",
			method:         http.MethodPost,
			path:           "/api/users",
			routePath:      "/api/users",
			expectedStatus: http.StatusCreated,
		},
		{
			name:           "request with path parameter",
			method:         http.MethodGet,
			path:           "/api/users/123",
			routePath:      "/api/users/:id",
			expectedStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := gin.New()
			r.Use(RequestID())
			r.Use(AccessLog())

			r.Handle(tt.method, tt.routePath, func(c *gin.Context) {
				c.Status(tt.expectedStatus)
			})

			req := httptest.NewRequest(tt.method, tt.path, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)
		})
	}
}

func TestAccessLog_WithoutRequestID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(AccessLog()) // No RequestID middleware

	r.GET("/api/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAccessLog_UnmatchedRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(AccessLog())

	// Only register one route
	r.GET("/api/exists", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	// Request a route that doesn't exist
	req := httptest.NewRequest(http.MethodGet, "/api/not-exists", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Should still log with the actual path
	assert.Equal(t, http.StatusNotFound, w.Code)
}
