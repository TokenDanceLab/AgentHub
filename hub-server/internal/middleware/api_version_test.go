package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestAPIVersion_HeaderOnAllMethods(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name   string
		method string
		path   string
	}{
		{name: "GET", method: http.MethodGet, path: "/api/test"},
		{name: "POST", method: http.MethodPost, path: "/api/users"},
		{name: "PUT", method: http.MethodPut, path: "/api/users/123"},
		{name: "DELETE", method: http.MethodDelete, path: "/api/users/123"},
		{name: "PATCH", method: http.MethodPatch, path: "/api/users/123"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := gin.New()
			r.Use(APIVersion())

			r.Handle(tt.method, tt.path, func(c *gin.Context) {
				c.Status(http.StatusOK)
			})

			req := httptest.NewRequest(tt.method, tt.path, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			assert.Equal(t, http.StatusOK, w.Code)
			assert.Equal(t, "1.0.0", w.Header().Get("X-API-Version"))
		})
	}
}

func TestAPIVersion_ConstValue(t *testing.T) {
	assert.Equal(t, "1.0.0", apiVersion)
}
