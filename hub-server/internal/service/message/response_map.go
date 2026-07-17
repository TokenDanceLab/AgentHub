package message

import "github.com/agenthub/hub-server/internal/model"

// collectReplyToIDs returns unique non-empty ReplyToMsgID values from msgs.
func collectReplyToIDs(msgs []model.Message) []string {
	seen := make(map[string]struct{})
	ids := make([]string, 0)
	for _, m := range msgs {
		if m.ReplyToMsgID == nil || *m.ReplyToMsgID == "" {
			continue
		}
		id := *m.ReplyToMsgID
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

// fileImageMessageIDs returns unique message IDs with file/image content types.
func fileImageMessageIDs(msgs []model.Message) []string {
	messageIDs := make([]string, 0)
	seen := make(map[string]struct{})
	for _, msg := range msgs {
		if (msg.ContentType != model.ContentTypeFile && msg.ContentType != model.ContentTypeImage) || msg.ID == "" {
			continue
		}
		if _, exists := seen[msg.ID]; exists {
			continue
		}
		seen[msg.ID] = struct{}{}
		messageIDs = append(messageIDs, msg.ID)
	}
	return messageIDs
}

// orderMessagesByIDs preserves pin/list order; missing IDs are skipped.
func orderMessagesByIDs(msgMap map[string]model.Message, ids []string) []model.Message {
	ordered := make([]model.Message, 0, len(ids))
	for _, id := range ids {
		if m, ok := msgMap[id]; ok {
			ordered = append(ordered, m)
		}
	}
	return ordered
}

// buildReplyToInfo projects a reply target. Recalled replies blank content and
// force content_type "text" (matches historical toMessageResponses behavior).
func buildReplyToInfo(reply *model.Message) *ReplyToInfo {
	if reply == nil {
		return nil
	}
	replyContent := reply.Content
	replyContentType := reply.ContentType
	if reply.Recalled {
		replyContent = ""
		replyContentType = "text"
	}
	return &ReplyToInfo{
		ID:          reply.ID,
		SenderID:    reply.SenderID,
		ContentType: replyContentType,
		Content:     replyContent,
		Recalled:    reply.Recalled,
		CreatedAt:   formatMessageTime(reply.CreatedAt),
	}
}

// projectOneMessage maps a stored message plus optional attachments/reply map
// into an API MessageResponse. Pure: no DB/bus.
func projectOneMessage(m model.Message, attachmentsByMessage map[string][]model.Attachment, replyMessages map[string]*model.Message) MessageResponse {
	resp := MessageResponse{
		ID:           m.ID,
		SessionID:    m.SessionID,
		SeqID:        m.SeqID,
		ClientMsgID:  m.ClientMsgID,
		SenderType:   m.SenderType,
		SenderID:     m.SenderID,
		ContentType:  m.ContentType,
		Content:      m.Content,
		ReplyToMsgID: m.ReplyToMsgID,
		Recalled:     m.Recalled,
		Edited:       m.Edited,
		CreatedAt:    formatMessageTime(m.CreatedAt),
	}
	if m.EditedAt != nil {
		resp.EditedAt = formatMessageTime(*m.EditedAt)
	}

	if len(attachmentsByMessage[m.ID]) > 0 {
		resp.Attachments = attachmentsByMessage[m.ID]
	}

	if m.ReplyToMsgID != nil && replyMessages != nil {
		if replyMsg, ok := replyMessages[*m.ReplyToMsgID]; ok {
			resp.ReplyTo = buildReplyToInfo(replyMsg)
		}
	}
	return resp
}

// projectMessageResponses maps a batch of messages with preloaded attachments
// and reply targets. Pure: no DB/bus.
func projectMessageResponses(msgs []model.Message, attachmentsByMessage map[string][]model.Attachment, replyMessages map[string]*model.Message) []MessageResponse {
	result := make([]MessageResponse, len(msgs))
	for i, m := range msgs {
		result[i] = projectOneMessage(m, attachmentsByMessage, replyMessages)
	}
	return result
}
