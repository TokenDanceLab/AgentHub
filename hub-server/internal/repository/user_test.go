package repository

import (
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

func TestUserRepo_FindOrCreateByTokenDanceSubCreatesStableDistinctHubUsers(t *testing.T) {
	db := setupSQLite(t)

	sub1 := "tokendance-subject-with-a-very-long-shared-prefix-" + strings.Repeat("1", 80)
	sub2 := "tokendance-subject-with-a-very-long-shared-prefix-" + strings.Repeat("2", 80)

	u1, err := FindOrCreateByTokenDanceSub(db, sub1, "", "")
	require.NoError(t, err)
	u2, err := FindOrCreateByTokenDanceSub(db, sub2, "", "")
	require.NoError(t, err)

	require.NotEqual(t, u1.ID, u2.ID)
	require.NotEqual(t, u1.Username, u2.Username)
	assert.True(t, strings.HasPrefix(u1.Username, "td_"))
	assert.True(t, len(u1.Username) <= 32)
	assert.True(t, len(u1.Nickname) <= 64)
	require.NotNil(t, u1.TokenDanceSub)
	assert.Equal(t, sub1, *u1.TokenDanceSub)

	again, err := FindOrCreateByTokenDanceSub(db, sub1, "", "")
	require.NoError(t, err)
	assert.Equal(t, u1.ID, again.ID)
	assert.Equal(t, u1.Username, again.Username)
}

func TestUserRepo_ReadsOIDCOnlyUserWithNullPasswordHash(t *testing.T) {
	db := setupSQLite(t)

	sub := "tokendance-sub-null-password"
	now := time.Now().UTC()
	require.NoError(t, db.Exec(`
		INSERT INTO users (
			id, username, password_hash, nickname, tokendance_sub, tokendance_sub_linked_at, created_at, updated_at
		) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
	`, "user-oidc-null-password", "td_null_password", "OIDC Only", sub, now, now, now).Error)

	bySub, err := FindByTokenDanceSub(db, sub)
	require.NoError(t, err)
	require.NotNil(t, bySub)
	assert.Equal(t, "user-oidc-null-password", bySub.ID)
	assert.Nil(t, bySub.PasswordHash)

	byID, err := GetUserByID(db, "user-oidc-null-password")
	require.NoError(t, err)
	require.NotNil(t, byID)
	assert.Equal(t, sub, *byID.TokenDanceSub)
	assert.Nil(t, byID.PasswordHash)
}
