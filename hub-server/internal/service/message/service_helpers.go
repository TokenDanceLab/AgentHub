package message

import (
	"context"
	"errors"
	"log/slog"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service"
)

// Residual pure-helper peel #1153: orchestration helpers (bus, seq, attachments).

// publish is a nil-safe wrapper over the bus port.
func (s *Service) publish(ctx context.Context, event service.Event) {
	if s == nil || s.bus == nil {
		return
	}
	s.bus.Publish(ctx, event)
}

func (s *Service) allocateSeq(ctx context.Context, sessionID string) (int64, error) {
	seq, err := resolveCache(s.cacheClient).AllocateSeq(ctx, sessionID)
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

func (s *Service) ensureAttachmentReferenceAllowed(userID, attachmentID string) error {
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

func (s *Service) toMessageResponses(msgs []model.Message) []MessageResponse {
	attachmentsByMessage := s.attachmentsByMessageID(msgs)

	replyToIDs := collectReplyToIDs(msgs)
	var replyMessages map[string]*model.Message
	if len(replyToIDs) > 0 {
		fetched, err := repository.GetMessagesByIDs(s.db, replyToIDs)
		if err == nil {
			replyMessages = make(map[string]*model.Message, len(fetched))
			for i := range fetched {
				replyMessages[fetched[i].ID] = &fetched[i]
			}
		}
	}

	return projectMessageResponses(msgs, attachmentsByMessage, replyMessages)
}

func (s *Service) attachmentsByMessageID(msgs []model.Message) map[string][]model.Attachment {
	messageIDs := fileImageMessageIDs(msgs)
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
