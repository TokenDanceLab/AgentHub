package service

import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
)

func newMockDBSession(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, *sql.DB) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		SkipDefaultTransaction: false,
		PrepareStmt:            false,
	})
	require.NoError(t, err)
	return gormDB, mock, sqlDB
}

func testSessionCache(t *testing.T) *cache.Client {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return cache.NewClient(rdb)
}

// ==================== CreatePrivateSession ====================

func TestCreatePrivateSession_SelfRequest(t *testing.T) {
	db, _, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	svc := NewSessionService(db, nil)
	_, err := svc.CreatePrivateSession(context.Background(), "user-1", "user-1")
	assert.Error(t, err)
}

func TestCreatePrivateSession_TargetNotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "users" WHERE id = $1 ORDER BY "users"."id" LIMIT $2`)).
		WithArgs("target-99", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewSessionService(db, nil)
	_, err := svc.CreatePrivateSession(context.Background(), "user-1", "target-99")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestCreatePrivateSession_Existing(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "users" WHERE id = $1 ORDER BY "users"."id" LIMIT $2`)).
		WithArgs("target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname"}).
			AddRow("target-1", "target", "hash", "Target"))

	mock.ExpectQuery(`(?s)SELECT s\.\* FROM sessions.*INNER JOIN session_members sm1`).
		WithArgs("user-1", "target-1", "private").
		WillReturnRows(sqlmock.NewRows([]string{"id", "type"}).
			AddRow("sess-existing", "private"))

	svc := NewSessionService(db, nil)
	resp, err := svc.CreatePrivateSession(context.Background(), "user-1", "target-1")
	require.NoError(t, err)
	assert.Equal(t, "sess-existing", resp.SessionID)
	assert.False(t, resp.Created)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestCreatePrivateSession_Success(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	// GetUserByID succeeds
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "users" WHERE id = $1 ORDER BY "users"."id" LIMIT $2`)).
		WithArgs("target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname"}).
			AddRow("target-1", "target", "hash", "Target"))

	// FindPrivateSessionBetween returns empty (no existing session)
	mock.ExpectQuery(`(?s)SELECT s\.\* FROM sessions.*INNER JOIN session_members sm1`).
		WithArgs("user-1", "target-1", "private").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	// Transaction: BEGIN
	mock.ExpectBegin()
	// CreateSession: INSERT INTO sessions (Exec because BeforeCreate sets ID)
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "sessions"`)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	// BatchCreateMembers: INSERT INTO session_members (Exec because BeforeCreate sets ID)
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "session_members"`)).
		WillReturnResult(sqlmock.NewResult(2, 2))
	// Transaction: COMMIT
	mock.ExpectCommit()

	svc := NewSessionService(db, testSessionCache(t))
	resp, err := svc.CreatePrivateSession(context.Background(), "user-1", "target-1")
	require.NoError(t, err)
	assert.True(t, resp.Created)
	assert.Equal(t, "private", resp.Type)
	assert.NotEmpty(t, resp.SessionID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestCreatePrivateSession_NilCacheDoesNotPanic(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "users" WHERE id = $1 ORDER BY "users"."id" LIMIT $2`)).
		WithArgs("target-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "password_hash", "nickname"}).
			AddRow("target-1", "target", "hash", "Target"))

	mock.ExpectQuery(`(?s)SELECT s\.\* FROM sessions.*INNER JOIN session_members sm1`).
		WithArgs("user-1", "target-1", "private").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "sessions"`)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "session_members"`)).
		WillReturnResult(sqlmock.NewResult(2, 2))
	mock.ExpectCommit()

	svc := NewSessionService(db, nil)
	resp, err := svc.CreatePrivateSession(context.Background(), "user-1", "target-1")
	require.NoError(t, err)
	assert.True(t, resp.Created)
	assert.Equal(t, "private", resp.Type)
	assert.NotEmpty(t, resp.SessionID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== getSession (tested via DeleteForMe) ====================

func TestDeleteForMe_SessionNotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-99", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewSessionService(db, nil)
	err := svc.DeleteForMe(context.Background(), "user-1", "sess-99")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestDeleteForMe_NotMember(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	// getSession: session exists and not dissolved
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved"}).
			AddRow("sess-1", "group", false))

	// requireMember: IsMemberActive returns false
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "user-99").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	svc := NewSessionService(db, nil)
	err := svc.DeleteForMe(context.Background(), "user-99", "sess-1")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestDeleteForMe_Success(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	// getSession: session exists
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("sess-1", "group", false, "owner-1"))

	// requireMember: IsMemberActive
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	// requireMember: GetActiveMember — role=member (not owner), so no owner-leave guard check
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "user-1", "member"))

	// #135: ListAgentInstancesByInviter — no agents for this user
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "agent_instances" WHERE`)).
		WithArgs("sess-1", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	// SoftDeleteMember
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "session_members" SET "left_at"=$1 WHERE session_id = $2 AND member_type = $3 AND member_id = $4 AND left_at IS NULL`)).
		WithArgs(sqlmock.AnyArg(), "sess-1", "user", "user-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := NewSessionService(db, nil)
	err := svc.DeleteForMe(context.Background(), "user-1", "sess-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== UpdateMemberSettings ====================

func TestUpdateMemberSettings_SessionNotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-99", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewSessionService(db, nil)
	pinned := true
	err := svc.UpdateMemberSettings(context.Background(), "user-1", "sess-99", &pinned, nil, nil)
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestUpdateMemberSettings_Success(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	// getSession
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved"}).
			AddRow("sess-1", "group", false))

	// requireMember: IsMemberActive
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	// requireMember: GetActiveMember
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "user-1", "member"))

	// UpdateMemberSettings
	pinned := true
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "session_members" SET "pinned"=$1 WHERE session_id = $2 AND member_type = $3 AND member_id = $4 AND left_at IS NULL`)).
		WithArgs(true, "sess-1", "user", "user-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := NewSessionService(db, nil)
	err := svc.UpdateMemberSettings(context.Background(), "user-1", "sess-1", &pinned, nil, nil)
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== B5: #163 fail-closed on repo errors ====================

func TestAddGroupMembers_FailClosedOnIsMemberActiveError(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	// getSession: session exists
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("sess-1", "group", false, "owner-1"))

	// requireMember: IsMemberActive + GetActiveMember
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "owner-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "owner-1", "owner"))

	// IsMemberActive returns DB error — must NOT silently pass
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "u2").
		WillReturnError(gorm.ErrInvalidDB)

	svc := NewSessionService(db, nil)
	err := svc.AddGroupMembers(context.Background(), "owner-1", "sess-1", []string{"u2"})
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRemoveGroupMember_FailClosedOnIsMemberActiveError(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	// getSession: session exists
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("sess-1", "group", false, "owner-1"))

	// requireMember
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "owner-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "owner-1", "owner"))

	// IsMemberActive for target returns DB error — must NOT silently pass
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "u2").
		WillReturnError(gorm.ErrInvalidDB)

	svc := NewSessionService(db, nil)
	err := svc.RemoveGroupMember(context.Background(), "owner-1", "sess-1", "u2")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestTransferGroupOwnership_FailClosedOnIsMemberActiveError(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	// getSession
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("sess-1", "group", false, "owner-1"))

	// requireMember
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "owner-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "owner-1", "owner"))

	// IsMemberActive for newOwner returns DB error — must NOT silently pass
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "u2").
		WillReturnError(gorm.ErrInvalidDB)

	svc := NewSessionService(db, nil)
	err := svc.TransferGroupOwnership(context.Background(), "owner-1", "sess-1", "u2")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== B5: #97 prevent owner from removing themselves ====================

func TestRemoveGroupMember_OwnerCannotRemoveSelf(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	// getSession
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("sess-1", "group", false, "owner-1"))

	// requireMember: owner is active
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "owner-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "owner-1", "owner"))

	svc := NewSessionService(db, nil)
	err := svc.RemoveGroupMember(context.Background(), "owner-1", "sess-1", "owner-1")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== B5: #112 require owner authority for group info updates ====================

func TestUpdateGroupInfo_NonOwnerRejected(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	// getSession
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("sess-1", "group", false, "owner-1"))

	// requireMember returns member with role=member (not owner)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "user-2").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "user-2", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-2", "sess-1", "user", "user-2", "member"))

	name := "Hacked"
	svc := NewSessionService(db, nil)
	err := svc.UpdateGroupInfo(context.Background(), "user-2", "sess-1", &name, nil, nil)
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== B5: #113 owner must transfer/dissolve before DeleteForMe ====================

func TestDeleteForMe_OwnerWithOtherMembersRejected(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	// getSession
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("sess-1", "group", false, "owner-1"))

	// requireMember: owner is active
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "owner-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "owner-1", "owner"))

	// ListActiveMembers: other active members exist
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE`)).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "owner-1", "owner").
			AddRow("mem-2", "sess-1", "user", "user-2", "member"))

	svc := NewSessionService(db, nil)
	err := svc.DeleteForMe(context.Background(), "owner-1", "sess-1")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== B5: #135 clean up agents when member removed ====================

func TestRemoveGroupMember_CleansUpInvitedAgents(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	// getSession
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("sess-1", "group", false, "owner-1"))

	// requireMember: owner is active
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "owner-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "owner-1", "owner"))

	// IsMemberActive for target user
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "u2").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	// ListAgentInstancesByInviter for target user
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "agent_instances" WHERE`)).
		WithArgs("sess-1", "u2").
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id", "display_name"}).
			AddRow("agent-1", "claude-code", "sess-1", "u2", "Claude"))

	// CancelTasksByAgentInstance
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "pending_agent_tasks" SET`)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// DeleteAgentInstance
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM "agent_instances" WHERE id = $1`)).
		WithArgs("agent-1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	// SoftDeleteMember for agent
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "session_members" SET "left_at"=$1 WHERE session_id = $2 AND member_type = $3 AND member_id = $4 AND left_at IS NULL`)).
		WithArgs(sqlmock.AnyArg(), "sess-1", "agent_instance", "agent-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// SoftDeleteMember for target user
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "session_members" SET "left_at"=$1 WHERE session_id = $2 AND member_type = $3 AND member_id = $4 AND left_at IS NULL`)).
		WithArgs(sqlmock.AnyArg(), "sess-1", "user", "u2").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := NewSessionService(db, nil)
	err := svc.RemoveGroupMember(context.Background(), "owner-1", "sess-1", "u2")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== B5: comprehensive lifecycle test ====================

func TestSessionLifecycle_CreateAddDissolveReject(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	// --- CreateGroupSession ---
	// GetFriendIDs
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT "friend_id" FROM "friendships" WHERE user_id = $1 AND status = $2`)).
		WithArgs("owner-1", "accepted").
		WillReturnRows(sqlmock.NewRows([]string{"friend_id"}).AddRow("u2"))

	// Transaction
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "sessions"`)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "session_members"`)).
		WillReturnResult(sqlmock.NewResult(2, 2))
	mock.ExpectCommit()

	svc := NewSessionService(db, testSessionCache(t))
	resp, err := svc.CreateGroupSession(context.Background(), "owner-1", "Test", []string{"u2"})
	require.NoError(t, err)
	assert.True(t, resp.Created)
	sessionID := resp.SessionID

	// --- DissolveGroup ---
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs(sessionID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow(sessionID, "group", false, "owner-1"))

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs(sessionID, "user", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs(sessionID, "user", "owner-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", sessionID, "user", "owner-1", "owner"))

	// UpdateSession (Dissolve)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "sessions" SET`)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err = svc.DissolveGroup(context.Background(), "owner-1", sessionID)
	assert.NoError(t, err)

	// --- getSession should now return SessionDissolved ---
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs(sessionID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow(sessionID, "group", true, "owner-1"))

	_, err = svc.getSession(context.Background(), sessionID)
	assert.Error(t, err)

	assert.NoError(t, mock.ExpectationsWereMet())
}
