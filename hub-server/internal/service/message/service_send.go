package message

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"golang.org/x/sync/errgroup"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/im"
	"github.com/agenthub/hub-server/internal/uuidv7"
)

// Residual pure-helper peel #1153: send/edit/recall/pin/forward write paths.

func (s *Service) SendMessage(ctx context.Context, sessionID, senderUserID string, req SendMessageRequest) (*SendMessageResponse, error) {
	content, attachmentIDs, err := normalizeSendMessage(req)
	if err != nil {
		return nil, err
	}

	isActiveMember, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, senderUserID)
	if err != nil {
		return nil, err
	}
	if !isActiveMember {
		return nil, errcode.SessionNotMember
	}

	session, err := repository.GetSessionByID(s.db, sessionID)
	if err != nil {
		return nil, errcode.SessionNotFound
	}
	if session.Dissolved {
		return nil, errcode.SessionDissolved
	}

	if err := s.validateReplyToMessage(sessionID, req.ReplyToMsgID); err != nil {
		return nil, err
	}
	if err := s.validatePrivateSendAllowed(session, sessionID, senderUserID); err != nil {
		return nil, err
	}

	// client_msg_id is a NOT NULL UUID column serving as the idempotency key.
	// When the client does not supply one, generate it server-side — writing
	// '' to the UUID column makes Postgres reject the insert (22P02), leaking
	// a 500 on every plain send.
	clientMsgID := req.ClientMsgID
	if clientMsgID == "" {
		clientMsgID = uuidv7.Must()
	}

	existing, err := repository.GetMessageByClientMsgID(s.db, sessionID, clientMsgID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return sendMessageResponseFromModel(existing), nil
	}

	for _, attachmentID := range attachmentIDs {
		if err := s.ensureAttachmentReferenceAllowed(senderUserID, attachmentID); err != nil {
			return nil, err
		}
	}

	msg := &model.Message{
		SessionID:    sessionID,
		ClientMsgID:  clientMsgID,
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

	err = s.persistSendMessageTx(msg, sessionID, attachmentIDs)
	if err != nil {
		// Single source of truth for the classification (#2244 slice 1). The
		// package-private isDuplicateKeyError this used to call did NOT
		// lower-case its input, so SQLite's upper-case "UNIQUE constraint
		// failed: messages.client_msg_id" — the wording every unit test here
		// produces, and the wording the repository copy had already been fixed
		// to accept — fell through to `return nil, err`: a client retrying a
		// send that had already landed got a 500 instead of its own message.
		if repository.IsUniqueViolation(err) {
			if existing, lookupErr := repository.GetMessageByClientMsgID(s.db, sessionID, clientMsgID); lookupErr == nil && existing != nil {
				return sendMessageResponseFromModel(existing), nil
			}
		}
		return nil, err
	}

	s.publish(ctx, bus.Event{Type: bus.EventTypeMessageNew, Payload: msg})

	return sendMessageResponseFromModel(msg), nil
}

// normalizeSendMessage validates content type and normalizes content; it also
// extracts attachment ids referenced by the content for later permission checks.
func normalizeSendMessage(req SendMessageRequest) (string, []string, error) {
	if !im.IsValidContentType(req.ContentType) {
		return "", nil, errcode.ErrBadRequest
	}
	content, err := normalizeMessageContent(req.ContentType, req.Content)
	if err != nil {
		slog.Warn("invalid message content", "content_type", req.ContentType, "error", err)
		return "", nil, errcode.ErrBadRequest
	}
	attachmentIDs, ok := attachmentIDsFromContent(req.ContentType, content)
	if !ok {
		return "", nil, errcode.ErrBadRequest
	}
	return content, attachmentIDs, nil
}

// validateReplyToMessage checks that a reply target exists in the session when
// one was supplied (nil or empty reply ids are allowed).
func (s *Service) validateReplyToMessage(sessionID string, replyToMsgID *string) error {
	if replyToMsgID == nil || *replyToMsgID == "" {
		return nil
	}
	if _, err := repository.GetMessageBySessionAndID(s.db, sessionID, *replyToMsgID); err != nil {
		return errcode.MsgNotFound
	}
	return nil
}

// persistSendMessageTx inserts the message with its attachment references and
// touches the session activity marker inside one transaction; duplicate-key
// insert races are recovered by the caller.
func (s *Service) persistSendMessageTx(msg *model.Message, sessionID string, attachmentIDs []string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.InsertMessage(tx, msg); err != nil {
			return err
		}
		if refs := messageAttachmentRefs(sessionID, msg.ID, attachmentIDs); len(refs) > 0 {
			if err := repository.CreateMessageAttachmentReferences(tx, refs); err != nil {
				return err
			}
		}
		return repository.TouchSessionLastMessage(tx, sessionID)
	})
}

// validatePrivateSendAllowed blocks sends to a private session peer that has
// blocked the sender; non-private sessions are never blocked here.
func (s *Service) validatePrivateSendAllowed(session *model.Session, sessionID, senderUserID string) error {
	if session.Type != model.SessionTypePrivate {
		return nil
	}
	other, err := repository.GetOtherMemberInPrivate(s.db, sessionID, senderUserID)
	if err != nil {
		return err
	}
	if other != nil {
		blocked, err := repository.IsBlockedBy(s.db, other.MemberID, senderUserID)
		if err != nil {
			return err
		}
		if blocked {
			return errcode.MsgBlockedByReceiver
		}
	}
	return nil
}

func (s *Service) RecallMessage(ctx context.Context, msgID, userID string) error {
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

	s.publish(ctx, bus.Event{Type: bus.EventTypeMessageRecall, Payload: msg})

	return nil
}

func (s *Service) EditMessage(ctx context.Context, msgID, userID string, req EditMessageRequest) (*EditMessageResponse, error) {
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
	s.publish(ctx, bus.Event{Type: bus.EventTypeMessageEdited, Payload: updated})

	return &EditMessageResponse{MessageID: msgID, EditedAt: formatMessageTimePtr(updated.EditedAt)}, nil
}

func (s *Service) PinMessage(ctx context.Context, userID, sessionID, msgID string) error {
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
		// Idempotent success, and deliberately NO publish.
		//
		// Why not publishing is correct here: message_pins' only uniqueness is
		// its composite PRIMARY KEY (session_id, message_id)
		// (migrations/0008_message_pins.up.sql, mirrored by the two
		// `gorm:"primaryKey"` tags on model.MessagePin). The only INSERT
		// PinMessageAtomic performs is tx.Create(pin) of exactly those
		// columns, and the table's only other constraint is the
		// (session_id, message_id) -> messages(session_id, id) foreign key
		// (migrations/0039), which Postgres reports as 23503 and this
		// classifier does NOT match. So a unique violation from this call can
		// only mean: this message is already pinned in this session. The pin
		// set did not change, there is no state transition to broadcast, and
		// re-publishing would make every message.pin subscriber
		// (internal/app/events.go -> ws.TypeMessagePin) re-render a pin list
		// identical to the one it already holds.
		//
		// Residual gap, recorded rather than papered over: s.publish is
		// best-effort (service_helpers.go logs and swallows a failed Publish),
		// so "the row exists" does not strictly prove "a message.pin event was
		// once delivered". A first attempt whose INSERT committed but whose
		// Publish failed leaves that pin permanently un-broadcast, and this
		// branch will never retry it. Closing that gap means changing publish
		// semantics, which is out of scope for #2244 slice 1; the current
		// contract is pinned by TestPinMessage_DuplicatePublishesNothing and
		// TestPinMessage_SuccessPublishesPinEventOnce.
		//
		// The classification itself used to be an inline case-sensitive check
		// for the literal "duplicate key" — the narrowest of the five copies in
		// the repo, and blind to SQLite's "UNIQUE constraint failed" wording
		// entirely, so an already-pinned message surfaced as a hard error
		// instead of as success.
		if repository.IsUniqueViolation(err) {
			return nil
		}
		return err
	}

	s.publish(ctx, bus.Event{Type: bus.EventTypeMessagePin, Payload: pin})

	return nil
}

func (s *Service) UnpinMessage(ctx context.Context, userID, sessionID, msgID string) error {
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

	s.publish(ctx, bus.Event{Type: bus.EventTypeMessageUnpin, Payload: map[string]string{
		"session_id": sessionID,
		"message_id": msgID,
	}})

	return nil
}

func (s *Service) ForwardMessage(ctx context.Context, userID, msgID string, targetSessionIDs []string) error {
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

func (s *Service) forwardOne(ctx context.Context, userID string, msg *model.Message, sessionID string) error {
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

	// Construct forwarded message (UUID allocated at orchestration edge)
	forwarded := newForwardedMessage(sessionID, seq, uuidv7.Must(), msg)

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
	s.publish(ctx, bus.Event{Type: bus.EventTypeMessageNew, Payload: forwarded})

	return nil
}
