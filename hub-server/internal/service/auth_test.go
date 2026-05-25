package service

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
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/jwtutil"
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

func hashPW(password string) string {
	h, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	return string(h)
}

// SQL substrings used for matching (QueryMatcherFunc with strings.Contains)
const (
	sqlUserByUsername  = `FROM "users" WHERE username =`
	sqlUserByID        = `FROM "users" WHERE id =`
	sqlInsertUser      = `INSERT INTO "users"`
	sqlInsertDevice    = `INSERT INTO "devices"`
	sqlRTByUserDevice  = `FROM "refresh_tokens" WHERE user_id`
	sqlRTByHash        = `FROM "refresh_tokens" WHERE token_hash`
	sqlInsertRT        = `INSERT INTO "refresh_tokens"`
	sqlRevokeByDevice  = `UPDATE "refresh_tokens" SET "revoked"` // + WHERE user_id ... AND device_id
	sqlRevokeAllTokens = `UPDATE "refresh_tokens" SET "revoked"` // + WHERE user_id
	sqlUpdateUser      = `UPDATE "users" SET`
)

// ==================== Register ====================

func TestRegister_Validation(t *testing.T) {
	db, _, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	tests := []struct {
		name     string
		username string
		password string
		nickname string
	}{
		{"short username", "abc", "password123", "nick"},
		{"long username", string(make([]byte, 33)), "password123", "nick"},
		{"short password", "testuser", "short", "nick"},
		{"long password", "testuser", string(make([]byte, 65)), "nick"},
		{"empty nickname", "testuser", "password123", ""},
	}

	svc := NewAuthService(db, jwtCfg(), nil)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.Register(context.Background(), tt.username, tt.password, tt.nickname)
			assert.Error(t, err)
		})
	}
}

func TestRegister_UsernameTaken(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlUserByUsername).
		WithArgs("existing", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname"}).
			AddRow("u1", "existing", "$2a$10$...", "Existing"))

	svc := NewAuthService(db, jwtCfg(), nil)
	_, err := svc.Register(context.Background(), "existing", "password123", "Existing")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRegister_Success(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlUserByUsername).
		WithArgs("newuser", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	mock.ExpectExec(sqlInsertUser).
		WillReturnResult(sqlmock.NewResult(1, 1))

	svc := NewAuthService(db, jwtCfg(), nil)
	user, err := svc.Register(context.Background(), "newuser", "password123", "New User")
	require.NoError(t, err)
	assert.Equal(t, "newuser", user.Username)
	assert.Equal(t, "New User", user.Nickname)
	assert.NotEmpty(t, user.PasswordHash)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== Login ====================

func TestLogin_BadCredentials(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlUserByUsername).
		WithArgs("nobody", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewAuthService(db, jwtCfg(), nil)
	_, err := svc.Login(context.Background(), "nobody", "password123", "desktop", "dev-1")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestLogin_WrongPassword(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	hash := hashPW("correctpassword")
	mock.ExpectQuery(sqlUserByUsername).
		WithArgs("testuser", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname"}).
			AddRow("u1", "testuser", hash, "Test User"))

	svc := NewAuthService(db, jwtCfg(), nil)
	_, err := svc.Login(context.Background(), "testuser", "wrongpassword", "desktop", "dev-1")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestLogin_Success(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	hash := hashPW("password123")
	mock.ExpectQuery(sqlUserByUsername).
		WithArgs("testuser", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname"}).
			AddRow("user-uuid", "testuser", hash, "Test User"))

	// UpsertDevice
	mock.ExpectQuery(sqlInsertDevice).
		WillReturnRows(sqlmock.NewRows([]string{"last_active_at"}).
			AddRow(time.Now()))

	// UpsertRefreshToken: lookup then create
	mock.ExpectQuery(sqlRTByUserDevice).
		WithArgs("user-uuid", "desktop", "dev-1", 1).
		WillReturnError(gorm.ErrRecordNotFound)
	mock.ExpectExec(sqlInsertRT).
		WillReturnResult(sqlmock.NewResult(1, 1))

	svc := NewAuthService(db, jwtCfg(), nil)
	resp, err := svc.Login(context.Background(), "testuser", "password123", "desktop", "dev-1")
	require.NoError(t, err)
	assert.NotEmpty(t, resp.AccessToken)
	assert.NotEmpty(t, resp.RefreshToken)
	assert.Equal(t, int64(900), resp.ExpiresIn)

	claims, err := jwtutil.ParseToken(resp.AccessToken, jwtCfg().Secret)
	require.NoError(t, err)
	assert.Equal(t, "user-uuid", claims.UserID)
	assert.Equal(t, "desktop", claims.DeviceType)
	assert.Equal(t, "dev-1", claims.DeviceID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== RefreshToken ====================

func TestRefreshToken_Invalid(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlRTByHash).
		WithArgs(sqlmock.AnyArg(), 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewAuthService(db, jwtCfg(), nil)
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

	svc := NewAuthService(db, jwtCfg(), nil)
	_, err := svc.RefreshToken(context.Background(), "any-refresh-token")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRefreshToken_Success(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlRTByHash).
		WithArgs(sqlmock.AnyArg(), 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "device_type", "device_id", "token_hash", "revoked", "expires_at"}).
			AddRow("rt-1", "user-uuid", "desktop", "dev-1", "hash", false, time.Now().Add(24*time.Hour)))

	svc := NewAuthService(db, jwtCfg(), nil)
	resp, err := svc.RefreshToken(context.Background(), "valid-refresh-token")
	require.NoError(t, err)
	assert.NotEmpty(t, resp.AccessToken)
	assert.Equal(t, int64(900), resp.ExpiresIn)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== Logout ====================

func TestLogout(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectExec(sqlRevokeByDevice).
		WithArgs(true, "user-uuid", "dev-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	svc := NewAuthService(db, jwtCfg(), nil)
	err := svc.Logout(context.Background(), "user-uuid", "dev-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== GetMe ====================

func TestGetMe_NotFound(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlUserByID).
		WithArgs("nonexistent", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewAuthService(db, jwtCfg(), nil)
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

	svc := NewAuthService(db, jwtCfg(), nil)
	user, err := svc.GetMe(context.Background(), "user-uuid")
	require.NoError(t, err)
	assert.Equal(t, "testuser", user.Username)
	assert.Equal(t, "Test User", user.Nickname)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== ChangePassword ====================

func TestChangePassword_Validation(t *testing.T) {
	db, _, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	svc := NewAuthService(db, jwtCfg(), nil)
	err := svc.ChangePassword(context.Background(), "user-uuid", "oldpass", "short")
	assert.Error(t, err)
}

func TestChangePassword_WrongOldPassword(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	hash := hashPW("correctold")
	mock.ExpectQuery(sqlUserByID).
		WithArgs("user-uuid", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname"}).
			AddRow("user-uuid", "testuser", hash, "Test User"))

	svc := NewAuthService(db, jwtCfg(), nil)
	err := svc.ChangePassword(context.Background(), "user-uuid", "wrongold", "newpassword123")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestChangePassword_Success(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	hash := hashPW("oldpassword")
	mock.ExpectQuery(sqlUserByID).
		WithArgs("user-uuid", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname"}).
			AddRow("user-uuid", "testuser", hash, "Test User"))

	// UpdatePasswordAndRevokeTokens (transaction: BEGIN -> update password -> revoke tokens -> COMMIT)
	mock.ExpectBegin()
	mock.ExpectExec(sqlUpdateUser).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(sqlRevokeAllTokens).
		WithArgs(true, "user-uuid").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := NewAuthService(db, jwtCfg(), testCacheClient(t))
	err := svc.ChangePassword(context.Background(), "user-uuid", "oldpassword", "newpassword123")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestChangePassword_NilCacheDoesNotPanic(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	hash := hashPW("oldpassword")
	mock.ExpectQuery(sqlUserByID).
		WithArgs("user-uuid", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname"}).
			AddRow("user-uuid", "testuser", hash, "Test User"))

	mock.ExpectBegin()
	mock.ExpectExec(sqlUpdateUser).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(sqlRevokeAllTokens).
		WithArgs(true, "user-uuid").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := NewAuthService(db, jwtCfg(), nil)
	err := svc.ChangePassword(context.Background(), "user-uuid", "oldpassword", "newpassword123")
	assert.NoError(t, err)
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

	svc := NewAuthService(db, jwtCfg(), testCacheClient(t))
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

	svc := NewAuthService(db, jwtCfg(), nil)
	user, err := svc.UpdateProfile(context.Background(), "user-uuid", "New Name", "https://img.com/a.png")
	require.NoError(t, err)
	assert.Equal(t, "New Name", user.Nickname)
	assert.NoError(t, mock.ExpectationsWereMet())
}
