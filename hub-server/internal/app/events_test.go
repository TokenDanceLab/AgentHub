package app

import (
	"context"
	"encoding/json"
	"regexp"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/service/contact"
	"github.com/agenthub/hub-server/internal/service/session"
	"github.com/agenthub/hub-server/internal/ws"
)

// newTypingTestApp wires the minimal App surface handleTypingFrame needs:
// sqlmock-backed session service, miniredis cache, and the real
// setupWSManager member-resolution closure.
func newTypingTestApp(t *testing.T) (*App, sqlmock.Sqlmock, *miniredis.Miniredis, *atomic.Int64) {
	t.Helper()

	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })

	gormDB, err := gorm.Open(postgres.New(postgres.Config{
		Conn:                 sqlDB,
		PreferSimpleProtocol: true,
	}), &gorm.Config{
		DisableAutomaticPing: true,
		Logger:               gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)

	// Count every executed query so the test can prove the typing callback
	// stops hitting the DB after the member cache is warm.
	var queryCount atomic.Int64
	require.NoError(t, gormDB.Callback().Query().Before("*").Register(
		"test:count_typing_queries",
		func(tx *gorm.DB) { queryCount.Add(1) },
	))

	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	cacheClient := cache.NewClient(rdb)

	a := &App{
		Config:         &config.Config{},
		CacheClient:    cacheClient,
		SessionService: session.NewService(gormDB, cacheClient),
		bg:             newBackgroundGroup(context.Background()),
	}
	a.setupWSManager()
	// The typing tests only need member resolution + fanout; detach the
	// route lifecycle hooks so Register does not trigger online-status
	// broadcasts (which would need the full contact/notification stack).
	a.mgr.OnRouteSet = nil
	a.mgr.OnRouteDel = nil
	return a, mock, mr, &queryCount
}

func expectActiveMembers(mock sqlmock.Sqlmock, sessionID string, memberIDs ...string) {
	rows := sqlmock.NewRows([]string{
		"id", "session_id", "member_type", "member_id", "role",
		"pinned", "archived", "muted", "last_read_seq", "joined_at", "left_at",
	})
	now := time.Now()
	for i, memberID := range memberIDs {
		rows.AddRow(
			"member-id-"+memberID, sessionID, "user", memberID, "member",
			false, false, false, 0, now, nil,
		)
		_ = i
	}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT")).WillReturnRows(rows)
}

func registerTestConn(t *testing.T, mgr *ws.Manager, userID, deviceID string) *ws.Conn {
	t.Helper()
	conn := &ws.Conn{Send: make(chan []byte, 8)}
	require.NoError(t, mgr.Register(conn))
	mgr.SetAuth(conn.ID, userID, "desktop", deviceID)
	return conn
}

func readFrameType(t *testing.T, conn *ws.Conn) string {
	t.Helper()
	select {
	case raw := <-conn.Send:
		var f ws.Frame
		require.NoError(t, json.Unmarshal(raw, &f))
		return f.Type
	case <-time.After(time.Second):
		t.Fatal("expected a pushed frame, got none")
		return ""
	}
}

// TestHandleTypingFrameUsesCachedMemberResolution proves the #2154 fix:
// sustained typing frames resolve session members through the shared
// cache.GetOrLoad path instead of one ListActiveMembers DB query per frame.
func TestHandleTypingFrameUsesCachedMemberResolution(t *testing.T) {
	a, mock, mr, queryCount := newTypingTestApp(t)

	const sessionID = "sess-typing-cache"
	expectActiveMembers(mock, sessionID, "user-sender", "user-peer-1", "user-peer-2")

	sender := registerTestConn(t, a.mgr, "user-sender", "dev-sender")
	peer1 := registerTestConn(t, a.mgr, "user-peer-1", "dev-peer-1")
	peer2 := registerTestConn(t, a.mgr, "user-peer-2", "dev-peer-2")

	const cacheKey = "session:members:" + sessionID
	require.False(t, mr.Exists(cacheKey), "member cache must start cold")

	// First frame: cold cache → exactly one DB query, then cached.
	a.handleTypingFrame("user-sender", sessionID)
	require.EqualValues(t, 1, queryCount.Load(), "cold cache must load members once")
	require.True(t, mr.Exists(cacheKey), "member list must be cached after first frame")

	require.Equal(t, ws.TypeTyping, readFrameType(t, peer1))
	require.Equal(t, ws.TypeTyping, readFrameType(t, peer2))
	require.Empty(t, sender.Send, "sender must not receive its own typing frame")

	// Sustained typing: N more frames must not add a single DB query.
	for i := 0; i < 5; i++ {
		a.handleTypingFrame("user-sender", sessionID)
	}
	require.EqualValues(t, 1, queryCount.Load(), "warm cache must serve all follow-up frames")
	require.Equal(t, ws.TypeTyping, readFrameType(t, peer1))
	require.Equal(t, ws.TypeTyping, readFrameType(t, peer2))

	require.NoError(t, mock.ExpectationsWereMet())
}

// TestHandleTypingFrameRejectsNonMember keeps the pre-fix admission rule:
// only session members may broadcast typing frames.
func TestHandleTypingFrameRejectsNonMember(t *testing.T) {
	a, mock, _, queryCount := newTypingTestApp(t)

	const sessionID = "sess-typing-admission"
	expectActiveMembers(mock, sessionID, "user-member")

	member := registerTestConn(t, a.mgr, "user-member", "dev-member")
	outsider := registerTestConn(t, a.mgr, "user-outsider", "dev-outsider")

	a.handleTypingFrame("user-outsider", sessionID)

	require.Empty(t, member.Send, "outsider typing frame must not fan out")
	require.Empty(t, outsider.Send, "outsider must not receive its own frame")
	require.EqualValues(t, 1, queryCount.Load(), "admission check resolves members once")
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestBroadcastOnlineStatusUsesBatchedPresence proves the online/offline
// fanout resolves friend presence with one pipelined AreOnline call instead
// of one IsOnline round trip per friend (#2154 perf lane).
func TestBroadcastOnlineStatusUsesBatchedPresence(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })

	gormDB, err := gorm.Open(postgres.New(postgres.Config{
		Conn:                 sqlDB,
		PreferSimpleProtocol: true,
	}), &gorm.Config{
		DisableAutomaticPing: true,
		Logger:               gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)

	rows := sqlmock.NewRows([]string{"friend_id"}).
		AddRow("friend-online").
		AddRow("friend-offline")
	mock.ExpectQuery(`FROM "friendships"`).WillReturnRows(rows)

	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	cacheClient := cache.NewClient(rdb)

	ctx := context.Background()
	require.NoError(t, cacheClient.SetRoute(ctx, "friend-online", "desktop", "conn-x"))

	mgr := ws.NewManager()
	onlinePeer := &ws.Conn{Send: make(chan []byte, 4)}
	require.NoError(t, mgr.Register(onlinePeer))
	mgr.SetAuth(onlinePeer.ID, "friend-online", "desktop", "dev-on")
	offlinePeer := &ws.Conn{Send: make(chan []byte, 4)}
	require.NoError(t, mgr.Register(offlinePeer))
	mgr.SetAuth(offlinePeer.ID, "friend-offline", "desktop", "dev-off")

	a := &App{
		CacheClient:    cacheClient,
		ContactService: contact.NewService(gormDB, nil, cacheClient),
		mgr:            mgr,
	}
	a.broadcastOnlineStatus(ctx, "user-1", true)

	select {
	case raw := <-onlinePeer.Send:
		var f ws.Frame
		require.NoError(t, json.Unmarshal(raw, &f))
		require.Equal(t, ws.TypeDeviceOnline, f.Type)
	case <-time.After(time.Second):
		t.Fatal("expected the online friend to receive the presence frame")
	}
	require.Empty(t, offlinePeer.Send, "offline friend must not receive the presence frame")
	require.NoError(t, mock.ExpectationsWereMet())
}
