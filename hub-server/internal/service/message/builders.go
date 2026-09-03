package message

import (
	"time"

	"github.com/agenthub/hub-server/internal/model"
)

// messageTimeLayout is the RFC3339-style layout used in message API projections.
const messageTimeLayout = "2006-01-02T15:04:05Z07:00"

func formatMessageTime(t time.Time) string {
	return t.Format(messageTimeLayout)
}

func formatMessageTimePtr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format(messageTimeLayout)
}

func sendMessageResponseFromModel(m *model.Message) *SendMessageResponse {
	if m == nil {
		return nil
	}
	return &SendMessageResponse{
		MessageID: m.ID,
		SeqID:     m.SeqID,
		CreatedAt: formatMessageTime(m.CreatedAt),
	}
}

// messageAttachmentRefs builds MessageAttachment rows for a send transaction.
func messageAttachmentRefs(sessionID, messageID string, attachmentIDs []string) []model.MessageAttachment {
	if len(attachmentIDs) == 0 {
		return nil
	}
	refs := make([]model.MessageAttachment, 0, len(attachmentIDs))
	for _, attachmentID := range attachmentIDs {
		refs = append(refs, model.MessageAttachment{
			SessionID:    sessionID,
			MessageID:    messageID,
			AttachmentID: attachmentID,
		})
	}
	return refs
}

// newForwardedMessage fills a forwarded message shell. clientMsgID is allocated
// at the orchestration edge (uuidv7); pure helper does not generate IDs.
func newForwardedMessage(sessionID string, seq int64, clientMsgID string, src *model.Message) *model.Message {
	if src == nil {
		return &model.Message{
			SessionID:   sessionID,
			ClientMsgID: clientMsgID,
			SeqID:       seq,
		}
	}
	return &model.Message{
		SessionID:   sessionID,
		ClientMsgID: clientMsgID,
		SenderType:  src.SenderType,
		SenderID:    src.SenderID,
		ContentType: src.ContentType,
		Content:     src.Content,
		SeqID:       seq,
	}
}
