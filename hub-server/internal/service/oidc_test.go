package service

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/repository"
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
			password_hash TEXT NOT NULL DEFAULT '',
			nickname TEXT NOT NULL,
			avatar_url TEXT DEFAULT '',
			tokendance_sub TEXT,
			tokendance_sub_linked_at DATETIME,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE UNIQUE INDEX idx_users_tokendance_sub ON users(tokendance_sub) WHERE tokendance_sub IS NOT NULL AND tokendance_sub != ''`,
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
	}
	for _, ddl := range tables {
		require.NoError(t, db.Exec(ddl).Error, "DDL: %s", ddl[:60])
	}
	return db
}

func setupOIDCTest(t *testing.T) (*OIDCService, *gorm.DB, *miniredis.Miniredis) {
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

	// Set up JWKS URI (so ParseTokenDanceJWT doesn't fail on missing JWKS URI;
	// the actual JWKS fetch won't happen in these unit tests because exchangeCode
	// will fail first or we stop before token validation)
	jwtutil.SetJWKSURI("https://id.example.com/oidc/jwks")

	svc := NewOIDCService(db, oidcCfg, jwtCfg, cacheClient)
	return svc, db, mr
}

func TestGenerateAuthorizationURL_Success(t *testing.T) {
	svc, _, _ := setupOIDCTest(t)
	ctx := context.Background()

	result, err := svc.GenerateAuthorizationURL(ctx, "test-challenge-abcdefghijklmnopqrstuvwxyz==", "S256", "desktop", "11111111-1111-4111-8111-111111111111")
	require.NoError(t, err)
	assert.NotEmpty(t, result.State)
	assert.Contains(t, result.AuthorizationURL, "https://id.example.com/oidc/authorize")
	assert.Contains(t, result.AuthorizationURL, "response_type=code")
	assert.Contains(t, result.AuthorizationURL, "code_challenge=test-challenge")
	assert.Contains(t, result.AuthorizationURL, "code_challenge_method=S256")
	assert.Contains(t, result.AuthorizationURL, "state="+result.State)
}

func TestHandleCallback_InvalidState(t *testing.T) {
	svc, _, _ := setupOIDCTest(t)
	ctx := context.Background()

	_, err := svc.HandleCallback(ctx, "test-code", "invalid-state", "verifier", "desktop", "11111111-1111-4111-8111-111111111111")
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
	}
	entryJSON, _ := json.Marshal(entry)
	mr.Set("oidc:state:expired-state", string(entryJSON))
	// Fast-forward past TTL
	mr.FastForward(11 * time.Minute)

	_, err := svc.HandleCallback(ctx, "test-code", "expired-state", "verifier", "desktop", "11111111-1111-4111-8111-111111111111")
	assert.Error(t, err)
}

func TestGenerateAuthorizationURL_InvalidDeviceType(t *testing.T) {
	svc, _, _ := setupOIDCTest(t)
	ctx := context.Background()

	_, err := svc.GenerateAuthorizationURL(ctx, "test-challenge", "S256", "tokendance_bearer", "11111111-1111-4111-8111-111111111111")
	require.Error(t, err)
}

func TestGenerateAuthorizationURL_RejectsNonS256PKCEMethod(t *testing.T) {
	svc, _, _ := setupOIDCTest(t)
	ctx := context.Background()

	_, err := svc.GenerateAuthorizationURL(ctx, "test-challenge", "plain", "desktop", "11111111-1111-4111-8111-111111111111")
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

	jwtutil.SetJWKSURI("")
	jwtutil.ResetJWKSCache()
	svc := NewOIDCService(db, config.TokenDanceIDConfig{
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
	authz, err := svc.GenerateAuthorizationURL(context.Background(), "challenge-1", "S256", "desktop", deviceID)
	require.NoError(t, err)

	result, err := svc.HandleCallback(context.Background(), "auth-code-1", authz.State, "verifier-1", "desktop", deviceID)
	require.NoError(t, err)
	require.NotEmpty(t, result.AccessToken)
	require.NotEmpty(t, result.RefreshToken)
	require.NotEmpty(t, result.User.ID)
	require.NotNil(t, result.User.TokenDanceSub)
	assert.Equal(t, "td-sub-1", *result.User.TokenDanceSub)

	claims, err := jwtutil.ParseToken(result.AccessToken, "hub-local-secret-minimum-32-chars")
	require.NoError(t, err)
	assert.Equal(t, result.User.ID, claims.UserID)
	assert.Equal(t, "desktop", claims.DeviceType)
	assert.Equal(t, deviceID, claims.DeviceID)

	_, err = repository.FindRefreshTokenByHash(db, jwtutil.HashRefreshToken(result.RefreshToken))
	require.NoError(t, err)
}

func oidcTestKey(t *testing.T) (*rsa.PrivateKey, string, string) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	kid := oidcTestKID(&privateKey.PublicKey)
	n := base64.RawURLEncoding.EncodeToString(privateKey.PublicKey.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(privateKey.PublicKey.E)).Bytes())
	jwks := `{"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":"` + kid + `","n":"` + n + `","e":"` + e + `"}]}`
	return privateKey, jwks, kid
}

func oidcTestKID(pub *rsa.PublicKey) string {
	hash := sha256.Sum256(pub.N.Bytes())
	return base64.RawURLEncoding.EncodeToString(hash[:16])
}

func signOIDCTestIDToken(t *testing.T, privateKey *rsa.PrivateKey, kid, issuer, audience, subject string) string {
	t.Helper()
	now := time.Now()
	claims := jwtutil.TokenDanceClaims{
		Email:         "user@example.com",
		EmailVerified: true,
		Name:          "Test User",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   subject,
			Audience:  jwt.ClaimStrings{audience},
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = kid
	signed, err := token.SignedString(privateKey)
	require.NoError(t, err)
	return signed
}
