package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/jwtutil"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func testSecret() string { return "test-secret-for-middleware-tests" }

func makeToken(userID, deviceType, deviceID string) string {
	token, err := jwtutil.GenerateAccessToken(userID, deviceType, deviceID, testSecret(), time.Hour)
	if err != nil {
		panic(err)
	}
	return token
}

func makeExpiredToken(userID, deviceType, deviceID string) string {
	token, err := jwtutil.GenerateAccessToken(userID, deviceType, deviceID, testSecret(), -time.Hour)
	if err != nil {
		panic(err)
	}
	return token
}

func ginRequest(method, path, authHeader string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, path, nil)
	if authHeader != "" {
		c.Request.Header.Set("Authorization", authHeader)
	}
	return c, w
}

// --- AuthMiddleware tests ---

func TestAuthMiddlewareNoHeader(t *testing.T) {
	c, w := ginRequest(http.MethodGet, "/client/users/me", "")
	AuthMiddleware(testSecret())(c)

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestAuthMiddlewareNoBearerPrefix(t *testing.T) {
	c, w := ginRequest(http.MethodGet, "/client/users/me", "Token some-token")
	AuthMiddleware(testSecret())(c)

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestAuthMiddlewareInvalidToken(t *testing.T) {
	c, w := ginRequest(http.MethodGet, "/client/users/me", "Bearer not.a.valid.token")
	AuthMiddleware(testSecret())(c)

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestAuthMiddlewareExpiredToken(t *testing.T) {
	token := makeExpiredToken("user-1", "desktop", "dev-1")
	c, w := ginRequest(http.MethodGet, "/client/users/me", "Bearer "+token)
	AuthMiddleware(testSecret())(c)

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted for expired token")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestAuthMiddlewareWrongSecret(t *testing.T) {
	token, _ := jwtutil.GenerateAccessToken("user-1", "desktop", "dev-1", "wrong-secret", time.Hour)
	c, w := ginRequest(http.MethodGet, "/client/users/me", "Bearer "+token)
	AuthMiddleware(testSecret())(c)

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted for wrong secret")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestAuthMiddlewareValidToken(t *testing.T) {
	token := makeToken("user-42", "desktop", "dev-42")
	called := false
	next := func(c *gin.Context) { called = true }

	c, w := ginRequest(http.MethodGet, "/client/users/me", "Bearer "+token)
	handler := AuthMiddleware(testSecret())
	handler(c)
	if !c.IsAborted() {
		next(c)
	}

	if c.IsAborted() {
		t.Fatal("expected request not to be aborted")
	}
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if !called {
		t.Fatal("expected next handler to be called")
	}
}

func TestAuthMiddlewareSetsContextValues(t *testing.T) {
	token := makeToken("user-99", "mobile", "dev-mobile-1")

	c, _ := ginRequest(http.MethodGet, "/client/users/me", "Bearer "+token)
	AuthMiddleware(testSecret())(c)

	if c.IsAborted() {
		t.Fatal("expected request not to be aborted")
	}
	if got := c.GetString("user_id"); got != "user-99" {
		t.Fatalf("user_id = %q, want user-99", got)
	}
	if got := c.GetString("device_type"); got != "mobile" {
		t.Fatalf("device_type = %q, want mobile", got)
	}
	if got := c.GetString("device_id"); got != "dev-mobile-1" {
		t.Fatalf("device_id = %q, want dev-mobile-1", got)
	}
}

// --- DeviceTypeCheck tests ---

func TestDeviceTypeCheckAllowed(t *testing.T) {
	called := false
	next := func(c *gin.Context) { called = true }

	c, _ := ginRequest(http.MethodGet, "/client/sessions", "")
	c.Set("device_type", "desktop")

	handler := DeviceTypeCheck("desktop", "mobile")
	handler(c)
	if !c.IsAborted() {
		next(c)
	}

	if c.IsAborted() {
		t.Fatal("expected request not to be aborted for allowed device type")
	}
	if !called {
		t.Fatal("expected next handler to be called")
	}
}

func TestDeviceTypeCheckDisallowed(t *testing.T) {
	called := false
	next := func(c *gin.Context) { called = true }

	c, w := ginRequest(http.MethodGet, "/client/sessions", "")
	c.Set("device_type", "web")

	handler := DeviceTypeCheck("desktop", "mobile")
	handler(c)
	if !c.IsAborted() {
		next(c)
	}

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted for disallowed device type")
	}
	if called {
		t.Fatal("expected next handler not to be called")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}

func TestDeviceTypeCheckEmptyType(t *testing.T) {
	called := false
	next := func(c *gin.Context) { called = true }

	c, w := ginRequest(http.MethodGet, "/client/sessions", "")

	handler := DeviceTypeCheck("desktop")
	handler(c)
	if !c.IsAborted() {
		next(c)
	}

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted for empty device type")
	}
	if called {
		t.Fatal("expected next handler not to be called")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}

func TestDeviceTypeCheckSingleAllowed(t *testing.T) {
	called := false
	next := func(c *gin.Context) { called = true }

	c, _ := ginRequest(http.MethodGet, "/client/sessions", "")
	c.Set("device_type", "desktop")

	handler := DeviceTypeCheck("desktop")
	handler(c)
	if !c.IsAborted() {
		next(c)
	}

	if c.IsAborted() {
		t.Fatal("expected request not to be aborted for the only allowed type")
	}
	if !called {
		t.Fatal("expected next handler to be called")
	}
}

func TestDeviceTypeCheckNoAllowedTypes(t *testing.T) {
	called := false
	next := func(c *gin.Context) { called = true }

	c, w := ginRequest(http.MethodGet, "/client/sessions", "")
	c.Set("device_type", "desktop")

	handler := DeviceTypeCheck() // no allowed types
	handler(c)
	if !c.IsAborted() {
		next(c)
	}

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted when no types are allowed")
	}
	if called {
		t.Fatal("expected next handler not to be called")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}

func TestDeviceTypeCheckMultipleAllowedTypes(t *testing.T) {
	tests := []struct {
		name        string
		deviceType  string
		allowed     []string
		shouldAbort bool
	}{
		{"desktop allowed in list", "desktop", []string{"desktop", "mobile", "web"}, false},
		{"mobile allowed in list", "mobile", []string{"desktop", "mobile", "web"}, false},
		{"web allowed in list", "web", []string{"desktop", "mobile", "web"}, false},
		{"tablet not in list", "tablet", []string{"desktop", "mobile"}, true},
		{"case sensitive mismatch", "Desktop", []string{"desktop"}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called := false
			next := func(c *gin.Context) { called = true }

			c, _ := ginRequest(http.MethodGet, "/client/sessions", "")
			c.Set("device_type", tt.deviceType)

			handler := DeviceTypeCheck(tt.allowed...)
			handler(c)
			if !c.IsAborted() {
				next(c)
			}

			if tt.shouldAbort {
				if !c.IsAborted() {
					t.Fatal("expected request to be aborted")
				}
				if called {
					t.Fatal("expected next handler not to be called")
				}
			} else {
				if c.IsAborted() {
					t.Fatal("expected request not to be aborted")
				}
				if !called {
					t.Fatal("expected next handler to be called")
				}
			}
		})
	}
}

// --- AccessLog tests ---

func TestAccessLogCallsNext(t *testing.T) {
	called := false
	next := func(c *gin.Context) {
		called = true
		c.Status(http.StatusOK)
	}

	c, _ := ginRequest(http.MethodGet, "/v1/health", "")
	handler := AccessLog()
	handler(c)
	next(c)

	if !called {
		t.Fatal("expected next handler to be called")
	}
}

func TestAccessLogDoesNotModifyResponse(t *testing.T) {
	// Use a Gin engine to exercise the full handler chain including c.Next().
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(AccessLog())
	router.GET("/test", func(c *gin.Context) {
		c.String(http.StatusCreated, "created")
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", w.Code)
	}
}
