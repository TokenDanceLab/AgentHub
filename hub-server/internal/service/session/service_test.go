package session

import (
	"context"
	"database/sql"
	"regexp"
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
)

func newTestBus(t *testing.T) *bus.Bus {
	t.Helper()
	b, err := bus.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b.Close(context.Background()) })
	return b
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
		if !ok {
			t.Fatalf("event payload should be a map, got %T", event.Payload)
		}
		return payload
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for service event")
		return nil
	}
}

// mockSessionCache implements Cache for testing.
type mockSessionCache struct {
	invalidated []string
	initSeq     map[string]int64
}

func (m *mockSessionCache) Invalidate(ctx context.Context, keys ...string) error {
	m.invalidated = append(m.invalidated, keys...)
	return nil
}

func (m *mockSessionCache) InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error {
	if m.initSeq == nil {
		m.initSeq = make(map[string]int64)
	}
	m.initSeq[sessionID] = seq
	return nil
}

// recordingSessionBus is a Bus test double that records Publish calls.
type recordingSessionBus struct {
	events []bus.Event
}

func (b *recordingSessionBus) Publish(ctx context.Context, event bus.Event) error {
	b.events = append(b.events, event)
	return nil
}

func TestService_NilBusPublishIsNoop(t *testing.T) {
	svc := &Service{db: nil, bus: nil, cacheClient: &mockSessionCache{}}
	// Must not panic when b port is unset (read-only/partial construction).
	svc.publishEvent(context.Background(), "session.created", map[string]interface{}{"k": "v"})
}

func TestService_SetBusAndSetCachePorts(t *testing.T) {
	rec := &recordingSessionBus{}
	cachePort := &mockSessionCache{}
	svc := NewService(nil, nil)
	require.NotNil(t, svc)

	svc.SetBus(rec)
	svc.SetCache(cachePort)
	svc.publishEvent(context.Background(), "session.dissolved", map[string]interface{}{"session_id": "s1"})
	require.NoError(t, resolveCache(svc.cacheClient).Invalidate(context.Background(), "session:members:s1"))
	require.NoError(t, resolveCache(svc.cacheClient).InitSeqIfAbsent(context.Background(), "s1", 0))

	require.Len(t, rec.events, 1)
	assert.Equal(t, "session.dissolved", rec.events[0].Type)
	assert.Contains(t, cachePort.invalidated, "session:members:s1")
	assert.Equal(t, int64(0), cachePort.initSeq["s1"])
}

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

	svc := NewService(db, nil)
	_, err := svc.CreatePrivateSession(context.Background(), "user-1", "user-1")
	assert.Error(t, err)
}

func TestCreatePrivateSession_TargetNotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "users" WHERE id = $1 ORDER BY "users"."id" LIMIT $2`)).
		WithArgs("target-99", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewService(db, nil)
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

	// #122: friendship check — both users must be accepted friends.
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "friendships" WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $3 AND friend_id = $4) ORDER BY "friendships"."id" LIMIT $5`)).
		WithArgs("user-1", "target-1", "target-1", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("f1", "user-1", "target-1", "accepted"))

	mock.ExpectQuery(`(?s)SELECT s\.\* FROM sessions.*INNER JOIN session_members sm1`).
		WithArgs("user-1", "target-1", "private").
		WillReturnRows(sqlmock.NewRows([]string{"id", "type"}).
			AddRow("sess-existing", "private"))

	svc := NewService(db, nil)
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

	// #122: friendship check — both users must be accepted friends.
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "friendships" WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $3 AND friend_id = $4) ORDER BY "friendships"."id" LIMIT $5`)).
		WithArgs("user-1", "target-1", "target-1", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("f1", "user-1", "target-1", "accepted"))

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

	svc := NewService(db, testSessionCache(t))
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

	// #122: friendship check — both users must be accepted friends.
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "friendships" WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $3 AND friend_id = $4) ORDER BY "friendships"."id" LIMIT $5`)).
		WithArgs("user-1", "target-1", "target-1", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "friend_id", "status"}).
			AddRow("f1", "user-1", "target-1", "accepted"))

	mock.ExpectQuery(`(?s)SELECT s\.\* FROM sessions.*INNER JOIN session_members sm1`).
		WithArgs("user-1", "target-1", "private").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "sessions"`)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "session_members"`)).
		WillReturnResult(sqlmock.NewResult(2, 2))
	mock.ExpectCommit()

	svc := NewService(db, nil)
	resp, err := svc.CreatePrivateSession(context.Background(), "user-1", "target-1")
	require.NoError(t, err)
	assert.True(t, resp.Created)
	assert.Equal(t, "private", resp.Type)
	assert.NotEmpty(t, resp.SessionID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestCreateGroupSession_AllowsOwnerOnlyWorkspace(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "sessions"`)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "session_members"`)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	svc := NewService(db, testSessionCache(t))
	resp, err := svc.CreateGroupSession(context.Background(), "owner-1", "Workspace", []string{})
	require.NoError(t, err)
	assert.True(t, resp.Created)
	assert.Equal(t, "group", resp.Type)
	assert.NotEmpty(t, resp.SessionID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestCreateGroupSession_PublishesCreatedEvent(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT "friend_id" FROM "friendships" WHERE user_id = $1 AND status = $2`)).
		WithArgs("owner-1", "accepted").
		WillReturnRows(sqlmock.NewRows([]string{"friend_id"}).AddRow("u2"))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "sessions"`)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "session_members"`)).
		WillReturnResult(sqlmock.NewResult(2, 2))
	mock.ExpectCommit()

	b := newTestBus(t)
	events := captureServiceEvents(b, "session.created")
	svc := &Service{db: db, cacheClient: testSessionCache(t), bus: b}
	resp, err := svc.CreateGroupSession(context.Background(), "owner-1", "Workspace", []string{"u2"})
	require.NoError(t, err)

	payload := waitForServiceEventPayload(t, events)
	assert.Equal(t, resp.SessionID, payload["session_id"])
	assert.Equal(t, "group", payload["type"])
	assert.Equal(t, "Workspace", payload["name"])
	assert.Equal(t, "owner-1", payload["owner_id"])
	assert.Equal(t, []string{"owner-1", "u2"}, payload["members"])
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== getSession (tested via DeleteForMe) ====================

func TestDeleteForMe_SessionNotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-99", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewService(db, nil)
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

	svc := NewService(db, nil)
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
		WithArgs("sess-1", "user-1", 100).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	// SoftDeleteMember
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "session_members" SET "left_at"=$1 WHERE session_id = $2 AND member_type = $3 AND member_id = $4 AND left_at IS NULL`)).
		WithArgs(sqlmock.AnyArg(), "sess-1", "user", "user-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := NewService(db, nil)
	err := svc.DeleteForMe(context.Background(), "user-1", "sess-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestDeleteForMe_PublishesMemberLeftEvent(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("sess-1", "group", false, "owner-1"))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "user-1", "member"))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "agent_instances" WHERE`)).
		WithArgs("sess-1", "user-1", 100).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "session_members" SET "left_at"=$1 WHERE session_id = $2 AND member_type = $3 AND member_id = $4 AND left_at IS NULL`)).
		WithArgs(sqlmock.AnyArg(), "sess-1", "user", "user-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	b := newTestBus(t)
	events := captureServiceEvents(b, "session.member_left")
	svc := &Service{db: db, cacheClient: testSessionCache(t), bus: b}
	err := svc.DeleteForMe(context.Background(), "user-1", "sess-1")
	require.NoError(t, err)

	payload := waitForServiceEventPayload(t, events)
	assert.Equal(t, "sess-1", payload["session_id"])
	assert.Equal(t, "user-1", payload["member_id"])
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== UpdateMemberSettings ====================

func TestUpdateMemberSettings_SessionNotFound(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-99", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := NewService(db, nil)
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

	svc := NewService(db, nil)
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

	// GetFriendIDs: owner-1 is friends with u2 (#86 friend-boundary check)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT "friend_id" FROM "friendships" WHERE user_id = $1 AND status = $2`)).
		WithArgs("owner-1", "accepted").
		WillReturnRows(sqlmock.NewRows([]string{"friend_id"}).AddRow("u2"))

	// AreMembersActive returns DB error — must NOT silently pass
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT "member_id" FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id IN ($3) AND left_at IS NULL`)).
		WithArgs("sess-1", "user", "u2").
		WillReturnError(gorm.ErrInvalidDB)

	svc := NewService(db, nil)
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

	svc := NewService(db, nil)
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

	svc := NewService(db, nil)
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

	svc := NewService(db, nil)
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
	svc := NewService(db, nil)
	err := svc.UpdateGroupInfo(context.Background(), "user-2", "sess-1", &name, nil, nil)
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestUpdateGroupInfo_PublishesInfoUpdatedEvent(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("sess-1", "group", false, "owner-1"))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "owner-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "owner-1", "owner"))
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "sessions" SET`)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	name := "New name"
	avatarURL := "https://example.test/avatar.png"
	b := newTestBus(t)
	events := captureServiceEvents(b, "session.info_updated")
	svc := &Service{db: db, cacheClient: testSessionCache(t), bus: b}
	err := svc.UpdateGroupInfo(context.Background(), "owner-1", "sess-1", &name, &avatarURL, nil)
	require.NoError(t, err)

	payload := waitForServiceEventPayload(t, events)
	assert.Equal(t, "sess-1", payload["session_id"])
	assert.Equal(t, map[string]interface{}{"name": name, "avatar_url": avatarURL}, payload["changes"])
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

	// ListActiveMembers (now LIMIT 500): other active members exist
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND left_at IS NULL LIMIT $2`)).
		WithArgs("sess-1", 500).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "owner-1", "owner").
			AddRow("mem-2", "sess-1", "user", "user-2", "member"))

	svc := NewService(db, nil)
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

	// ListAgentInstancesByInviterPage for target user (page 0, size 100).
	// GORM omits OFFSET when offset=0, so only 3 args: session, inviter, limit.
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "agent_instances" WHERE`)).
		WithArgs("sess-1", "u2", 100).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id", "display_name"}).
			AddRow("agent-1", "claude-code", "sess-1", "u2", "Claude"))

	// Per-page batched cleanup (#2102): BatchCancelTasksByAgentInstance
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "pending_agent_tasks" SET`)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// BatchDeleteAgentInstances
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM "agent_instances" WHERE id IN ($1)`)).
		WithArgs("agent-1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	// BatchSoftDeleteMembers for agent
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "session_members" SET "left_at"=$1 WHERE session_id = $2 AND member_type = $3 AND member_id IN ($4) AND left_at IS NULL`)).
		WithArgs(sqlmock.AnyArg(), "sess-1", "agent_instance", "agent-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// Second page: empty, terminates pagination loop.
	// GORM includes OFFSET when offset > 0, so 4 args: session, inviter, limit, offset.
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "agent_instances" WHERE`)).
		WithArgs("sess-1", "u2", 100, 100).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id", "display_name"}))

	// SoftDeleteMember for target user
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "session_members" SET "left_at"=$1 WHERE session_id = $2 AND member_type = $3 AND member_id = $4 AND left_at IS NULL`)).
		WithArgs(sqlmock.AnyArg(), "sess-1", "user", "u2").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := NewService(db, nil)
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

	svc := NewService(db, testSessionCache(t))
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

func TestDissolveGroup_PublishesDissolvedEvent(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("sess-1", "group", false, "owner-1"))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "owner-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "owner-1", "owner"))
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "sessions" SET`)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	b := newTestBus(t)
	events := captureServiceEvents(b, "session.dissolved")
	svc := &Service{db: db, cacheClient: testSessionCache(t), bus: b}
	err := svc.DissolveGroup(context.Background(), "owner-1", "sess-1")
	require.NoError(t, err)

	payload := waitForServiceEventPayload(t, events)
	assert.Equal(t, "sess-1", payload["session_id"])
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestDissolveGroup_CleansUpAgentTasks(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	// getSession: SELECT * FROM "sessions" WHERE id = $1
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("sess-1", "group", false, "owner-1"))

	// requireMember: IsMemberActive for owner-1
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE`)).
		WithArgs("sess-1", "user", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	// requireMember: GetActiveMember for owner-1 (role=owner)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "owner-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "owner-1", "owner"))

	// UpdateSession (mark dissolved): BEGIN + UPDATE + COMMIT
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "sessions" SET`)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// ListActiveMembers (now LIMIT 500): returns owner-1 (human) + u2 (human, has agent)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND left_at IS NULL LIMIT $2`)).
		WithArgs("sess-1", 500).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "owner-1", "owner").
			AddRow("mem-2", "sess-1", "user", "u2", "member"))

	// cleanupInvitedAgents for owner-1: no agents (page 0 empty)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "agent_instances" WHERE`)).
		WithArgs("sess-1", "owner-1", 100).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	// cleanupInvitedAgents for u2: page 0 returns agent-1
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "agent_instances" WHERE`)).
		WithArgs("sess-1", "u2", 100).
		WillReturnRows(sqlmock.NewRows([]string{"id", "agent_type", "session_id", "inviter_user_id", "display_name"}).
			AddRow("agent-1", "claude-code", "sess-1", "u2", "Claude"))

	// Agent cleanup (batched per #2102): BatchCancelTasksByAgentInstance
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "pending_agent_tasks" SET`)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// Agent cleanup (batched): BatchDeleteAgentInstances
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM "agent_instances" WHERE id IN ($1)`)).
		WithArgs("agent-1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	// Agent cleanup (batched): BatchSoftDeleteMembers
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "session_members" SET "left_at"=$1 WHERE session_id = $2 AND member_type = $3 AND member_id IN ($4) AND left_at IS NULL`)).
		WithArgs(sqlmock.AnyArg(), "sess-1", "agent_instance", "agent-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// cleanupInvitedAgents for u2: page 1 empty
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "agent_instances" WHERE`)).
		WithArgs("sess-1", "u2", 100, 100).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	b := newTestBus(t)
	events := captureServiceEvents(b, "session.dissolved")
	svc := &Service{db: db, cacheClient: testSessionCache(t), bus: b}
	err := svc.DissolveGroup(context.Background(), "owner-1", "sess-1")
	require.NoError(t, err)

	payload := waitForServiceEventPayload(t, events)
	assert.Equal(t, "sess-1", payload["session_id"])
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAddGroupMembers_DeduplicateIDs(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	// getSession: SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("sess-1", "group", false, "user-1"))

	// requireMember: IsMemberActive for user-1
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL`)).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	// requireMember: GetActiveMember
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "user-1", "owner"))

	// GetFriendIDs: user-1 is friends with user-2 and user-3 (#86 friend-boundary check)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT "friend_id" FROM "friendships" WHERE user_id = $1 AND status = $2`)).
		WithArgs("user-1", "accepted").
		WillReturnRows(sqlmock.NewRows([]string{"friend_id"}).AddRow("user-2").AddRow("user-3"))

	// Input has [user-2, user-2, user-3] - deduplicated to [user-2, user-3].
	// After dedup, batch AreMembersActive + AreMembersSoftDeleted (2 queries, not 4+).

	// AreMembersActive for [user-2, user-3]: none active
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT "member_id" FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id IN ($3,$4) AND left_at IS NULL`)).
		WithArgs("sess-1", "user", "user-2", "user-3").
		WillReturnRows(sqlmock.NewRows([]string{"member_id"}))

	// AreMembersSoftDeleted for [user-2, user-3]: none soft deleted
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT "member_id" FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id IN ($3,$4) AND left_at IS NOT NULL`)).
		WithArgs("sess-1", "user", "user-2", "user-3").
		WillReturnRows(sqlmock.NewRows([]string{"member_id"}))

	// BatchCreateMembers for [user-2, user-3]
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "session_members" ("id","session_id","member_type","member_id","role","pinned","archived","muted","last_read_seq","joined_at","left_at") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11),($12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`)).
		WillReturnResult(sqlmock.NewResult(2, 2))
	mock.ExpectCommit()

	svc := NewService(db, testSessionCache(t))
	err := svc.AddGroupMembers(context.Background(), "user-1", "sess-1", []string{"user-2", "user-2", "user-3"})
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAddGroupMembers_PublishesMemberJoinedEvents(t *testing.T) {
	db, mock, sqlDB := newMockDBSession(t)
	defer sqlDB.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "sessions" WHERE id = $1 ORDER BY "sessions"."id" LIMIT $2`)).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved", "owner_user_id"}).
			AddRow("sess-1", "group", false, "owner-1"))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT count(*) FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL`)).
		WithArgs("sess-1", "user", "owner-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id = $3 AND left_at IS NULL ORDER BY "session_members"."id" LIMIT $4`)).
		WithArgs("sess-1", "user", "owner-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "owner-1", "owner"))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT "friend_id" FROM "friendships" WHERE user_id = $1 AND status = $2`)).
		WithArgs("owner-1", "accepted").
		WillReturnRows(sqlmock.NewRows([]string{"friend_id"}).AddRow("u2"))
	// AreMembersActive for [u2]: not active
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT "member_id" FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id IN ($3) AND left_at IS NULL`)).
		WithArgs("sess-1", "user", "u2").
		WillReturnRows(sqlmock.NewRows([]string{"member_id"}))
	// AreMembersSoftDeleted for [u2]: not soft deleted
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT "member_id" FROM "session_members" WHERE session_id = $1 AND member_type = $2 AND member_id IN ($3) AND left_at IS NOT NULL`)).
		WithArgs("sess-1", "user", "u2").
		WillReturnRows(sqlmock.NewRows([]string{"member_id"}))
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "session_members"`)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	b := newTestBus(t)
	events := captureServiceEvents(b, "session.member_joined")
	svc := &Service{db: db, cacheClient: testSessionCache(t), bus: b}
	err := svc.AddGroupMembers(context.Background(), "owner-1", "sess-1", []string{"u2"})
	require.NoError(t, err)

	payload := waitForServiceEventPayload(t, events)
	assert.Equal(t, "sess-1", payload["session_id"])
	assert.Equal(t, "u2", payload["member_id"])
	assert.Equal(t, "user", payload["member_type"])
	assert.NoError(t, mock.ExpectationsWereMet())
}
