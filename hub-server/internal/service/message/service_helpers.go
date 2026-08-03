package message

import (
	"context"
	"errors"
	"log/slog"
	"sync"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// Residual pure-helper peel #1153: orchestration helpers (bus, seq, attachments).

// publish is a nil-safe wrapper over the bus port.
func (s *Service) publish(ctx context.Context, event bus.Event) {
	if s == nil || s.bus == nil {
		return
	}
	s.bus.Publish(ctx, event)
}

// seqLocks serializes seq allocation per session. Redis INCR is atomic, but
// the DB mirror (SyncSessionSeq) and the DB fallback path (AllocateSeqID) both
// touch sessions.next_seq; without serialization the two sources can interleave
// and hand out duplicate seq values (#1533). Different sessions stay parallel.
var seqLocks sync.Map // sessionID -> *sync.Mutex

func seqLockFor(sessionID string) *sync.Mutex {
	v, _ := seqLocks.LoadOrStore(sessionID, &sync.Mutex{})
	return v.(*sync.Mutex)
}

func (s *Service) allocateSeq(ctx context.Context, sessionID string) (int64, error) {
	mu := seqLockFor(sessionID)
	mu.Lock()
	defer mu.Unlock()

	seq, err := resolveCache(s.cacheClient).AllocateSeq(ctx, sessionID)
	if err == nil {
		// #154: Redis allocation does not update last_message_at, so touch it here
		// to ensure the session appears in recent conversations.
		if touchErr := repository.TouchSessionLastMessage(s.db, sessionID); touchErr != nil {
			slog.Warn("failed to touch session last_message_at after redis seq alloc", "session_id", sessionID, "error", touchErr)
		}
		if seq == 1 {
			// Redis key 刚重建（重启 / FLUSH / key 过期）：从 DB 持久镜像恢复，
			// 防止 seq 回退或重复（seq continuity contract, #1533）。
			var dbSeq int64
			if dbErr := s.db.Raw("SELECT next_seq FROM sessions WHERE id = ?", sessionID).Scan(&dbSeq).Error; dbErr == nil && dbSeq > 0 {
				if setErr := resolveCache(s.cacheClient).SetSeq(ctx, sessionID, dbSeq); setErr == nil {
					if recovered, incrErr := resolveCache(s.cacheClient).AllocateSeq(ctx, sessionID); incrErr == nil {
						seq = recovered
					}
				}
			}
		}
		// 持久化镜像：Redis 是实时分配源，DB 只前推不回退，供恢复使用。
		if syncErr := repository.SyncSessionSeq(s.db, sessionID, seq); syncErr != nil {
			slog.Warn("failed to sync session seq mirror to db", "session_id", sessionID, "seq", seq, "error", syncErr)
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
	if err == nil {
		// 尽力把 DB 分配同步回 Redis，避免 Redis 恢复后 INCR 从旧值继续
		// 而重复 fallback 已分配的 seq（失败可忽略——Redis 故障中）。
		if setErr := resolveCache(s.cacheClient).SetSeq(ctx, sessionID, fallbackSeq); setErr != nil {
			slog.Warn("failed to mirror fallback seq to redis", "session_id", sessionID, "seq", fallbackSeq, "error", setErr)
		}
	}
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
