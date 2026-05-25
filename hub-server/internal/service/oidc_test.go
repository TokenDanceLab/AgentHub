package service

import (
	"context"
	"encoding/json"
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
	"github.com/agenthub/hub-server/internal/jwtutil"
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

	result, err := svc.GenerateAuthorizationURL(ctx, "test-challenge-abcdefghijklmnopqrstuvwxyz==", "S256", "desktop", "device-123")
	require.NoError(t, err)
	assert.NotEmpty(t, result.State)
	assert.Contains(t, result.AuthorizationURL, "https://id.example.com/oidc/auth")
	assert.Contains(t, result.AuthorizationURL, "response_type=code")
	assert.Contains(t, result.AuthorizationURL, "code_challenge=test-challenge")
	assert.Contains(t, result.AuthorizationURL, "code_challenge_method=S256")
	assert.Contains(t, result.AuthorizationURL, "state="+result.State)
}

func TestHandleCallback_InvalidState(t *testing.T) {
	svc, _, _ := setupOIDCTest(t)
	ctx := context.Background()

	_, err := svc.HandleCallback(ctx, "test-code", "invalid-state", "verifier", "desktop", "device-123")
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
		DeviceID:            "device-123",
	}
	entryJSON, _ := json.Marshal(entry)
	mr.Set("oidc:state:expired-state", string(entryJSON))
	// Fast-forward past TTL
	mr.FastForward(11 * time.Minute)

	_, err := svc.HandleCallback(ctx, "test-code", "expired-state", "verifier", "desktop", "device-123")
	assert.Error(t, err)
}
