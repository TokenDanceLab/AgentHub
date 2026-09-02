package message

import (
	"context"
	"errors"
	"log/slog"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/seqalloc"
)

// Residual pure-helper peel #1153: orchestration helpers (bus, seq, attachments).

// publish is a nil-safe wrapper over the bus port.
func (s *Service) publish(ctx context.Context, event bus.Event) {
	if s == nil || s.bus == nil {
		return
	}
	if err := s.bus.Publish(ctx, event); err != nil {
		slog.Warn("failed to publish message event", "event_type", event.Type, "error", err)
	}
}

// allocateSeq allocates the next sequence number via the shared seqalloc
// allocator (Redis INCR → DB mirror → DB fallback).
//
// It deliberately does NOT touch sessions.last_message_at. It used to (#154),
// which made every SendMessage / ForwardMessage issue two UPDATEs against the
// same `sessions` row in one request: one here, outside any transaction, and
// one inside the caller's persist transaction (#2154 P2-8). Only the in-
// transaction touch survives — it is atomic with the message insert, so a
// rolled-back insert can no longer leave the session looking freshly active,
// and the hot `sessions` row is written once instead of twice.
//
// Both callers in this package already touch inside their transaction
// (persistSendMessageTx for SendMessage, forwardOne for ForwardMessage), so no
// path lost its #154 behavior; TestSendMessage_TouchesSessionLastMessageOnce
// locks that. The agent-service allocateSeq (service/agent/agent.go) is a
// separate method that never touched here, and the Edge stream callback path
// touches through its own throttled writer (service/agent
// touchSessionLastMessageThrottled), so no agent path is affected either.
func (s *Service) allocateSeq(ctx context.Context, sessionID string) (int64, error) {
	return s.seqAllocator().Allocate(ctx, sessionID)
}

// seqAllocator returns the configured allocator, lazily constructing one from
// the cache port + DB for struct-literal tests that bypass NewService.
func (s *Service) seqAllocator() *seqalloc.Allocator {
	if s.seqAlloc != nil {
		return s.seqAlloc
	}
	return seqalloc.New(resolveCache(s.cacheClient), s.db)
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
