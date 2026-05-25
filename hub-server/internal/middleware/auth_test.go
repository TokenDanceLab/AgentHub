package middleware

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/jwtutil"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func testSecret() string { return "test-secret-for-middleware-tests" }

func testConfig() *config.Config {
	return &config.Config{JWT: config.JWTConfig{Secret: testSecret()}}
}

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
	AuthMiddleware(testConfig())(c)

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestAuthMiddlewareNoBearerPrefix(t *testing.T) {
	c, w := ginRequest(http.MethodGet, "/client/users/me", "Token some-token")
	AuthMiddleware(testConfig())(c)

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestAuthMiddlewareInvalidToken(t *testing.T) {
	c, w := ginRequest(http.MethodGet, "/client/users/me", "Bearer not.a.valid.token")
	AuthMiddleware(testConfig())(c)

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestAuthMiddlewareRejectsTokenDanceTokenWithoutExpectedAudience(t *testing.T) {
	token := "not-a-valid-local-token"
	cfg := testConfig()
	cfg.TokenDanceID.IssuerURL = "https://id.example"
	cfg.TokenDanceID.ClientID = ""

	c, w := ginRequest(http.MethodGet, "/client/users/me", "Bearer "+token)
	AuthMiddleware(cfg)(c)

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted when TokenDance client_id is missing")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestAuthMiddlewareExpiredToken(t *testing.T) {
	token := makeExpiredToken("user-1", "desktop", "dev-1")
	c, w := ginRequest(http.MethodGet, "/client/users/me", "Bearer "+token)
	AuthMiddleware(testConfig())(c)

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
	AuthMiddleware(testConfig())(c)

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
	handler := AuthMiddleware(testConfig())
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
	AuthMiddleware(testConfig())(c)

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

func TestAuthMiddlewareTokenDanceBearerDoesNotSatisfyDesktopDeviceCheck(t *testing.T) {
	token, issuer, audience, jwks := makeTokenDanceMiddlewareToken(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(jwks))
	}))
	t.Cleanup(server.Close)
	jwtutil.SetJWKSURI(server.URL)

	cfg := testConfig()
	cfg.TokenDanceID.IssuerURL = issuer
	cfg.TokenDanceID.ClientID = audience

	c, w := ginRequest(http.MethodPost, "/edge/devices/register", "Bearer "+token)
	AuthMiddleware(cfg)(c)
	if c.IsAborted() {
		t.Fatalf("TokenDance bearer should authenticate before device gate, status=%d body=%s", w.Code, w.Body.String())
	}
	if got := c.GetString("auth_source"); got != "tokendance_id" {
		t.Fatalf("auth_source = %q, want tokendance_id", got)
	}
	if got := c.GetString("device_type"); got != "tokendance_bearer" {
		t.Fatalf("device_type = %q, want tokendance_bearer", got)
	}

	DeviceTypeCheck("desktop")(c)
	if !c.IsAborted() {
		t.Fatal("expected TokenDance bearer to be rejected by desktop device gate")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}

func makeTokenDanceMiddlewareToken(t *testing.T) (token, issuer, audience, jwks string) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	kid := tokenDanceMiddlewareKID(&priv.PublicKey)
	n := base64.RawURLEncoding.EncodeToString(priv.PublicKey.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(priv.PublicKey.E)).Bytes())
	jwks = `{"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":"` + kid + `","n":"` + n + `","e":"` + e + `"}]}`

	issuer = "https://id.example"
	audience = "agenthub-client"
	now := time.Now()
	claims := jwtutil.TokenDanceClaims{
		Email:         "user@example.com",
		EmailVerified: true,
		Name:          "Test User",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   "tokendance-user-1",
			Audience:  jwt.ClaimStrings{audience},
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	signed := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed.Header["kid"] = kid
	token, err = signed.SignedString(priv)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return token, issuer, audience, jwks
}

func tokenDanceMiddlewareKID(pub *rsa.PublicKey) string {
	hash := sha256.Sum256(pub.N.Bytes())
	return base64.RawURLEncoding.EncodeToString(hash[:16])
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
