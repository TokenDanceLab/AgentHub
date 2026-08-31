package session

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
	"github.com/agenthub/hub-server/internal/testkit"
)

// ── behavioral test helpers (moved with Session package #708) ───────────────

// newBehaviorServiceDB creates an in-memory SQLite DB with all tables needed
// by Session Service, including the composite unique index
// required by UpsertFriendship.
func newBehaviorServiceDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)

	require.NoError(t, db.AutoMigrate(
		&model.User{},
		&model.Friendship{},
		&model.Session{},
		&model.SessionMember{},
		&model.AgentInstance{},
		&model.PendingAgentTask{},
	))

	// UpsertFriendship uses ON CONFLICT (user_id, friend_id) which requires
	// a unique constraint. AutoMigrate creates a composite index but not a
	// unique constraint on these columns for SQLite.
	require.NoError(t, db.Exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_user_friend_unique ON friendships (user_id, friend_id)`,
	).Error)

	return db
}

// newBehaviorServiceCache creates a miniredis-backed cache.Client.
func newBehaviorServiceCache(t *testing.T) *cache.Client {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	return cache.NewClient(redis.NewClient(&redis.Options{Addr: mr.Addr()}))
}

// createUser creates a user and returns their auto-generated UUID ID.
// The BeforeCreate hook on model.User generates a UUID; the explicit ID
// must NOT be set, otherwise it is overwritten by the hook.
func createUser(t *testing.T, db *gorm.DB, username, nickname string) string {
	t.Helper()
	u := &model.User{Username: username, Nickname: nickname}
	require.NoError(t, db.Create(u).Error)
	require.NotEmpty(t, u.ID)
	return u.ID
}

// createFriendship creates an accepted friendship between two existing users.
func createFriendship(t *testing.T, db *gorm.DB, userID, friendID string) {
	t.Helper()
	require.NoError(t, db.Create(&model.Friendship{
		UserID:   userID,
		FriendID: friendID,
		Status:   model.StatusAccepted,
	}).Error)
}

// drainBus waits for the event bus to finish processing all events.
// Uses the shared Eventually helper so a stuck bus fails loudly instead of
// silently passing after the bounded loop (#1550).
func drainBus(t *testing.T, bus *bus.Bus) {
	t.Helper()
	testkit.Eventually(t, 3*time.Second, func() bool {
		return bus.Pending() == 0 && bus.Running() == 0
	}, "bus did not drain", nil)
}

// ── Session Service behavioral tests ────────────────────────────────────────

// TestSessionService_CreatePrivateSessionFlow tests creating a private session.
func TestSessionService_CreatePrivateSessionFlow(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	alice := createUser(t, db, "alice", "Alice")
	bob := createUser(t, db, "bob", "Bob")
	createFriendship(t, db, alice, bob)

	svc := NewService(db, cc)

	resp, err := svc.CreatePrivateSession(context.Background(), alice, bob)
	require.NoError(t, err)
	assert.True(t, resp.Created)
	assert.Equal(t, model.SessionTypePrivate, resp.Type)
	assert.NotEmpty(t, resp.SessionID)

	resp2, err := svc.CreatePrivateSession(context.Background(), alice, bob)
	require.NoError(t, err)
	assert.False(t, resp2.Created)
	assert.Equal(t, resp.SessionID, resp2.SessionID)
}

// TestSessionService_CreatePrivateSessionRequiresFriendship verifies friendship guard.
func TestSessionService_CreatePrivateSessionRequiresFriendship(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	alice := createUser(t, db, "alice", "Alice")
	bob := createUser(t, db, "bob", "Bob")

	svc := NewService(db, cc)
	_, err := svc.CreatePrivateSession(context.Background(), alice, bob)
	assert.ErrorIs(t, err, errcode.FriendNotFriend)
}

// TestSessionService_CreatePrivateSessionFailsForSelf verifies self-chat rejected.
func TestSessionService_CreatePrivateSessionFailsForSelf(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	alice := createUser(t, db, "alice", "Alice")

	svc := NewService(db, cc)
	_, err := svc.CreatePrivateSession(context.Background(), alice, alice)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
}

// TestSessionService_CreateGroupSessionFlow tests creating a group, listing,
// adding members, and removing members.
func TestSessionService_CreateGroupSessionFlow(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	bus, err := bus.New()
	require.NoError(t, err)
	t.Cleanup(func() { bus.Close(context.Background()) })

	owner := createUser(t, db, "owner", "Owner")
	f1 := createUser(t, db, "f1", "Friend1")
	f2 := createUser(t, db, "f2", "Friend2")
	f3 := createUser(t, db, "f3", "Friend3")
	createFriendship(t, db, owner, f1)
	createFriendship(t, db, owner, f2)
	createFriendship(t, db, owner, f3)

	svc := NewService(db, cc, bus)

	resp, err := svc.CreateGroupSession(context.Background(), owner, "Test Group", []string{f1, f2})
	require.NoError(t, err)
	assert.True(t, resp.Created)
	assert.Equal(t, model.SessionTypeGroup, resp.Type)
	sessionID := resp.SessionID
	drainBus(t, bus)

	sessions, err := svc.ListSessions(context.Background(), owner)
	require.NoError(t, err)
	require.Len(t, sessions, 1)
	assert.Equal(t, sessionID, sessions[0].SessionID)
	assert.Equal(t, "owner", sessions[0].Role)

	sessions, err = svc.ListSessions(context.Background(), f1)
	require.NoError(t, err)
	require.Len(t, sessions, 1)
	assert.Equal(t, "member", sessions[0].Role)

	err = svc.AddGroupMembers(context.Background(), owner, sessionID, []string{f3})
	require.NoError(t, err)
	drainBus(t, bus)

	sessions, err = svc.ListSessions(context.Background(), f3)
	require.NoError(t, err)
	require.Len(t, sessions, 1)

	err = svc.RemoveGroupMember(context.Background(), owner, sessionID, f2)
	require.NoError(t, err)
	drainBus(t, bus)

	sessions, err = svc.ListSessions(context.Background(), f2)
	require.NoError(t, err)
	assert.Empty(t, sessions)
}

// TestSessionService_GroupMemberManagementRequiresOwnerAuth verifies owner-only ops.
func TestSessionService_GroupMemberManagementRequiresOwnerAuth(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	owner := createUser(t, db, "owner", "Owner")
	m1 := createUser(t, db, "m1", "M1")
	m2 := createUser(t, db, "m2", "M2")
	createFriendship(t, db, owner, m1)
	createFriendship(t, db, owner, m2)

	svc := NewService(db, cc)
	resp, err := svc.CreateGroupSession(context.Background(), owner, "Auth Group", []string{m1})
	require.NoError(t, err)

	err = svc.AddGroupMembers(context.Background(), m1, resp.SessionID, []string{m2})
	assert.ErrorIs(t, err, errcode.GroupNotOwner)

	err = svc.RemoveGroupMember(context.Background(), m1, resp.SessionID, owner)
	assert.ErrorIs(t, err, errcode.GroupNotOwner)
}

// TestSessionService_CannotAddNonFriendToGroup verifies friend-only join.
func TestSessionService_CannotAddNonFriendToGroup(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	owner := createUser(t, db, "owner", "Owner")
	m1 := createUser(t, db, "m1", "M1")
	stranger := createUser(t, db, "stranger", "Stranger")
	createFriendship(t, db, owner, m1)

	svc := NewService(db, cc)
	resp, err := svc.CreateGroupSession(context.Background(), owner, "Friends Only", []string{m1})
	require.NoError(t, err)

	err = svc.AddGroupMembers(context.Background(), owner, resp.SessionID, []string{stranger})
	assert.ErrorIs(t, err, errcode.ErrBadRequest)
}

// TestSessionService_CannotAddDuplicateMember verifies duplicate member error.
func TestSessionService_CannotAddDuplicateMember(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	owner := createUser(t, db, "owner", "Owner")
	m1 := createUser(t, db, "m1", "M1")
	createFriendship(t, db, owner, m1)

	svc := NewService(db, cc)
	resp, err := svc.CreateGroupSession(context.Background(), owner, "Dup", []string{m1})
	require.NoError(t, err)

	err = svc.AddGroupMembers(context.Background(), owner, resp.SessionID, []string{m1})
	assert.ErrorIs(t, err, errcode.GroupAlreadyMember)
}

// TestSessionService_CannotRemoveOwner verifies owner removal guard.
func TestSessionService_CannotRemoveOwner(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	owner := createUser(t, db, "owner", "Owner")
	m1 := createUser(t, db, "m1", "M1")
	createFriendship(t, db, owner, m1)

	svc := NewService(db, cc)
	resp, err := svc.CreateGroupSession(context.Background(), owner, "Test", []string{m1})
	require.NoError(t, err)

	err = svc.RemoveGroupMember(context.Background(), owner, resp.SessionID, owner)
	assert.ErrorIs(t, err, errcode.GroupOwnerCannotLeave)
}

// TestSessionService_LeaveGroup verifies a member can leave voluntarily.
func TestSessionService_LeaveGroup(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	bus, err := bus.New()
	require.NoError(t, err)
	t.Cleanup(func() { bus.Close(context.Background()) })

	owner := createUser(t, db, "owner", "Owner")
	m1 := createUser(t, db, "m1", "M1")
	m2 := createUser(t, db, "m2", "M2")
	createFriendship(t, db, owner, m1)
	createFriendship(t, db, owner, m2)

	svc := NewService(db, cc, bus)
	resp, err := svc.CreateGroupSession(context.Background(), owner, "Leave", []string{m1, m2})
	require.NoError(t, err)
	drainBus(t, bus)

	err = svc.LeaveGroup(context.Background(), m1, resp.SessionID)
	require.NoError(t, err)
	drainBus(t, bus)

	sessions, err := svc.ListSessions(context.Background(), m1)
	require.NoError(t, err)
	assert.Empty(t, sessions)

	sessions, err = svc.ListSessions(context.Background(), owner)
	require.NoError(t, err)
	assert.Len(t, sessions, 1)
}

// TestSessionService_OwnerCannotLeaveIfOthersActive verifies owner leave guard.
func TestSessionService_OwnerCannotLeaveIfOthersActive(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	owner := createUser(t, db, "owner", "Owner")
	m1 := createUser(t, db, "m1", "M1")
	createFriendship(t, db, owner, m1)

	svc := NewService(db, cc)
	resp, err := svc.CreateGroupSession(context.Background(), owner, "Sticky", []string{m1})
	require.NoError(t, err)

	err = svc.LeaveGroup(context.Background(), owner, resp.SessionID)
	assert.ErrorIs(t, err, errcode.GroupOwnerCannotLeave)
}

// TestSessionService_TransferOwnershipThenLeave verifies transfer + leave.
func TestSessionService_TransferOwnershipThenLeave(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	owner := createUser(t, db, "owner", "Owner")
	m1 := createUser(t, db, "m1", "M1")
	createFriendship(t, db, owner, m1)

	svc := NewService(db, cc)
	resp, err := svc.CreateGroupSession(context.Background(), owner, "Transfer", []string{m1})
	require.NoError(t, err)

	err = svc.TransferGroupOwnership(context.Background(), owner, resp.SessionID, m1)
	require.NoError(t, err)

	err = svc.LeaveGroup(context.Background(), owner, resp.SessionID)
	require.NoError(t, err)

	sessions, err := svc.ListSessions(context.Background(), m1)
	require.NoError(t, err)
	require.Len(t, sessions, 1)
	assert.Equal(t, "owner", sessions[0].Role)
}

// TestSessionService_DissolveGroupFlow verifies dissolve.
func TestSessionService_DissolveGroupFlow(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	bus, err := bus.New()
	require.NoError(t, err)
	t.Cleanup(func() { bus.Close(context.Background()) })

	owner := createUser(t, db, "owner", "Owner")
	m1 := createUser(t, db, "m1", "M1")
	createFriendship(t, db, owner, m1)

	svc := NewService(db, cc, bus)
	resp, err := svc.CreateGroupSession(context.Background(), owner, "Dissolve", []string{m1})
	require.NoError(t, err)
	drainBus(t, bus)

	err = svc.DissolveGroup(context.Background(), m1, resp.SessionID)
	assert.ErrorIs(t, err, errcode.GroupNotOwner)

	err = svc.DissolveGroup(context.Background(), owner, resp.SessionID)
	require.NoError(t, err)
	drainBus(t, bus)

	err = svc.AddGroupMembers(context.Background(), owner, resp.SessionID, []string{})
	assert.Error(t, err)
}

// TestSessionService_UpdateGroupInfo verifies group info updates.
func TestSessionService_UpdateGroupInfo(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	bus, err := bus.New()
	require.NoError(t, err)
	t.Cleanup(func() { bus.Close(context.Background()) })

	owner := createUser(t, db, "owner", "Owner")
	m1 := createUser(t, db, "m1", "M1")
	createFriendship(t, db, owner, m1)

	svc := NewService(db, cc, bus)
	resp, err := svc.CreateGroupSession(context.Background(), owner, "Old", []string{m1})
	require.NoError(t, err)
	drainBus(t, bus)

	newName := "New Name"
	err = svc.UpdateGroupInfo(context.Background(), owner, resp.SessionID, &newName, nil, nil)
	require.NoError(t, err)
	drainBus(t, bus)

	sessions, err := svc.ListSessions(context.Background(), m1)
	require.NoError(t, err)
	require.Len(t, sessions, 1)
	assert.Equal(t, "New Name", sessions[0].Name)
}

// TestSessionService_UpdateGroupInfoRequiresOwnerAuth verifies info update auth.
func TestSessionService_UpdateGroupInfoRequiresOwnerAuth(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	owner := createUser(t, db, "owner", "Owner")
	m1 := createUser(t, db, "m1", "M1")
	createFriendship(t, db, owner, m1)

	svc := NewService(db, cc)
	resp, err := svc.CreateGroupSession(context.Background(), owner, "Test", []string{m1})
	require.NoError(t, err)

	newName := "Hacked"
	err = svc.UpdateGroupInfo(context.Background(), m1, resp.SessionID, &newName, nil, nil)
	assert.ErrorIs(t, err, errcode.GroupNotOwner)
}

// TestSessionService_UpdateMemberSettings verifies pin/archive/mute.
func TestSessionService_UpdateMemberSettings(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	owner := createUser(t, db, "owner", "Owner")
	m1 := createUser(t, db, "m1", "M1")
	createFriendship(t, db, owner, m1)

	svc := NewService(db, cc)
	resp, err := svc.CreateGroupSession(context.Background(), owner, "Settings", []string{m1})
	require.NoError(t, err)

	yes := true
	err = svc.UpdateMemberSettings(context.Background(), owner, resp.SessionID, &yes, &yes, &yes)
	require.NoError(t, err)
}

// TestSessionService_SearchSessions verifies session search.
func TestSessionService_SearchSessions(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	owner := createUser(t, db, "owner", "Owner")
	m1 := createUser(t, db, "m1", "M1")
	createFriendship(t, db, owner, m1)

	svc := NewService(db, cc)
	_, err := svc.CreateGroupSession(context.Background(), owner, "Project Alpha", []string{m1})
	require.NoError(t, err)
	_, err = svc.CreateGroupSession(context.Background(), owner, "Project Beta", []string{})
	require.NoError(t, err)

	page, err := svc.SearchSessions(context.Background(), owner, "Alpha", "", 50)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	assert.Equal(t, "Project Alpha", page.Items[0].Name)
	assert.False(t, page.HasMore)
	assert.Empty(t, page.NextCursor)

	page, err = svc.SearchSessions(context.Background(), owner, "Nope", "", 50)
	require.NoError(t, err)
	assert.Empty(t, page.Items)
}

// TestSessionService_DeleteForMe verifies soft-delete.
func TestSessionService_DeleteForMe(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cc := newBehaviorServiceCache(t)
	bus, err := bus.New()
	require.NoError(t, err)
	t.Cleanup(func() { bus.Close(context.Background()) })

	owner := createUser(t, db, "owner", "Owner")
	m1 := createUser(t, db, "m1", "M1")
	createFriendship(t, db, owner, m1)

	svc := NewService(db, cc, bus)
	resp, err := svc.CreateGroupSession(context.Background(), owner, "DeleteMe", []string{m1})
	require.NoError(t, err)
	drainBus(t, bus)

	err = svc.DeleteForMe(context.Background(), m1, resp.SessionID)
	require.NoError(t, err)
	drainBus(t, bus)

	sessions, err := svc.ListSessions(context.Background(), m1)
	require.NoError(t, err)
	assert.Empty(t, sessions)

	sessions, err = svc.ListSessions(context.Background(), owner)
	require.NoError(t, err)
	assert.Len(t, sessions, 1)
}

// TestSessionService_CreatePrivateSessionWithNilCacheDoesNotPanic verifies
// nil cache is safely handled.
func TestSessionService_CreatePrivateSessionWithNilCacheDoesNotPanic(t *testing.T) {
	db := newBehaviorServiceDB(t)
	alice := createUser(t, db, "alice", "Alice")
	bob := createUser(t, db, "bob", "Bob")
	createFriendship(t, db, alice, bob)

	svc := NewService(db, nil)
	resp, err := svc.CreatePrivateSession(context.Background(), alice, bob)
	require.NoError(t, err)
	assert.True(t, resp.Created)
	assert.Equal(t, model.SessionTypePrivate, resp.Type)
}
