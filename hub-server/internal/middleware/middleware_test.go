package middleware

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestSplitAndTrim(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{name: "empty", input: "", want: []string{}},
		{name: "single", input: "https://example.com", want: []string{"https://example.com"}},
		{name: "multiple", input: "https://a.com,https://b.com", want: []string{"https://a.com", "https://b.com"}},
		{name: "with spaces", input: " https://a.com , https://b.com ", want: []string{"https://a.com", "https://b.com"}},
		{name: "trailing comma", input: "https://a.com,", want: []string{"https://a.com"}},
		{name: "leading comma", input: ",https://a.com", want: []string{"https://a.com"}},
		{name: "double comma", input: "https://a.com,,https://b.com", want: []string{"https://a.com", "https://b.com"}},
		{name: "all spaces and commas", input: " , , ", want: []string{}},
		{name: "localhost origins", input: "http://localhost:3000,http://127.0.0.1:5173", want: []string{"http://localhost:3000", "http://127.0.0.1:5173"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := splitAndTrim(tt.input)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestDefaultCORSOrigins(t *testing.T) {
	tests := []struct {
		name string
		env  string
		want string
	}{
		{name: "production", env: "production", want: "https://hub.vectorcontrol.tech"},
		{name: "prod alias", env: "prod", want: "https://hub.vectorcontrol.tech"},
		{name: "release alias", env: "release", want: "https://hub.vectorcontrol.tech"},
		{name: "development", env: "development", want: "https://hub.vectorcontrol.tech,http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"},
		{name: "staging", env: "staging", want: "https://hub.vectorcontrol.tech,http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"},
		{name: "empty env", env: "", want: "https://hub.vectorcontrol.tech,http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := defaultCORSOrigins(tt.env)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestDefaultCORSOriginsIncludesWebDevPortOutsideProduction(t *testing.T) {
	for _, env := range []string{"", "development", "staging"} {
		t.Run(env, func(t *testing.T) {
			origins := splitAndTrim(defaultCORSOrigins(env))
			assert.Contains(t, origins, "http://localhost:5174")
			assert.Contains(t, origins, "http://127.0.0.1:5174")
		})
	}
}

func TestCorsEnvironment(t *testing.T) {
	t.Run("AGENTHUB_ENV takes precedence", func(t *testing.T) {
		os.Setenv("AGENTHUB_ENV", "production")
		defer os.Unsetenv("AGENTHUB_ENV")
		os.Setenv("GIN_MODE", "debug")
		defer os.Unsetenv("GIN_MODE")
		assert.Equal(t, "production", corsEnvironment())
	})

	t.Run("falls back to GIN_MODE", func(t *testing.T) {
		os.Unsetenv("AGENTHUB_ENV")
		os.Setenv("GIN_MODE", "release")
		defer os.Unsetenv("GIN_MODE")
		assert.Equal(t, "release", corsEnvironment())
	})

	t.Run("empty when both unset", func(t *testing.T) {
		os.Unsetenv("AGENTHUB_ENV")
		os.Unsetenv("GIN_MODE")
		assert.Equal(t, "", corsEnvironment())
	})
}

func TestIsProductionEnvironment(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{name: "production exact", input: "production", want: true},
		{name: "uppercase PRODUCTION", input: "PRODUCTION", want: true},
		{name: "mixed case", input: "Production", want: true},
		{name: "prod alias", input: "prod", want: true},
		{name: "PROD uppercase", input: "PROD", want: true},
		{name: "release alias", input: "release", want: true},
		{name: "RELEASE uppercase", input: "RELEASE", want: true},
		{name: "development", input: "development", want: false},
		{name: "staging", input: "staging", want: false},
		{name: "empty", input: "", want: false},
		{name: "debug", input: "debug", want: false},
		{name: "test", input: "test", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, isProductionEnvironment(tt.input))
		})
	}
}

func TestIsLoopbackOrigin(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		want   bool
	}{
		{name: "localhost", origin: "http://localhost:3000", want: true},
		{name: "localhost no port", origin: "http://localhost", want: true},
		{name: "localhost https", origin: "https://localhost:5173", want: true},
		{name: "127.0.0.1", origin: "http://127.0.0.1:8080", want: true},
		{name: "127.0.0.1 no port", origin: "http://127.0.0.1", want: true},
		{name: "::1 ipv6", origin: "http://[::1]:3000", want: true},
		{name: "remote host", origin: "https://hub.vectorcontrol.tech", want: false},
		{name: "external ip", origin: "http://192.168.1.1:8080", want: false},
		{name: "invalid url", origin: "not-a-url", want: false},
		{name: "empty", origin: "", want: false},
		{name: "0.0.0.0", origin: "http://0.0.0.0:3000", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, isLoopbackOrigin(tt.origin))
		})
	}
}

func TestValidateCORSOriginsForEnvironment(t *testing.T) {
	t.Run("allows any origin in non-production", func(t *testing.T) {
		err := validateCORSOriginsForEnvironment("development", []string{"http://localhost:3000"})
		assert.NoError(t, err)
	})

	t.Run("rejects loopback in production", func(t *testing.T) {
		err := validateCORSOriginsForEnvironment("production", []string{"http://localhost:3000"})
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "localhost")
	})

	t.Run("rejects web dev loopback origins in production", func(t *testing.T) {
		origins := []string{
			"http://localhost:5174",
			"http://127.0.0.1:5174",
		}
		for _, origin := range origins {
			err := validateCORSOriginsForEnvironment("production", []string{origin})
			assert.Error(t, err)
			assert.Contains(t, err.Error(), origin)
		}
	})

	t.Run("allows remote origins in production", func(t *testing.T) {
		err := validateCORSOriginsForEnvironment("production", []string{"https://hub.vectorcontrol.tech"})
		assert.NoError(t, err)
	})

	t.Run("empty origins in production", func(t *testing.T) {
		err := validateCORSOriginsForEnvironment("production", []string{})
		assert.NoError(t, err)
	})
}

func TestAPIVersion(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)

	APIVersion()(c)

	assert.Equal(t, "1.0.0", w.Header().Get("X-API-Version"))
}

func TestRequestID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("generates request ID when none provided", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)

		RequestID()(c)

		rid := GetRequestID(c)
		assert.NotEmpty(t, rid)
		assert.Equal(t, rid, w.Header().Get("X-Request-ID"))
	})

	t.Run("reuses existing request ID from header", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/test", nil)
		c.Request.Header.Set("X-Request-ID", "custom-req-id-123")

		RequestID()(c)

		rid := GetRequestID(c)
		assert.Equal(t, "custom-req-id-123", rid)
		assert.Equal(t, "custom-req-id-123", w.Header().Get("X-Request-ID"))
	})
}

func TestBodyLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("sets max bytes reader", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/test", nil)

		BodyLimit(1024)(c)

		assert.NotNil(t, c.Request.Body)
	})
}

func TestGetRequestID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("returns empty string when middleware not applied", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)

		rid := GetRequestID(c)
		assert.Empty(t, rid)
	})
}
