//go:build integration

package integration

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

func TestMigration0076_RealPG_BackfillsLegacyAndPreservesNoopDown(t *testing.T) {
	m, db := openTempMigrateDB(t)
	version, dirty, err := m.Version()
	require.NoError(t, err)
	require.False(t, dirty)
	require.GreaterOrEqual(t, version, uint(80))
	latestVersion := version

	require.NoError(t, m.Migrate(75))
	version, dirty, err = m.Version()
	require.NoError(t, err)
	require.False(t, dirty)
	require.Equal(t, uint(75), version)

	// 0076/0077 down files intentionally retain additive schema so an older
	// binary cannot revive a broad refresh session. Remove the additive objects
	// here to recreate a real 0075 database before exercising the up files.
	require.NoError(t, db.Exec(`ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS user_identity_id`).Error)
	require.NoError(t, db.Exec(`DROP TABLE IF EXISTS user_identities`).Error)

	const (
		userID     = "10000000-0000-4000-8000-000000000076"
		deviceID   = "20000000-0000-4000-8000-000000000076"
		refreshID  = "30000000-0000-4000-8000-000000000076"
		legacySub  = "legacy-subject-0076"
		refreshRaw = "legacy-refresh-hash-0076"
	)
	now := time.Now().UTC()
	require.NoError(t, db.Exec(`
		INSERT INTO users (id, username, password_hash, nickname, tokendance_sub, tokendance_sub_linked_at)
		VALUES (?, ?, NULL, ?, ?, ?)
	`, userID, "legacy_0076", "Legacy 0076", legacySub, now).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO devices (id, user_id, device_type)
		VALUES (?, ?, 'desktop')
	`, deviceID, userID).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO refresh_tokens (id, user_id, device_type, device_id, token_hash, expires_at, revoked)
		VALUES (?, ?, 'desktop', ?, ?, ?, false)
	`, refreshID, userID, deviceID, refreshRaw, now.Add(time.Hour)).Error)

	require.NoError(t, m.Migrate(latestVersion))
	version, dirty, err = m.Version()
	require.NoError(t, err)
	require.False(t, dirty)
	require.Equal(t, latestVersion, version)

	var identity model.UserIdentity
	require.NoError(t, db.Where("issuer = ? AND subject = ?", "legacy:tokendance-id", legacySub).First(&identity).Error)
	assert.Equal(t, userID, identity.UserID)
	assert.Equal(t, "tokendance-id", identity.Provider)
	assert.Equal(t, model.IdentityStatusRetired, identity.Status)

	var refresh model.RefreshToken
	require.NoError(t, db.First(&refresh, "id = ?", refreshID).Error)
	assert.True(t, refresh.Revoked)
	assert.Nil(t, refresh.UserIdentityID)

	// The down files are no-ops for identity data. Returning the version must
	// not drop the table/column or reopen the legacy refresh chain.
	require.NoError(t, m.Migrate(75))
	version, dirty, err = m.Version()
	require.NoError(t, err)
	require.False(t, dirty)
	require.Equal(t, uint(75), version)

	var identityTableExists bool
	require.NoError(t, db.Raw(`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = current_schema() AND table_name = 'user_identities'
		)`).Scan(&identityTableExists).Error)
	assert.True(t, identityTableExists)

	var bindingColumnExists bool
	require.NoError(t, db.Raw(`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = current_schema()
			  AND table_name = 'refresh_tokens'
			  AND column_name = 'user_identity_id'
		)`).Scan(&bindingColumnExists).Error)
	assert.True(t, bindingColumnExists)

	require.NoError(t, db.First(&refresh, "id = ?", refreshID).Error)
	assert.True(t, refresh.Revoked)
}

func TestMigration0076_RealPG_AddsUniqueIndexForLegacyUsersWithoutPrimaryKey(t *testing.T) {
	db, cleanup := openTempMigratedDB(t)
	t.Cleanup(cleanup)

	up, err := os.ReadFile("../../migrations/0076_user_identities.up.sql")
	require.NoError(t, err)

	tx := db.Begin()
	require.NoError(t, tx.Error)
	t.Cleanup(func() { _ = tx.Rollback().Error })

	execSQLStatements(t, tx, `
		CREATE SCHEMA migration_0076_legacy;
		SET LOCAL search_path TO migration_0076_legacy, public;
		CREATE TABLE users (
			id UUID NOT NULL,
			username VARCHAR(64) NOT NULL,
			password_hash VARCHAR(128),
			nickname VARCHAR(64) NOT NULL,
			tokendance_sub VARCHAR(255),
			tokendance_sub_linked_at TIMESTAMPTZ
		);
		CREATE TABLE refresh_tokens (
			user_id UUID NOT NULL,
			revoked BOOLEAN NOT NULL DEFAULT FALSE
		);
		INSERT INTO users (id, username, nickname, tokendance_sub)
		VALUES (
			'10000000-0000-4000-8000-000000000076',
			'legacy_no_pk',
			'Legacy Without PK',
			'legacy-no-pk-subject'
		);
	`)
	execSQLStatements(t, tx, string(up))

	var uniqueIndexExists bool
	require.NoError(t, tx.Raw(`
		SELECT EXISTS (
			SELECT 1
			FROM pg_indexes
			WHERE schemaname = current_schema()
			  AND tablename = 'users'
			  AND indexname = 'idx_users_id_unique'
		)
	`).Scan(&uniqueIndexExists).Error)
	assert.True(t, uniqueIndexExists)

	var identityCount int64
	require.NoError(t, tx.Table("user_identities").
		Where("issuer = ? AND subject = ?", "legacy:tokendance-id", "legacy-no-pk-subject").
		Count(&identityCount).Error)
	assert.Equal(t, int64(1), identityCount)
}

func execSQLStatements(t *testing.T, tx *gorm.DB, sql string) {
	t.Helper()
	var statements []string
	for _, line := range strings.Split(sql, "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			statements = append(statements, line)
		}
	}
	for _, statement := range strings.Split(strings.Join(statements, "\n"), ";") {
		if strings.TrimSpace(statement) == "" {
			continue
		}
		require.NoError(t, tx.Exec(statement).Error)
	}
}

func TestAccountIdentity_RealPG_ExactIssuerSubject(t *testing.T) {
	db, cleanup := openTempMigratedDB(t)
	t.Cleanup(cleanup)

	const (
		issuerA = "https://account-a.example"
		issuerB = "https://account-b.example"
		subject = "shared-subject"
	)
	first, err := repository.FindOrCreateByAccountIdentity(db, issuerA, subject, "Alice", "")
	require.NoError(t, err)
	again, err := repository.FindOrCreateByAccountIdentity(db, issuerA, subject, "Alice", "")
	require.NoError(t, err)
	require.Equal(t, first.ID, again.ID)

	otherIssuer, err := repository.FindOrCreateByAccountIdentity(db, issuerB, subject, "Alice", "")
	require.NoError(t, err)
	require.NotEqual(t, first.ID, otherIssuer.ID)

	var identities []model.UserIdentity
	require.NoError(t, db.Where("subject = ?", subject).Order("issuer").Find(&identities).Error)
	require.Len(t, identities, 2)
	assert.Equal(t, issuerA, identities[0].Issuer)
	assert.Equal(t, issuerB, identities[1].Issuer)
	assert.Nil(t, first.TokenDanceSub)
}

func TestAccountIdentity_RealPG_ConcurrentFirstLogin(t *testing.T) {
	db, cleanup := openTempMigratedDB(t)
	t.Cleanup(cleanup)

	const (
		issuer     = "https://account.example"
		subject    = "concurrent-subject"
		goroutines = 20
	)
	var wg sync.WaitGroup
	results := make([]*model.User, goroutines)
	errs := make([]error, goroutines)

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			results[idx], errs[idx] = repository.FindOrCreateByAccountIdentity(
				db,
				issuer,
				subject,
				fmt.Sprintf("Concurrent %d", idx),
				"",
			)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		require.NoError(t, err, "goroutine %d", i)
		require.NotNil(t, results[i], "goroutine %d", i)
	}

	var identity model.UserIdentity
	require.NoError(t, db.Where("issuer = ? AND subject = ?", issuer, subject).First(&identity).Error)
	for i := range results {
		assert.Equal(t, identity.UserID, results[i].ID, "goroutine %d", i)
	}

	var identityCount int64
	require.NoError(t, db.Model(&model.UserIdentity{}).
		Where("issuer = ? AND subject = ?", issuer, subject).
		Count(&identityCount).Error)
	assert.Equal(t, int64(1), identityCount)
}

func TestAccountIdentity_RealPG_RetiredIdentityRejected(t *testing.T) {
	db, cleanup := openTempMigratedDB(t)
	t.Cleanup(cleanup)

	const issuer = "https://account.example"
	const subject = "retired-subject"
	user, err := repository.FindOrCreateByAccountIdentity(db, issuer, subject, "Retired", "")
	require.NoError(t, err)
	require.NoError(t, db.Model(&model.UserIdentity{}).
		Where("issuer = ? AND subject = ?", issuer, subject).
		Update("status", model.IdentityStatusRetired).Error)

	_, err = repository.FindOrCreateByAccountIdentity(db, issuer, subject, "Retired", "")
	require.Error(t, err)
	assert.ErrorIs(t, err, repository.ErrOIDCIdentityRetired)

	var stored model.UserIdentity
	require.NoError(t, db.Where("issuer = ? AND subject = ?", issuer, subject).First(&stored).Error)
	assert.Equal(t, user.ID, stored.UserID)
	assert.Equal(t, model.IdentityStatusRetired, stored.Status)
}

func TestAccountIdentity_RealPG_RefreshIsPinnedToExactIdentity(t *testing.T) {
	db, cleanup := openTempMigratedDB(t)
	t.Cleanup(cleanup)

	const (
		issuer      = "https://account.example"
		subject     = "refresh-binding-subject"
		deviceID    = "33333333-3333-4333-8333-333333333333"
		refreshHash = "refresh-binding-hash"
	)
	user, err := repository.FindOrCreateAccountSession(db, repository.AccountSessionInput{
		Issuer:           issuer,
		Subject:          subject,
		Name:             "Refresh Binding",
		DeviceType:       "desktop",
		DeviceID:         deviceID,
		RefreshTokenHash: refreshHash,
		RefreshExpiresAt: time.Now().Add(time.Hour),
	})
	require.NoError(t, err)

	var identity model.UserIdentity
	require.NoError(t, db.Where("issuer = ? AND subject = ?", issuer, subject).First(&identity).Error)
	require.NoError(t, db.Create(&model.UserIdentity{
		UserID:   user.ID,
		Provider: model.IdentityProviderAccount,
		Issuer:   "https://other-account.example",
		Subject:  "other-active-subject",
		Status:   model.IdentityStatusActive,
		LinkedAt: time.Now().UTC(),
	}).Error)
	require.NoError(t, db.Model(&model.UserIdentity{}).
		Where("id = ?", identity.ID).
		Update("status", model.IdentityStatusRetired).Error)

	_, err = repository.FindRefreshTokenForRotation(db, refreshHash)
	require.Error(t, err)
	require.NoError(t, repository.RevokeRefreshTokensForRetiredIdentity(db, issuer, subject))
	stored, err := repository.FindRefreshTokenByHash(db, refreshHash)
	require.NoError(t, err)
	assert.True(t, stored.Revoked)
}
