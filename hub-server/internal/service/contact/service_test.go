package contact

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
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// mockContactCache implements Cache for testing.
type mockContactCache struct {
	invalidated []string
	online      map[string]bool
}

func (m *mockContactCache) Invalidate(ctx context.Context, keys ...string) error {
	m.invalidated = append(m.invalidated, keys...)
	return nil
}

func (m *mockContactCache) IsOnline(ctx context.Context, userID string) (bool, error) {
	if m.online == nil {
		return false, nil
	}
	return m.online[userID], nil
}

// recordingContactBus is a Bus test double that records Publish calls.
type recordingContactBus struct {
	events []bus.Event
}

func (b *recordingContactBus) Publish(ctx context.Context, event bus.Event) error {
	b.events = append(b.events, event)
	return nil
}

func newTestBus(t *testing.T) *bus.Bus {
	t.Helper()
	b, err := bus.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b.Close(context.Background()) })
	return b
}

func testCacheClient(t *testing.T) *cache.Client {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return cache.NewClient(rdb)
}

func TestService_ResolveCacheUsesNoopForTypedNilClient(t *testing.T) {
	ctx := context.Background()
	var typedNil *cache.Client

	resolved := resolveCache(typedNil)
	require.IsType(t, cache.NoOpCache{}, resolved)
	online, err := resolved.IsOnline(ctx, "user-1")
	require.NoError(t, err)
	require.False(t, online)
	require.NoError(t, resolved.Invalidate(ctx, "test:key"))
}

func TestService_NilBusPublishIsNoop(t *testing.T) {
	svc := &Service{db: nil, bus: nil, cacheClient: &mockContactCache{}}
	// Must not panic when b port is unset (read-only/partial construction).
	svc.publish(context.Background(), bus.Event{Type: "friend.request", Payload: "x"})
}

func TestService_SetBusAndSetCachePorts(t *testing.T) {
	rec := &recordingContactBus{}
	cache := &mockContactCache{}
	svc := NewService(nil, nil, nil)
	require.NotNil(t, svc)

	svc.SetBus(rec)
	svc.SetCache(cache)
	svc.publish(context.Background(), bus.Event{Type: "friend.accepted", Payload: map[string]string{"k": "v"}})

	require.Len(t, rec.events, 1)
	assert.Equal(t, "friend.accepted", rec.events[0].Type)
	require.NotNil(t, svc.cacheClient)
}

// SQL substrings used for matching (QueryMatcherFunc with strings.Contains)
const (
	sqlcUserByID          = `FROM "users" WHERE id =`
	sqlcUsersByIDs        = `FROM "users" WHERE id IN`
	sqlcFriendshipBetween = `FROM "friendships" WHERE (user_id`
	sqlcFriendshipByID    = `FROM "friendships" WHERE id =`
	sqlcFriendshipByUF    = `FROM "friendships" WHERE user_id = $1 AND friend_id = $2`
	sqlcFriendshipsByUser = `FROM "friendships" WHERE user_id = $1 AND status = $2 LIMIT`
	sqlcPendingReqs       = `FROM "friendships" WHERE friend_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT`
	sqlcInsertFriend      = `INSERT INTO "friendships"`
	sqlcUpdateFriend      = `UPDATE "friendships" SET`
	sqlcDeleteFriend      = `DELETE FROM "friendships" WHERE`
)

func newMockDBContact(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, *sql.DB) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(
		func(expectedSQL, actualSQL string) error {
			if strings.Contains(actualSQL, expectedSQL) {
				return nil
			}
			return fmt.Errorf("expected SQL to contain %q, got %q", expectedSQL, actualSQL)
		},
	)))
	require.NoError(t, err)
	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		SkipDefaultTransaction: true,
		PrepareStmt:            false,
	})
	require.NoError(t, err)
	return gormDB, mock, sqlDB
}

// ==================== SearchUser ====================

func TestSearchUser_SelfSearch(t *testing.T) {
	db, _, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	svc := NewService(db, nil, nil)
	_, err := svc.SearchUser(context.Background(), "user-1", "user-1")
	assert.ErrorIs(t, err, errcode.UserInvalidParam)
}

func TestSearchUser_NotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("target-99", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewService(db, nil, nil)
	_, err := svc.SearchUser(context.Background(), "user-1", "target-99")
	assert.ErrorIs(t, err, errcode.UserNotFound)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSearchUser_Stranger(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("target-1", "targetuser", "hash", "Target User", "https://avatar.url"))

	mock.ExpectQuery(sqlcFriendshipBetween).
		WithArgs("user-1", "target-1", "target-1", "user-1", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewService(db, nil, nil)
	result, err := svc.SearchUser(context.Background(), "user-1", "target-1")
	require.NoError(t, err)
	assert.Equal(t, "target-1", result.UserID)
	assert.Equal(t, "targetuser", result.Username)
	assert.Equal(t, "stranger", result.Relationship)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSearchUser_Friend(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("target-1", "frienduser", "hash", "Friend", ""))

	mock.ExpectQuery(sqlcFriendshipBetween).
		WithArgs("user-1", "target-1", "target-1", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status", "remark"}).
			AddRow("f-1", "user-1", "target-1", model.StatusAccepted, "my friend"))

	svc := NewService(db, nil, nil)
	result, err := svc.SearchUser(context.Background(), "user-1", "target-1")
	require.NoError(t, err)
	assert.Equal(t, "friend", result.Relationship)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSearchUser_PendingSent(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("target-1", "newfriend", "hash", "New", ""))

	mock.ExpectQuery(sqlcFriendshipBetween).
		WithArgs("user-1", "target-1", "target-1", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("f-2", "user-1", "target-1", model.StatusPending))

	svc := NewService(db, nil, nil)
	result, err := svc.SearchUser(context.Background(), "user-1", "target-1")
	require.NoError(t, err)
	assert.Equal(t, "pending_sent", result.Relationship)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSearchUser_PendingReceived(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("target-1", "sender", "hash", "Sender", ""))

	mock.ExpectQuery(sqlcFriendshipBetween).
		WithArgs("user-1", "target-1", "target-1", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("f-3", "target-1", "user-1", model.StatusPending))

	svc := NewService(db, nil, nil)
	result, err := svc.SearchUser(context.Background(), "user-1", "target-1")
	require.NoError(t, err)
	assert.Equal(t, "pending_received", result.Relationship)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSearchUser_Blocked(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("target-1", "blockeduser", "hash", "Blocked", ""))

	mock.ExpectQuery(sqlcFriendshipBetween).
		WithArgs("user-1", "target-1", "target-1", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("f-4", "target-1", "user-1", model.StatusBlocked))

	svc := NewService(db, nil, nil)
	_, err := svc.SearchUser(context.Background(), "user-1", "target-1")
	assert.ErrorIs(t, err, errcode.FriendBlocked)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== SendFriendRequest ====================

func TestSendFriendRequest_SelfRequest(t *testing.T) {
	db, _, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	svc := NewService(db, nil, nil)
	err := svc.SendFriendRequest(context.Background(), "user-1", "user-1", "please add me")
	assert.ErrorIs(t, err, errcode.UserInvalidParam)
}

func TestSendFriendRequest_TargetNotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("nonexistent", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewService(db, nil, nil)
	err := svc.SendFriendRequest(context.Background(), "user-1", "nonexistent", "hello")
	assert.ErrorIs(t, err, errcode.UserNotFound)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSendFriendRequest_AlreadyFriends(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("target-1", "friend", "hash", "Friend", ""))

	mock.ExpectQuery(sqlcFriendshipBetween).
		WithArgs("user-1", "target-1", "target-1", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("f-1", "user-1", "target-1", model.StatusAccepted))

	svc := NewService(db, nil, nil)
	err := svc.SendFriendRequest(context.Background(), "user-1", "target-1", "hello")
	assert.ErrorIs(t, err, errcode.FriendAlready)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSendFriendRequest_BlockedByTarget(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("target-1", "target", "hash", "Target", ""))

	mock.ExpectQuery(sqlcFriendshipBetween).
		WithArgs("user-1", "target-1", "target-1", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("f-block", "target-1", "user-1", model.StatusBlocked))

	svc := NewService(db, nil, nil)
	err := svc.SendFriendRequest(context.Background(), "user-1", "target-1", "hello")
	assert.ErrorIs(t, err, errcode.FriendBlocked)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSendFriendRequest_Success(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("target-1", "target", "hash", "Target", ""))

	mock.ExpectQuery(sqlcFriendshipBetween).
		WithArgs("user-1", "target-1", "target-1", "user-1", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	mock.ExpectExec(sqlcInsertFriend).
		WillReturnResult(sqlmock.NewResult(1, 1))

	svc := NewService(db, nil, nil)
	err := svc.SendFriendRequest(context.Background(), "user-1", "target-1", "please add me")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSendFriendRequest_PublishesDocumentedEventPayload(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("target-1", "target", "hash", "Target", ""))

	mock.ExpectQuery(sqlcFriendshipBetween).
		WithArgs("user-1", "target-1", "target-1", "user-1", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	mock.ExpectExec(sqlcInsertFriend).
		WillReturnResult(sqlmock.NewResult(1, 1))

	b := newTestBus(t)
	events := captureServiceEvents(b, "friend.request")
	svc := NewService(db, b, nil)
	err := svc.SendFriendRequest(context.Background(), "user-1", "target-1", "please add me")
	require.NoError(t, err)

	payload := waitForServiceEventPayload(t, events)
	assert.NotEmpty(t, payload["request_id"])
	assert.Equal(t, "user-1", payload["from_user_id"])
	assert.Equal(t, "please add me", payload["message"])
	assert.NotContains(t, payload, "sender_id")
	assert.NotContains(t, payload, "receiver_id")
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSendFriendRequest_PendingAlready(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("target-1", "target", "hash", "Target", ""))

	mock.ExpectQuery(sqlcFriendshipBetween).
		WithArgs("user-1", "target-1", "target-1", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("f-existing", "user-1", "target-1", model.StatusPending))

	svc := NewService(db, nil, nil)
	err := svc.SendFriendRequest(context.Background(), "user-1", "target-1", "hello")
	assert.ErrorIs(t, err, errcode.FriendAlready)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== AcceptFriendRequest ====================

func TestAcceptFriendRequest_NotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipByID).
		WithArgs("req-99", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewService(db, nil, testCacheClient(t))
	err := svc.AcceptFriendRequest(context.Background(), "user-1", "req-99")
	assert.ErrorIs(t, err, errcode.FriendRequestNotFound)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAcceptFriendRequest_WrongReceiver(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipByID).
		WithArgs("req-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status", "request_message"}).
			AddRow("req-1", "sender", "other-user", model.StatusPending, "add me"))

	svc := NewService(db, nil, testCacheClient(t))
	err := svc.AcceptFriendRequest(context.Background(), "user-1", "req-1")
	assert.ErrorIs(t, err, errcode.FriendRequestNotFound)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAcceptFriendRequest_AlreadyAccepted(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipByID).
		WithArgs("req-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("req-1", "sender", "user-1", model.StatusAccepted))

	svc := NewService(db, nil, testCacheClient(t))
	err := svc.AcceptFriendRequest(context.Background(), "user-1", "req-1")
	assert.ErrorIs(t, err, errcode.FriendRequestNotFound)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAcceptFriendRequest_Success(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipByID).
		WithArgs("req-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("req-1", "sender", "user-1", model.StatusPending))

	// Explicit transaction: UpdateFriendshipByID + UpsertFriendship
	mock.ExpectBegin()
	mock.ExpectExec(sqlcUpdateFriend).
		WithArgs(model.StatusAccepted, sqlmock.AnyArg(), "req-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(sqlcInsertFriend).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	svc := NewService(db, nil, testCacheClient(t))
	err := svc.AcceptFriendRequest(context.Background(), "user-1", "req-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAcceptFriendRequest_PublishesAcceptedEventAfterMutation(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipByID).
		WithArgs("req-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("req-1", "sender", "user-1", model.StatusPending))

	mock.ExpectBegin()
	mock.ExpectExec(sqlcUpdateFriend).
		WithArgs(model.StatusAccepted, sqlmock.AnyArg(), "req-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(sqlcInsertFriend).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	b := newTestBus(t)
	events := captureServiceEvents(b, "friend.accepted")
	svc := NewService(db, b, testCacheClient(t))
	err := svc.AcceptFriendRequest(context.Background(), "user-1", "req-1")
	require.NoError(t, err)

	payload := waitForServiceEventPayload(t, events)
	assert.Equal(t, "req-1", payload["friendship_id"])
	assert.Equal(t, "sender", payload["user_id"])
	assert.Equal(t, "user-1", payload["accepter_id"])
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAcceptFriendRequest_NilCacheDoesNotPanic(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipByID).
		WithArgs("req-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("req-1", "sender", "user-1", model.StatusPending))

	mock.ExpectBegin()
	mock.ExpectExec(sqlcUpdateFriend).
		WithArgs(model.StatusAccepted, sqlmock.AnyArg(), "req-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(sqlcInsertFriend).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	svc := NewService(db, nil, nil)
	err := svc.AcceptFriendRequest(context.Background(), "user-1", "req-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== RejectFriendRequest ====================

func TestRejectFriendRequest_NotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipByID).
		WithArgs("req-99", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewService(db, nil, testCacheClient(t))
	err := svc.RejectFriendRequest(context.Background(), "user-1", "req-99")
	assert.ErrorIs(t, err, errcode.FriendRequestNotFound)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRejectFriendRequest_Success(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipByID).
		WithArgs("req-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("req-1", "sender", "user-1", model.StatusPending))

	mock.ExpectExec(sqlcDeleteFriend).
		WithArgs("req-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	svc := NewService(db, nil, testCacheClient(t))
	err := svc.RejectFriendRequest(context.Background(), "user-1", "req-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== RemoveContact ====================

func TestRemoveContact_NotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipByUF).
		WithArgs("user-1", "friend-1", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewService(db, nil, testCacheClient(t))
	err := svc.RemoveContact(context.Background(), "user-1", "friend-1")
	assert.ErrorIs(t, err, errcode.FriendRequestNotFound)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRemoveContact_Success(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipByUF).
		WithArgs("user-1", "friend-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("f-1", "user-1", "friend-1", model.StatusAccepted))

	// DeleteFriendshipPair uses explicit db.Transaction
	mock.ExpectBegin()
	mock.ExpectExec(sqlcDeleteFriend).
		WithArgs("user-1", "friend-1", "friend-1", "user-1").
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectCommit()

	svc := NewService(db, nil, testCacheClient(t))
	err := svc.RemoveContact(context.Background(), "user-1", "friend-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== BlockContact ====================

func TestBlockContact_SelfBlock(t *testing.T) {
	db, _, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	svc := NewService(db, nil, nil)
	err := svc.BlockContact(context.Background(), "user-1", "user-1")
	assert.ErrorIs(t, err, errcode.UserInvalidParam)
}

func TestBlockContact_TargetNotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("nonexistent", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewService(db, nil, testCacheClient(t))
	err := svc.BlockContact(context.Background(), "user-1", "nonexistent")
	assert.ErrorIs(t, err, errcode.UserNotFound)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestBlockContact_Success(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("target-1", "target", "hash", "Target", ""))

	// #183: UpsertFriendship sets currentUserID -> targetUserID = blocked
	mock.ExpectExec(sqlcInsertFriend).
		WillReturnResult(sqlmock.NewResult(1, 1))

	svc := NewService(db, nil, testCacheClient(t))
	err := svc.BlockContact(context.Background(), "user-1", "target-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== UnblockContact ====================

func TestUnblockContact_NotFoundOrNotBlocked(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipByUF).
		WithArgs("user-1", "target-1", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewService(db, nil, testCacheClient(t))
	err := svc.UnblockContact(context.Background(), "user-1", "target-1")
	assert.ErrorIs(t, err, errcode.FriendRequestNotFound)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestUnblockContact_NotBlockedStatus(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipByUF).
		WithArgs("user-1", "target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("f-1", "user-1", "target-1", model.StatusAccepted))

	svc := NewService(db, nil, testCacheClient(t))
	err := svc.UnblockContact(context.Background(), "user-1", "target-1")
	assert.ErrorIs(t, err, errcode.FriendRequestNotFound)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestUnblockContact_Success(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipByUF).
		WithArgs("user-1", "target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("f-block", "user-1", "target-1", model.StatusBlocked))

	mock.ExpectExec(sqlcDeleteFriend).
		WithArgs("f-block").
		WillReturnResult(sqlmock.NewResult(0, 1))

	svc := NewService(db, nil, testCacheClient(t))
	err := svc.UnblockContact(context.Background(), "user-1", "target-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== ListContacts ====================

func TestListContacts_Empty(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipsByUser).
		WithArgs("user-1", model.StatusAccepted, 500).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status", "remark"}))

	svc := NewService(db, nil, testCacheClient(t))
	contacts, err := svc.ListContacts(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Empty(t, contacts)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestListContacts_WithFriends(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipsByUser).
		WithArgs("user-1", model.StatusAccepted, 500).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status", "remark"}).
			AddRow("f-1", "user-1", "friend-a", model.StatusAccepted, "Buddy").
			AddRow("f-2", "user-1", "friend-b", model.StatusAccepted, ""))

	mock.ExpectQuery(sqlcUsersByIDs).
		WithArgs("friend-a", "friend-b").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("friend-a", "friendA", "hash1", "Friend A", "").
			AddRow("friend-b", "friendB", "hash2", "Friend B", "https://img.url"))

	svc := NewService(db, nil, testCacheClient(t))
	contacts, err := svc.ListContacts(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Len(t, contacts, 2)
	assert.Equal(t, "friend-a", contacts[0].UserID)
	assert.Equal(t, "friendA", contacts[0].Username)
	assert.Equal(t, "Buddy", contacts[0].Remark)
	assert.Equal(t, "friend-b", contacts[1].UserID)
	assert.Equal(t, "Friend B", contacts[1].Nickname)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestListContacts_NilCacheMarksOffline(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipsByUser).
		WithArgs("user-1", model.StatusAccepted, 500).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status", "remark"}).
			AddRow("f-1", "user-1", "friend-a", model.StatusAccepted, "Buddy").
			AddRow("f-2", "user-1", "friend-b", model.StatusAccepted, ""))

	mock.ExpectQuery(sqlcUsersByIDs).
		WithArgs("friend-a", "friend-b").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("friend-a", "friendA", "hash1", "Friend A", "").
			AddRow("friend-b", "friendB", "hash2", "Friend B", "https://img.url"))

	svc := NewService(db, nil, nil)
	contacts, err := svc.ListContacts(context.Background(), "user-1")
	require.NoError(t, err)
	require.Len(t, contacts, 2)
	assert.False(t, contacts[0].Online)
	assert.False(t, contacts[1].Online)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestListContacts_BatchesFriendUserLookup(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipsByUser).
		WithArgs("user-1", model.StatusAccepted, 500).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status", "remark"}).
			AddRow("f-1", "user-1", "friend-a", model.StatusAccepted, "A").
			AddRow("f-2", "user-1", "friend-b", model.StatusAccepted, "B").
			AddRow("f-3", "user-1", "friend-c", model.StatusAccepted, "C"))

	mock.ExpectQuery(sqlcUsersByIDs).
		WithArgs("friend-a", "friend-b", "friend-c").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("friend-a", "friendA", "hash-a", "Friend A", "").
			AddRow("friend-b", "friendB", "hash-b", "Friend B", "").
			AddRow("friend-c", "friendC", "hash-c", "Friend C", ""))

	svc := NewService(db, nil, testCacheClient(t))
	contacts, err := svc.ListContacts(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Len(t, contacts, 3)
	assert.Equal(t, "friend-c", contacts[2].UserID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== UpdateRemark ====================

func TestUpdateRemark(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectExec(sqlcUpdateFriend).
		WithArgs("Best Friend", sqlmock.AnyArg(), "user-1", "friend-1", model.StatusAccepted).
		WillReturnResult(sqlmock.NewResult(0, 1))

	svc := NewService(db, nil, nil)
	err := svc.UpdateRemark(context.Background(), "user-1", "friend-1", "Best Friend")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== ListFriendRequests ====================

func TestListFriendRequests_Empty(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcPendingReqs).
		WithArgs("user-1", model.StatusPending, 500).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status", "request_message", "created_at"}))

	svc := NewService(db, nil, nil)
	requests, err := svc.ListFriendRequests(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Empty(t, requests)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestListFriendRequests_WithRequests(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	now := time.Now()
	mock.ExpectQuery(sqlcPendingReqs).
		WithArgs("user-1", model.StatusPending, 500).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status", "request_message", "created_at"}).
			AddRow("req-1", "sender-a", "user-1", model.StatusPending, "Hi, let's connect!", now))

	mock.ExpectQuery(sqlcUsersByIDs).
		WithArgs("sender-a").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("sender-a", "senderA", "hash", "Sender A", "https://avatar.com/a.png"))

	svc := NewService(db, nil, nil)
	requests, err := svc.ListFriendRequests(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Len(t, requests, 1)
	assert.Equal(t, "req-1", requests[0].RequestID)
	assert.Equal(t, "sender-a", requests[0].UserID)
	assert.Equal(t, "senderA", requests[0].Username)
	assert.Equal(t, "Hi, let's connect!", requests[0].Message)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestListFriendRequests_BatchesSenderLookupAndSkipsMissingSender(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	now := time.Now()
	mock.ExpectQuery(sqlcPendingReqs).
		WithArgs("user-1", model.StatusPending, 500).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status", "request_message", "created_at"}).
			AddRow("req-1", "sender-a", "user-1", model.StatusPending, "first", now).
			AddRow("req-2", "sender-b", "user-1", model.StatusPending, "second", now).
			AddRow("req-3", "sender-missing", "user-1", model.StatusPending, "missing", now))

	mock.ExpectQuery(sqlcUsersByIDs).
		WithArgs("sender-a", "sender-b", "sender-missing").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("sender-a", "senderA", "hash-a", "Sender A", "").
			AddRow("sender-b", "senderB", "hash-b", "Sender B", ""))

	svc := NewService(db, nil, nil)
	requests, err := svc.ListFriendRequests(context.Background(), "user-1")
	require.NoError(t, err)
	require.Len(t, requests, 2)
	assert.Equal(t, "req-1", requests[0].RequestID)
	assert.Equal(t, "req-2", requests[1].RequestID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func captureServiceEvents(b *bus.Bus, eventType string) <-chan bus.Event {
	events := make(chan bus.Event, 1)
	b.Subscribe(eventType, func(ctx context.Context, event bus.Event) {
		events <- event
	})
	return events
}

func waitForServiceEventPayload(t *testing.T, events <-chan bus.Event) map[string]interface{} {
	t.Helper()
	select {
	case event := <-events:
		payload, ok := event.Payload.(map[string]interface{})
		require.True(t, ok, "event payload should be a map")
		return payload
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for service event")
		return nil
	}
}
