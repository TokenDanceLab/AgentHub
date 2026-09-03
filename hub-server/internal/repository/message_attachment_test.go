package repository

import (
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMessageAttachmentRepo_CreateAndAccess(t *testing.T) {
	db := setupSQLite(t)
	s := createTestSession(t, db)

	member := &model.SessionMember{
		SessionID:  s.ID,
		MemberType: model.MemberTypeUser,
		MemberID:   "viewer-1",
		Role:       model.MemberRoleMember,
	}
	require.NoError(t, CreateSessionMember(db, member))

	msg := &model.Message{
		SessionID:   s.ID,
		SeqID:       1,
		ClientMsgID: "attach-client-1",
		SenderType:  model.SenderTypeUser,
		SenderID:    "owner-1",
		ContentType: model.ContentTypeFile,
		Content:     `{"attachment_id":"att-1"}`,
	}
	require.NoError(t, InsertMessage(db, msg))

	refs := []model.MessageAttachment{{
		SessionID:    s.ID,
		MessageID:    msg.ID,
		AttachmentID: "att-1",
	}}
	require.NoError(t, CreateMessageAttachmentReferences(db, refs))
	require.NoError(t, CreateMessageAttachmentReferences(db, refs))

	allowed, err := CanUserAccessReferencedAttachment(db, "viewer-1", "att-1")
	require.NoError(t, err)
	assert.True(t, allowed)

	allowed, err = CanUserAccessReferencedAttachment(db, "outsider-1", "att-1")
	require.NoError(t, err)
	assert.False(t, allowed)

	require.NoError(t, SoftDeleteMember(db, s.ID, model.MemberTypeUser, "viewer-1"))
	allowed, err = CanUserAccessReferencedAttachment(db, "viewer-1", "att-1")
	require.NoError(t, err)
	assert.False(t, allowed)
}

func TestMessageAttachmentRepo_ListAttachmentsByMessageIDs(t *testing.T) {
	db := setupSQLite(t)
	s := createTestSession(t, db)

	msgWithAttachment := &model.Message{
		SessionID:   s.ID,
		SeqID:       1,
		ClientMsgID: "attach-client-1",
		SenderType:  model.SenderTypeUser,
		SenderID:    "owner-1",
		ContentType: model.ContentTypeFile,
		Content:     `{"attachment_id":"att-1"}`,
	}
	msgWithoutAttachment := &model.Message{
		SessionID:   s.ID,
		SeqID:       2,
		ClientMsgID: "attach-client-2",
		SenderType:  model.SenderTypeUser,
		SenderID:    "owner-1",
		ContentType: model.ContentTypeText,
		Content:     `{"text":"plain"}`,
	}
	require.NoError(t, InsertMessage(db, msgWithAttachment))
	require.NoError(t, InsertMessage(db, msgWithoutAttachment))

	require.NoError(t, db.Exec(
		`INSERT INTO attachments (id, hash, size, mime_type, original_name, uploader_user_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"att-1", "hash-1", 42, "text/plain", "notes.txt", "owner-1", `{"height":3,"width":2}`, time.Now(),
	).Error)
	require.NoError(t, CreateMessageAttachmentReferences(db, []model.MessageAttachment{{
		SessionID:    s.ID,
		MessageID:    msgWithAttachment.ID,
		AttachmentID: "att-1",
	}}))

	attachmentsByMessage, err := ListAttachmentsByMessageIDs(db, []string{msgWithAttachment.ID, msgWithoutAttachment.ID})
	require.NoError(t, err)

	require.Len(t, attachmentsByMessage[msgWithAttachment.ID], 1)
	assert.Equal(t, "att-1", attachmentsByMessage[msgWithAttachment.ID][0].ID)
	assert.Equal(t, "hash-1", attachmentsByMessage[msgWithAttachment.ID][0].Hash)
	assert.Equal(t, int64(42), attachmentsByMessage[msgWithAttachment.ID][0].Size)
	assert.Equal(t, "text/plain", attachmentsByMessage[msgWithAttachment.ID][0].MimeType)
	assert.Equal(t, "notes.txt", attachmentsByMessage[msgWithAttachment.ID][0].OriginalName)
	assert.JSONEq(t, `{"height":3,"width":2}`, attachmentsByMessage[msgWithAttachment.ID][0].Metadata)
	assert.Empty(t, attachmentsByMessage[msgWithoutAttachment.ID])

	empty, err := ListAttachmentsByMessageIDs(db, nil)
	require.NoError(t, err)
	assert.Empty(t, empty)
}
