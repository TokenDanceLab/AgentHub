package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sync/errgroup"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/pkg/uuidv7"
)

// messageCache is the subset of *cache.Client methods used by MessageService.
type messageCache interface {
	AllocateSeq(ctx context.Context, sessionID string) (int64, error)
}

type MessageService struct {
	db          *gorm.DB
	bus         *Bus
	cacheClient messageCache
}

func NewMessageService(db *gorm.DB, bus *Bus, cacheClient *cache.Client) *MessageService {
	return &MessageService{db: db, bus: bus, cacheClient: resolveMessageCache(cacheClient)}
}

func (s *MessageService) allocateSeq(ctx context.Context, sessionID string) (int64, error) {
	seq, err := resolveMessageCache(s.cacheClient).AllocateSeq(ctx, sessionID)
	if err == nil {
		return seq, nil
	}
	slog.Warn("redis seq allocation failed, falling back to DB", "session_id", sessionID, "error", err)
	var fallbackSeq int64
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var txErr error
		fallbackSeq, txErr = repository.AllocateSeqID(tx, sessionID)
		return txErr
	})
	return fallbackSeq, err
}

type SendMessageRequest struct {
	ClientMsgID  string  `json:"client_msg_id"`
	ContentType  string  `json:"content_type"`
	Content      string  `json:"content"`
	ReplyToMsgID *string `json:"reply_to_message_id,omitempty"`
}

type ReplyToInfo struct {
	ID          string `json:"id"`
	SenderID    string `json:"sender_id"`
	ContentType string `json:"content_type"`
	Content     string `json:"content"`
	Recalled    bool   `json:"recalled"`
	CreatedAt   string `json:"created_at"`
}

type MessageResponse struct {
	ID           string       `json:"id"`
	SessionID    string       `json:"session_id"`
	SeqID        int64        `json:"seq_id"`
	ClientMsgID  string       `json:"client_msg_id"`
	SenderType   string       `json:"sender_type"`
	SenderID     string       `json:"sender_id"`
	ContentType  string       `json:"content_type"`
	Content      string       `json:"content"`
	ReplyToMsgID *string      `json:"reply_to_message_id,omitempty"`
	ReplyTo      *ReplyToInfo `json:"reply_to,omitempty"`
	Recalled     bool         `json:"recalled"`
	CreatedAt    string       `json:"created_at"`
}

type SendMessageResponse struct {
	MessageID string `json:"message_id"`
	SeqID     int64  `json:"seq_id"`
	CreatedAt string `json:"created_at"`
}

var validContentTypes = map[string]bool{
	"text": true, "code": true, "diff": true, "image": true,
	"file": true, "link_card": true, "deploy_card": true,
}

func (s *MessageService) SendMessage(ctx context.Context, sessionID, senderUserID string, req SendMessageRequest) (*SendMessageResponse, error) {
	if !validContentTypes[req.ContentType] {
		return nil, errcode.ErrBadRequest
	}

	content := req.Content
	if req.ContentType == "text" {
		contentBytes, err := json.Marshal(map[string]string{"text": req.Content})
		if err != nil {
			return nil, errcode.ErrInternal
		}
		content = string(contentBytes)
	}
	attachmentIDs, ok := attachmentIDsFromContent(req.ContentType, content)
	if !ok {
		return nil, errcode.ErrBadRequest
	}

	active, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, senderUserID)
	if err != nil {
		return nil, err
	}
	if !active {
		return nil, errcode.SessionNotMember
	}

	session, err := repository.GetSessionByID(s.db, sessionID)
	if err != nil {
		return nil, errcode.SessionNotFound
	}
	if session.Dissolved {
		return nil, errcode.SessionDissolved
	}

	if session.Type == model.SessionTypePrivate {
		other, err := repository.GetOtherMemberInPrivate(s.db, sessionID, senderUserID)
		if err != nil {
			return nil, err
		}
		if other != nil {
			blocked, err := repository.IsBlockedBy(s.db, other.MemberID, senderUserID)
			if err != nil {
				return nil, err
			}
			if blocked {
				return nil, errcode.MsgBlockedByReceiver
			}
		}
	}

	existing, err := repository.GetMessageByClientMsgID(s.db, sessionID, req.ClientMsgID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return &SendMessageResponse{
			MessageID: existing.ID,
			SeqID:     existing.SeqID,
			CreatedAt: existing.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}, nil
	}

	for _, attachmentID := range attachmentIDs {
		if err := s.ensureAttachmentReferenceAllowed(senderUserID, attachmentID); err != nil {
			return nil, err
		}
	}

	msg := &model.Message{
		SessionID:    sessionID,
		ClientMsgID:  req.ClientMsgID,
		SenderType:   model.SenderTypeUser,
		SenderID:     senderUserID,
		ContentType:  req.ContentType,
		Content:      content,
		ReplyToMsgID: req.ReplyToMsgID,
	}

	seq, err := s.allocateSeq(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	msg.SeqID = seq

	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.InsertMessage(tx, msg); err != nil {
			return err
		}
		if len(attachmentIDs) > 0 {
			refs := make([]model.MessageAttachment, 0, len(attachmentIDs))
			for _, attachmentID := range attachmentIDs {
				refs = append(refs, model.MessageAttachment{
					SessionID:    sessionID,
					MessageID:    msg.ID,
					AttachmentID: attachmentID,
				})
			}
			if err := repository.CreateMessageAttachmentReferences(tx, refs); err != nil {
				return err
			}
		}
		return repository.TouchSessionLastMessage(tx, sessionID)
	})
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique") {
			existing, lookupErr := repository.GetMessageByClientMsgID(s.db, sessionID, req.ClientMsgID)
			if lookupErr == nil && existing != nil {
				return &SendMessageResponse{
					MessageID: existing.ID,
					SeqID:     existing.SeqID,
					CreatedAt: existing.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
				}, nil
			}
		}
		return nil, err
	}

	s.bus.Publish(ctx, Event{Type: "message.new", Payload: msg})

	return &SendMessageResponse{
		MessageID: msg.ID,
		SeqID:     msg.SeqID,
		CreatedAt: msg.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}, nil
}

func attachmentIDsFromContent(contentType, content string) ([]string, bool) {
	if contentType != model.ContentTypeFile {
		return nil, true
	}

	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(content), &payload); err != nil {
		return nil, true
	}

	seen := make(map[string]struct{})
	ids := make([]string, 0, 1)
	add := func(value interface{}) bool {
		id, ok := value.(string)
		if !ok {
			return true
		}
		id = strings.TrimSpace(id)
		if id == "" {
			return true
		}
		parsed, err := uuid.Parse(id)
		if err != nil {
			return false
		}
		id = parsed.String()
		if _, exists := seen[id]; exists {
			return true
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
		return true
	}

	if !add(payload["attachment_id"]) {
		return nil, false
	}

	if rawIDs, ok := payload["attachment_ids"].([]interface{}); ok {
		for _, rawID := range rawIDs {
			if !add(rawID) {
				return nil, false
			}
		}
	}

	if rawAttachments, ok := payload["attachments"].([]interface{}); ok {
		for _, rawAttachment := range rawAttachments {
			attachment, ok := rawAttachment.(map[string]interface{})
			if !ok {
				continue
			}
			if !add(attachment["attachment_id"]) {
				return nil, false
			}
			if !add(attachment["id"]) {
				return nil, false
			}
		}
	}

	return ids, true
}

func (s *MessageService) ensureAttachmentReferenceAllowed(userID, attachmentID string) error {
	attachment, err := repository.GetAttachmentByID(s.db, attachmentID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AttachNotFound
		}
		return err
	}
	if attachment.UploaderUserID == userID {
		return nil
	}

	allowed, err := repository.CanUserAccessReferencedAttachment(s.db, userID, attachmentID)
	if err != nil {
		return err
	}
	if !allowed {
		return errcode.AttachNotFound
	}
	return nil
}

func (s *MessageService) GetMessages(ctx context.Context, sessionID, userID string, beforeSeq int64, limit int) ([]MessageResponse, error) {
	active, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, userID)
	if err != nil {
		return nil, err
	}
	if !active {
		return nil, errcode.SessionNotMember
	}

	msgs, err := repository.GetMessagesBySession(s.db, sessionID, beforeSeq, limit)
	if err != nil {
		return nil, err
	}

	return s.toMessageResponses(msgs), nil
}

func (s *MessageService) GetMessagesIncremental(ctx context.Context, sessionID, userID string, afterSeq int64, limit int) ([]MessageResponse, error) {
	active, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, userID)
	if err != nil {
		return nil, err
	}
	if !active {
		return nil, errcode.SessionNotMember
	}

	msgs, err := repository.GetMessagesIncrement(s.db, sessionID, afterSeq, limit)
	if err != nil {
		return nil, err
	}

	return s.toMessageResponses(msgs), nil
}

func (s *MessageService) toMessageResponses(msgs []model.Message) []MessageResponse {
	result := make([]MessageResponse, len(msgs))

	replyToIDs := make(map[string]bool)
	for _, m := range msgs {
		if m.ReplyToMsgID != nil && *m.ReplyToMsgID != "" {
			replyToIDs[*m.ReplyToMsgID] = true
		}
	}

	var replyMessages map[string]*model.Message
	if len(replyToIDs) > 0 {
		ids := make([]string, 0, len(replyToIDs))
		for id := range replyToIDs {
			ids = append(ids, id)
		}
		fetched, err := repository.GetMessagesByIDs(s.db, ids)
		if err == nil {
			replyMessages = make(map[string]*model.Message, len(fetched))
			for i := range fetched {
				replyMessages[fetched[i].ID] = &fetched[i]
			}
		}
	}

	for i, m := range msgs {
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
			CreatedAt:    m.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}

		if m.ReplyToMsgID != nil && replyMessages != nil {
			if replyMsg, ok := replyMessages[*m.ReplyToMsgID]; ok {
				replyContent := replyMsg.Content
				replyContentType := replyMsg.ContentType
				if replyMsg.Recalled {
					replyContent = ""
					replyContentType = "text"
				}
				resp.ReplyTo = &ReplyToInfo{
					ID:          replyMsg.ID,
					SenderID:    replyMsg.SenderID,
					ContentType: replyContentType,
					Content:     replyContent,
					Recalled:    replyMsg.Recalled,
					CreatedAt:   replyMsg.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
				}
			}
		}

		result[i] = resp
	}
	return result
}

func (s *MessageService) RecallMessage(ctx context.Context, msgID, userID string) error {
	msg, err := repository.GetMessageByID(s.db, msgID)
	if err != nil {
		return errcode.MsgNotFound
	}

	member, err := repository.GetActiveMember(s.db, msg.SessionID, model.MemberTypeUser, userID)
	if err != nil {
		return errcode.SessionNotMember
	}

	isOwner := member.Role == model.MemberRoleOwner
	isSender := msg.SenderID == userID

	if !isSender && !isOwner {
		return errcode.SessionNotMember
	}

	if !isOwner && time.Since(msg.CreatedAt) > config.MessageRecallWindow {
		return errcode.MsgRecallTimeout
	}

	if err := repository.UpdateMessageRecalled(s.db, msgID); err != nil {
		return err
	}

	s.bus.Publish(ctx, Event{Type: "message.recall", Payload: msg})

	return nil
}

func (s *MessageService) PinMessage(ctx context.Context, userID, sessionID, msgID string) error {
	active, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, userID)
	if err != nil {
		return err
	}
	if !active {
		return errcode.SessionNotMember
	}

	if _, err := repository.GetMessageBySessionAndID(s.db, sessionID, msgID); err != nil {
		return errcode.MsgNotFound
	}

	count, err := repository.CountPinsBySession(s.db, sessionID)
	if err != nil {
		return err
	}
	if count >= config.MaxPinsPerSession {
		return errcode.MsgPinLimitExceeded
	}

	pin := &model.MessagePin{
		SessionID:      sessionID,
		MessageID:      msgID,
		PinnedByUserID: userID,
	}
	if err := repository.InsertPin(s.db, pin); err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			return nil
		}
		return err
	}

	s.bus.Publish(ctx, Event{Type: "message.pin", Payload: pin})

	return nil
}

func (s *MessageService) UnpinMessage(ctx context.Context, userID, sessionID, msgID string) error {
	active, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, userID)
	if err != nil {
		return err
	}
	if !active {
		return errcode.SessionNotMember
	}

	if err := repository.DeletePin(s.db, sessionID, msgID); err != nil {
		return err
	}

	s.bus.Publish(ctx, Event{Type: "message.unpin", Payload: map[string]string{
		"session_id": sessionID,
		"message_id": msgID,
	}})

	return nil
}

func (s *MessageService) ListPinnedMessages(ctx context.Context, userID, sessionID string) ([]MessageResponse, error) {
	active, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, userID)
	if err != nil {
		return nil, err
	}
	if !active {
		return nil, errcode.SessionNotMember
	}

	pins, err := repository.ListPinsBySession(s.db, sessionID)
	if err != nil {
		return nil, err
	}

	msgIDs := make([]string, len(pins))
	for i, p := range pins {
		msgIDs[i] = p.MessageID
	}

	if len(msgIDs) == 0 {
		return []MessageResponse{}, nil
	}

	msgs, err := repository.GetMessagesBySessionAndIDs(s.db, sessionID, msgIDs)
	if err != nil {
		return nil, err
	}

	msgMap := make(map[string]model.Message, len(msgs))
	for _, m := range msgs {
		msgMap[m.ID] = m
	}

	ordered := make([]model.Message, 0, len(pins))
	for _, p := range pins {
		if m, ok := msgMap[p.MessageID]; ok {
			ordered = append(ordered, m)
		}
	}

	return s.toMessageResponses(ordered), nil
}

func (s *MessageService) ForwardMessage(ctx context.Context, userID, msgID string, targetSessionIDs []string) error {
	// Source message access check
	msg, err := repository.GetMessageByID(s.db, msgID)
	if err != nil {
		return errcode.MsgNotFound
	}

	srcActive, err := repository.IsMemberActive(s.db, msg.SessionID, model.MemberTypeUser, userID)
	if err != nil || !srcActive {
		return errcode.SessionNotMember
	}

	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(config.ForwardMessageConcurrency)

	for _, sessionID := range targetSessionIDs {
		sid := sessionID
		g.Go(func() error {
			return s.forwardOne(ctx, userID, msg, sid)
		})
	}

	return g.Wait()
}

func (s *MessageService) forwardOne(ctx context.Context, userID string, msg *model.Message, sessionID string) error {
	// Validate membership
	active, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, userID)
	if err != nil {
		return err
	}
	if !active {
		return errcode.SessionNotMember
	}

	// Validate session
	session, err := repository.GetSessionByID(s.db, sessionID)
	if err != nil {
		return errcode.SessionNotFound
	}
	if session.Dissolved {
		return errcode.SessionDissolved
	}

	// Private session: check not blocked
	if session.Type == model.SessionTypePrivate {
		other, err := repository.GetOtherMemberInPrivate(s.db, sessionID, userID)
		if err != nil {
			return err
		}
		if other != nil {
			blocked, err := repository.IsBlockedBy(s.db, other.MemberID, userID)
			if err != nil {
				return err
			}
			if blocked {
				return errcode.MsgBlockedByReceiver
			}
		}
	}

	// Allocate seq (uses Stage 5 Redis INCR with DB fallback)
	seq, err := s.allocateSeq(ctx, sessionID)
	if err != nil {
		return fmt.Errorf("allocate seq for session %s: %w", sessionID, err)
	}

	// Construct forwarded message
	forwarded := &model.Message{
		SessionID:   sessionID,
		ClientMsgID: uuidv7.Must(),
		SenderType:  model.SenderTypeUser,
		SenderID:    userID,
		ContentType: msg.ContentType,
		Content:     msg.Content,
		SeqID:       seq,
	}

	// Insert + touch session
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.InsertMessage(tx, forwarded); err != nil {
			return err
		}
		return repository.TouchSessionLastMessage(tx, sessionID)
	})
	if err != nil {
		return fmt.Errorf("forward to session %s: %w", sessionID, err)
	}

	// Publish event
	s.bus.Publish(ctx, Event{Type: "message.new", Payload: forwarded})

	return nil
}

func (s *MessageService) MarkRead(ctx context.Context, userID, sessionID string, lastReadSeq int64) error {
	active, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, userID)
	if err != nil {
		return err
	}
	if !active {
		return errcode.SessionNotMember
	}

	if err := repository.UpdateLastReadSeq(s.db, sessionID, userID, lastReadSeq); err != nil {
		return err
	}

	s.bus.Publish(ctx, Event{Type: "message.read", Payload: map[string]interface{}{
		"session_id":    sessionID,
		"user_id":       userID,
		"last_read_seq": lastReadSeq,
	}})

	return nil
}

func (s *MessageService) SearchMessages(ctx context.Context, userID, q, sessionID, contentType, from, to string) ([]MessageResponse, error) {
	if sessionID != "" {
		active, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, userID)
		if err != nil || !active {
			return nil, errcode.SessionNotMember
		}
		msgs, err := repository.SearchMessages(s.db, q, sessionID, contentType, from, to)
		if err != nil {
			return nil, err
		}
		return s.toMessageResponses(msgs), nil
	}

	msgs, err := repository.SearchAllMessages(s.db, userID, q)
	if err != nil {
		return nil, err
	}
	return s.toMessageResponses(msgs), nil
}
