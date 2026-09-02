package repository

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupSharedSQLite creates a shared-cache in-memory SQLite database suitable
// for concurrent access from multiple goroutines. Unlike :memory: which gives
// each connection a private database, file::memory:?cache=shared allows all
// connections in the process to see the same data.
// sharedSQLiteFixtureSeq numbers each setupSharedSQLite call (#2260).
var sharedSQLiteFixtureSeq atomic.Uint64

func setupSharedSQLite(t *testing.T) *gorm.DB {
	t.Helper()
	// Unique name + close-on-cleanup: `file::memory:?cache=shared` is ONE
	// process-global database, so every invocation used to share rows with every
	// other invocation and with the previous -count round. These assertions
	// tolerate the leftovers today, which is exactly how the same pattern stayed
	// hidden in agent_23505_test.go until it did not (#2260).
	dsn := fmt.Sprintf("file:upsert_toctou_%d?mode=memory&cache=shared&_journal_mode=WAL", sharedSQLiteFixtureSeq.Add(1))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })

	// Reuse the same schema as setupSQLite. We extract the table definitions
	// by calling setupSQLite's raw SQL directly.
	tables := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT,
			nickname TEXT NOT NULL,
			avatar_url TEXT DEFAULT '',
			tokendance_sub TEXT DEFAULT NULL,
			tokendance_sub_linked_at DATETIME DEFAULT NULL,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tokendance_sub ON users(tokendance_sub)
			WHERE tokendance_sub IS NOT NULL AND tokendance_sub != ''`,
		`CREATE TABLE IF NOT EXISTS refresh_tokens (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			device_type TEXT NOT NULL DEFAULT '',
			device_id TEXT NOT NULL DEFAULT '',
			token_hash TEXT NOT NULL UNIQUE,
			expires_at DATETIME NOT NULL,
			revoked INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_rt_user_device ON refresh_tokens(user_id, device_type, device_id)`,
	}
	for _, ddl := range tables {
		require.NoError(t, db.Exec(ddl).Error)
	}
	return db
}

// TestUpsertRefreshToken_Concurrent verifies that concurrent upserts for the
// same (user_id, device_type, device_id) triple produce exactly one row and
// no errors (#2102 F12). This guards against TOCTOU races in the previous
// SELECT-then-CREATE/SAVE implementation.
func TestUpsertRefreshToken_Concurrent(t *testing.T) {
	db := setupSharedSQLite(t)

	const goroutines = 20
	var wg sync.WaitGroup
	errs := make([]error, goroutines)

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			rt := &model.RefreshToken{
				UserID:     "user-concurrent",
				DeviceType: "desktop",
				DeviceID:   "dev-concurrent",
				TokenHash:  fmt.Sprintf("hash-%d-%d", idx, time.Now().UnixNano()),
				ExpiresAt:  time.Now().Add(24 * time.Hour),
			}
			errs[idx] = UpsertRefreshToken(db, rt)
		}(i)
	}
	wg.Wait()

	// All goroutines must succeed (no unique constraint violations or panics).
	for i, err := range errs {
		assert.NoError(t, err, "goroutine %d failed", i)
	}

	// Exactly one row must exist for this key.
	var count int64
	require.NoError(t, db.Model(&model.RefreshToken{}).
		Where("user_id = ? AND device_type = ? AND device_id = ?",
			"user-concurrent", "desktop", "dev-concurrent").Count(&count).Error)
	assert.Equal(t, int64(1), count, "expected exactly 1 row after concurrent upserts")
}

// TestFindOrCreateByTokenDanceSub_Concurrent verifies that concurrent first-login
// attempts for the same TokenDance sub produce exactly one user and no errors
// (#2102 F13). This guards against TOCTOU races in the previous
// Find-then-Create implementation.
func TestFindOrCreateByTokenDanceSub_Concurrent(t *testing.T) {
	db := setupSharedSQLite(t)

	const goroutines = 20
	var wg sync.WaitGroup
	type result struct {
		user *model.User
		err  error
	}
	results := make([]result, goroutines)

	sub := "concurrent-sub-test-2102"
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			u, err := FindOrCreateByTokenDanceSub(db, sub,
				fmt.Sprintf("Name-%d", idx), fmt.Sprintf("https://avatar/%d.png", idx))
			results[idx] = result{u, err}
		}(i)
	}
	wg.Wait()

	// All goroutines must succeed.
	for i, r := range results {
		assert.NoError(t, r.err, "goroutine %d failed", i)
		assert.NotNil(t, r.user, "goroutine %d returned nil user", i)
	}

	// Exactly one user must exist for this sub.
	var count int64
	require.NoError(t, db.Model(&model.User{}).
		Where("tokendance_sub = ?", sub).Count(&count).Error)
	assert.Equal(t, int64(1), count, "expected exactly 1 user after concurrent upserts")

	// All returned users must share the same ID.
	if results[0].user != nil {
		expectedID := results[0].user.ID
		for i, r := range results {
			if r.user != nil {
				assert.Equal(t, expectedID, r.user.ID, "goroutine %d got different user ID", i)
			}
		}
	}
}
