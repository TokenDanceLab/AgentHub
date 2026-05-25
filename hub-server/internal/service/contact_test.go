package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// SQL substrings used for matching (QueryMatcherFunc with strings.Contains)
const (
	sqlcUserByID          = `FROM "users" WHERE id =`
	sqlcUsersByIDs        = `FROM "users" WHERE id IN`
	sqlcFriendshipBetween = `FROM "friendships" WHERE (user_id`
	sqlcFriendshipByID    = `FROM "friendships" WHERE id =`
	sqlcFriendshipByUF    = `FROM "friendships" WHERE user_id = $1 AND friend_id = $2`
	sqlcFriendshipsByUser = `FROM "friendships" WHERE user_id = $1 AND status = $2`
	sqlcPendingReqs       = `FROM "friendships" WHERE friend_id = $1 AND status = $2`
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

	svc := NewContactService(db, nil, nil)
	_, err := svc.SearchUser(context.Background(), "user-1", "user-1")
	assert.ErrorIs(t, err, errcode.UserInvalidParam)
}

func TestSearchUser_NotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("target-99", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewContactService(db, nil, nil)
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

	svc := NewContactService(db, nil, nil)
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

	svc := NewContactService(db, nil, nil)
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

	svc := NewContactService(db, nil, nil)
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

	svc := NewContactService(db, nil, nil)
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

	svc := NewContactService(db, nil, nil)
	_, err := svc.SearchUser(context.Background(), "user-1", "target-1")
	assert.ErrorIs(t, err, errcode.FriendBlocked)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== SendFriendRequest ====================

func TestSendFriendRequest_SelfRequest(t *testing.T) {
	db, _, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	svc := NewContactService(db, nil, nil)
	err := svc.SendFriendRequest(context.Background(), "user-1", "user-1", "please add me")
	assert.ErrorIs(t, err, errcode.UserInvalidParam)
}

func TestSendFriendRequest_TargetNotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("nonexistent", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewContactService(db, nil, nil)
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

	svc := NewContactService(db, nil, nil)
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

	svc := NewContactService(db, nil, nil)
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

	svc := NewContactService(db, nil, nil)
	err := svc.SendFriendRequest(context.Background(), "user-1", "target-1", "please add me")
	assert.NoError(t, err)
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

	svc := NewContactService(db, nil, nil)
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

	svc := NewContactService(db, nil, testCacheClient(t))
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

	svc := NewContactService(db, nil, testCacheClient(t))
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

	svc := NewContactService(db, nil, testCacheClient(t))
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

	svc := NewContactService(db, nil, testCacheClient(t))
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

	svc := NewContactService(db, nil, testCacheClient(t))
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

	svc := NewContactService(db, nil, testCacheClient(t))
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

	svc := NewContactService(db, nil, testCacheClient(t))
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

	svc := NewContactService(db, nil, testCacheClient(t))
	err := svc.RemoveContact(context.Background(), "user-1", "friend-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== BlockContact ====================

func TestBlockContact_SelfBlock(t *testing.T) {
	db, _, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	svc := NewContactService(db, nil, nil)
	err := svc.BlockContact(context.Background(), "user-1", "user-1")
	assert.ErrorIs(t, err, errcode.UserInvalidParam)
}

func TestBlockContact_TargetNotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcUserByID).
		WithArgs("nonexistent", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewContactService(db, nil, testCacheClient(t))
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

	// Explicit transaction: DELETE + INSERT
	mock.ExpectBegin()
	mock.ExpectExec(sqlcDeleteFriend).
		WithArgs("user-1", "target-1", "target-1", "user-1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(sqlcInsertFriend).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	svc := NewContactService(db, nil, testCacheClient(t))
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

	svc := NewContactService(db, nil, testCacheClient(t))
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

	svc := NewContactService(db, nil, testCacheClient(t))
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

	svc := NewContactService(db, nil, testCacheClient(t))
	err := svc.UnblockContact(context.Background(), "user-1", "target-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== ListContacts ====================

func TestListContacts_Empty(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipsByUser).
		WithArgs("user-1", model.StatusAccepted).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status", "remark"}))

	svc := NewContactService(db, nil, testCacheClient(t))
	contacts, err := svc.ListContacts(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Empty(t, contacts)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestListContacts_WithFriends(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipsByUser).
		WithArgs("user-1", model.StatusAccepted).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status", "remark"}).
			AddRow("f-1", "user-1", "friend-a", model.StatusAccepted, "Buddy").
			AddRow("f-2", "user-1", "friend-b", model.StatusAccepted, ""))

	mock.ExpectQuery(sqlcUsersByIDs).
		WithArgs("friend-a", "friend-b").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("friend-a", "friendA", "hash1", "Friend A", "").
			AddRow("friend-b", "friendB", "hash2", "Friend B", "https://img.url"))

	svc := NewContactService(db, nil, testCacheClient(t))
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

func TestListContacts_BatchesFriendUserLookup(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcFriendshipsByUser).
		WithArgs("user-1", model.StatusAccepted).
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

	svc := NewContactService(db, nil, testCacheClient(t))
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

	svc := NewContactService(db, nil, nil)
	err := svc.UpdateRemark(context.Background(), "user-1", "friend-1", "Best Friend")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== ListFriendRequests ====================

func TestListFriendRequests_Empty(t *testing.T) {
	db, mock, sqlDB := newMockDBContact(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlcPendingReqs).
		WithArgs("user-1", model.StatusPending).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status", "request_message", "created_at"}))

	svc := NewContactService(db, nil, nil)
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
		WithArgs("user-1", model.StatusPending).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status", "request_message", "created_at"}).
			AddRow("req-1", "sender-a", "user-1", model.StatusPending, "Hi, let's connect!", now))

	mock.ExpectQuery(sqlcUsersByIDs).
		WithArgs("sender-a").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("sender-a", "senderA", "hash", "Sender A", "https://avatar.com/a.png"))

	svc := NewContactService(db, nil, nil)
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
		WithArgs("user-1", model.StatusPending).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status", "request_message", "created_at"}).
			AddRow("req-1", "sender-a", "user-1", model.StatusPending, "first", now).
			AddRow("req-2", "sender-b", "user-1", model.StatusPending, "second", now).
			AddRow("req-3", "sender-missing", "user-1", model.StatusPending, "missing", now))

	mock.ExpectQuery(sqlcUsersByIDs).
		WithArgs("sender-a", "sender-b", "sender-missing").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname", "avatar_url"}).
			AddRow("sender-a", "senderA", "hash-a", "Sender A", "").
			AddRow("sender-b", "senderB", "hash-b", "Sender B", ""))

	svc := NewContactService(db, nil, nil)
	requests, err := svc.ListFriendRequests(context.Background(), "user-1")
	require.NoError(t, err)
	require.Len(t, requests, 2)
	assert.Equal(t, "req-1", requests[0].RequestID)
	assert.Equal(t, "req-2", requests[1].RequestID)
	assert.NoError(t, mock.ExpectationsWereMet())
}
