package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
)

func TestMessageReactionService_AddReactionReturnsSummaryAndPublishesEvent(t *testing.T) {
	db := newMessageReactionTestDB(t)
	seedMessageReactionSession(t, db, "sess-react", "user-1", "user-2")
	seedMessageReactionMessage(t, db, "sess-react", "msg-react")

	bus := newTestBus(t)
	eventCh := make(chan Event, 1)
	bus.Subscribe("message.reaction_added", func(ctx context.Context, event Event) {
		eventCh <- event
	})
	svc := &MessageReactionService{db: db, bus: bus}

	resp, err := svc.AddMessageReaction(context.Background(), "user-1", "sess-react", "msg-react", " heart ")
	require.NoError(t, err)
	assert.Equal(t, "msg-react", resp.MessageID)
	assert.Equal(t, "sess-react", resp.SessionID)
	assert.Equal(t, "heart", resp.Reaction)
	assert.Equal(t, 1, resp.Count)
	assert.True(t, resp.ReactedByMe)

	resp, err = svc.AddMessageReaction(context.Background(), "user-1", "sess-react", "msg-react", "heart")
	require.NoError(t, err)
	assert.Equal(t, 1, resp.Count)
	assert.True(t, resp.ReactedByMe)

	select {
	case event := <-eventCh:
		payload, ok := event.Payload.(MessageReactionEventPayload)
		require.True(t, ok)
		assert.Equal(t, "added", payload.Action)
		assert.Equal(t, "user-1", payload.UserID)
		assert.Equal(t, "heart", payload.Reaction)
	case <-time.After(time.Second):
		t.Fatal("expected message reaction event")
	}
}

func TestMessageReactionService_RemoveReactionIsIdempotent(t *testing.T) {
	db := newMessageReactionTestDB(t)
	seedMessageReactionSession(t, db, "sess-remove", "user-1", "user-2")
	seedMessageReactionMessage(t, db, "sess-remove", "msg-remove")

	svc := &MessageReactionService{db: db, bus: newTestBus(t)}

	_, err := svc.AddMessageReaction(context.Background(), "user-1", "sess-remove", "msg-remove", "thumbs_up")
	require.NoError(t, err)
	_, err = svc.AddMessageReaction(context.Background(), "user-2", "sess-remove", "msg-remove", "thumbs_up")
	require.NoError(t, err)

	resp, err := svc.RemoveMessageReaction(context.Background(), "user-1", "sess-remove", "msg-remove", "thumbs_up")
	require.NoError(t, err)
	assert.Equal(t, "msg-remove", resp.MessageID)
	assert.Equal(t, "sess-remove", resp.SessionID)
	assert.Equal(t, "thumbs_up", resp.Reaction)
	assert.Equal(t, 1, resp.Count)
	assert.False(t, resp.ReactedByMe)

	resp, err = svc.RemoveMessageReaction(context.Background(), "user-1", "sess-remove", "msg-remove", "thumbs_up")
	require.NoError(t, err)
	assert.Equal(t, 1, resp.Count)
	assert.False(t, resp.ReactedByMe)
}

func TestMessageReactionService_RejectsInvalidReaction(t *testing.T) {
	db := newMessageReactionTestDB(t)
	seedMessageReactionSession(t, db, "sess-invalid", "user-1")
	seedMessageReactionMessage(t, db, "sess-invalid", "msg-invalid")

	svc := &MessageReactionService{db: db}

	_, err := svc.AddMessageReaction(context.Background(), "user-1", "sess-invalid", "msg-invalid", "   ")
	require.ErrorIs(t, err, errcode.ErrBadRequest)

	_, err = svc.AddMessageReaction(context.Background(), "user-1", "sess-invalid", "msg-invalid", strings.Repeat("x", 65))
	require.ErrorIs(t, err, errcode.ErrBadRequest)
}

func TestMessageReactionService_RequiresSessionMembership(t *testing.T) {
	db := newMessageReactionTestDB(t)
	seedMessageReactionSession(t, db, "sess-member", "user-1")
	seedMessageReactionMessage(t, db, "sess-member", "msg-member")

	svc := &MessageReactionService{db: db}

	_, err := svc.AddMessageReaction(context.Background(), "user-2", "sess-member", "msg-member", "heart")
	require.ErrorIs(t, err, errcode.SessionNotMember)
}

func TestMessageReactionService_RejectsMessageOutsideSession(t *testing.T) {
	db := newMessageReactionTestDB(t)
	seedMessageReactionSession(t, db, "sess-a", "user-1")
	seedMessageReactionSession(t, db, "sess-b", "user-1")
	seedMessageReactionMessage(t, db, "sess-b", "msg-other")

	svc := &MessageReactionService{db: db}

	_, err := svc.AddMessageReaction(context.Background(), "user-1", "sess-a", "msg-other", "heart")
	require.ErrorIs(t, err, errcode.MsgNotFound)
}

func newMessageReactionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)

	ddl := []string{
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			next_seq INTEGER NOT NULL DEFAULT 0,
			dissolved BOOLEAN NOT NULL DEFAULT FALSE,
			created_at DATETIME
		)`,
		`CREATE TABLE session_members (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			member_type TEXT NOT NULL,
			member_id TEXT NOT NULL,
			role TEXT NOT NULL,
			left_at DATETIME
		)`,
		`CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			seq_id INTEGER NOT NULL,
			client_msg_id TEXT NOT NULL,
			sender_type TEXT NOT NULL,
			sender_id TEXT NOT NULL,
			content_type TEXT NOT NULL,
			content TEXT NOT NULL,
			recalled BOOLEAN NOT NULL DEFAULT FALSE,
			created_at DATETIME
		)`,
		`CREATE TABLE message_reactions (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			message_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			reaction TEXT NOT NULL,
			created_at DATETIME,
			UNIQUE (session_id, message_id, user_id, reaction)
		)`,
	}

	for _, stmt := range ddl {
		require.NoError(t, db.Exec(stmt).Error)
	}
	return db
}

func seedMessageReactionSession(t *testing.T, db *gorm.DB, sessionID string, userIDs ...string) {
	t.Helper()
	require.NoError(t, db.Exec(`INSERT INTO sessions (id, type, next_seq, dissolved) VALUES (?, 'group', 0, 0)`, sessionID).Error)
	for _, userID := range userIDs {
		require.NoError(t, db.Exec(
			`INSERT INTO session_members (id, session_id, member_type, member_id, role) VALUES (?, ?, 'user', ?, 'member')`,
			"mem-"+sessionID+"-"+userID, sessionID, userID,
		).Error)
	}
}

func seedMessageReactionMessage(t *testing.T, db *gorm.DB, sessionID, messageID string) {
	t.Helper()
	require.NoError(t, db.Exec(`INSERT INTO messages (
		id, session_id, seq_id, client_msg_id, sender_type, sender_id, content_type, content, recalled, created_at
	) VALUES (?, ?, 1, ?, 'user', 'sender-1', 'text', '{"text":"hello"}', 0, ?)`,
		messageID, sessionID, "client-"+messageID, time.Now(),
	).Error)
}
