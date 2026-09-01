package auth

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func newMockDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, *sql.DB) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(
		sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(
			func(expectedSQL, actualSQL string) error {
				if strings.Contains(actualSQL, expectedSQL) {
					return nil
				}
				return fmt.Errorf("expected SQL to contain %q, but got %q", expectedSQL, actualSQL)
			},
		)),
	)
	require.NoError(t, err)
	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		SkipDefaultTransaction: true,
		PrepareStmt:            false,
	})
	require.NoError(t, err)
	return gormDB, mock, sqlDB
}

func testCacheClient(t *testing.T) *cache.Client {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return cache.NewClient(rdb)
}

func jwtCfg() config.JWTConfig {
	return config.JWTConfig{
		Secret:     "test-secret-at-least-16-char!!",
		AccessTTL:  15 * time.Minute,
		RefreshTTL: 720 * time.Hour,
	}
}

// SQL substrings used for matching (QueryMatcherFunc with strings.Contains)
const (
	sqlUserByID       = `FROM "users" WHERE id =`
	sqlRTByUserDevice = `FROM "refresh_tokens" WHERE user_id`
	sqlRTByHash       = `FROM "refresh_tokens" WHERE token_hash`
	sqlInsertRT       = `INSERT INTO "refresh_tokens"`
	sqlRevokeByDevice = `UPDATE "refresh_tokens" SET "revoked"=$1 WHERE user_id`    // device-wide revoke (Logout / rotation step 2)
	sqlClaimRT        = `UPDATE "refresh_tokens" SET "revoked"=$1 WHERE token_hash` // rotation step 1 atomic claim (#2154)
	sqlUpdateUser     = `UPDATE "users" SET`
)

// ==================== RefreshToken ====================

func TestRefreshToken_Invalid(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlRTByHash).
		WithArgs(sqlmock.AnyArg(), 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewService(db, jwtCfg(), nil)
	_, err := svc.RefreshToken(context.Background(), "invalid-refresh-token")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRefreshToken_Revoked(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlRTByHash).
		WithArgs(sqlmock.AnyArg(), 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-1", "user-uuid", "desktop", "dev-1", "hash", true, time.Now().Add(24*time.Hour)))

	svc := NewService(db, jwtCfg(), nil)
	_, err := svc.RefreshToken(context.Background(), "any-refresh-token")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// #134: RefreshToken rotates the refresh token (old revoked, new issued).
func TestRefreshToken_Success(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	expiry := time.Now().Add(24 * time.Hour)
	mock.ExpectQuery(sqlRTByHash).
		WithArgs(sqlmock.AnyArg(), 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-1", "user-uuid", "desktop", "dev-1", "hash", false, expiry))

	// Rotation step 1: atomic claim on the presented row (#2154).
	mock.ExpectExec(sqlClaimRT).
		WithArgs(true, sqlmock.AnyArg(), false).
		WillReturnResult(sqlmock.NewResult(0, 1))

	// Revoke old token
	mock.ExpectExec(sqlRevokeByDevice).
		WithArgs(true, "user-uuid", "dev-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	// UpsertRefreshToken: atomic upsert + re-fetch
	mock.ExpectExec(sqlInsertRT).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(sqlRTByUserDevice).
		WithArgs("user-uuid", "desktop", "dev-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-new", "user-uuid", "desktop", "dev-1", "newhash", false, expiry))

	svc := NewService(db, jwtCfg(), nil)
	resp, err := svc.RefreshToken(context.Background(), "valid-refresh-token")
	require.NoError(t, err)
	assert.NotEmpty(t, resp.AccessToken)
	assert.NotEmpty(t, resp.RefreshToken)
	// The new refresh token should be different from the one passed in
	// (we can't check exact value, but we check it's not empty and it's a new token)
	assert.Equal(t, int64(900), resp.ExpiresIn)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// #134: Refresh token rotation with redis cache.
func TestRefreshToken_RotatesWithCache(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	expiry := time.Now().Add(24 * time.Hour)
	mock.ExpectQuery(sqlRTByHash).
		WithArgs(sqlmock.AnyArg(), 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-1", "user-uuid", "web", "dev-web", "oldhash", false, expiry))

	mock.ExpectExec(sqlClaimRT).
		WithArgs(true, sqlmock.AnyArg(), false).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectExec(sqlRevokeByDevice).
		WithArgs(true, "user-uuid", "dev-web").
		WillReturnResult(sqlmock.NewResult(0, 1))

	// UpsertRefreshToken: atomic upsert + re-fetch
	mock.ExpectExec(sqlInsertRT).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(sqlRTByUserDevice).
		WithArgs("user-uuid", "web", "dev-web", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-new", "user-uuid", "web", "dev-web", "newhash", false, expiry))

	svc := NewService(db, jwtCfg(), testCacheClient(t))
	resp, err := svc.RefreshToken(context.Background(), "some-refresh-token")
	require.NoError(t, err)
	assert.NotEmpty(t, resp.AccessToken)
	assert.NotEmpty(t, resp.RefreshToken)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// RefreshToken rejects tokens whose hash is in the Redis blacklist
// (set during a previous rotation). This closes the race window between
// DB revocation and Redis blacklisting.
func TestRefreshToken_RejectsBlacklistedTokenHash(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	expiry := time.Now().Add(24 * time.Hour)
	mock.ExpectQuery(sqlRTByHash).
		WithArgs(sqlmock.AnyArg(), 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-1", "user-uuid", "desktop", "dev-1", "hash-abc", false, expiry))

	cacheClient := testCacheClient(t)
	// Pre-set the token hash in the blacklist (simulating a prior rotation
	// that blacklisted faster than DB commit).
	require.NoError(t, cacheClient.BlacklistRefreshToken(context.Background(), "hash-abc", time.Hour))

	svc := NewService(db, jwtCfg(), cacheClient)
	_, err := svc.RefreshToken(context.Background(), "any-token-producing-hash-abc")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// RefreshToken rejects tokens when the user:device compound key is
// blacklisted (set during logout before DB revocation completes).
func TestRefreshToken_RejectsBlacklistedUserDevice(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	expiry := time.Now().Add(24 * time.Hour)
	mock.ExpectQuery(sqlRTByHash).
		WithArgs(sqlmock.AnyArg(), 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-1", "user-uuid", "desktop", "dev-1", "hash-xyz", false, expiry))

	cacheClient := testCacheClient(t)
	// Pre-set the user:device blacklist key (simulating a logout that
	// wrote to Redis but hasn't finished DB commit yet).
	require.NoError(t, cacheClient.BlacklistRefreshToken(context.Background(), "user-uuid:dev-1", time.Hour))

	svc := NewService(db, jwtCfg(), cacheClient)
	_, err := svc.RefreshToken(context.Background(), "any-token-for-user-uuid-dev-1")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// RefreshToken rejects tokens when the user:device:device_type compound key
// is blacklisted (set during logout with device_type scoping, #149).
func TestRefreshToken_RejectsBlacklistedUserDeviceType(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	expiry := time.Now().Add(24 * time.Hour)
	mock.ExpectQuery(sqlRTByHash).
		WithArgs(sqlmock.AnyArg(), 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-1", "user-uuid", "desktop", "dev-1", "hash-uvw", false, expiry))

	cacheClient := testCacheClient(t)
	// Pre-set the scoped blacklist key.
	require.NoError(t, cacheClient.BlacklistRefreshToken(context.Background(), "user-uuid:dev-1:desktop", time.Hour))

	svc := NewService(db, jwtCfg(), cacheClient)
	_, err := svc.RefreshToken(context.Background(), "any-token-for-user-uuid-dev-1-desktop")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== Logout ====================

func TestLogout(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectExec(sqlRevokeByDevice).
		WithArgs(true, "user-uuid", "dev-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	svc := NewService(db, jwtCfg(), nil)
	err := svc.Logout(context.Background(), "user-uuid", "dev-1", "", "")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// #66: Logout writes to Redis blacklist.
func TestLogout_BlacklistsInRedis(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectExec(sqlRevokeByDevice).
		WithArgs(true, "user-uuid", "dev-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	cacheClient := testCacheClient(t)
	svc := NewService(db, jwtCfg(), cacheClient)
	err := svc.Logout(context.Background(), "user-uuid", "dev-1", "desktop", "")
	require.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())

	// Verify the blacklist key exists in Redis.
	ctx := context.Background()
	key := "rt_blacklist:user-uuid:dev-1:desktop"
	exists, redisErr := cacheClient.GetRDB().Exists(ctx, key).Result()
	require.NoError(t, redisErr)
	assert.Equal(t, int64(1), exists)
}

// #149: Logout with device_type scoping.
func TestLogout_WithDeviceType(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectExec(sqlRevokeByDevice).
		WithArgs(true, "user-uuid", "dev-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	cacheClient := testCacheClient(t)
	svc := NewService(db, jwtCfg(), cacheClient)
	err := svc.Logout(context.Background(), "user-uuid", "dev-1", "desktop", "")
	require.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())

	// Verify the scoped blacklist key.
	ctx := context.Background()
	key := "rt_blacklist:user-uuid:dev-1:desktop"
	exists, redisErr := cacheClient.GetRDB().Exists(ctx, key).Result()
	require.NoError(t, redisErr)
	assert.Equal(t, int64(1), exists)
}

func TestLogout_WithoutDeviceType(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectExec(sqlRevokeByDevice).
		WithArgs(true, "user-uuid", "dev-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	cacheClient := testCacheClient(t)
	svc := NewService(db, jwtCfg(), cacheClient)
	err := svc.Logout(context.Background(), "user-uuid", "dev-1", "", "")
	require.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())

	// Verify the unscoped blacklist key.
	ctx := context.Background()
	key := "rt_blacklist:user-uuid:dev-1"
	exists, redisErr := cacheClient.GetRDB().Exists(ctx, key).Result()
	require.NoError(t, redisErr)
	assert.Equal(t, int64(1), exists)
}

// #888: Logout blacklists access token jti so middleware can reject it immediately.
func TestLogout_BlacklistsAccessJTI(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectExec(sqlRevokeByDevice).
		WithArgs(true, "user-uuid", "dev-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	cacheClient := testCacheClient(t)
	svc := NewService(db, jwtCfg(), cacheClient)
	err := svc.Logout(context.Background(), "user-uuid", "dev-1", "desktop", "access-jti-abc")
	require.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())

	ctx := context.Background()
	key := "at_blacklist:access-jti-abc"
	exists, redisErr := cacheClient.GetRDB().Exists(ctx, key).Result()
	require.NoError(t, redisErr)
	assert.Equal(t, int64(1), exists)

	blacklisted, err := cacheClient.IsAccessTokenBlacklisted(ctx, "access-jti-abc")
	require.NoError(t, err)
	assert.True(t, blacklisted)
}

// ==================== GetMe ====================

func TestGetMe_NotFound(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlUserByID).
		WithArgs("nonexistent", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewService(db, jwtCfg(), nil)
	_, err := svc.GetMe(context.Background(), "nonexistent")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestGetMe_Success(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlUserByID).
		WithArgs("user-uuid", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("user-uuid", "testuser", "hashed", "Test User", "https://example.com/avatar.png"))

	svc := NewService(db, jwtCfg(), nil)
	user, err := svc.GetMe(context.Background(), "user-uuid")
	require.NoError(t, err)
	assert.Equal(t, "testuser", user.Username)
	assert.Equal(t, "Test User", user.Nickname)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== UpdateProfile ====================

func TestUpdateProfile_Success(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlUserByID).
		WithArgs("user-uuid", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("user-uuid", "testuser", "hashed", "Old Name", ""))

	// UpdateUser (via Save)
	mock.ExpectExec(sqlUpdateUser).
		WillReturnResult(sqlmock.NewResult(0, 1))

	svc := NewService(db, jwtCfg(), testCacheClient(t))
	user, err := svc.UpdateProfile(context.Background(), "user-uuid", "New Name", "https://img.com/a.png")
	require.NoError(t, err)
	assert.Equal(t, "New Name", user.Nickname)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestUpdateProfile_NilCacheDoesNotPanic(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlUserByID).
		WithArgs("user-uuid", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("user-uuid", "testuser", "hashed", "Old Name", ""))

	mock.ExpectExec(sqlUpdateUser).
		WillReturnResult(sqlmock.NewResult(0, 1))

	svc := NewService(db, jwtCfg(), nil)
	user, err := svc.UpdateProfile(context.Background(), "user-uuid", "New Name", "https://img.com/a.png")
	require.NoError(t, err)
	assert.Equal(t, "New Name", user.Nickname)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// TestRefreshToken_ConcurrentRotationLosesClaim proves the #2154 atomic-claim
// gate at the SQL level: when the conditional claim UPDATE affects 0 rows (a
// concurrent presenter already rotated this hash), the refresh is rejected as
// reuse, the F2 counter increments, and NO device-wide revoke/upsert SQL runs
// (exhausted expectations below).
func TestRefreshToken_ConcurrentRotationLosesClaim(t *testing.T) {
	metrics.Register()

	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	expiry := time.Now().Add(24 * time.Hour)
	mock.ExpectQuery(sqlRTByHash).
		WithArgs(sqlmock.AnyArg(), 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-1", "user-uuid", "desktop", "dev-1", "hash", false, expiry))

	// Claim loses the race: RowsAffected = 0.
	mock.ExpectExec(sqlClaimRT).
		WithArgs(true, sqlmock.AnyArg(), false).
		WillReturnResult(sqlmock.NewResult(0, 0))

	before := testutil.ToFloat64(metrics.RefreshTokenReuseTotal)

	svc := NewService(db, jwtCfg(), nil)
	resp, err := svc.RefreshToken(context.Background(), "raced-refresh-token")
	assert.Nil(t, resp)
	assert.ErrorIs(t, err, errcode.AuthRefreshInvalid)
	assert.InDelta(t, 1, testutil.ToFloat64(metrics.RefreshTokenReuseTotal)-before, 0,
		"a lost claim race must count as refresh-token reuse")
	assert.NoError(t, mock.ExpectationsWereMet())
}
