package contact

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/glebarez/sqlite"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/pkg/testkit"
)

// ── behavioral test helpers (moved with Contact package #685) ───────────────

func newBehaviorServiceDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)

	require.NoError(t, db.AutoMigrate(
		&model.User{},
		&model.Friendship{},
	))

	// UpsertFriendship uses ON CONFLICT (user_id, friend_id) which requires
	// a unique constraint. AutoMigrate creates a composite index but not a
	// unique constraint on these columns for SQLite.
	require.NoError(t, db.Exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_user_friend_unique ON friendships (user_id, friend_id)`,
	).Error)

	return db
}

func newBehaviorServiceCache(t *testing.T) *cache.Client {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	return cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()}))
}

func createUser(t *testing.T, db *gorm.DB, username, nickname string) string {
	t.Helper()
	u := &model.User{Username: username, Nickname: nickname}
	require.NoError(t, db.Create(u).Error)
	require.NotEmpty(t, u.ID)
	return u.ID
}

func createFriendship(t *testing.T, db *gorm.DB, userID, friendID string) {
	t.Helper()
	require.NoError(t, db.Create(&model.Friendship{
		UserID:   userID,
		FriendID: friendID,
		Status:   model.StatusAccepted,
	}).Error)
}

func drainBus(t *testing.T, bus *bus.Bus) {
	t.Helper()
	// Shared Eventually helper: a stuck bus fails loudly instead of silently
	// passing after the bounded loop (#1550).
	testkit.Eventually(t, 3*time.Second, func() bool {
		return bus.Pending() == 0 && bus.Running() == 0
	}, "bus did not drain", nil)
}

// ── ContactService behavioral tests ─────────────────────────────────────────

// TestContactService_SearchToFriendFlow tests the full flow: search a stranger,
// send a friend request, list received requests, accept, and verify both sides
// are now friends.
func TestContactService_SearchToFriendFlow(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	bus, err := bus.New()
	require.NoError(t, err)
	t.Cleanup(func() { bus.Close(context.Background()) })

	alice := createUser(t, db, "alice", "Alice")
	bob := createUser(t, db, "bob", "Bob")

	svc := NewService(db, bus, cc)

	result, err := svc.SearchUser(context.Background(), alice, bob)
	require.NoError(t, err)
	assert.Equal(t, bob, result.UserID)
	assert.Equal(t, "stranger", result.Relationship)

	err = svc.SendFriendRequest(context.Background(), alice, bob, "Hi Bob!")
	require.NoError(t, err)

	result, err = svc.SearchUser(context.Background(), alice, bob)
	require.NoError(t, err)
	assert.Equal(t, "pending_sent", result.Relationship)

	result, err = svc.SearchUser(context.Background(), bob, alice)
	require.NoError(t, err)
	assert.Equal(t, "pending_received", result.Relationship)

	requests, err := svc.ListFriendRequests(context.Background(), bob)
	require.NoError(t, err)
	require.Len(t, requests, 1)
	assert.Equal(t, alice, requests[0].UserID)
	assert.Equal(t, "Hi Bob!", requests[0].Message)

	err = svc.AcceptFriendRequest(context.Background(), bob, requests[0].RequestID)
	require.NoError(t, err)
	drainBus(t, bus)

	result, err = svc.SearchUser(context.Background(), alice, bob)
	require.NoError(t, err)
	assert.Equal(t, "friend", result.Relationship)

	result, err = svc.SearchUser(context.Background(), bob, alice)
	require.NoError(t, err)
	assert.Equal(t, "friend", result.Relationship)

	contacts, err := svc.ListContacts(context.Background(), alice)
	require.NoError(t, err)
	require.Len(t, contacts, 1)
	assert.Equal(t, bob, contacts[0].UserID)
	assert.Equal(t, "user", contacts[0].Type)

	contacts, err = svc.ListContacts(context.Background(), bob)
	require.NoError(t, err)
	require.Len(t, contacts, 1)
	assert.Equal(t, alice, contacts[0].UserID)
}

// TestContactService_SendFriendRequestWhenAlreadyPending verifies duplicate requests.
func TestContactService_SendFriendRequestWhenAlreadyPending(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	alice := createUser(t, db, "alice", "Alice")
	bob := createUser(t, db, "bob", "Bob")

	svc := NewService(db, nil, cc)
	err := svc.SendFriendRequest(context.Background(), alice, bob, "hello")
	require.NoError(t, err)
	err = svc.SendFriendRequest(context.Background(), alice, bob, "again")
	assert.ErrorIs(t, err, errcode.FriendAlready)
}

// TestContactService_SendFriendRequestWhenAlreadyAccepted verifies request to friend fails.
func TestContactService_SendFriendRequestWhenAlreadyAccepted(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	alice := createUser(t, db, "alice", "Alice")
	bob := createUser(t, db, "bob", "Bob")
	createFriendship(t, db, alice, bob)

	svc := NewService(db, nil, cc)
	err := svc.SendFriendRequest(context.Background(), alice, bob, "hello")
	assert.ErrorIs(t, err, errcode.FriendAlready)
}

// TestContactService_SendFriendRequestWhenBlocked verifies blocked user cannot send.
func TestContactService_SendFriendRequestWhenBlocked(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	alice := createUser(t, db, "alice", "Alice")
	bob := createUser(t, db, "bob", "Bob")

	require.NoError(t, db.Create(&model.Friendship{
		UserID:   bob,
		FriendID: alice,
		Status:   model.StatusBlocked,
	}).Error)

	svc := NewService(db, nil, cc)
	err := svc.SendFriendRequest(context.Background(), alice, bob, "hello")
	assert.ErrorIs(t, err, errcode.FriendBlocked)
}

// TestContactService_RejectFriendRequest verifies the reject flow.
func TestContactService_RejectFriendRequest(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	alice := createUser(t, db, "alice", "Alice")
	bob := createUser(t, db, "bob", "Bob")

	svc := NewService(db, nil, cc)
	err := svc.SendFriendRequest(context.Background(), alice, bob, "hi")
	require.NoError(t, err)

	requests, err := svc.ListFriendRequests(context.Background(), bob)
	require.NoError(t, err)
	require.Len(t, requests, 1)

	err = svc.RejectFriendRequest(context.Background(), bob, requests[0].RequestID)
	require.NoError(t, err)

	requests, err = svc.ListFriendRequests(context.Background(), bob)
	require.NoError(t, err)
	assert.Empty(t, requests)

	result, err := svc.SearchUser(context.Background(), alice, bob)
	require.NoError(t, err)
	assert.Equal(t, "stranger", result.Relationship)
}

// TestContactService_BlockAndUnblock verifies the block/unblock flow.
func TestContactService_BlockAndUnblock(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	alice := createUser(t, db, "alice", "Alice")
	bob := createUser(t, db, "bob", "Bob")

	svc := NewService(db, nil, cc)

	// alice blocks bob
	err := svc.BlockContact(context.Background(), alice, bob)
	require.NoError(t, err)

	// alice searches bob — should see "blocked" (alice initiated the block)
	result, err := svc.SearchUser(context.Background(), alice, bob)
	require.NoError(t, err)
	assert.Equal(t, "blocked", result.Relationship)

	// Unblock
	err = svc.UnblockContact(context.Background(), alice, bob)
	require.NoError(t, err)

	// After unblock, back to strangers
	result, err = svc.SearchUser(context.Background(), alice, bob)
	require.NoError(t, err)
	assert.Equal(t, "stranger", result.Relationship)
}

// TestContactService_BlockSelfReturnsError verifies blocking self fails.
func TestContactService_BlockSelfReturnsError(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	alice := createUser(t, db, "alice", "Alice")

	svc := NewService(db, nil, cc)
	err := svc.BlockContact(context.Background(), alice, alice)
	assert.ErrorIs(t, err, errcode.UserInvalidParam)
}

// TestContactService_RemoveContact verifies removing a friend.
func TestContactService_RemoveContact(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	alice := createUser(t, db, "alice", "Alice")
	bob := createUser(t, db, "bob", "Bob")
	createFriendship(t, db, alice, bob)

	svc := NewService(db, nil, cc)
	err := svc.RemoveContact(context.Background(), alice, bob)
	require.NoError(t, err)

	result, err := svc.SearchUser(context.Background(), alice, bob)
	require.NoError(t, err)
	assert.Equal(t, "stranger", result.Relationship)
}

// TestContactService_UpdateRemark verifies updating a friend's remark.
func TestContactService_UpdateRemark(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	alice := createUser(t, db, "alice", "Alice")
	bob := createUser(t, db, "bob", "Bob")
	createFriendship(t, db, alice, bob)

	svc := NewService(db, nil, cc)
	err := svc.UpdateRemark(context.Background(), alice, bob, "best friend")
	require.NoError(t, err)

	contacts, err := svc.ListContacts(context.Background(), alice)
	require.NoError(t, err)
	require.Len(t, contacts, 1)
	assert.Equal(t, "best friend", contacts[0].Remark)
}

// TestContactService_ListEmptyContacts verifies empty contact list.
func TestContactService_ListEmptyContacts(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	lonely := createUser(t, db, "lonely", "Lonely")

	svc := NewService(db, nil, cc)
	contacts, err := svc.ListContacts(context.Background(), lonely)
	require.NoError(t, err)
	assert.NotNil(t, contacts)
	assert.Empty(t, contacts)
}

// TestContactService_ListEmptyRequests verifies empty request list.
func TestContactService_ListEmptyRequests(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	noreq := createUser(t, db, "noreq", "NoReq")

	svc := NewService(db, nil, cc)
	requests, err := svc.ListFriendRequests(context.Background(), noreq)
	require.NoError(t, err)
	assert.NotNil(t, requests)
	assert.Empty(t, requests)
}

// TestContactService_AcceptAlreadyAcceptedRequestFails verifies double accept fails.
func TestContactService_AcceptAlreadyAcceptedRequestFails(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	alice := createUser(t, db, "alice", "Alice")
	bob := createUser(t, db, "bob", "Bob")

	svc := NewService(db, nil, cc)
	err := svc.SendFriendRequest(context.Background(), alice, bob, "hi")
	require.NoError(t, err)

	requests, err := svc.ListFriendRequests(context.Background(), bob)
	require.NoError(t, err)
	require.Len(t, requests, 1)

	err = svc.AcceptFriendRequest(context.Background(), bob, requests[0].RequestID)
	require.NoError(t, err)

	err = svc.AcceptFriendRequest(context.Background(), bob, requests[0].RequestID)
	assert.ErrorIs(t, err, errcode.FriendRequestNotFound)
}

// TestContactService_AcceptRequestFromWrongUserFails verifies wrong-user accept fails.
func TestContactService_AcceptRequestFromWrongUserFails(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	alice := createUser(t, db, "alice", "Alice")
	bob := createUser(t, db, "bob", "Bob")
	charlie := createUser(t, db, "charlie", "Charlie")

	svc := NewService(db, nil, cc)
	err := svc.SendFriendRequest(context.Background(), alice, bob, "hi")
	require.NoError(t, err)

	requests, err := svc.ListFriendRequests(context.Background(), bob)
	require.NoError(t, err)
	require.Len(t, requests, 1)

	err = svc.AcceptFriendRequest(context.Background(), charlie, requests[0].RequestID)
	assert.ErrorIs(t, err, errcode.FriendRequestNotFound)
}
