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

	mock.ExpectQuery(`(?s)SELECT s\.\* FROM sessions.*INNER JOIN session_members m1`).
		WithArgs("user-1", "target-1").
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
	mock.ExpectQuery(`(?s)SELECT s\.\* FROM sessions.*INNER JOIN session_members m1`).
		WithArgs("user-1", "target-1").
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
