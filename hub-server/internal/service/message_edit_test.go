package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
)

func TestEditMessage_SuccessUpdatesContentAndPublishesEvent(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	bus := newTestBus(t)
	seedMessageSessionMember(t, db, "sess-edit", "user-1")
	require.NoError(t, db.Exec(`INSERT INTO messages (
		id, session_id, seq_id, client_msg_id, sender_type, sender_id, content_type, content, recalled, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"msg-edit", "sess-edit", 1, "client-edit", "user", "user-1", "text", `{"text":"original"}`, false, time.Now(),
	).Error)

	seen := make(chan Event, 1)
	bus.Subscribe("message.edited", func(ctx context.Context, event Event) {
		seen <- event
	})

	svc := &MessageService{db: db, bus: bus}
	resp, err := svc.EditMessage(context.Background(), "msg-edit", "user-1", EditMessageRequest{
		ContentType: "text",
		Content:     "edited text",
	})
	require.NoError(t, err)
	assert.Equal(t, "msg-edit", resp.MessageID)
	assert.NotEmpty(t, resp.EditedAt)

	var stored struct {
		Content string
		Edited  bool
	}
	require.NoError(t, db.Table("messages").Select("content, edited").Where("id = ?", "msg-edit").Scan(&stored).Error)
	assert.JSONEq(t, `{"text":"edited text"}`, stored.Content)
	assert.True(t, stored.Edited)

	select {
	case event := <-seen:
		assert.Equal(t, "message.edited", event.Type)
	case <-time.After(time.Second):
		t.Fatal("message.edited event was not published")
	}
}

func TestEditMessage_RejectsNonSender(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	bus := newTestBus(t)
	seedMessageSessionMember(t, db, "sess-edit", "user-1")
	require.NoError(t, db.Exec(`INSERT INTO session_members (id, session_id, member_type, member_id, role) VALUES (?, ?, 'user', ?, 'member')`,
		"mem-sess-edit-user-2", "sess-edit", "user-2").Error)
	require.NoError(t, db.Exec(`INSERT INTO messages (
		id, session_id, seq_id, client_msg_id, sender_type, sender_id, content_type, content, recalled, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"msg-edit", "sess-edit", 1, "client-edit", "user", "user-1", "text", `{"text":"original"}`, false, time.Now(),
	).Error)

	svc := &MessageService{db: db, bus: bus}
	_, err := svc.EditMessage(context.Background(), "msg-edit", "user-2", EditMessageRequest{
		ContentType: "text",
		Content:     "not allowed",
	})
	require.ErrorIs(t, err, errcode.SessionNotMember)
}

func TestEditMessage_RejectsRecalledMessage(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	bus := newTestBus(t)
	seedMessageSessionMember(t, db, "sess-edit", "user-1")
	require.NoError(t, db.Exec(`INSERT INTO messages (
		id, session_id, seq_id, client_msg_id, sender_type, sender_id, content_type, content, recalled, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"msg-edit", "sess-edit", 1, "client-edit", "user", "user-1", "text", `{"text":"original"}`, true, time.Now(),
	).Error)

	svc := &MessageService{db: db, bus: bus}
	_, err := svc.EditMessage(context.Background(), "msg-edit", "user-1", EditMessageRequest{
		ContentType: "text",
		Content:     "not allowed",
	})
	require.ErrorIs(t, err, errcode.MsgNotEditable)
}

func TestEditMessage_RejectsAgentMessage(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	bus := newTestBus(t)
	seedMessageSessionMember(t, db, "sess-edit", "user-1")
	require.NoError(t, db.Exec(`INSERT INTO messages (
		id, session_id, seq_id, client_msg_id, sender_type, sender_id, content_type, content, recalled, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"msg-edit", "sess-edit", 1, "client-edit", "agent", "user-1", "text", `{"text":"agent"}`, false, time.Now(),
	).Error)

	svc := &MessageService{db: db, bus: bus}
	_, err := svc.EditMessage(context.Background(), "msg-edit", "user-1", EditMessageRequest{
		ContentType: "text",
		Content:     "not allowed",
	})
	require.ErrorIs(t, err, errcode.MsgNotEditable)
}

func TestEditMessage_RejectsExpiredWindow(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	bus := newTestBus(t)
	seedMessageSessionMember(t, db, "sess-edit", "user-1")
	require.NoError(t, db.Exec(`INSERT INTO messages (
		id, session_id, seq_id, client_msg_id, sender_type, sender_id, content_type, content, recalled, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"msg-edit", "sess-edit", 1, "client-edit", "user", "user-1", "text", `{"text":"old"}`, false, time.Now().Add(-time.Hour),
	).Error)

	svc := &MessageService{db: db, bus: bus}
	_, err := svc.EditMessage(context.Background(), "msg-edit", "user-1", EditMessageRequest{
		ContentType: "text",
		Content:     "too late",
	})
	require.ErrorIs(t, err, errcode.MsgEditTimeout)
}

func TestEditMessage_RejectsInvalidContent(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	bus := newTestBus(t)
	seedMessageSessionMember(t, db, "sess-edit", "user-1")
	require.NoError(t, db.Exec(`INSERT INTO messages (
		id, session_id, seq_id, client_msg_id, sender_type, sender_id, content_type, content, recalled, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"msg-edit", "sess-edit", 1, "client-edit", "user", "user-1", "text", `{"text":"original"}`, false, time.Now(),
	).Error)

	svc := &MessageService{db: db, bus: bus}
	_, err := svc.EditMessage(context.Background(), "msg-edit", "user-1", EditMessageRequest{
		ContentType: "file",
		Content:     `{"name":"missing attachment id"}`,
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
}

func TestEditMessage_NotFound(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	bus := newTestBus(t)

	svc := &MessageService{db: db, bus: bus}
	_, err := svc.EditMessage(context.Background(), "missing", "user-1", EditMessageRequest{
		ContentType: "text",
		Content:     "ignored",
	})
	require.ErrorIs(t, err, errcode.MsgNotFound)
}
