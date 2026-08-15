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
// allocator (Redis INCR → DB mirror → DB fallback), then touches
// last_message_at so the session appears in recent conversations (#154).
func (s *Service) allocateSeq(ctx context.Context, sessionID string) (int64, error) {
	seq, err := s.seqAllocator().Allocate(ctx, sessionID)
	if err == nil {
		if touchErr := repository.TouchSessionLastMessage(s.db, sessionID); touchErr != nil {
			slog.Warn("failed to touch session last_message_at after seq alloc", "session_id", sessionID, "error", touchErr)
		}
	}
	return seq, err
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
