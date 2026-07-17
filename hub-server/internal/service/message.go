package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/im"
	"github.com/agenthub/hub-server/pkg/uuidv7"
)

// ── MessageService ports + type ──────────────────────────────────────────────
//
// Same-package thin first seam (#585): MessageService already owns IM message
// orchestration (send/edit/recall/pin/forward/search/read). This seam hardens
// replaceable ports (bus + cache) without a package move — same pattern as
// DispatchService / EdgeCallbackService / DeliveryOutbox.
// #628: pure content normalize/attachment-id helpers live in service/im;
// MessageService keeps thin aliases for same-package call sites.

// messageBus publishes domain events from message write/lifecycle paths.
// Implemented by *Bus.
type messageBus interface {
	Publish(ctx context.Context, event Event)
}

// messageCache is the subset of *cache.Client methods used by MessageService.
// Implemented by *cache.Client and cache.NoOpCache.
type messageCache interface {
	AllocateSeq(ctx context.Context, sessionID string) (int64, error)
}

// MessageService owns IM message orchestration in the flat service package:
// send/edit/recall, pin/unpin/list-pins, forward, mark-read, search, and
// history projection. Seq allocation uses injected messageCache with DB
// fallback; domain events go through messageBus. Not a package move (#585).
type MessageService struct {
	db          *gorm.DB
	bus         messageBus
	cacheClient messageCache
}

// NewMessageService constructs a MessageService.
// bus may be nil for read-only/partial tests; write paths that publish no-op.
// cacheClient may be nil and falls back to cache.NoOpCache (DB seq path).
func NewMessageService(db *gorm.DB, bus messageBus, cacheClient messageCache) *MessageService {
	return &MessageService{db: db, bus: bus, cacheClient: resolveMessageCache(cacheClient)}
}

// SetBus injects (or replaces) the event bus port.
func (s *MessageService) SetBus(bus messageBus) {
	if s == nil {
		return
	}
	s.bus = bus
}

// SetCache injects (or replaces) the sequence cache port.
func (s *MessageService) SetCache(cacheClient messageCache) {
	if s == nil {
		return
	}
	s.cacheClient = resolveMessageCache(cacheClient)
}

// publish is a nil-safe wrapper over the bus port.
func (s *MessageService) publish(ctx context.Context, event Event) {
	if s == nil || s.bus == nil {
		return
	}
	s.bus.Publish(ctx, event)
}

func (s *MessageService) allocateSeq(ctx context.Context, sessionID string) (int64, error) {
	seq, err := resolveMessageCache(s.cacheClient).AllocateSeq(ctx, sessionID)
	if err == nil {
		// #154: Redis allocation does not update last_message_at, so touch it here
		// to ensure the session appears in recent conversations.
		if touchErr := repository.TouchSessionLastMessage(s.db, sessionID); touchErr != nil {
			slog.Warn("failed to touch session last_message_at after redis seq alloc", "session_id", sessionID, "error", touchErr)
		}
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
	ID           string             `json:"id"`
	SessionID    string             `json:"session_id"`
	SeqID        int64              `json:"seq_id"`
	ClientMsgID  string             `json:"client_msg_id"`
	SenderType   string             `json:"sender_type"`
	SenderID     string             `json:"sender_id"`
	ContentType  string             `json:"content_type"`
	Content      string             `json:"content"`
	ReplyToMsgID *string            `json:"reply_to_message_id,omitempty"`
	ReplyTo      *ReplyToInfo       `json:"reply_to,omitempty"`
	Attachments  []model.Attachment `json:"attachments,omitempty"`
	Recalled     bool               `json:"recalled"`
	Edited       bool               `json:"edited"`
	EditedAt     string             `json:"edited_at,omitempty"`
	CreatedAt    string             `json:"created_at"`
}

type SendMessageResponse struct {
	MessageID string `json:"message_id"`
	SeqID     int64  `json:"seq_id"`
	CreatedAt string `json:"created_at"`
}

type EditMessageRequest struct {
	ContentType string `json:"content_type"`
	Content     string `json:"content"`
}

type EditMessageResponse struct {
	MessageID string `json:"message_id"`
	EditedAt  string `json:"edited_at"`
}

// ── Pure IM helpers (aliases to service/im; #628) ────────────────────────────

// validContentTypes is retained for same-package lookups; source of truth is im.
var validContentTypes = map[string]bool{
	"text": true, "code": true, "diff": true, "image": true,
	"file": true, "link_card": true, "deploy_card": true,
}

// normalizeMessageContent is a thin alias to im.NormalizeMessageContent.
func normalizeMessageContent(contentType, content string) (string, error) {
	return im.NormalizeMessageContent(contentType, content)
}

// attachmentIDsFromContent is a thin alias to im.AttachmentIDsFromContent.
func attachmentIDsFromContent(contentType, content string) ([]string, bool) {
	return im.AttachmentIDsFromContent(contentType, content)
}

func (s *MessageService) SendMessage(ctx context.Context, sessionID, senderUserID string, req SendMessageRequest) (*SendMessageResponse, error) {
	if !im.IsValidContentType(req.ContentType) {
		return nil, errcode.ErrBadRequest
	}

	content, err := normalizeMessageContent(req.ContentType, req.Content)
	if err != nil {
		slog.Warn("invalid message content", "content_type", req.ContentType, "error", err)
		return nil, errcode.ErrBadRequest
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

	if req.ReplyToMsgID != nil && *req.ReplyToMsgID != "" {
		if _, err := repository.GetMessageBySessionAndID(s.db, sessionID, *req.ReplyToMsgID); err != nil {
			return nil, errcode.MsgNotFound
		}
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

	s.publish(ctx, Event{Type: "message.new", Payload: msg})

	return &SendMessageResponse{
		MessageID: msg.ID,
		SeqID:     msg.SeqID,
		CreatedAt: msg.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}, nil
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
	attachmentsByMessage := s.attachmentsByMessageID(msgs)

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
			Edited:       m.Edited,
			CreatedAt:    m.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
		if m.EditedAt != nil {
			resp.EditedAt = m.EditedAt.Format("2006-01-02T15:04:05Z07:00")
		}

		if len(attachmentsByMessage[m.ID]) > 0 {
			resp.Attachments = attachmentsByMessage[m.ID]
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

func (s *MessageService) attachmentsByMessageID(msgs []model.Message) map[string][]model.Attachment {
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
	if len(messageIDs) == 0 {
		return nil
	}

	attachmentsByMessage, err := repository.ListAttachmentsByMessageIDs(s.db, messageIDs)
	if err != nil {
		slog.Warn("failed to load message attachments", "error", err)
		return nil
	}
	return attachmentsByMessage
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

	s.publish(ctx, Event{Type: "message.recall", Payload: msg})

	return nil
}

func (s *MessageService) EditMessage(ctx context.Context, msgID, userID string, req EditMessageRequest) (*EditMessageResponse, error) {
	msg, err := repository.GetMessageByID(s.db, msgID)
	if err != nil {
		return nil, errcode.MsgNotFound
	}

	if _, err := repository.GetActiveMember(s.db, msg.SessionID, model.MemberTypeUser, userID); err != nil {
		return nil, errcode.SessionNotMember
	}
	if msg.Recalled {
		return nil, errcode.MsgNotEditable
	}
	if msg.SenderType != model.SenderTypeUser {
		return nil, errcode.MsgNotEditable
	}
	if msg.SenderID != userID {
		return nil, errcode.SessionNotMember
	}
	if config.MessageEditWindow > 0 && time.Since(msg.CreatedAt) > config.MessageEditWindow {
		return nil, errcode.MsgEditTimeout
	}
	if !im.IsValidContentType(req.ContentType) {
		return nil, errcode.ErrBadRequest
	}

	content, err := normalizeMessageContent(req.ContentType, req.Content)
	if err != nil {
		slog.Warn("invalid message edit content", "content_type", req.ContentType, "error", err)
		return nil, errcode.ErrBadRequest
	}
	attachmentIDs, ok := attachmentIDsFromContent(req.ContentType, content)
	if !ok {
		return nil, errcode.ErrBadRequest
	}
	for _, attachmentID := range attachmentIDs {
		if err := s.ensureAttachmentReferenceAllowed(userID, attachmentID); err != nil {
			return nil, err
		}
	}

	if err := repository.UpdateMessageContent(s.db, msgID, req.ContentType, content); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.MsgNotFound
		}
		return nil, err
	}

	updated, err := repository.GetMessageByID(s.db, msgID)
	if err != nil {
		return nil, err
	}
	s.publish(ctx, Event{Type: "message.edited", Payload: updated})

	editedAt := ""
	if updated.EditedAt != nil {
		editedAt = updated.EditedAt.Format("2006-01-02T15:04:05Z07:00")
	}
	return &EditMessageResponse{MessageID: msgID, EditedAt: editedAt}, nil
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

	pin := &model.MessagePin{
		SessionID:      sessionID,
		MessageID:      msgID,
		PinnedByUserID: userID,
	}
	if err := repository.PinMessageAtomic(s.db, pin, config.MaxPinsPerSession); err != nil {
		if errors.Is(err, repository.ErrPinLimitExceeded) {
			return errcode.MsgPinLimitExceeded
		}
		if strings.Contains(err.Error(), "duplicate key") {
			return nil
		}
		return err
	}

	s.publish(ctx, Event{Type: "message.pin", Payload: pin})

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

	s.publish(ctx, Event{Type: "message.unpin", Payload: map[string]string{
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
	if len(targetSessionIDs) > config.MaxForwardTargets {
		return errcode.ErrBadRequest
	}
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
		SenderType:  msg.SenderType,
		SenderID:    msg.SenderID,
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
	s.publish(ctx, Event{Type: "message.new", Payload: forwarded})

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

	member, err := repository.GetActiveMember(s.db, sessionID, model.MemberTypeUser, userID)
	if err != nil {
		return err
	}
	if lastReadSeq <= member.LastReadSeq {
		return nil
	}
	if err := repository.UpdateLastReadSeq(s.db, sessionID, userID, lastReadSeq); err != nil {
		return err
	}

	s.publish(ctx, Event{Type: "message.read", Payload: map[string]interface{}{
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

	msgs, err := repository.SearchAllMessages(s.db, userID, q, contentType, from, to)
	if err != nil {
		return nil, err
	}
	return s.toMessageResponses(msgs), nil
}
