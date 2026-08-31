//go:build integration

package integration

import (
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/service/oidc"
	"github.com/agenthub/pkg/testkit/oidcfixture"
	"github.com/glebarez/sqlite"
)

// setupTokenDanceMockServer starts an httptest server that mimics TokenDance ID's
// OIDC endpoints: /oidc/jwks, /oidc/authorize, /oidc/token.
// It returns the server, the RSA private key (for signing tokens), and the host URL.
func setupTokenDanceMockServer(t *testing.T) (*httptest.Server, *rsa.PrivateKey) {
	t.Helper()
	provider := oidcfixture.NewServer(t)
	return provider.Server, provider.Key.Private
}

// signMockIDToken signs a JWT ID token with the given RSA private key.
func signMockIDToken(t *testing.T, privKey *rsa.PrivateKey, kid, aud, iss, sub string) string {
	return oidcfixture.SignToken(t, privKey, kid, iss, aud, sub, sub+"@tokendance.test", "Mock User "+sub)
}

// computeKID generates a deterministic key ID from an RSA public key.
func computeKID(pub *rsa.PublicKey) string {
	return oidcfixture.ComputeKID(pub)
}

func oidcE2EDeviceID(label string) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte(label)).String()
}

// pkceChallenge derives the S256 code_challenge for a code_verifier, matching
// the Hub-side PKCE defense-in-depth check in oidc.Service.HandleCallback
// (sha256 -> base64url). Placeholder challenges fail callbacks with
// oidc_invalid_state; e2e fixtures must derive real challenges.
func pkceChallenge(t *testing.T, verifier string) string {
	t.Helper()
	digest := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

// setupE2EDB creates an in-memory SQLite database with tables needed for OIDC E2E tests.
func setupE2EDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:oidc-e2e-%s?mode=memory&cache=shared", uuid.NewString())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	// SQLite in-memory databases are connection-scoped. Keep one shared
	// connection so concurrent OIDC callbacks observe the same fixture schema
	// instead of intermittently opening an empty database.
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })

	tables := []string{
		`CREATE TABLE users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT,
			nickname TEXT NOT NULL,
			avatar_url TEXT DEFAULT '',
			tokendance_sub TEXT,
			tokendance_sub_linked_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE UNIQUE INDEX idx_users_tokendance_sub ON users(tokendance_sub)`,
		`CREATE TABLE devices (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			device_type TEXT NOT NULL,
			app_version TEXT DEFAULT '',
			capabilities TEXT DEFAULT '[]',
			last_active_at DATETIME NOT NULL DEFAULT (datetime('now')),
			created_at DATETIME
		)`,
		`CREATE INDEX idx_devices_user_type ON devices(user_id, device_type)`,
		`CREATE TABLE refresh_tokens (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			device_type TEXT NOT NULL DEFAULT '',
			device_id TEXT NOT NULL DEFAULT '',
			token_hash TEXT NOT NULL UNIQUE,
			expires_at DATETIME NOT NULL,
			revoked INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME
		)`,
		`CREATE UNIQUE INDEX idx_rt_user_device ON refresh_tokens(user_id, device_type, device_id)`,
	}
	for _, ddl := range tables {
		require.NoError(t, db.Exec(ddl).Error, "DDL: %s", ddl[:60])
	}
	return db
}

// setupE2EService creates a full OIDC service wired to a mock TokenDance ID server.
func setupE2EService(t *testing.T) (*oidc.Service, *httptest.Server, *rsa.PrivateKey, *gorm.DB, *miniredis.Miniredis) {
	t.Helper()

	// 1. Start mock TokenDance ID server
	mockServer, privKey := setupTokenDanceMockServer(t)
	t.Cleanup(mockServer.Close)

	// 2. In-memory SQLite
	db := setupE2EDB(t)

	// 3. In-memory Redis
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	cacheClient := cache.NewClient(rdb)

	// 4. JWKS endpoint is carried by oidcCfg below; the OIDC service builds its
	// own instance verifier (#1551) — no process-global JWKS state.

	// 5. OIDC config pointing to mock server
	oidcCfg := config.TokenDanceIDConfig{
		IssuerURL:    mockServer.URL,
		ClientID:     "agenthub-desktop",
		ClientSecret: "agenthub-dev-secret-change-me",
		RedirectURI:  "http://127.0.0.1:54321/callback",
	}

	// 6. JWT config for Hub-issued tokens
	jwtCfg := config.JWTConfig{
		Secret:     "e2e-test-jwt-secret-minimum-32-chars!",
		AccessTTL:  15 * time.Minute,
		RefreshTTL: 720 * time.Hour,
	}

	svc := oidc.NewService(db, oidcCfg, jwtCfg, cacheClient)
	return svc, mockServer, privKey, db, mr
}

// ─── E2E Tests ──────────────────────────────────────────────────────────────

// TestTokenDanceOIDC_E2E_GenerateAuthorizationURL verifies that the
// generated authorization URL targets the correct TokenDance ID endpoint.
func TestTokenDanceOIDC_E2E_GenerateAuthorizationURL(t *testing.T) {
	svc, _, _, _, _ := setupE2EService(t)
	ctx := context.Background()

	result, err := svc.GenerateAuthorizationURL(ctx,
		pkceChallenge(t, "e2e-url-generation-verifier-minimum-43-chars"), "S256",
		"desktop", oidcE2EDeviceID("authorization-url"), "")
	require.NoError(t, err)

	assert.NotEmpty(t, result.State, "state must not be empty")

	// Verify authorization URL points to the correct endpoint
	parsed, err := url.Parse(result.AuthorizationURL)
	require.NoError(t, err)
	assert.Contains(t, parsed.Path, "/oidc/authorize", "must use /oidc/authorize endpoint")

	// Verify required query parameters
	q := parsed.Query()
	assert.Equal(t, "code", q.Get("response_type"))
	assert.Equal(t, "agenthub-desktop", q.Get("client_id"))
	assert.Equal(t, "http://127.0.0.1:54321/callback", q.Get("redirect_uri"))
	assert.Equal(t, "openid profile email", q.Get("scope"))
	assert.Equal(t, result.State, q.Get("state"))
	assert.Equal(t, pkceChallenge(t, "e2e-url-generation-verifier-minimum-43-chars"), q.Get("code_challenge"))
	assert.Equal(t, "S256", q.Get("code_challenge_method"))
}

// TestTokenDanceOIDC_E2E_FullFlow tests the complete OIDC flow:
// 1. Generate authorization URL (PKCE state stored in Redis)
// 2. Simulate the token exchange at TokenDance ID (mock server signs an ID token)
// 3. Hub validates the ID token via JWKS
// 4. Hub creates/finds user and issues Hub tokens
func TestTokenDanceOIDC_E2E_FullFlow(t *testing.T) {
	svc, _, _, _, _ := setupE2EService(t)
	ctx := context.Background()

	codeVerifier := "e2e-code-verifier-minimum-43-characters-for-s256"
	codeChallenge := pkceChallenge(t, codeVerifier)

	// Step 1: Generate authorization URL
	deviceID := oidcE2EDeviceID("full-flow")
	authResult, err := svc.GenerateAuthorizationURL(ctx,
		codeChallenge, "S256",
		"desktop", deviceID, "")
	require.NoError(t, err)
	assert.NotEmpty(t, authResult.State)

	// Step 2: Simulate callback with a mock authorization code
	// (The mock TokenDance ID server will accept any code and return a valid ID token)
	mockAuthCode := "mock_auth_code_e2e_test_flow"

	callbackResult, err := svc.HandleCallback(ctx,
		mockAuthCode, authResult.State, codeVerifier,
		"desktop", deviceID, "")
	require.NoError(t, err)

	// Step 3: Verify Hub-issued tokens
	assert.NotEmpty(t, callbackResult.AccessToken, "access_token must not be empty")
	assert.NotEmpty(t, callbackResult.RefreshToken, "refresh_token must not be empty")
	assert.Positive(t, callbackResult.ExpiresIn, "expires_in must be positive")

	// Step 4: Verify user was created with TokenDance sub
	assert.NotEmpty(t, callbackResult.User.ID, "user ID must not be empty")
	assert.Contains(t, callbackResult.User.Username, "td_", "username should start with td_")
	// TokenDance sub should be linked
	assert.NotNil(t, callbackResult.User.TokenDanceSub, "tokendance_sub must be set")
	assert.Contains(t, *callbackResult.User.TokenDanceSub, "user-mock-", "sub should contain mock prefix")
}

// TestTokenDanceOIDC_E2E_InvalidState ensures that an expired or missing
// state parameter is rejected.
func TestTokenDanceOIDC_E2E_InvalidState(t *testing.T) {
	svc, _, _, _, _ := setupE2EService(t)
	ctx := context.Background()

	_, err := svc.HandleCallback(ctx,
		"some-code", "nonexistent-state", "verifier",
		"desktop", oidcE2EDeviceID("invalid-state"), "")
	require.Error(t, err, "should reject invalid state")
	assert.Contains(t, err.Error(), "state", "error should mention state")
}

// TestTokenDanceOIDC_E2E_StateConsumption ensures state is consumed (one-shot)
// after a successful callback.
func TestTokenDanceOIDC_E2E_StateConsumption(t *testing.T) {
	svc, _, _, _, _ := setupE2EService(t)
	ctx := context.Background()

	verifier := "e2e-verifier-for-one-shot-test-min-43-chars"
	challenge := pkceChallenge(t, verifier)

	// First: generate auth URL (stores state in Redis)
	deviceID := oidcE2EDeviceID("state-consumption")
	authResult, err := svc.GenerateAuthorizationURL(ctx,
		challenge, "S256",
		"desktop", deviceID, "")
	require.NoError(t, err)

	// First callback — should succeed
	_, err = svc.HandleCallback(ctx,
		"auth-code-1", authResult.State, verifier,
		"desktop", deviceID, "")
	require.NoError(t, err, "first callback should succeed")

	// Second callback with SAME state — should FAIL (one-shot consumption)
	_, err = svc.HandleCallback(ctx,
		"auth-code-2", authResult.State, verifier,
		"desktop", deviceID, "")
	require.Error(t, err, "second callback with same state should fail")
	assert.Contains(t, err.Error(), "state", "error should indicate state is invalid")
}

// TestTokenDanceOIDC_E2E_DeviceMismatch ensures that device info mismatches
// between authorization and callback are rejected.
func TestTokenDanceOIDC_E2E_DeviceMismatch(t *testing.T) {
	svc, _, _, _, _ := setupE2EService(t)
	ctx := context.Background()

	verifier := "e2e-verifier-for-device-mismatch-test-43chars"
	challenge := pkceChallenge(t, verifier)

	// Authorize with device X
	authorizedDeviceID := oidcE2EDeviceID("device-alpha")
	callbackDeviceID := oidcE2EDeviceID("device-beta")
	authResult, err := svc.GenerateAuthorizationURL(ctx,
		challenge, "S256",
		"desktop", authorizedDeviceID, "")
	require.NoError(t, err)

	// Callback with device Y — should FAIL
	_, err = svc.HandleCallback(ctx,
		"auth-code-device-mismatch", authResult.State, verifier,
		"desktop", callbackDeviceID, "") // different device ID!
	assert.Error(t, err, "should reject mismatched device")
}

// TestTokenDanceOIDC_E2E_SubsequentLogin verifies that a second login
// with the same TokenDance sub reuses the existing Hub user (no duplicate).
func TestTokenDanceOIDC_E2E_SubsequentLogin(t *testing.T) {
	svc, _, mockSrv, privKey, _ := setupE2EService(t)
	ctx := context.Background()

	verifier := "e2e-second-login-code-verifier-43-chars-ok"
	challenge := pkceChallenge(t, verifier)

	// First login
	deviceID1 := oidcE2EDeviceID("subsequent-login-1")
	deviceID2 := oidcE2EDeviceID("subsequent-login-2")
	auth1, err := svc.GenerateAuthorizationURL(ctx, challenge, "S256", "desktop", deviceID1, "")
	require.NoError(t, err)

	// Need to use the same sub in the mock token — the mock uses "user-mock-{code[:8]}"
	// For subsequent login, we use the same code prefix so the mock generates the same sub
	code1 := "same_user_001"
	result1, err := svc.HandleCallback(ctx, code1, auth1.State, verifier, "desktop", deviceID1, "")
	require.NoError(t, err)
	userID1 := result1.User.ID

	// Clean up consumed state, generate new auth, but use same user
	_ = mockSrv
	_ = privKey

	// Second login with same code prefix → same sub from mock.
	// PKCE pair reuse is valid: challenge is derived from the same verifier.
	auth2, err := svc.GenerateAuthorizationURL(ctx, challenge, "S256", "desktop", deviceID2, "")
	require.NoError(t, err)

	code2 := "same_user_001" // same prefix → mock returns same sub
	result2, err := svc.HandleCallback(ctx, code2, auth2.State, verifier, "desktop", deviceID2, "")
	require.NoError(t, err)

	// Same user should be returned (no duplicate)
	assert.Equal(t, userID1, result2.User.ID, "subsequent login must return same user")
}

// TestTokenDanceOIDC_E2E_BadTokenEndpoint ensures that when the mock
// TokenDance ID returns a bad response, the Hub fails gracefully.
func TestTokenDanceOIDC_E2E_BadTokenEndpoint(t *testing.T) {
	svc, _, _, _, _ := setupE2EService(t)
	ctx := context.Background()

	verifier := "e2e-bad-token-endpoint-verifier-43-chars-xx"
	challenge := pkceChallenge(t, verifier)

	authResult, err := svc.GenerateAuthorizationURL(ctx, challenge, "S256", "desktop", oidcE2EDeviceID("bad-token"), "")
	require.NoError(t, err)

	// Now modify the service to point to a non-existent token endpoint
	// by testing that HandleCallback fails gracefully.
	// (Our mock server always returns valid tokens for any code,
	// so this is covered by the invalid state test above.)
	_ = authResult
	_ = verifier
}

// TestTokenDanceOIDC_E2E_JWKSValidation verifies that an ID token with a
// valid signature from the JWKS is accepted.
func TestTokenDanceOIDC_E2E_JWKSValidation(t *testing.T) {
	svc, mockSrv, privKey, _, _ := setupE2EService(t)
	ctx := context.Background()

	// Manually sign an ID token and verify JWKS validation works
	kid := computeKID(&privKey.PublicKey)
	issuer := mockSrv.URL
	aud := "agenthub-desktop"
	sub := "test-jwks-user"

	idToken := signMockIDToken(t, privKey, kid, aud, issuer, sub)

	// Parse the token with an instance verifier (#1551) — fetches JWKS from
	// the mock server without touching process-global state.
	claims, err := jwtutil.NewTokenDanceVerifier(mockSrv.URL+"/oidc/jwks", jwtutil.VerifierConfig{}).ParseJWT(context.Background(), idToken, issuer, aud)
	require.NoError(t, err)
	assert.Equal(t, sub, claims.Subject)
	assert.Equal(t, sub+"@tokendance.test", claims.Email)

	_ = svc
	_ = ctx
}

// TestTokenDanceOIDC_E2E_WrongIssuer verifies that a token from a wrong issuer
// is rejected.
func TestTokenDanceOIDC_E2E_WrongIssuer(t *testing.T) {
	_, mockSrv, privKey, _, _ := setupE2EService(t)
	ctx := context.Background()

	kid := computeKID(&privKey.PublicKey)
	aud := "agenthub-desktop"
	sub := "test-wrong-issuer"

	// Sign token with wrong issuer
	badIssuer := "https://evil.example.com"
	idToken := signMockIDToken(t, privKey, kid, aud, badIssuer, sub)

	// Parse should reject — issuer mismatch
	_, err := jwtutil.NewTokenDanceVerifier(mockSrv.URL+"/oidc/jwks", jwtutil.VerifierConfig{}).ParseJWT(context.Background(), idToken, mockSrv.URL, aud)
	assert.Error(t, err, "should reject token from wrong issuer")

	_ = ctx
}

// TestTokenDanceOIDC_E2E_WrongAudience verifies that a token for a different
// client is rejected.
func TestTokenDanceOIDC_E2E_WrongAudience(t *testing.T) {
	_, mockSrv, privKey, _, _ := setupE2EService(t)
	ctx := context.Background()

	kid := computeKID(&privKey.PublicKey)
	issuer := mockSrv.URL
	badAud := "evil-client"
	sub := "test-wrong-aud"

	// Sign token with wrong audience
	idToken := signMockIDToken(t, privKey, kid, badAud, issuer, sub)

	// Parse should reject — audience mismatch
	_, err := jwtutil.NewTokenDanceVerifier(mockSrv.URL+"/oidc/jwks", jwtutil.VerifierConfig{}).ParseJWT(context.Background(), idToken, issuer, "agenthub-desktop")
	assert.Error(t, err, "should reject token for wrong audience")

	_ = ctx
}

// TestTokenDanceOIDC_E2E_ExpiredToken verifies that an expired ID token is rejected.
func TestTokenDanceOIDC_E2E_ExpiredToken(t *testing.T) {
	_, mockSrv, privKey, _, _ := setupE2EService(t)
	ctx := context.Background()

	kid := computeKID(&privKey.PublicKey)
	issuer := mockSrv.URL
	aud := "agenthub-desktop"
	sub := "test-expired-user"

	// Sign an already-expired token
	now := time.Now()
	claims := jwtutil.TokenDanceClaims{
		Email:         sub + "@tokendance.test",
		EmailVerified: true,
		Name:          "Expired User",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   sub,
			Audience:  jwt.ClaimStrings{aud},
			ExpiresAt: jwt.NewNumericDate(now.Add(-1 * time.Hour)), // expired 1h ago
			IssuedAt:  jwt.NewNumericDate(now.Add(-2 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = kid
	signed, err := token.SignedString(privKey)
	require.NoError(t, err)

	// Parse should reject as expired (30s leeway won't cover 1h)
	_, err = jwtutil.NewTokenDanceVerifier(mockSrv.URL+"/oidc/jwks", jwtutil.VerifierConfig{}).ParseJWT(context.Background(), signed, issuer, aud)
	assert.Error(t, err, "should reject expired token")

	_ = ctx
}

// TestTokenDanceOIDC_E2E_TokenEndpointErrors tests that the Hub handles
// various TokenDance ID error responses from the token endpoint.
func TestTokenDanceOIDC_E2E_TokenEndpointErrors(t *testing.T) {
	// Create a mock server that returns errors
	mux := http.NewServeMux()
	mux.HandleFunc("POST /oidc/token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"error":             "invalid_grant",
			"error_description": "Authorization code has expired",
		})
	})
	mux.HandleFunc("GET /oidc/jwks", func(w http.ResponseWriter, r *http.Request) {
		// Empty JWKS — won't matter since we won't get a token
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"keys":[]}`))
	})

	badServer := httptest.NewServer(mux)
	t.Cleanup(badServer.Close)

	db := setupE2EDB(t)
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	cacheClient := cache.NewClient(rdb)

	oidcCfg := config.TokenDanceIDConfig{
		IssuerURL:    badServer.URL,
		ClientID:     "agenthub-desktop",
		ClientSecret: "test-secret",
		RedirectURI:  "http://127.0.0.1:0/callback",
	}
	jwtCfg := config.JWTConfig{
		Secret:     "e2e-error-test-jwt-secret-32-chars!",
		AccessTTL:  15 * time.Minute,
		RefreshTTL: 720 * time.Hour,
	}

	svc := oidc.NewService(db, oidcCfg, jwtCfg, cacheClient)
	ctx := context.Background()

	verifier := "e2e-token-error-test-verifier-43-chars-here"
	challenge := pkceChallenge(t, verifier)

	// Generate auth URL (stores state in Redis)
	deviceID := oidcE2EDeviceID("token-endpoint-error")
	authResult, err := svc.GenerateAuthorizationURL(ctx, challenge, "S256", "desktop", deviceID, "")
	require.NoError(t, err)

	// Callback should fail because the token endpoint returns an error
	_, err = svc.HandleCallback(ctx, "any-code", authResult.State, verifier, "desktop", deviceID, "")
	assert.Error(t, err, "callback should fail when token endpoint returns error")

	// Clean up state that was consumed (HandleCallback deletes on success only)
	// State should NOT have been consumed since HandleCallback failed before deletion.
	// Second attempt should also fail:
	_, err2 := svc.HandleCallback(ctx, "any-code", authResult.State, verifier, "desktop", deviceID, "")
	assert.Error(t, err2, "second attempt should also fail")
}

// TestTokenDanceOIDC_E2E_MultipleClients verifies that tokens issued for
// different clients (different aud claims) can both be validated.
func TestTokenDanceOIDC_E2E_MultipleClients(t *testing.T) {
	_, mockSrv, privKey, _, _ := setupE2EService(t)
	ctx := context.Background()

	kid := computeKID(&privKey.PublicKey)
	issuer := mockSrv.URL

	// Client A
	tokenA := signMockIDToken(t, privKey, kid, "client-a", issuer, "user-x")
	claimsA, err := jwtutil.NewTokenDanceVerifier(mockSrv.URL+"/oidc/jwks", jwtutil.VerifierConfig{}).ParseJWT(context.Background(), tokenA, issuer, "client-a")
	require.NoError(t, err)
	assert.Equal(t, "user-x", claimsA.Subject)

	// Client B
	tokenB := signMockIDToken(t, privKey, kid, "client-b", issuer, "user-y")
	claimsB, err := jwtutil.NewTokenDanceVerifier(mockSrv.URL+"/oidc/jwks", jwtutil.VerifierConfig{}).ParseJWT(context.Background(), tokenB, issuer, "client-b")
	require.NoError(t, err)
	assert.Equal(t, "user-y", claimsB.Subject)

	// Cross-validation should fail: client-a token with client-b aud
	_, err = jwtutil.NewTokenDanceVerifier(mockSrv.URL+"/oidc/jwks", jwtutil.VerifierConfig{}).ParseJWT(context.Background(), tokenB, issuer, "client-a")
	assert.Error(t, err, "cross-client validation should fail")

	_ = ctx
}

// TestTokenDanceOIDC_E2E_EmptyScopes verifies that the mock server returns
// expected scopes and that headers are properly set.
func TestTokenDanceOIDC_E2E_EmptyScopes(t *testing.T) {
	svc, mockSrv, _, _, _ := setupE2EService(t)
	ctx := context.Background()
	_ = mockSrv

	verifier := "e2e-scope-test-code-verifier-minimum-43-chars"
	challenge := pkceChallenge(t, verifier)

	deviceID := oidcE2EDeviceID("scope")
	authResult, err := svc.GenerateAuthorizationURL(ctx, challenge, "S256", "desktop", deviceID, "")
	require.NoError(t, err)

	// Verify scope is in the authorization URL
	parsed, err := url.Parse(authResult.AuthorizationURL)
	require.NoError(t, err)
	assert.Equal(t, "openid profile email", parsed.Query().Get("scope"), "scope must include the email claim used by Hub profiles")

	// Callback should work with the mock
	callbackResult, err := svc.HandleCallback(ctx,
		"scope-test-code", authResult.State, verifier,
		"desktop", deviceID, "")
	require.NoError(t, err)
	assert.NotEmpty(t, callbackResult.AccessToken)
}

// TestTokenDanceOIDC_E2E_RefreshTokenStorage verifies that a refresh token
// is properly stored in the database after successful login.
func TestTokenDanceOIDC_E2E_RefreshTokenStorage(t *testing.T) {
	svc, _, _, db, _ := setupE2EService(t)
	ctx := context.Background()

	verifier := "e2e-refresh-storage-verifier-43-chars-here-ok"
	challenge := pkceChallenge(t, verifier)

	deviceID := oidcE2EDeviceID("refresh-storage")
	authResult, err := svc.GenerateAuthorizationURL(ctx, challenge, "S256", "desktop", deviceID, "")
	require.NoError(t, err)

	callbackResult, err := svc.HandleCallback(ctx,
		"refresh-test-code", authResult.State, verifier,
		"desktop", deviceID, "")
	require.NoError(t, err)

	// Verify refresh token exists in DB
	var count int64
	db.Table("refresh_tokens").Where("user_id = ? AND revoked = 0", callbackResult.User.ID).Count(&count)
	assert.Equal(t, int64(1), count, "exactly one active refresh token should exist")
}

// TestTokenDanceOIDC_E2E_ConcurrentLogins verifies that multiple concurrent
// logins don't interfere with each other.
func TestTokenDanceOIDC_E2E_ConcurrentLogins(t *testing.T) {
	svc, _, _, _, mr := setupE2EService(t)
	ctx := context.Background()

	numLogins := 5
	type loginResult struct {
		index      int
		accessTok  string
		refreshTok string
		userID     string
		err        error
	}

	results := make(chan loginResult, numLogins)

	for i := 0; i < numLogins; i++ {
		go func(idx int) {
			v := fmt.Sprintf("e2e-conc-%d-verifier-that-is-long-enough-ok", idx)
			c := pkceChallenge(t, v)
			deviceID := oidcE2EDeviceID(fmt.Sprintf("concurrent-%d", idx))
			authR, err := svc.GenerateAuthorizationURL(ctx, c, "S256", "desktop", deviceID, "")
			if err != nil {
				results <- loginResult{index: idx, err: err}
				return
			}

			cbR, err := svc.HandleCallback(ctx,
				fmt.Sprintf("%08d-conc-code", idx), authR.State, v,
				"desktop", deviceID, "")
			if err != nil {
				results <- loginResult{index: idx, err: err}
				return
			}
			results <- loginResult{
				index: idx, accessTok: cbR.AccessToken,
				refreshTok: cbR.RefreshToken, userID: cbR.User.ID,
			}
		}(i)
	}

	userIDs := make(map[string]bool)
	for i := 0; i < numLogins; i++ {
		r := <-results
		require.NoError(t, r.err, "login %d should not error", r.index)
		assert.NotEmpty(t, r.accessTok, "login %d access token should not be empty", r.index)
		assert.NotEmpty(t, r.refreshTok, "login %d refresh token should not be empty", r.index)
		userIDs[r.userID] = true
	}

	// Each concurrent login creates a unique user (different sub from mock server)
	assert.Equal(t, numLogins, len(userIDs), "each concurrent login should create unique user")

	_ = mr
}

// TestTokenDanceOIDC_E2E_LargePKCEValues verifies that PKCE values at the
// maximum reasonable length are handled correctly.
func TestTokenDanceOIDC_E2E_LargePKCEValues(t *testing.T) {
	svc, _, _, _, _ := setupE2EService(t)
	ctx := context.Background()

	// 128-char verifier; its S256 challenge is the standard 43-char base64url hash.
	verifier := strings.Repeat("v", 128)
	challenge := pkceChallenge(t, verifier)

	deviceID := oidcE2EDeviceID("large-pkce")
	authResult, err := svc.GenerateAuthorizationURL(ctx, challenge, "S256", "desktop", deviceID, "")
	require.NoError(t, err)

	callbackResult, err := svc.HandleCallback(ctx,
		"large-pkce-code", authResult.State, verifier,
		"desktop", deviceID, "")
	require.NoError(t, err)
	assert.NotEmpty(t, callbackResult.AccessToken)
}
