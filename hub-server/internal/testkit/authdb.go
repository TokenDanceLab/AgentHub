package testkit

import (
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// NewAuthDB is an isolated SQLite contract fixture. PostgreSQL locking and
// production migrations require the separate integration lane.
func NewAuthDB(t testing.TB) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	for _, ddl := range []string{
		`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT, nickname TEXT NOT NULL, avatar_url TEXT DEFAULT '', tokendance_sub TEXT, tokendance_sub_linked_at DATETIME, created_at DATETIME, updated_at DATETIME)`,
		`CREATE TABLE user_identities (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, issuer TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', linked_at DATETIME NOT NULL, created_at DATETIME, updated_at DATETIME, UNIQUE(issuer,subject))`,
		`CREATE TABLE devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_type TEXT NOT NULL, app_version TEXT DEFAULT '', capabilities TEXT DEFAULT '[]', last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP, created_at DATETIME)`,
		`CREATE TABLE refresh_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_type TEXT NOT NULL, device_id TEXT NOT NULL, user_identity_id TEXT, oidc_client_id TEXT NOT NULL DEFAULT '', token_hash TEXT NOT NULL UNIQUE, expires_at DATETIME NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_at DATETIME, UNIQUE(user_id,device_type,device_id))`,
	} {
		require.NoError(t, db.Exec(ddl).Error)
	}
	require.NoError(t, db.AutoMigrate(&model.OIDCSubjectEpoch{}, &model.BrowserSession{}, &model.OIDCLogoutEvent{}))
	return db
}
