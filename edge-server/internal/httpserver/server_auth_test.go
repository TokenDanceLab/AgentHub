package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// testHubSecret matches the 32-byte minimum enforced by jwtutil.ValidateHubToken.
const testDebugHubSecret = "my-secret-key-must-be-32-bytes-long!"

// scopedDebugClaims builds Edge-scoped Hub claims that pass ValidateHubToken.
type scopedDebugClaims struct {
	UserID     string `json:"user_id"`
	DeviceID   string `json:"device_id"`
	DeviceType string `json:"device_type,omitempty"`
	Purpose    string `json:"purpose,omitempty"`
	jwt.RegisteredClaims
}

func debugEdgeScopedClaims(userID string, expiresIn time.Duration) scopedDebugClaims {
	return scopedDebugClaims{
		UserID:     userID,
		DeviceID:   "edge-device-debug",
		DeviceType: "edge",
		Purpose:    "edge-api",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenthub-hub",
			Audience:  jwt.ClaimStrings{"agenthub-edge"},
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiresIn)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
}

func newDebugTestToken(secret string, claims scopedDebugClaims) string {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte(secret))
	return s
}

func TestDebugAuthFunc_DevModeReturnsNil(t *testing.T) {
	cfg := Config{Dev: true, LocalAuthToken: "aght_x", HubJWTSecret: testDebugHubSecret, EdgeDeviceID: "edge-device-debug"}
	if auth := debugAuthFunc(cfg); auth != nil {
		t.Fatalf("dev mode: expected nil auth, got non-nil")
	}
}

func TestDebugAuthFunc_LocalAuthTokenTakesPrecedence(t *testing.T) {
	cfg := Config{LocalAuthToken: "aght_local_token", HubJWTSecret: testDebugHubSecret, EdgeDeviceID: "edge-device-debug"}
	auth := debugAuthFunc(cfg)
	if auth == nil {
		t.Fatal("expected non-nil auth with local token configured")
	}
	// Local token path accepts the pre-shared bearer.
	req := httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil)
	req.Header.Set("Authorization", "Bearer aght_local_token")
	if !auth(req) {
		t.Fatal("expected local bearer token to be accepted")
	}
	// A valid Hub JWT should NOT be accepted under the local-token auth path,
	// because the local token is the configured secret.
	token := newDebugTestToken(testDebugHubSecret, debugEdgeScopedClaims("user-1", time.Hour))
	reqJWT := httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil)
	reqJWT.Header.Set("Authorization", "Bearer "+token)
	if auth(reqJWT) {
		t.Fatal("Hub JWT must not satisfy local-token auth path")
	}
}

func TestDebugAuthFunc_HubJWTFallbackAllowsValidToken(t *testing.T) {
	// Hub-JWT-only mode (LocalAuthToken empty, HubJWTSecret configured): the
	// pre-Task-1 behavior returned nil and exposed debug endpoints publicly.
	// After Task 1 the fallback must validate a Hub JWT.
	cfg := Config{HubJWTSecret: testDebugHubSecret, EdgeDeviceID: "edge-device-debug"}
	auth := debugAuthFunc(cfg)
	if auth == nil {
		t.Fatal("expected non-nil Hub-JWT fallback auth, got nil (debug endpoints would be public)")
	}

	token := newDebugTestToken(testDebugHubSecret, debugEdgeScopedClaims("user-1", time.Hour))
	req := httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if !auth(req) {
		t.Fatal("expected valid Hub JWT to be accepted by debug auth fallback")
	}
}

func TestDebugAuthFunc_HubJWTFallbackRejectsMissingToken(t *testing.T) {
	cfg := Config{HubJWTSecret: testDebugHubSecret, EdgeDeviceID: "edge-device-debug"}
	auth := debugAuthFunc(cfg)
	req := httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil)
	if auth(req) {
		t.Fatal("expected missing bearer to be rejected")
	}
}

func TestDebugAuthFunc_HubJWTFallbackRejectsWrongSecret(t *testing.T) {
	cfg := Config{HubJWTSecret: testDebugHubSecret, EdgeDeviceID: "edge-device-debug"}
	auth := debugAuthFunc(cfg)
	token := newDebugTestToken("a-different-32-byte-secret-here!", debugEdgeScopedClaims("user-1", time.Hour))
	req := httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if auth(req) {
		t.Fatal("expected token signed with wrong secret to be rejected")
	}
}

func TestDebugAuthFunc_HubJWTFallbackRejectsExpiredToken(t *testing.T) {
	cfg := Config{HubJWTSecret: testDebugHubSecret, EdgeDeviceID: "edge-device-debug"}
	auth := debugAuthFunc(cfg)
	token := newDebugTestToken(testDebugHubSecret, debugEdgeScopedClaims("user-1", -1*time.Hour))
	req := httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if auth(req) {
		t.Fatal("expected expired token to be rejected")
	}
}

func TestDebugAuthFunc_HubJWTFallbackRejectsTokenDanceBearer(t *testing.T) {
	// TokenDance bearer tokens (td_ prefix) are not Edge sessions and must
	// never be accepted as debug auth.
	cfg := Config{HubJWTSecret: testDebugHubSecret, EdgeDeviceID: "edge-device-debug"}
	auth := debugAuthFunc(cfg)
	req := httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil)
	req.Header.Set("Authorization", "Bearer td_live_tokendance_api_key")
	if auth(req) {
		t.Fatal("expected TokenDance bearer (td_) to be rejected")
	}
}

func TestDebugAuthFunc_HubJWTFallbackRejectsWrongDeviceID(t *testing.T) {
	cfg := Config{HubJWTSecret: testDebugHubSecret, EdgeDeviceID: "edge-device-debug"}
	auth := debugAuthFunc(cfg)
	// claims use DeviceID edge-device-debug which matches cfg; mutate to mismatch
	claims := debugEdgeScopedClaims("user-1", time.Hour)
	claims.DeviceID = "other-device"
	token := newDebugTestToken(testDebugHubSecret, claims)
	req := httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if auth(req) {
		t.Fatal("expected token with mismatched device_id to be rejected")
	}
}

func TestDebugAuthFunc_NoAuthConfiguredDeniesAll(t *testing.T) {
	// Dev false, both secrets empty: deny-all so debug endpoints are not
	// exposed without explicit auth configuration. Run() auto-generates a
	// LocalAuthToken before calling debugAuthFunc, making this branch
	// unreachable in production — but the gate itself must fail closed.
	cfg := Config{}
	auth := debugAuthFunc(cfg)
	if auth == nil {
		t.Fatal("expected non-nil deny-all auth when no auth configured, got nil")
	}
	req := httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil)
	if auth(req) {
		t.Fatal("deny-all auth must reject all requests")
	}
}
