//nolint:gosec // Test fixtures contain public, non-production credential shapes.
package oidc

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/glebarez/sqlite"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/pkg/testkit/oidcfixture"
)

const (
	testAccountClientID     = "agenthub-client"
	testAccountClientSecret = "account-client-secret-padded-to-at-least-32"
	testAccountCodeVerifier = "verifier-abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789"
	testOIDCDeviceID        = "11111111-1111-4111-8111-111111111111"
)

type accountOIDCTestEnv struct {
	service     *Service
	db          *gorm.DB
	provider    *oidcfixture.Provider
	redis       *miniredis.Miniredis
	redirectURI string
}

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
		`CREATE UNIQUE INDEX idx_users_tokendance_sub ON users(tokendance_sub)
			WHERE tokendance_sub IS NOT NULL AND tokendance_sub != ''`,
		`CREATE TABLE user_identities (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			provider TEXT NOT NULL,
			issuer TEXT NOT NULL,
			subject TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'active',
			linked_at DATETIME NOT NULL,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE UNIQUE INDEX idx_user_identities_issuer_subject ON user_identities(issuer, subject)`,
		`CREATE INDEX idx_user_identities_user_id ON user_identities(user_id)`,
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
			user_identity_id TEXT,
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

func newAccountOIDCTestEnv(t *testing.T) *accountOIDCTestEnv {
	t.Helper()
	db := setupOIDCDB(t)
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	cacheClient := cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()}))

	provider := oidcfixture.NewServer(t)
	provider.ConfigureClient(testAccountClientID, testAccountClientSecret)
	redirectURI := "http://127.0.0.1:53682/callback"
	cfg := config.AccountOIDCConfig{
		IssuerURL:            provider.Server.URL,
		ClientID:             testAccountClientID,
		ClientSecret:         testAccountClientSecret,
		RedirectURI:          redirectURI,
		AllowedRedirectURIs:  []string{"https://hub.example.com/workbench/auth/account/callback"},
		HTTPTimeout:          2 * time.Second,
		MaxResponseBodyBytes: 64 * 1024,
	}
	svc := NewService(db, cfg, config.JWTConfig{
		Secret:     "hub-local-secret-minimum-32-characters",
		AccessTTL:  15 * time.Minute,
		RefreshTTL: time.Hour,
	}, cacheClient)
	return &accountOIDCTestEnv{
		service:     svc,
		db:          db,
		provider:    provider,
		redis:       mr,
		redirectURI: redirectURI,
	}
}

func authorizeAccountTest(t *testing.T, env *accountOIDCTestEnv, opts oidcfixture.CodeOptions) string {
	t.Helper()
	authz, err := env.service.GenerateAuthorizationURL(
		context.Background(),
		pkceS256Challenge(testAccountCodeVerifier),
		"S256",
		"desktop",
		testOIDCDeviceID,
		env.redirectURI,
	)
	require.NoError(t, err)
	authURL, err := url.Parse(authz.AuthorizationURL)
	require.NoError(t, err)
	require.Equal(t, "/oauth/authorize", authURL.Path)
	require.Equal(t, "openid profile", authURL.Query().Get("scope"))
	require.NotContains(t, authURL.Query().Get("scope"), "offline_access")
	opts.Nonce = authURL.Query().Get("nonce")
	if opts.Subject == "" {
		opts.Subject = "account-subject-1"
	}
	env.provider.RegisterCodeOptions("auth-code-1", opts)
	return authz.State
}

func callbackAccountTest(env *accountOIDCTestEnv, state, issuer string) (*CallbackResult, error) {
	return env.service.HandleCallback(
		context.Background(),
		"auth-code-1",
		state,
		testAccountCodeVerifier,
		issuer,
		"desktop",
		testOIDCDeviceID,
		env.redirectURI,
	)
}

func TestGenerateAuthorizationURLUsesPublicAccountContract(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	authz, err := env.service.GenerateAuthorizationURL(
		context.Background(),
		pkceS256Challenge(testAccountCodeVerifier),
		"S256",
		"desktop",
		testOIDCDeviceID,
		env.redirectURI,
	)
	require.NoError(t, err)
	assert.NotEmpty(t, authz.State)
	assert.Equal(t, env.provider.Server.URL, authz.Issuer)

	authURL, err := url.Parse(authz.AuthorizationURL)
	require.NoError(t, err)
	q := authURL.Query()
	assert.Equal(t, "/oauth/authorize", authURL.Path)
	assert.Equal(t, "code", q.Get("response_type"))
	assert.Equal(t, testAccountClientID, q.Get("client_id"))
	assert.Equal(t, "openid profile", q.Get("scope"))
	assert.Equal(t, env.redirectURI, q.Get("redirect_uri"))
	assert.Equal(t, "S256", q.Get("code_challenge_method"))
	assert.NotEmpty(t, q.Get("nonce"))
	assert.NotContains(t, q.Get("scope"), "offline_access")
}

func TestGenerateAuthorizationURLRejectsUnlistedRedirectURI(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	_, err := env.service.GenerateAuthorizationURL(
		context.Background(),
		pkceS256Challenge(testAccountCodeVerifier),
		"S256",
		"web",
		testOIDCDeviceID,
		"https://evil.example/callback",
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "redirect_uri is not allowed")
}

func TestGenerateAuthorizationURLRejectsDynamicDesktopPort(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	_, err := env.service.GenerateAuthorizationURL(
		context.Background(),
		pkceS256Challenge(testAccountCodeVerifier),
		"S256",
		"desktop",
		testOIDCDeviceID,
		"http://127.0.0.1:49152/callback",
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "redirect_uri is not allowed")
}

func TestHandleCallbackSuccessIssuesHubSessionAndMapsIssuerSubject(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	state := authorizeAccountTest(t, env, oidcfixture.CodeOptions{
		Subject: "account-subject-success",
		Name:    "Account User",
	})

	result, err := callbackAccountTest(env, state, env.provider.Server.URL)
	require.NoError(t, err)
	require.NotEmpty(t, result.AccessToken)
	require.NotEmpty(t, result.RefreshToken)
	require.NotEmpty(t, result.User.ID)
	assert.Nil(t, result.User.TokenDanceSub)
	assert.Nil(t, result.User.PasswordHash)

	claims, err := jwtutil.ParseToken(result.AccessToken, "hub-local-secret-minimum-32-characters")
	require.NoError(t, err)
	assert.Equal(t, result.User.ID, claims.UserID)
	assert.Equal(t, "desktop", claims.DeviceType)
	assert.Equal(t, testOIDCDeviceID, claims.DeviceID)

	var identity model.UserIdentity
	require.NoError(t, env.db.Where(
		"issuer = ? AND subject = ?",
		env.provider.Server.URL,
		"account-subject-success",
	).First(&identity).Error)
	assert.Equal(t, result.User.ID, identity.UserID)
	assert.Equal(t, model.IdentityProviderAccount, identity.Provider)
	assert.Equal(t, model.IdentityStatusActive, identity.Status)

	persistedRefresh, err := repository.FindRefreshTokenByHash(env.db, jwtutil.HashRefreshToken(result.RefreshToken))
	require.NoError(t, err)
	require.NotNil(t, persistedRefresh.UserIdentityID)
	assert.Equal(t, identity.ID, *persistedRefresh.UserIdentityID)
}

func TestHandleCallbackRejectsWrongAuthorizationResponseIssuer(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	state := authorizeAccountTest(t, env, oidcfixture.CodeOptions{Subject: "issuer-test"})

	_, err := callbackAccountTest(env, state, "https://id.tokendancelab.com")
	require.ErrorIs(t, err, errcode.OIDCIssuerInvalid)
}

func TestHandleCallbackRejectsIDTokenNonceMismatch(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	authz, err := env.service.GenerateAuthorizationURL(
		context.Background(),
		pkceS256Challenge(testAccountCodeVerifier),
		"S256",
		"desktop",
		testOIDCDeviceID,
		env.redirectURI,
	)
	require.NoError(t, err)
	env.provider.RegisterCodeOptions("auth-code-1", oidcfixture.CodeOptions{
		Subject: "nonce-test",
		Nonce:   "wrong-nonce",
	})

	_, err = callbackAccountTest(env, authz.State, env.provider.Server.URL)
	require.ErrorIs(t, err, errcode.OIDCIDTokenInvalid)
}

func TestHandleCallbackRejectsIDTokenAudienceMismatch(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	state := authorizeAccountTest(t, env, oidcfixture.CodeOptions{
		Subject:         "audience-test",
		IDTokenAudience: "some-other-client",
	})

	_, err := callbackAccountTest(env, state, env.provider.Server.URL)
	require.ErrorIs(t, err, errcode.OIDCIDTokenInvalid)
}

func TestHandleCallbackRejectsIDTokenAZPMismatch(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	state := authorizeAccountTest(t, env, oidcfixture.CodeOptions{
		Subject:    "azp-test",
		IDTokenAzp: "some-other-client",
	})

	_, err := callbackAccountTest(env, state, env.provider.Server.URL)
	require.ErrorIs(t, err, errcode.OIDCIDTokenInvalid)
}

func TestHandleCallbackRejectsUserInfoSubjectMismatch(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	state := authorizeAccountTest(t, env, oidcfixture.CodeOptions{
		Subject:         "id-token-subject",
		UserInfoSubject: "different-userinfo-subject",
	})

	_, err := callbackAccountTest(env, state, env.provider.Server.URL)
	require.ErrorIs(t, err, errcode.OIDCUserInfoInvalid)
}

func TestHandleCallbackRejectsRetiredIdentity(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	now := time.Now().UTC()
	user := &model.User{Username: "retired-user", Nickname: "Retired"}
	require.NoError(t, env.db.Create(user).Error)
	identity := &model.UserIdentity{
		UserID:   user.ID,
		Provider: model.IdentityProviderAccount,
		Issuer:   env.provider.Server.URL,
		Subject:  "retired-subject",
		Status:   model.IdentityStatusRetired,
		LinkedAt: now,
	}
	require.NoError(t, env.db.Create(identity).Error)
	rawRefresh := "retired-refresh-token"
	require.NoError(t, env.db.Create(&model.RefreshToken{
		UserID:         user.ID,
		DeviceType:     "desktop",
		DeviceID:       testOIDCDeviceID,
		UserIdentityID: &identity.ID,
		TokenHash:      jwtutil.HashRefreshToken(rawRefresh),
		ExpiresAt:      time.Now().Add(time.Hour),
	}).Error)

	state := authorizeAccountTest(t, env, oidcfixture.CodeOptions{Subject: "retired-subject"})
	_, err := callbackAccountTest(env, state, env.provider.Server.URL)
	require.ErrorIs(t, err, errcode.OIDCIdentityRetired)

	persisted, err := repository.FindRefreshTokenByHash(env.db, jwtutil.HashRefreshToken(rawRefresh))
	require.NoError(t, err)
	assert.True(t, persisted.Revoked, "retired identity must revoke existing Hub refresh sessions")
}

func TestHandleCallbackDoesNotClaimLegacyTokenDanceSubject(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	now := time.Now().UTC()
	subject := "legacy-subject-shared-value"
	require.NoError(t, env.db.Exec(`
		INSERT INTO users (
			id, username, password_hash, nickname, tokendance_sub,
			tokendance_sub_linked_at, created_at, updated_at
		) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
	`, "legacy-user", "legacy_user", "Legacy User", subject, now, now, now).Error)

	state := authorizeAccountTest(t, env, oidcfixture.CodeOptions{Subject: subject})
	result, err := callbackAccountTest(env, state, env.provider.Server.URL)
	require.NoError(t, err)
	assert.NotEqual(t, "legacy-user", result.User.ID)
	assert.Nil(t, result.User.TokenDanceSub)

	var users int64
	require.NoError(t, env.db.Model(&model.User{}).Count(&users).Error)
	assert.Equal(t, int64(2), users)
}

func TestHandleCallbackRejectsPKCEVerifierMismatchAndConsumesState(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	state := authorizeAccountTest(t, env, oidcfixture.CodeOptions{Subject: "pkce-test"})

	_, err := env.service.HandleCallback(
		context.Background(),
		"auth-code-1",
		state,
		"wrong-verifier-that-is-still-long-enough-to-pass-shape-validation-000000",
		env.provider.Server.URL,
		"desktop",
		testOIDCDeviceID,
		env.redirectURI,
	)
	require.ErrorIs(t, err, errcode.OIDCInvalidState)

	_, err = callbackAccountTest(env, state, env.provider.Server.URL)
	require.ErrorIs(t, err, errcode.OIDCInvalidState)
}

func TestHandleCallbackRejectsStaleState(t *testing.T) {
	env := newAccountOIDCTestEnv(t)
	entry := stateEntry{
		CodeChallenge:       pkceS256Challenge(testAccountCodeVerifier),
		CodeChallengeMethod: "S256",
		DeviceType:          "desktop",
		DeviceID:            testOIDCDeviceID,
		RedirectURI:         env.redirectURI,
		Nonce:               "nonce",
		CreatedAt:           time.Now().Add(-11 * time.Minute).Unix(),
	}
	raw, err := json.Marshal(entry)
	require.NoError(t, err)
	require.NoError(t, env.redis.Set(oidcStateKey("stale-state"), string(raw)))

	_, err = callbackAccountTest(env, "stale-state", env.provider.Server.URL)
	require.ErrorIs(t, err, errcode.OIDCInvalidState)
}

func TestProviderDiscoveryRejectsCrossOriginEndpoint(t *testing.T) {
	var issuer string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/openid-configuration" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                         issuer,
			"authorization_endpoint":                         issuer + "/oauth/authorize",
			"token_endpoint":                                 "https://internal-account.invalid/admin/token",
			"userinfo_endpoint":                              issuer + "/oauth/userinfo",
			"jwks_uri":                                       issuer + "/oauth/jwks",
			"response_types_supported":                       []string{"code"},
			"response_modes_supported":                       []string{"query"},
			"grant_types_supported":                          []string{"authorization_code"},
			"id_token_signing_alg_values_supported":          []string{"RS256"},
			"token_endpoint_auth_methods_supported":          []string{"client_secret_basic"},
			"code_challenge_methods_supported":               []string{"S256"},
			"authorization_response_iss_parameter_supported": true,
		})
	}))
	defer server.Close()
	issuer = server.URL

	svc := NewService(nil, config.AccountOIDCConfig{
		IssuerURL:            server.URL,
		ClientID:             testAccountClientID,
		ClientSecret:         testAccountClientSecret,
		RedirectURI:          "http://127.0.0.1:53682/callback",
		HTTPTimeout:          time.Second,
		MaxResponseBodyBytes: 64 * 1024,
	}, config.JWTConfig{}, nil)

	_, err := svc.GenerateAuthorizationURL(
		context.Background(),
		pkceS256Challenge(testAccountCodeVerifier),
		"S256",
		"desktop",
		testOIDCDeviceID,
		"http://127.0.0.1:53682/callback",
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "issuer-origin policy")
}

func TestProviderDiscoveryRequiresRFC9207IssuerResponse(t *testing.T) {
	var issuer string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                         issuer,
			"authorization_endpoint":                         issuer + "/oauth/authorize",
			"token_endpoint":                                 issuer + "/oauth/token",
			"userinfo_endpoint":                              issuer + "/oauth/userinfo",
			"jwks_uri":                                       issuer + "/oauth/jwks",
			"response_types_supported":                       []string{"code"},
			"response_modes_supported":                       []string{"query"},
			"grant_types_supported":                          []string{"authorization_code"},
			"id_token_signing_alg_values_supported":          []string{"RS256"},
			"token_endpoint_auth_methods_supported":          []string{"client_secret_basic"},
			"code_challenge_methods_supported":               []string{"S256"},
			"authorization_response_iss_parameter_supported": false,
		})
	}))
	defer server.Close()
	issuer = server.URL

	svc := NewService(nil, config.AccountOIDCConfig{
		IssuerURL:            server.URL,
		ClientID:             testAccountClientID,
		ClientSecret:         testAccountClientSecret,
		RedirectURI:          "http://127.0.0.1:53682/callback",
		HTTPTimeout:          time.Second,
		MaxResponseBodyBytes: 64 * 1024,
	}, config.JWTConfig{}, nil)

	_, err := svc.GenerateAuthorizationURL(
		context.Background(),
		pkceS256Challenge(testAccountCodeVerifier),
		"S256",
		"desktop",
		testOIDCDeviceID,
		"http://127.0.0.1:53682/callback",
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "RFC 9207")
}

func pkceS256Challenge(verifier string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(verifier)))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}
