package repository

import (
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// =============================================================================
// Friendship repository tests
// =============================================================================

func TestFriendshipRepo_CRUD(t *testing.T) {
	db := setupSQLite(t)

	f := &model.Friendship{
		UserID:         "user-a",
		FriendID:       "user-b",
		Status:         model.StatusPending,
		RequestMessage: "Please add me",
	}

	// Create
	err := CreateFriendship(db, f)
	require.NoError(t, err)
	assert.NotEmpty(t, f.ID)

	// Find between
	found, err := FindFriendshipBetween(db, "user-a", "user-b")
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, model.StatusPending, found.Status)

	// Also find reversed
	found, err = FindFriendshipBetween(db, "user-b", "user-a")
	require.NoError(t, err)
	require.NotNil(t, found)
}

func TestFriendshipRepo_StatusTransitions(t *testing.T) {
	db := setupSQLite(t)

	f := &model.Friendship{
		UserID:   "user-1",
		FriendID: "user-2",
		Status:   model.StatusPending,
	}
	require.NoError(t, CreateFriendship(db, f))

	// Accept
	err := UpdateFriendshipByID(db, f.ID, model.StatusAccepted)
	require.NoError(t, err)

	fetched, err := GetFriendshipByID(db, f.ID)
	require.NoError(t, err)
	assert.Equal(t, model.StatusAccepted, fetched.Status)

	// Update remark
	err = UpdateFriendshipRemark(db, "user-1", "user-2", "Bestie")
	require.NoError(t, err)

	fetched, err = GetFriendshipByID(db, f.ID)
	require.NoError(t, err)
	assert.Equal(t, "Bestie", fetched.Remark)
}

func TestFriendshipRepo_UpdateRemarkNoRows(t *testing.T) {
	db := setupSQLite(t)

	// No friendship rows exist, so UpdateFriendshipRemark should return ErrRecordNotFound.
	err := UpdateFriendshipRemark(db, "user-x", "user-y", "remark")
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)

	// Create a friendship with pending status - remark should NOT be updatable
	f := &model.Friendship{UserID: "user-x", FriendID: "user-y", Status: model.StatusPending}
	require.NoError(t, CreateFriendship(db, f))

	err = UpdateFriendshipRemark(db, "user-x", "user-y", "remark")
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound, "pending friendship should not allow remark update")

	// Update to accepted - remark SHOULD be updatable
	require.NoError(t, UpdateFriendshipByID(db, f.ID, model.StatusAccepted))
	err = UpdateFriendshipRemark(db, "user-x", "user-y", "cleared")
	require.NoError(t, err)

	fetched, err := GetFriendshipByID(db, f.ID)
	require.NoError(t, err)
	assert.Equal(t, "cleared", fetched.Remark)

	// Clearing remark to empty string
	err = UpdateFriendshipRemark(db, "user-x", "user-y", "")
	require.NoError(t, err)
	fetched, err = GetFriendshipByID(db, f.ID)
	require.NoError(t, err)
	assert.Equal(t, "", fetched.Remark)
}

func TestFriendshipRepo_Lists(t *testing.T) {
	db := setupSQLite(t)

	// Pending incoming
	f1 := &model.Friendship{UserID: "alice", FriendID: "bob", Status: model.StatusPending}
	f2 := &model.Friendship{UserID: "carol", FriendID: "bob", Status: model.StatusPending}
	// Accepted
	f3 := &model.Friendship{UserID: "bob", FriendID: "dave", Status: model.StatusAccepted}

	require.NoError(t, CreateFriendship(db, f1))
	require.NoError(t, CreateFriendship(db, f2))
	require.NoError(t, CreateFriendship(db, f3))

	// Pending (received for bob)
	received, err := ListReceivedRequests(db, "bob")
	require.NoError(t, err)
	assert.Len(t, received, 2)

	// Pending (sent by alice)
	sent, err := ListSentRequests(db, "alice")
	require.NoError(t, err)
	assert.Len(t, sent, 1)

	// Accepted friends (bob's connections)
	accepted, err := ListAcceptedFriends(db, "bob")
	require.NoError(t, err)
	assert.Len(t, accepted, 1)
	assert.Equal(t, "dave", accepted[0].FriendID)

	// Friend IDs
	ids, err := GetFriendIDs(db, "bob")
	require.NoError(t, err)
	assert.Len(t, ids, 1)
	assert.Equal(t, "dave", ids[0])
}

func TestFriendshipRepo_BlockAndDelete(t *testing.T) {
	db := setupSQLite(t)

	f := &model.Friendship{UserID: "u1", FriendID: "u2", Status: model.StatusAccepted}
	require.NoError(t, CreateFriendship(db, f))

	// Block
	err := UpdateFriendshipByID(db, f.ID, model.StatusBlocked)
	require.NoError(t, err)

	blocked, err := IsBlockedBy(db, "u1", "u2")
	require.NoError(t, err)
	assert.True(t, blocked)

	// Delete pair
	err = DeleteFriendshipPair(db, "u1", "u2")
	require.NoError(t, err)

	found, err := FindFriendshipBetween(db, "u1", "u2")
	require.NoError(t, err)
	assert.Nil(t, found)
}

func TestFriendshipRepo_DeleteFriendshipDeletesLoadedRow(t *testing.T) {
	db := setupSQLite(t)

	target := &model.Friendship{UserID: "delete-u1", FriendID: "delete-u2", Status: model.StatusPending}
	other := &model.Friendship{UserID: "keep-u1", FriendID: "keep-u2", Status: model.StatusBlocked}
	require.NoError(t, CreateFriendship(db, target))
	require.NoError(t, CreateFriendship(db, other))

	require.NoError(t, DeleteFriendship(db, target))

	_, err := GetFriendshipByID(db, target.ID)
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
	kept, err := GetFriendshipByID(db, other.ID)
	require.NoError(t, err)
	assert.Equal(t, other.ID, kept.ID)
}

func TestFriendshipRepo_Upsert(t *testing.T) {
	db := setupSQLite(t)

	f := &model.Friendship{
		UserID:   "upsert-a",
		FriendID: "upsert-b",
		Status:   model.StatusPending,
	}
	require.NoError(t, UpsertFriendship(db, f))

	// Upsert with same user_id+friend_id updates
	f2 := &model.Friendship{
		UserID:   "upsert-a",
		FriendID: "upsert-b",
		Status:   model.StatusAccepted,
	}
	require.NoError(t, UpsertFriendship(db, f2))

	found, err := FindFriendshipBetween(db, "upsert-a", "upsert-b")
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, model.StatusAccepted, found.Status)
}
