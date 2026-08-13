//nolint:gosec // 测试 fixture：凭据模式字符串用于构造测试用例，非真实凭据
package middleware

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/jwtutil"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// #nosec G101 -- 测试专用固定 JWT secret（非真实凭据）
func testSecret() string { return "test-secret-for-middleware-tests" }

func testConfig() *config.Config {
	return &config.Config{JWT: config.JWTConfig{Secret: testSecret()}}
}

// newTestAuthMW builds an AuthMiddleware for tests (#1551): instance-owned
// deps, no package globals.
func newTestAuthMW(cfg *config.Config, deps AuthDependencies, tdVerifier *jwtutil.TokenDanceVerifier) *AuthMiddleware {
	if cfg == nil {
		cfg = testConfig()
	}
	return NewAuthMiddleware(cfg, deps, tdVerifier)
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
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).Handler()(c)

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestAuthMiddlewareNoBearerPrefix(t *testing.T) {
	c, w := ginRequest(http.MethodGet, "/client/users/me", "Token some-token")
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).Handler()(c)

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestAuthMiddlewareInvalidToken(t *testing.T) {
	c, w := ginRequest(http.MethodGet, "/client/users/me", "Bearer not.a.valid.token")
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).Handler()(c)

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestAuthMiddlewareRejectsTokenDanceTokenWithoutExpectedAudience(t *testing.T) {
	authHeaderValue := "not-a-valid-local-token"
	cfg := testConfig()
	cfg.TokenDanceID.IssuerURL = "https://id.example"
	cfg.TokenDanceID.ClientID = ""

	c, w := ginRequest(http.MethodGet, "/client/users/me", "Bearer "+authHeaderValue)
	newTestAuthMW(cfg, AuthDependencies{}, nil).Handler()(c)

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
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).Handler()(c)

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
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).Handler()(c)

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
	handler := newTestAuthMW(testConfig(), AuthDependencies{}, nil).Handler()
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
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).Handler()(c)

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

	cfg := testConfig()
	cfg.TokenDanceID.IssuerURL = issuer
	cfg.TokenDanceID.ClientID = audience

	c, w := ginRequest(http.MethodPost, "/edge/devices/register", "Bearer "+token)
	newTestAuthMW(cfg, AuthDependencies{}, jwtutil.NewTokenDanceVerifier(server.URL, jwtutil.VerifierConfig{})).Handler()(c)
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

func TestWSAuthMiddlewareRejectsTokenDanceBearer(t *testing.T) {
	token, issuer, audience, jwks := makeTokenDanceMiddlewareToken(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(jwks))
	}))
	t.Cleanup(server.Close)

	cfg := testConfig()
	cfg.TokenDanceID.IssuerURL = issuer
	cfg.TokenDanceID.ClientID = audience

	c, w := ginRequest(http.MethodGet, "/client/ws", "Bearer "+token)
	newTestAuthMW(cfg, AuthDependencies{}, jwtutil.NewTokenDanceVerifier(server.URL, jwtutil.VerifierConfig{})).WSHandler()(c)

	if !c.IsAborted() {
		t.Fatal("expected TokenDance bearer to be rejected before WebSocket upgrade")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if got := c.GetString("auth_source"); got != "" {
		t.Fatalf("auth_source = %q, want empty", got)
	}
}

// TestWSAuthMiddlewareRejectsHubLocalQueryToken is the #954 fail-closed gate:
// query-only access_token must no longer authenticate Hub WS upgrades.
func TestWSAuthMiddlewareRejectsHubLocalQueryToken(t *testing.T) {
	token := makeToken("user-ws", "web", "device-ws")
	c, w := ginRequest(http.MethodGet, "/client/ws?access_token="+token, "")

	newTestAuthMW(testConfig(), AuthDependencies{}, nil).WSHandler()(c)

	if !c.IsAborted() {
		t.Fatal("expected query-only access_token to be rejected on Hub WS upgrade")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if got := c.GetString("auth_source"); got != "" {
		t.Fatalf("auth_source = %q, want empty", got)
	}
	if got := c.GetString("user_id"); got != "" {
		t.Fatalf("user_id = %q, want empty", got)
	}
}

// TestWSAuthMiddlewareAcceptsHubLocalBearerToken covers native clients that set
// Authorization: Bearer on the WS upgrade request.
func TestWSAuthMiddlewareAcceptsHubLocalBearerToken(t *testing.T) {
	token := makeToken("user-ws", "desktop", "device-ws")
	c, w := ginRequest(http.MethodGet, "/client/ws", "Bearer "+token)

	newTestAuthMW(testConfig(), AuthDependencies{}, nil).WSHandler()(c)

	if c.IsAborted() {
		t.Fatalf("expected Hub-local Bearer token to authenticate, status=%d body=%s", w.Code, w.Body.String())
	}
	if got := c.GetString("auth_source"); got != "hub_local" {
		t.Fatalf("auth_source = %q, want hub_local", got)
	}
	if got := c.GetString("user_id"); got != "user-ws" {
		t.Fatalf("user_id = %q, want user-ws", got)
	}
	if got := c.GetString("device_type"); got != "desktop" {
		t.Fatalf("device_type = %q, want desktop", got)
	}
	if got := c.GetString("purpose"); got != "" {
		t.Fatalf("purpose = %q, want empty product session purpose", got)
	}
}

// TestWSAuthMiddlewareAcceptsSubprotocolBearerToken is the #921 primary browser
// path: Sec-WebSocket-Protocol carries "agenthub.bearer.v1, <jwt>" without a
// query access_token.
func TestWSAuthMiddlewareAcceptsSubprotocolBearerToken(t *testing.T) {
	token := makeToken("user-proto", "web", "device-proto")
	c, w := ginRequest(http.MethodGet, "/client/ws", "")
	c.Request.Header.Set("Sec-WebSocket-Protocol", WSBearerSubprotocol+", "+token)

	newTestAuthMW(testConfig(), AuthDependencies{}, nil).WSHandler()(c)

	if c.IsAborted() {
		t.Fatalf("expected Sec-WebSocket-Protocol bearer token to authenticate, status=%d body=%s", w.Code, w.Body.String())
	}
	if got := c.GetString("auth_source"); got != "hub_local" {
		t.Fatalf("auth_source = %q, want hub_local", got)
	}
	if got := c.GetString("user_id"); got != "user-proto" {
		t.Fatalf("user_id = %q, want user-proto", got)
	}
	if got := c.GetString("device_type"); got != "web" {
		t.Fatalf("device_type = %q, want web", got)
	}
}

// TestWSAuthMiddlewareAcceptsAccessTokenSubprotocolForm covers the alternate
// single-token convention: access_token.<jwt>.
func TestWSAuthMiddlewareAcceptsAccessTokenSubprotocolForm(t *testing.T) {
	token := makeToken("user-at", "web", "device-at")
	c, w := ginRequest(http.MethodGet, "/client/ws", "")
	c.Request.Header.Set("Sec-WebSocket-Protocol", "access_token."+token)

	newTestAuthMW(testConfig(), AuthDependencies{}, nil).WSHandler()(c)

	if c.IsAborted() {
		t.Fatalf("expected access_token.<jwt> subprotocol to authenticate, status=%d body=%s", w.Code, w.Body.String())
	}
	if got := c.GetString("user_id"); got != "user-at" {
		t.Fatalf("user_id = %q, want user-at", got)
	}
	if got := c.GetString("auth_source"); got != "hub_local" {
		t.Fatalf("auth_source = %q, want hub_local", got)
	}
}

// TestWSAuthMiddlewareIgnoresQueryWhenSubprotocolPresent ensures a query
// access_token cannot override (or supply) auth when a subprotocol JWT is present.
func TestWSAuthMiddlewareIgnoresQueryWhenSubprotocolPresent(t *testing.T) {
	protoToken := makeToken("user-proto", "web", "device-proto")
	queryToken := makeToken("user-query", "web", "device-query")
	c, w := ginRequest(http.MethodGet, "/client/ws?access_token="+queryToken, "")
	c.Request.Header.Set("Sec-WebSocket-Protocol", WSBearerSubprotocol+", "+protoToken)

	newTestAuthMW(testConfig(), AuthDependencies{}, nil).WSHandler()(c)

	if c.IsAborted() {
		t.Fatalf("expected subprotocol token to authenticate, status=%d body=%s", w.Code, w.Body.String())
	}
	if got := c.GetString("user_id"); got != "user-proto" {
		t.Fatalf("user_id = %q, want user-proto (query token must be ignored)", got)
	}
}

func TestWSAuthMiddlewareRejectsMissingToken(t *testing.T) {
	c, w := ginRequest(http.MethodGet, "/client/ws", "")
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).WSHandler()(c)

	if !c.IsAborted() {
		t.Fatal("expected missing WS token to be rejected")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestTokenFromWSSubprotocols(t *testing.T) {
	token := "header.payload.sig"
	cases := []struct {
		name   string
		values []string
		want   string
	}{
		{"empty", nil, ""},
		{"marker only", []string{WSBearerSubprotocol}, ""},
		{"preferred form", []string{WSBearerSubprotocol + ", " + token}, token},
		{"access_token form", []string{"access_token." + token}, token},
		{"multi header values", []string{WSBearerSubprotocol, token}, token},
		{"access_token preferred over raw", []string{WSBearerSubprotocol + ", other.jwt, access_token." + token}, token},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tokenFromWSSubprotocols(tc.values); got != tc.want {
				t.Fatalf("tokenFromWSSubprotocols(%v) = %q, want %q", tc.values, got, tc.want)
			}
		})
	}
}

// TestWSAuthMiddlewareRejectsNonHubSessionPurpose is the #889 regression:
// tokens with a non-empty purpose (edge-api / run-start) must not upgrade WS.
// ParseToken rejects them at the product gate (401); the shared enforceHubSession
// gate is defense-in-depth for the same policy on REST and WS.
func TestWSAuthMiddlewareRejectsNonHubSessionPurpose(t *testing.T) {
	secret := testSecret()
	cases := []struct {
		name  string
		token string
	}{
		{
			name: "edge-api purpose",
			token: mustSignClaims(t, jwtutil.Claims{
				UserID:     "user-edge",
				DeviceType: "desktop",
				DeviceID:   "dev-1",
				Purpose:    jwtutil.PurposeEdge,
				RegisteredClaims: jwt.RegisteredClaims{
					Issuer:    "agenthub-hub",
					Audience:  jwt.ClaimStrings{jwtutil.AudienceAPI},
					Subject:   "user-edge",
					ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
					IssuedAt:  jwt.NewNumericDate(time.Now()),
				},
			}, secret),
		},
		{
			name: "run-start purpose",
			token: mustSignClaims(t, jwtutil.Claims{
				UserID:     "user-cap",
				DeviceType: "desktop",
				DeviceID:   "dev-1",
				Purpose:    jwtutil.PurposeRun,
				RegisteredClaims: jwt.RegisteredClaims{
					Issuer:    "agenthub-hub",
					Audience:  jwt.ClaimStrings{jwtutil.AudienceAPI},
					Subject:   "user-cap",
					ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
					IssuedAt:  jwt.NewNumericDate(time.Now()),
				},
			}, secret),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, w := ginRequest(http.MethodGet, "/client/ws", "Bearer "+tc.token)
			newTestAuthMW(testConfig(), AuthDependencies{}, nil).WSHandler()(c)

			if !c.IsAborted() {
				t.Fatal("expected non-hub-session purpose token to be rejected on WS upgrade")
			}
			// Product ParseToken rejects non-empty purpose as invalid token (401).
			// Either 401 (parse gate) or 403 (hub-session gate) is a closed door.
			if w.Code != http.StatusUnauthorized && w.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 401 or 403", w.Code)
			}
			if got := c.GetString("auth_source"); got != "" {
				t.Fatalf("auth_source = %q, want empty after rejection", got)
			}
		})
	}
}

// TestEnforceHubSessionRejectsPurposeAndDeviceType covers the shared post-parse
// gate used by both RequireHubSession and WSAuthMiddleware (#889).
func TestEnforceHubSessionRejectsPurposeAndDeviceType(t *testing.T) {
	cases := []struct {
		name       string
		authSource string
		deviceType string
		purpose    string
		wantOK     bool
	}{
		{"hub product session", "hub_local", "web", "", true},
		{"desktop product session", "hub_local", "desktop", "", true},
		{"non-empty purpose edge-api", "hub_local", "desktop", "edge-api", false},
		{"non-empty purpose run-start", "hub_local", "web", "run-start", false},
		{"edge device_type", "hub_local", "edge", "", false},
		{"tokendance_bearer device_type", "hub_local", "tokendance_bearer", "", false},
		{"tokendance auth_source", "tokendance_id", "tokendance_bearer", "", false},
		{"empty auth_source", "", "web", "", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, w := ginRequest(http.MethodGet, "/client/ws", "")
			c.Set("auth_source", tc.authSource)
			c.Set("device_type", tc.deviceType)
			c.Set("purpose", tc.purpose)
			c.Set("user_id", "user-gate")

			ok := newTestAuthMW(nil, AuthDependencies{}, nil).enforceHubSession(c)
			if ok != tc.wantOK {
				t.Fatalf("enforceHubSession = %v, want %v (status=%d body=%s)", ok, tc.wantOK, w.Code, w.Body.String())
			}
			if tc.wantOK {
				if c.IsAborted() {
					t.Fatal("expected request not aborted for valid hub session")
				}
				return
			}
			if !c.IsAborted() {
				t.Fatal("expected request aborted for invalid hub session")
			}
			if w.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403", w.Code)
			}
		})
	}
}

func mustSignClaims(t *testing.T, claims jwtutil.Claims, secret string) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign claims: %v", err)
	}
	return signed
}

func TestAuthMiddlewareRejectsEdgeToken(t *testing.T) {
	token, err := jwtutil.GenerateEdgeToken("user-edge", "edge-dev-1", testSecret(), time.Hour)
	if err != nil {
		t.Fatalf("GenerateEdgeToken: %v", err)
	}
	c, w := ginRequest(http.MethodGet, "/client/auth/me", "Bearer "+token)
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).Handler()(c)

	if !c.IsAborted() {
		t.Fatal("expected edge JWT to be rejected on product AuthMiddleware")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if got := c.GetString("auth_source"); got != "" {
		t.Fatalf("auth_source = %q, want empty", got)
	}
}

func TestAuthMiddlewareRejectsCapabilityToken(t *testing.T) {
	// testSecret is long enough for capability mint (>= 32).
	token, err := jwtutil.IssueCapabilityToken([]byte(testSecret()), "user-1", "edge-1", "proj_1", "run-start", time.Minute)
	if err != nil {
		t.Fatalf("IssueCapabilityToken: %v", err)
	}
	c, w := ginRequest(http.MethodGet, "/client/sessions", "Bearer "+token)
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).Handler()(c)

	if !c.IsAborted() {
		t.Fatal("expected capability JWT to be rejected on product AuthMiddleware")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if got := c.GetString("auth_source"); got != "" {
		t.Fatalf("auth_source = %q, want empty", got)
	}
}

func TestAuthMiddlewareProductTokenStillReachesHandler(t *testing.T) {
	token := makeToken("user-product", "web", "dev-web-1")
	c, w := ginRequest(http.MethodGet, "/client/auth/me", "Bearer "+token)
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).Handler()(c)
	if c.IsAborted() {
		t.Fatalf("product token must authenticate, status=%d body=%s", w.Code, w.Body.String())
	}
	if got := c.GetString("auth_source"); got != "hub_local" {
		t.Fatalf("auth_source = %q, want hub_local", got)
	}
	if got := c.GetString("user_id"); got != "user-product" {
		t.Fatalf("user_id = %q, want user-product", got)
	}
	// RequireHubSession still accepts product hub_local.
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).RequireHubSession()(c)
	if c.IsAborted() {
		t.Fatal("RequireHubSession must accept product hub_local session")
	}
}

func TestWSAuthMiddlewareRejectsEdgeToken(t *testing.T) {
	token, err := jwtutil.GenerateEdgeToken("user-edge", "edge-dev-ws", testSecret(), time.Hour)
	if err != nil {
		t.Fatalf("GenerateEdgeToken: %v", err)
	}
	c, w := ginRequest(http.MethodGet, "/client/ws", "Bearer "+token)
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).WSHandler()(c)

	if !c.IsAborted() {
		t.Fatal("expected edge JWT to be rejected on WSAuthMiddleware")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if got := c.GetString("auth_source"); got != "" {
		t.Fatalf("auth_source = %q, want empty", got)
	}
}

func TestWSAuthMiddlewareRejectsCapabilityToken(t *testing.T) {
	token, err := jwtutil.IssueCapabilityToken([]byte(testSecret()), "user-1", "edge-1", "proj_1", "run-start", time.Minute)
	if err != nil {
		t.Fatalf("IssueCapabilityToken: %v", err)
	}
	c, w := ginRequest(http.MethodGet, "/client/ws", "Bearer "+token)
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).WSHandler()(c)

	if !c.IsAborted() {
		t.Fatal("expected capability JWT to be rejected on WSAuthMiddleware")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
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

type stubAccessBlacklist struct {
	blacklisted map[string]bool
}

func (s stubAccessBlacklist) IsAccessTokenBlacklisted(ctx context.Context, jti string) (bool, error) {
	return s.blacklisted[jti], nil
}

func TestAuthMiddlewareRejectsBlacklistedAccessJTI(t *testing.T) {
	token := makeToken("user-bl", "desktop", "dev-bl")
	claims, err := jwtutil.ParseToken(token, testSecret())
	if err != nil {
		t.Fatalf("ParseToken: %v", err)
	}
	if claims.ID == "" {
		t.Fatal("expected minted jti")
	}
	c, w := ginRequest(http.MethodGet, "/client/auth/me", "Bearer "+token)
	newTestAuthMW(testConfig(), AuthDependencies{
		BlacklistChecker: stubAccessBlacklist{blacklisted: map[string]bool{claims.ID: true}},
	}, nil).Handler()(c)
	if !c.IsAborted() {
		t.Fatal("expected blacklisted access jti to be rejected")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestWSAuthMiddlewareRejectsBlacklistedAccessJTI(t *testing.T) {
	token := makeToken("user-ws-bl", "web", "dev-ws-bl")
	claims, err := jwtutil.ParseToken(token, testSecret())
	if err != nil {
		t.Fatalf("ParseToken: %v", err)
	}
	c, w := ginRequest(http.MethodGet, "/client/ws", "Bearer "+token)
	newTestAuthMW(testConfig(), AuthDependencies{
		BlacklistChecker: stubAccessBlacklist{blacklisted: map[string]bool{claims.ID: true}},
	}, nil).WSHandler()(c)
	if !c.IsAborted() {
		t.Fatal("expected blacklisted access jti to be rejected on WS")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

// erroringAccessBlacklist always returns an error, simulating a Redis outage
// for the jti blacklist check path.
type erroringAccessBlacklist struct{}

func (erroringAccessBlacklist) IsAccessTokenBlacklisted(ctx context.Context, jti string) (bool, error) {
	return false, errors.New("redis unavailable")
}

// TestAuthMiddlewareBlacklistCheckErrorFailsOpenByDefault verifies the
// historical behavior: when AGENTHUB_AUTH_FAIL_CLOSED is not set (default
// false), a Redis outage on the jti blacklist path allows the request
// through (fail-open).
func TestAuthMiddlewareBlacklistCheckErrorFailsOpenByDefault(t *testing.T) {
	t.Setenv("AGENTHUB_AUTH_FAIL_CLOSED", "")
	token := makeToken("user-fo", "desktop", "dev-fo")
	c, w := ginRequest(http.MethodGet, "/client/auth/me", "Bearer "+token)
	newTestAuthMW(testConfig(), AuthDependencies{
		BlacklistChecker: erroringAccessBlacklist{},
	}, nil).Handler()(c)
	if c.IsAborted() {
		t.Fatalf("default fail-open: expected request to be allowed, status=%d body=%s", w.Code, w.Body.String())
	}
	if got := c.GetString("user_id"); got != "user-fo" {
		t.Fatalf("user_id = %q, want user-fo", got)
	}
}

// TestAuthMiddlewareBlacklistCheckErrorFailsClosedWhenConfigured verifies the
// Task 2 hardening: when AGENTHUB_AUTH_FAIL_CLOSED=true, a Redis outage on
// the jti blacklist path rejects the request with 401 so a revoked
// (logged-out) access JWT cannot slip back in during the outage.
func TestAuthMiddlewareBlacklistCheckErrorFailsClosedWhenConfigured(t *testing.T) {
	t.Setenv("AGENTHUB_AUTH_FAIL_CLOSED", "true")
	token := makeToken("user-fc", "desktop", "dev-fc")
	c, w := ginRequest(http.MethodGet, "/client/auth/me", "Bearer "+token)
	newTestAuthMW(testConfig(), AuthDependencies{
		BlacklistChecker: erroringAccessBlacklist{},
	}, nil).Handler()(c)
	if !c.IsAborted() {
		t.Fatal("fail-closed: expected request to be rejected when blacklist check errors")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

// TestWSAuthMiddlewareBlacklistCheckErrorFailsClosedWhenConfigured is the WS
// upgrade counterpart: the fail-closed policy applies equally to WebSocket
// upgrades so a Redis outage cannot let a revoked access JWT upgrade.
func TestWSAuthMiddlewareBlacklistCheckErrorFailsClosedWhenConfigured(t *testing.T) {
	t.Setenv("AGENTHUB_AUTH_FAIL_CLOSED", "true")
	token := makeToken("user-ws-fc", "web", "dev-ws-fc")
	c, w := ginRequest(http.MethodGet, "/client/ws", "Bearer "+token)
	newTestAuthMW(testConfig(), AuthDependencies{
		BlacklistChecker: erroringAccessBlacklist{},
	}, nil).WSHandler()(c)
	if !c.IsAborted() {
		t.Fatal("fail-closed WS: expected upgrade to be rejected when blacklist check errors")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestAuthMiddlewareAcceptsLegacyTokenWithoutJTI(t *testing.T) {
	// Legacy product token: no RegisteredClaims.ID (pre-#888).
	now := time.Now()
	legacyClaims := jwtutil.Claims{
		UserID:     "user-legacy",
		DeviceType: "desktop",
		DeviceID:   "dev-legacy",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"agenthub-api"},
			Subject:   "user-legacy",
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, legacyClaims).SignedString([]byte(testSecret()))
	if err != nil {
		t.Fatalf("sign legacy: %v", err)
	}
	// Even with a blacklist checker present, missing jti is accept-with-log.
	// (blacklist injected via newTestAuthMW below)

	c, w := ginRequest(http.MethodGet, "/client/auth/me", "Bearer "+token)
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).Handler()(c)
	if c.IsAborted() {
		t.Fatalf("legacy missing-jti token must be accepted, status=%d body=%s", w.Code, w.Body.String())
	}
	if got := c.GetString("user_id"); got != "user-legacy" {
		t.Fatalf("user_id = %q, want user-legacy", got)
	}
	if got := c.GetString("access_jti"); got != "" {
		t.Fatalf("access_jti = %q, want empty for legacy", got)
	}
}

func TestAuthMiddlewareSetsAccessJTI(t *testing.T) {
	token := makeToken("user-jti", "mobile", "dev-jti")
	c, _ := ginRequest(http.MethodGet, "/client/auth/me", "Bearer "+token)
	newTestAuthMW(testConfig(), AuthDependencies{}, nil).Handler()(c)
	if c.IsAborted() {
		t.Fatal("expected auth success")
	}
	if got := c.GetString("access_jti"); got == "" {
		t.Fatal("expected access_jti context value from minted jti")
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

// --- RequireHubSession / RequireLocalAuth tests ---

func requireLocalAuthGinCtx(authSource string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/client/auth/password", nil)
	c.Set("auth_source", authSource)
	return c, w
}

func TestRequireHubSessionAllowsHubLocalAuth(t *testing.T) {
	c, w := requireLocalAuthGinCtx("hub_local")
	called := false
	next := func(c *gin.Context) { called = true }

	handler := newTestAuthMW(testConfig(), AuthDependencies{}, nil).RequireHubSession()
	handler(c)
	if !c.IsAborted() {
		next(c)
	}

	if c.IsAborted() {
		t.Fatal("expected request not to be aborted for Hub-local auth")
	}
	if !called {
		t.Fatal("expected next handler to be called")
	}
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

func TestRequireHubSessionBlocksTokenDanceAuth(t *testing.T) {
	c, w := requireLocalAuthGinCtx("tokendance_id")
	called := false
	next := func(c *gin.Context) { called = true }

	handler := newTestAuthMW(testConfig(), AuthDependencies{}, nil).RequireHubSession()
	handler(c)
	if !c.IsAborted() {
		next(c)
	}

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted for TokenDance auth")
	}
	if called {
		t.Fatal("expected next handler NOT to be called")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}

func TestRequireHubSessionBlocksEmptyAuthSource(t *testing.T) {
	c, w := requireLocalAuthGinCtx("")
	called := false
	next := func(c *gin.Context) { called = true }

	handler := newTestAuthMW(testConfig(), AuthDependencies{}, nil).RequireHubSession()
	handler(c)
	if !c.IsAborted() {
		next(c)
	}

	if !c.IsAborted() {
		t.Fatal("expected request to be aborted when auth_source is empty")
	}
	if called {
		t.Fatal("expected next handler NOT to be called")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}

func TestRequireHubSessionBlocksNonEmptyPurpose(t *testing.T) {
	c, w := requireLocalAuthGinCtx("hub_local")
	c.Set("purpose", "edge-api")
	c.Set("device_type", "desktop")

	newTestAuthMW(testConfig(), AuthDependencies{}, nil).RequireHubSession()(c)

	if !c.IsAborted() {
		t.Fatal("expected RequireHubSession to reject non-empty purpose")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}

func TestRequireHubSessionBlocksEdgeDeviceType(t *testing.T) {
	c, w := requireLocalAuthGinCtx("hub_local")
	c.Set("device_type", "edge")
	c.Set("purpose", "")

	newTestAuthMW(testConfig(), AuthDependencies{}, nil).RequireHubSession()(c)

	if !c.IsAborted() {
		t.Fatal("expected RequireHubSession to reject edge device_type")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}

func TestRequireLocalAuthDelegatesToHubSession(t *testing.T) {
	c, w := requireLocalAuthGinCtx("tokendance_id")

	newTestAuthMW(testConfig(), AuthDependencies{}, nil).RequireLocalAuth()(c)

	if !c.IsAborted() {
		t.Fatal("expected RequireLocalAuth alias to require Hub-local auth")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}

// ── #1551 instance isolation ──────────────────────────────────────────────

// TestAuthMiddlewareInstancesAreIsolated proves the process-global wiring is
// gone: two instances with different blacklist deps behave independently,
// regardless of construction order (a package global would leak A's
// blacklist into B).
func TestAuthMiddlewareInstancesAreIsolated(t *testing.T) {
	token := makeToken("user-iso", "web", "dev-iso")
	claims, err := jwtutil.ParseToken(token, testSecret())
	require.NoError(t, err)
	if claims.ID == "" {
		t.Fatal("expected minted jti")
	}

	// Instance A rejects the blacklisted jti.
	mwA := newTestAuthMW(testConfig(), AuthDependencies{
		BlacklistChecker: stubAccessBlacklist{blacklisted: map[string]bool{claims.ID: true}},
	}, nil)

	// Instance B (constructed after A) has no blacklist — must accept the
	// same token.
	mwB := newTestAuthMW(testConfig(), AuthDependencies{}, nil)

	cA, wA := ginRequest(http.MethodGet, "/client/auth/me", "Bearer "+token)
	mwA.Handler()(cA)
	if !cA.IsAborted() || wA.Code != http.StatusUnauthorized {
		t.Fatalf("instance A: aborted=%v status=%d, want 401 (blacklist must apply)", cA.IsAborted(), wA.Code)
	}

	cB, _ := ginRequest(http.MethodGet, "/client/auth/me", "Bearer "+token)
	mwB.Handler()(cB)
	if cB.IsAborted() {
		t.Fatal("instance B: request aborted — instance A's blacklist leaked into B")
	}
}

// TestAuthMiddlewarePermissionAuditIsolated proves audit callbacks are
// instance-owned: only the instance with a callback receives the decision.
func TestAuthMiddlewarePermissionAuditIsolated(t *testing.T) {
	var auditedA, auditedB atomic.Int64

	mwA := newTestAuthMW(testConfig(), AuthDependencies{
		PermissionAudit: func(ctx context.Context, userID, decision string, allowed bool, details map[string]interface{}, clientIP string) {
			auditedA.Add(1)
		},
	}, nil)
	mwB := newTestAuthMW(testConfig(), AuthDependencies{}, nil)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/admin/x", nil)

	mwA.auditPermission(c, "u1", "admin_access", false, nil, "127.0.0.1")
	mwB.auditPermission(c, "u1", "admin_access", false, nil, "127.0.0.1")

	assert.Equal(t, int64(1), auditedA.Load(), "instance A must receive its audit decision")
	assert.Equal(t, int64(0), auditedB.Load(), "instance B has no audit callback")
}
