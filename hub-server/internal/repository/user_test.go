package repository

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// =============================================================================
// User repository tests
// =============================================================================

func TestUserRepo_CRUD(t *testing.T) {
	db := setupSQLite(t)

	user := &model.User{
		Username:     "testuser",
		PasswordHash: strPtr("hashed_password"),
		Nickname:     "Test User",
	}

	// Create
	err := CreateUser(db, user)
	require.NoError(t, err)
	assert.NotEmpty(t, user.ID)

	// Read by ID
	fetched, err := GetUserByID(db, user.ID)
	require.NoError(t, err)
	assert.Equal(t, user.Username, fetched.Username)
	assert.Equal(t, user.Nickname, fetched.Nickname)

	// Read by username
	fetchedByUsername, err := GetUserByUsername(db, "testuser")
	require.NoError(t, err)
	assert.Equal(t, user.ID, fetchedByUsername.ID)

	// Read non-existent
	_, err = GetUserByID(db, "nonexistent-id")
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)

	// Update
	user.Nickname = "Updated Name"
	err = UpdateUser(db, user)
	require.NoError(t, err)
	fetched, err = GetUserByID(db, user.ID)
	require.NoError(t, err)
	assert.Equal(t, "Updated Name", fetched.Nickname)
}

func TestUserRepo_GetUsersByIDs(t *testing.T) {
	db := setupSQLite(t)

	// Create multiple users
	u1 := &model.User{Username: "user1", PasswordHash: strPtr("h1"), Nickname: "U1"}
	u2 := &model.User{Username: "user2", PasswordHash: strPtr("h2"), Nickname: "U2"}
	u3 := &model.User{Username: "user3", PasswordHash: strPtr("h3"), Nickname: "U3"}
	require.NoError(t, CreateUser(db, u1))
	require.NoError(t, CreateUser(db, u2))
	require.NoError(t, CreateUser(db, u3))

	// Fetch by IDs
	m, err := GetUsersByIDs(db, []string{u1.ID, u2.ID})
	require.NoError(t, err)
	assert.Len(t, m, 2)
	assert.Equal(t, "U1", m[u1.ID].Nickname)
	assert.Equal(t, "U2", m[u2.ID].Nickname)

	// Empty list
	m, err = GetUsersByIDs(db, []string{})
	require.NoError(t, err)
	assert.Empty(t, m)

	// Non-existent IDs
	m, err = GetUsersByIDs(db, []string{"no-such-id"})
	require.NoError(t, err)
	assert.Empty(t, m)
}

func TestUserRepo_FindOrCreateByAccountIdentityCreatesStableDistinctHubUsers(t *testing.T) {
	db := setupSQLite(t)

	issuer := "https://account.example"
	sub1 := "account-subject-with-a-very-long-shared-prefix-" + strings.Repeat("1", 80)
	sub2 := "account-subject-with-a-very-long-shared-prefix-" + strings.Repeat("2", 80)

	u1, err := FindOrCreateByAccountIdentity(db, issuer, sub1, "", "")
	require.NoError(t, err)
	u2, err := FindOrCreateByAccountIdentity(db, issuer, sub2, "", "")
	require.NoError(t, err)

	require.NotEqual(t, u1.ID, u2.ID)
	require.NotEqual(t, u1.Username, u2.Username)
	assert.True(t, strings.HasPrefix(u1.Username, "acct_"))
	assert.LessOrEqual(t, len(u1.Username), 64)
	assert.True(t, len(u1.Nickname) <= 64)
	assert.Nil(t, u1.TokenDanceSub, "new Account users must not be written into the legacy column")
	assert.Nil(t, u1.PasswordHash)

	again, err := FindOrCreateByAccountIdentity(db, issuer, sub1, "", "")
	require.NoError(t, err)
	assert.Equal(t, u1.ID, again.ID)
	assert.Equal(t, u1.Username, again.Username)
}

func TestUserRepo_AccountProfileInitializesOnceAndPreservesLocalEdits(t *testing.T) {
	db := setupSQLite(t)

	created, err := FindOrCreateByAccountIdentity(
		db,
		"https://account.example",
		"profile-owner",
		"Provider Name",
		"https://avatars.example/provider.png",
	)
	require.NoError(t, err)
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", created.ID).Updates(map[string]interface{}{
		"nickname":   "Local Name",
		"avatar_url": "https://avatars.example/local.png",
	}).Error)

	again, err := FindOrCreateByAccountIdentity(
		db,
		"https://account.example",
		"profile-owner",
		"Changed Provider Name",
		"https://avatars.example/changed.png",
	)
	require.NoError(t, err)
	assert.Equal(t, created.ID, again.ID)
	assert.Equal(t, "Local Name", again.Nickname)
	assert.Equal(t, "https://avatars.example/local.png", again.AvatarURL)
}

func TestUserRepo_AccountSessionRollsBackAllWritesOnDeviceConflict(t *testing.T) {
	db := setupSQLite(t)

	existing := &model.User{Username: "existing-device-owner", Nickname: "Existing"}
	require.NoError(t, CreateUser(db, existing))
	const deviceID = "22222222-2222-4222-8222-222222222222"
	require.NoError(t, UpsertDevice(db, &model.Device{
		ID:         deviceID,
		UserID:     existing.ID,
		DeviceType: "desktop",
	}))

	_, err := FindOrCreateAccountSession(db, AccountSessionInput{
		Issuer:           "https://account.example",
		Subject:          "new-session-subject",
		Name:             strings.Repeat("N", 80),
		Picture:          "https://avatars.example/" + strings.Repeat("p", 600),
		DeviceType:       "desktop",
		DeviceID:         deviceID,
		RefreshTokenHash: "refresh-hash",
		RefreshExpiresAt: time.Now().Add(time.Hour),
	})
	require.ErrorIs(t, err, ErrDeviceOwnershipMismatch)

	var users int64
	require.NoError(t, db.Model(&model.User{}).Count(&users).Error)
	assert.Equal(t, int64(1), users, "candidate user must roll back with the failed session")
	var identities int64
	require.NoError(t, db.Model(&model.UserIdentity{}).Count(&identities).Error)
	assert.Zero(t, identities)
}

func TestUserRepo_AccountIdentityDoesNotClaimLegacyTokenDanceSubject(t *testing.T) {
	db := setupSQLite(t)

	subject := "same-subject-value"
	now := time.Now().UTC()
	require.NoError(t, db.Exec(`
		INSERT INTO users (
			id, username, password_hash, nickname, tokendance_sub, tokendance_sub_linked_at, created_at, updated_at
		) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
	`, "legacy-user", "legacy_user", "Legacy User", subject, now, now, now).Error)

	issuer := "https://account.example"
	created, err := FindOrCreateByAccountIdentity(db, issuer, subject, "Account User", "")
	require.NoError(t, err)
	require.NotEqual(t, "legacy-user", created.ID, "legacy tokendance_sub must never be auto-claimed")
	assert.Nil(t, created.PasswordHash)

	legacy, err := GetUserByID(db, "legacy-user")
	require.NoError(t, err)
	require.NotNil(t, legacy.TokenDanceSub)
	assert.Equal(t, subject, *legacy.TokenDanceSub)

	var identities int64
	require.NoError(t, db.Model(&model.UserIdentity{}).
		Where("user_id = ?", created.ID).
		Count(&identities).Error)
	assert.Equal(t, int64(1), identities)
}

func TestUserRepo_RetiredAccountIdentityIsRejected(t *testing.T) {
	db := setupSQLite(t)

	user, err := FindOrCreateByAccountIdentity(
		db,
		"https://account.example",
		"retired-subject",
		"Retired User",
		"",
	)
	require.NoError(t, err)
	require.NoError(t, db.Model(&model.UserIdentity{}).
		Where("user_id = ?", user.ID).
		Update("status", model.IdentityStatusRetired).Error)

	_, err = FindOrCreateByAccountIdentity(
		db,
		"https://account.example",
		"retired-subject",
		"Retired User",
		"",
	)
	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrOIDCIdentityRetired))
}
