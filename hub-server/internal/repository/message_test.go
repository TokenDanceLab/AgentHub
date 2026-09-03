package repository

import (
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestUpdateMessageContentMarksEditedAndStoresTimestamp(t *testing.T) {
	db := setupSQLite(t)
	require.NoError(t, db.Exec(`INSERT INTO messages (
		id, session_id, seq_id, client_msg_id, sender_type, sender_id, content_type, content, recalled, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"msg-edit", "sess-edit", 1, "client-edit", "user", "user-1", "text", `{"text":"before"}`, false, time.Now(),
	).Error)

	require.NoError(t, UpdateMessageContent(db, "msg-edit", "text", `{"text":"after"}`))

	var stored struct {
		ContentType string
		Content     string
		Edited      bool
		EditedAt    *time.Time
	}
	require.NoError(t, db.Table("messages").Where("id = ?", "msg-edit").First(&stored).Error)
	assert.Equal(t, "text", stored.ContentType)
	assert.JSONEq(t, `{"text":"after"}`, stored.Content)
	assert.True(t, stored.Edited)
	if stored.EditedAt == nil {
		t.Fatal("edited_at was not set")
	}
}

func TestUpdateMessageContentReturnsNotFoundWhenNoRowsChange(t *testing.T) {
	db := setupSQLite(t)
	require.ErrorIs(t, UpdateMessageContent(db, "missing", "text", `{"text":"after"}`), gorm.ErrRecordNotFound)
}

func TestMessageRepo_InsertAndGet(t *testing.T) {
	db := setupSQLite(t)
	s := createTestSession(t, db)

	msg := &model.Message{
		SessionID:   s.ID,
		SeqID:       1,
		ClientMsgID: "client-001",
		SenderType:  model.SenderTypeUser,
		SenderID:    "user-1",
		ContentType: model.ContentTypeText,
		Content:     `{"text":"Hello"}`,
	}

	err := InsertMessage(db, msg)
	require.NoError(t, err)
	assert.NotEmpty(t, msg.ID)

	fetched, err := GetMessageByID(db, msg.ID)
	require.NoError(t, err)
	assert.Equal(t, `{"text":"Hello"}`, fetched.Content)
}

func TestMessageRepo_GetBySession(t *testing.T) {
	db := setupSQLite(t)
	s := createTestSession(t, db)

	for i := 1; i <= 5; i++ {
		msg := &model.Message{
			SessionID:   s.ID,
			SeqID:       int64(i),
			ClientMsgID: "client-" + string(rune('0'+i)),
			SenderType:  model.SenderTypeUser,
			SenderID:    "user-1",
			ContentType: model.ContentTypeText,
			Content:     `{"text":"Message ` + string(rune('0'+i)) + `"}`,
		}
		require.NoError(t, InsertMessage(db, msg))
	}

	msgs, err := GetMessagesBySession(db, s.ID, 0, 10)
	require.NoError(t, err)
	assert.Len(t, msgs, 5)

	// Get with beforeSeq
	msgs, err = GetMessagesBySession(db, s.ID, 4, 10)
	require.NoError(t, err)
	assert.Len(t, msgs, 3) // seq 1,2,3 (before seq 4)

	// Get with small limit
	msgs, err = GetMessagesBySession(db, s.ID, 0, 2)
	require.NoError(t, err)
	assert.Len(t, msgs, 2)
}

func TestMessageRepo_Increment(t *testing.T) {
	db := setupSQLite(t)
	s := createTestSession(t, db)

	for i := 1; i <= 5; i++ {
		msg := &model.Message{
			SessionID:   s.ID,
			SeqID:       int64(i),
			ClientMsgID: "inc-client-" + string(rune('0'+i)),
			SenderType:  model.SenderTypeUser,
			SenderID:    "user-1",
			ContentType: model.ContentTypeText,
			Content:     `{"text":"Inc ` + string(rune('0'+i)) + `"}`,
		}
		require.NoError(t, InsertMessage(db, msg))
	}

	msgs, err := GetMessagesIncrement(db, s.ID, 2, 10)
	require.NoError(t, err)
	assert.Len(t, msgs, 3) // seq 3,4,5 (after seq 2)
	assert.Equal(t, int64(3), msgs[0].SeqID)
}

func TestMessageRepo_Recall(t *testing.T) {
	db := setupSQLite(t)
	s := createTestSession(t, db)

	msg := &model.Message{
		SessionID:   s.ID,
		SeqID:       1,
		ClientMsgID: "recall-001",
		SenderType:  model.SenderTypeUser,
		SenderID:    "user-1",
		ContentType: model.ContentTypeText,
		Content:     `{"text":"Recall me"}`,
	}
	require.NoError(t, InsertMessage(db, msg))

	err := UpdateMessageRecalled(db, msg.ID)
	require.NoError(t, err)

	fetched, err := GetMessageByID(db, msg.ID)
	require.NoError(t, err)
	assert.True(t, fetched.Recalled)
}

func TestMessageRepo_DuplicateClientMsgID(t *testing.T) {
	db := setupSQLite(t)
	s := createTestSession(t, db)

	msg := &model.Message{
		SessionID:   s.ID,
		SeqID:       1,
		ClientMsgID: "dup-client",
		SenderType:  model.SenderTypeUser,
		SenderID:    "user-1",
		ContentType: model.ContentTypeText,
		Content:     `{"text":"First"}`,
	}
	require.NoError(t, InsertMessage(db, msg))

	fetched, err := GetMessageByClientMsgID(db, s.ID, "dup-client")
	require.NoError(t, err)
	require.NotNil(t, fetched)
	assert.Equal(t, `{"text":"First"}`, fetched.Content)

	// Non-existent returns nil, nil
	fetched, err = GetMessageByClientMsgID(db, s.ID, "no-such")
	require.NoError(t, err)
	assert.Nil(t, fetched)
}

func TestMessageRepo_Pins(t *testing.T) {
	db := setupSQLite(t)
	s := createTestSession(t, db)

	pin := &model.MessagePin{
		SessionID:      s.ID,
		MessageID:      "msg-001",
		PinnedByUserID: "user-1",
	}

	err := InsertPin(db, pin)
	require.NoError(t, err)

	count, err := CountPinsBySession(db, s.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), count)

	pins, err := ListPinsBySession(db, s.ID)
	require.NoError(t, err)
	assert.Len(t, pins, 1)
	assert.Equal(t, "msg-001", pins[0].MessageID)

	// Delete pin
	err = DeletePin(db, s.ID, "msg-001")
	require.NoError(t, err)

	count, err = CountPinsBySession(db, s.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)
}

func TestMessageRepo_GetByIDs(t *testing.T) {
	db := setupSQLite(t)
	s := createTestSession(t, db)

	msg1 := &model.Message{SessionID: s.ID, SeqID: 1, ClientMsgID: "c1", SenderType: model.SenderTypeUser, SenderID: "u1", ContentType: model.ContentTypeText, Content: `{}`}
	msg2 := &model.Message{SessionID: s.ID, SeqID: 2, ClientMsgID: "c2", SenderType: model.SenderTypeUser, SenderID: "u1", ContentType: model.ContentTypeText, Content: `{}`}
	require.NoError(t, InsertMessage(db, msg1))
	require.NoError(t, InsertMessage(db, msg2))

	msgs, err := GetMessagesByIDs(db, []string{msg1.ID, msg2.ID})
	require.NoError(t, err)
	assert.Len(t, msgs, 2)

	// Empty list
	msgs, err = GetMessagesByIDs(db, []string{})
	require.NoError(t, err)
	assert.Empty(t, msgs)
}

func TestMessageRepo_PinMessageAtomic(t *testing.T) {
	db := setupSQLite(t)

	s := &model.Session{Type: model.SessionTypeGroup, Name: "pin-test"}
	require.NoError(t, CreateSession(db, s))

	pin := func(msgID, userID string) error {
		return PinMessageAtomic(db, &model.MessagePin{
			SessionID:      s.ID,
			MessageID:      msgID,
			PinnedByUserID: userID,
		}, 3) // low limit for testing
	}

	// Pin 3 messages — all should succeed
	require.NoError(t, pin("msg-1", "user-1"))
	require.NoError(t, pin("msg-2", "user-1"))
	require.NoError(t, pin("msg-3", "user-1"))

	// 4th pin should fail with limit exceeded
	err := pin("msg-4", "user-1")
	assert.ErrorIs(t, err, ErrPinLimitExceeded)

	// Verify count
	count, err := CountPinsBySession(db, s.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(3), count)
}
