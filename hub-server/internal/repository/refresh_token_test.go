package repository

import (
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// =============================================================================
// RefreshToken repository tests
// =============================================================================

func TestRefreshTokenRepo_UpsertAndGet(t *testing.T) {
	db := setupSQLite(t)

	expiresAt := time.Now().Add(24 * time.Hour)
	rt := &model.RefreshToken{
		UserID:     "user-rt",
		DeviceType: "desktop",
		DeviceID:   "dev-rt-1",
		TokenHash:  "hash123abc",
		ExpiresAt:  expiresAt,
	}
	err := UpsertRefreshToken(db, rt)
	require.NoError(t, err)
	assert.NotEmpty(t, rt.ID)

	// Find by hash
	found, err := FindRefreshTokenByHash(db, "hash123abc")
	require.NoError(t, err)
	assert.Equal(t, "user-rt", found.UserID)

	// Non-existent hash
	_, err = FindRefreshTokenByHash(db, "nonexistent")
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)

	// Upsert again (same user_id + device_type + device_id)
	rt2 := &model.RefreshToken{
		UserID:     "user-rt",
		DeviceType: "desktop",
		DeviceID:   "dev-rt-1",
		TokenHash:  "hash456def",
		ExpiresAt:  expiresAt.Add(time.Hour),
	}
	err = UpsertRefreshToken(db, rt2)
	require.NoError(t, err)
	// Should have same ID (updated existing)
	assert.Equal(t, rt.ID, rt2.ID)

	// Find by new hash
	found, err = FindRefreshTokenByHash(db, "hash456def")
	require.NoError(t, err)
	assert.Equal(t, rt.ID, found.ID)

	// Old hash no longer exists (overwritten)
	_, err = FindRefreshTokenByHash(db, "hash123abc")
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
}

func TestRefreshTokenRepo_Revoke(t *testing.T) {
	db := setupSQLite(t)

	expiresAt := time.Now().Add(24 * time.Hour)
	rt1 := &model.RefreshToken{UserID: "user-rev", DeviceType: "desktop", DeviceID: "dev-1", TokenHash: "h1", ExpiresAt: expiresAt}
	rt2 := &model.RefreshToken{UserID: "user-rev", DeviceType: "desktop", DeviceID: "dev-2", TokenHash: "h2", ExpiresAt: expiresAt}
	require.NoError(t, UpsertRefreshToken(db, rt1))
	require.NoError(t, UpsertRefreshToken(db, rt2))

	// Revoke by device
	require.NoError(t, RevokeRefreshTokensByUserDevice(db, "user-rev", "dev-1"))

	found, err := FindRefreshTokenByHash(db, "h1")
	require.NoError(t, err)
	assert.True(t, found.Revoked)

	// rt2 still not revoked
	found, err = FindRefreshTokenByHash(db, "h2")
	require.NoError(t, err)
	assert.False(t, found.Revoked)

	// Revoke all for user
	rt3 := &model.RefreshToken{UserID: "user-all-rev", DeviceType: "mobile", DeviceID: "dev-3", TokenHash: "h3", ExpiresAt: expiresAt}
	require.NoError(t, UpsertRefreshToken(db, rt3))

	require.NoError(t, RevokeAllUserTokens(db, "user-all-rev"))
	found, err = FindRefreshTokenByHash(db, "h3")
	require.NoError(t, err)
	assert.True(t, found.Revoked)
}
