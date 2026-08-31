//nolint:gosec // 测试 fixture：凭据模式字符串用于构造测试用例，非真实凭据
package oidc

import (
	"bytes"
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/pkg/reqlog"
	"github.com/agenthub/pkg/testkit/oidcfixture"
	"github.com/glebarez/sqlite"
)

// setupOIDCDB creates an in-memory SQLite database with tables needed for OIDC tests.
// Raw SQL is used instead of AutoMigrate because GORM's SQLite driver mishandles
// PostgreSQL-specific GORM tags (e.g. jsonb with default:'[]').
func setupOIDCDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)

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
		`CREATE UNIQUE INDEX idx_devices_user_type ON devices(user_id, device_type)`,
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

func setupOIDCTest(t *testing.T) (*Service, *gorm.DB, *miniredis.Miniredis) {
	t.Helper()

	db := setupOIDCDB(t)

	// In-memory Redis via miniredis
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	cacheClient := cache.NewClient(rdb)

	oidcCfg := config.TokenDanceIDConfig{
		IssuerURL:    "https://id.example.com",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
		RedirectURI:  "http://localhost:8080/client/auth/oidc/callback",
	}

	jwtCfg := config.JWTConfig{
		Secret:     "test-secret-minimum-32-characters!!",
		AccessTTL:  15 * time.Minute,
		RefreshTTL: 720 * time.Hour,
	}

	// JWKS URI comes from oidcCfg; the verifier is constructed inside
	// NewService (#1551) — no process-global JWKS state.
	svc := NewService(db, oidcCfg, jwtCfg, cacheClient)
	return svc, db, mr
}

func TestGenerateAuthorizationURL_Success(t *testing.T) {
	svc, _, _ := setupOIDCTest(t)
	ctx := context.Background()

	result, err := svc.GenerateAuthorizationURL(ctx, "test-challenge-abcdefghijklmnopqrstuvwxyz==", "S256", "desktop", "11111111-1111-4111-8111-111111111111", "")
	require.NoError(t, err)
	assert.NotEmpty(t, result.State)
	assert.Contains(t, result.AuthorizationURL, "https://id.example.com/oidc/authorize")
	assert.Contains(t, result.AuthorizationURL, "response_type=code")
	assert.Contains(t, result.AuthorizationURL, "code_challenge=test-challenge")
	assert.Contains(t, result.AuthorizationURL, "code_challenge_method=S256")
	assert.Contains(t, result.AuthorizationURL, "state="+result.State)
	assert.Contains(t, result.AuthorizationURL, "redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fclient%2Fauth%2Foidc%2Fcallback")
}

func TestGenerateAuthorizationURL_AllowsConfiguredBrowserRedirectURI(t *testing.T) {
	svc, _, _ := setupOIDCTest(t)
	svc.cfg.AllowedRedirectURIs = []string{"https://hub.example/auth/tokendance/callback"}

	result, err := svc.GenerateAuthorizationURL(context.Background(),
		"test-challenge-abcdefghijklmnopqrstuvwxyz==", "S256",
		"web", "11111111-1111-4111-8111-111111111111",
		"https://hub.example/auth/tokendance/callback")
	require.NoError(t, err)

	authURL, err := url.Parse(result.AuthorizationURL)
	require.NoError(t, err)
	assert.Equal(t, "https://hub.example/auth/tokendance/callback", authURL.Query().Get("redirect_uri"))
}

func TestGenerateAuthorizationURL_AllowsDesktopLoopbackDynamicPortWhenRegistered(t *testing.T) {
	svc, _, _ := setupOIDCTest(t)
	svc.cfg.AllowedRedirectURIs = []string{"http://127.0.0.1/callback"}

	result, err := svc.GenerateAuthorizationURL(context.Background(),
		"test-challenge-abcdefghijklmnopqrstuvwxyz==", "S256",
		"desktop", "11111111-1111-4111-8111-111111111111",
		"http://127.0.0.1:49152/callback")
	require.NoError(t, err)

	authURL, err := url.Parse(result.AuthorizationURL)
	require.NoError(t, err)
	assert.Equal(t, "http://127.0.0.1:49152/callback", authURL.Query().Get("redirect_uri"))
}

func TestGenerateAuthorizationURL_RejectsUnlistedRedirectURI(t *testing.T) {
	svc, _, _ := setupOIDCTest(t)

	_, err := svc.GenerateAuthorizationURL(context.Background(),
		"test-challenge-abcdefghijklmnopqrstuvwxyz==", "S256",
		"web", "11111111-1111-4111-8111-111111111111",
		"https://evil.example/callback")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "redirect_uri is not allowed")
}

func TestGenerateAuthorizationURL_RejectsWebLoopbackDynamicPort(t *testing.T) {
	svc, _, _ := setupOIDCTest(t)
	svc.cfg.AllowedRedirectURIs = []string{"http://127.0.0.1/callback"}

	_, err := svc.GenerateAuthorizationURL(context.Background(),
		"test-challenge-abcdefghijklmnopqrstuvwxyz==", "S256",
		"web", "11111111-1111-4111-8111-111111111111",
		"http://127.0.0.1:49152/callback")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "redirect_uri is not allowed")
}

func TestHandleCallback_InvalidState(t *testing.T) {
	svc, _, _ := setupOIDCTest(t)
	ctx := context.Background()

	_, err := svc.HandleCallback(ctx, "test-code", "invalid-state", "verifier", "desktop", "11111111-1111-4111-8111-111111111111", "")
	require.Error(t, err)
}

func TestHandleCallback_StateExpired(t *testing.T) {
	svc, _, mr := setupOIDCTest(t)
	ctx := context.Background()

	// Store a state that's about to expire
	entry := stateEntry{
		CodeChallenge:       "challenge",
		CodeChallengeMethod: "S256",
		DeviceType:          "desktop",
		DeviceID:            "11111111-1111-4111-8111-111111111111",
		RedirectURI:         "http://localhost:8080/client/auth/oidc/callback",
	}
	entryJSON, _ := json.Marshal(entry)
	mr.Set("oidc:state:expired-state", string(entryJSON))
	// Fast-forward past TTL
	mr.FastForward(11 * time.Minute)

	_, err := svc.HandleCallback(ctx, "test-code", "expired-state", "verifier", "desktop", "11111111-1111-4111-8111-111111111111", "")
	assert.Error(t, err)
}

func TestHandleCallback_RejectsStaleStateEntryBeforeTokenExchange(t *testing.T) {
	svc, _, mr := setupOIDCTest(t)
	ctx := context.Background()

	entry := stateEntry{
		CodeChallenge:       "challenge",
		CodeChallengeMethod: "S256",
		DeviceType:          "desktop",
		DeviceID:            "11111111-1111-4111-8111-111111111111",
		RedirectURI:         "http://localhost:8080/client/auth/oidc/callback",
		CreatedAt:           time.Now().Add(-11 * time.Minute).Unix(),
	}
	entryJSON, err := json.Marshal(entry)
	require.NoError(t, err)
	require.NoError(t, mr.Set("oidc:state:stale-state", string(entryJSON)))

	_, err = svc.HandleCallback(ctx, "test-code", "stale-state", "verifier", "desktop", "11111111-1111-4111-8111-111111111111", "")
	require.Error(t, err)
	require.IsType(t, &errcode.Error{}, err)
	assert.Equal(t, errcode.OIDCInvalidState.Code, err.(*errcode.Error).Code)
}

func TestGenerateAuthorizationURL_InvalidDeviceType(t *testing.T) {
	svc, _, _ := setupOIDCTest(t)
	ctx := context.Background()

	_, err := svc.GenerateAuthorizationURL(ctx, "test-challenge", "S256", "tokendance_bearer", "11111111-1111-4111-8111-111111111111", "")
	require.Error(t, err)
}

func TestGenerateAuthorizationURL_RejectsNonS256PKCEMethod(t *testing.T) {
	svc, _, _ := setupOIDCTest(t)
	ctx := context.Background()

	_, err := svc.GenerateAuthorizationURL(ctx, "test-challenge", "plain", "desktop", "11111111-1111-4111-8111-111111111111", "")
	require.Error(t, err)
}

func TestHandleCallback_SuccessUsesConfiguredJWKSAndIssuesHubSession(t *testing.T) {
	db := setupOIDCDB(t)
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	cacheClient := cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()}))

	privateKey, jwks, kid := oidcTestKey(t)
	issuer := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oidc/jwks":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(jwks))
		case "/oidc/token":
			require.NoError(t, r.ParseForm())
			assert.Equal(t, "authorization_code", r.PostForm.Get("grant_type"))
			assert.Equal(t, "auth-code-1", r.PostForm.Get("code"))
			assert.Equal(t, "http://127.0.0.1:8181/client/auth/oidc/callback", r.PostForm.Get("redirect_uri"))
			assert.Equal(t, "agenthub-client", r.PostForm.Get("client_id"))
			assert.Equal(t, "agenthub-secret", r.PostForm.Get("client_secret"))
			assert.Equal(t, "verifier-1", r.PostForm.Get("code_verifier"))
			idToken := signOIDCTestIDToken(t, privateKey, kid, issuer, "agenthub-client", "td-sub-1")
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"td-access","token_type":"Bearer","expires_in":900,"id_token":"` + idToken + `"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	issuer = server.URL

	// JWKS URI is carried by the config; NewService builds its own verifier (#1551).
	svc := NewService(db, config.TokenDanceIDConfig{
		IssuerURL:    server.URL,
		JWKSURI:      server.URL + "/oidc/jwks",
		ClientID:     "agenthub-client",
		ClientSecret: "agenthub-secret",
		RedirectURI:  "http://127.0.0.1:8181/client/auth/oidc/callback",
	}, config.JWTConfig{
		Secret:     "hub-local-secret-minimum-32-chars",
		AccessTTL:  15 * time.Minute,
		RefreshTTL: time.Hour,
	}, cacheClient)

	deviceID := "11111111-1111-4111-8111-111111111111"
	authz, err := svc.GenerateAuthorizationURL(context.Background(), pkceS256Challenge("verifier-1"), "S256", "desktop", deviceID, "")
	require.NoError(t, err)

	result, err := svc.HandleCallback(context.Background(), "auth-code-1", authz.State, "verifier-1", "desktop", deviceID, "")
	require.NoError(t, err)
	require.NotEmpty(t, result.AccessToken)
	require.NotEmpty(t, result.RefreshToken)
	require.NotEmpty(t, result.User.ID)
	require.NotNil(t, result.User.TokenDanceSub)
	assert.Equal(t, "td-sub-1", *result.User.TokenDanceSub)
	assert.Nil(t, result.User.PasswordHash)

	claims, err := jwtutil.ParseToken(result.AccessToken, "hub-local-secret-minimum-32-chars")
	require.NoError(t, err)
	assert.Equal(t, result.User.ID, claims.UserID)
	assert.Equal(t, "desktop", claims.DeviceType)
	assert.Equal(t, deviceID, claims.DeviceID)

	_, err = repository.FindRefreshTokenByHash(db, jwtutil.HashRefreshToken(result.RefreshToken))
	require.NoError(t, err)
}

func TestHandleCallback_TokenEndpointErrorDoesNotLogProviderRawBody(t *testing.T) {
	db := setupOIDCDB(t)
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	cacheClient := cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()}))

	const rawProviderBody = `{"error":"invalid_grant","error_description":"authorization code auth-code-secret returned access_token provider-access-secret","access_token":"provider-access-secret","refresh_token":"provider-refresh-secret","id_token":"provider-id-secret"}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oidc/token" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(rawProviderBody))
	}))
	t.Cleanup(server.Close)

	var logBuf bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previousLogger) })

	// JWKS URI is carried by the config; NewService builds its own verifier (#1551).
	svc := NewService(db, config.TokenDanceIDConfig{
		IssuerURL:    server.URL,
		ClientID:     "agenthub-client",
		ClientSecret: "agenthub-secret",
		RedirectURI:  "http://127.0.0.1:8181/client/auth/oidc/callback",
	}, config.JWTConfig{
		Secret:     "hub-local-secret-minimum-32-chars",
		AccessTTL:  15 * time.Minute,
		RefreshTTL: time.Hour,
	}, cacheClient)

	deviceID := "11111111-1111-4111-8111-111111111111"
	authz, err := svc.GenerateAuthorizationURL(context.Background(), pkceS256Challenge("verifier-1"), "S256", "desktop", deviceID, "")
	require.NoError(t, err)

	ctx := reqlog.WithRequestID(context.Background(), "req-oidc-token-redact")
	_, err = svc.HandleCallback(ctx, "auth-code-secret", authz.State, "verifier-1", "desktop", deviceID, "")
	require.ErrorIs(t, err, errcode.OIDCCodeExchangeFailed)

	logText := logBuf.String()
	assert.Contains(t, logText, "req-oidc-token-redact")
	assert.Contains(t, logText, "invalid_grant")
	assert.Contains(t, logText, "400")
	for _, forbidden := range []string{
		rawProviderBody,
		"auth-code-secret",
		"provider-access-secret",
		"provider-refresh-secret",
		"provider-id-secret",
		"access_token",
		"refresh_token",
		"id_token",
		"response_body",
	} {
		assert.NotContains(t, logText, forbidden)
		assert.NotContains(t, err.Error(), forbidden)
	}
}

func oidcTestKey(t *testing.T) (*rsa.PrivateKey, string, string) {
	t.Helper()
	key := oidcfixture.NewKey(t)
	return key.Private, key.JWKS, key.Kid
}

func signOIDCTestIDToken(t *testing.T, privateKey *rsa.PrivateKey, kid, issuer, audience, subject string) string {
	return oidcfixture.SignToken(t, privateKey, kid, issuer, audience, subject, "user@example.com", "Test User")
}

// pkceS256Challenge computes the RFC 7636 S256 code_challenge for a given
// code_verifier: BASE64URL-ENCODE(SHA256(ASCII(code_verifier))). Used by the
// HandleCallback tests so the local PKCE verification (Task 4) sees a
// challenge that matches the verifier supplied at callback time.
func pkceS256Challenge(verifier string) string {
	digest := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

// TestHandleCallback_RejectsPKCEVerifierMismatch (Task 4): the local PKCE
// check must reject a callback whose code_verifier does not hash to the
// code_challenge stored during authorize, before any network call to the
// token endpoint. The state is otherwise valid (fresh, matching device and
// redirect), so only the PKCE mismatch can produce the rejection.
func TestHandleCallback_RejectsPKCEVerifierMismatch(t *testing.T) {
	svc, _, mr := setupOIDCTest(t)
	ctx := context.Background()

	// Authorize with the real S256 challenge for "correct-verifier".
	authz, err := svc.GenerateAuthorizationURL(ctx, pkceS256Challenge("correct-verifier"), "S256", "desktop", "11111111-1111-4111-8111-111111111111", "")
	require.NoError(t, err)

	// Callback supplies a different verifier — local PKCE check must reject.
	_, err = svc.HandleCallback(ctx, "auth-code", authz.State, "wrong-verifier", "desktop", "11111111-1111-4111-8111-111111111111", "")
	require.Error(t, err)
	require.ErrorIs(t, err, errcode.OIDCInvalidState)

	// The state must have been consumed atomically (GetDel) even on the
	// PKCE mismatch path, so a replay with the correct verifier now fails
	// on the missing state rather than passing.
	_, replayErr := svc.HandleCallback(ctx, "auth-code", authz.State, "correct-verifier", "desktop", "11111111-1111-4111-8111-111111111111", "")
	require.Error(t, replayErr)
	require.ErrorIs(t, replayErr, errcode.OIDCInvalidState)
	_ = mr
}

// TestHandleCallback_RejectsEmptyPKCEVerifier (Task 4): an empty code_verifier
// is a client bug and must fail closed before the token exchange.
func TestHandleCallback_RejectsEmptyPKCEVerifier(t *testing.T) {
	svc, _, _ := setupOIDCTest(t)
	ctx := context.Background()

	authz, err := svc.GenerateAuthorizationURL(ctx, pkceS256Challenge("verifier-x"), "S256", "desktop", "11111111-1111-4111-8111-111111111111", "")
	require.NoError(t, err)

	_, err = svc.HandleCallback(ctx, "auth-code", authz.State, "", "desktop", "11111111-1111-4111-8111-111111111111", "")
	require.Error(t, err)
	require.ErrorIs(t, err, errcode.OIDCInvalidState)
}
