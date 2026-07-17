package service

import (
	"context"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/im"
)

// ── MessageReactionService ports + type ──────────────────────────────────────
//
// Same-package thin residual seam (#639/#651): MessageReactionService already
// owns reaction add/remove/list orchestration. This seam hardens a replaceable
// bus port (messageReactionBus) and moves pure reaction normalize + summary
// projection helpers into service/im, matching MessageService (#585) /
// service/im pure helpers (#628/#639/#651). Not a package move;
// OpenAPI/handler/frontend unchanged.

// messageReactionBus publishes domain events from reaction write paths.
// Implemented by *Bus.
type messageReactionBus interface {
	Publish(ctx context.Context, event Event)
}

// MessageReactionService owns IM message reaction orchestration in the flat
// service package: add/remove/list summaries + access checks. Domain events go
// through messageReactionBus. Not a package move (#639/#651).
type MessageReactionService struct {
	db  *gorm.DB
	bus messageReactionBus
}

// NewMessageReactionService constructs a MessageReactionService.
// bus may be nil for read-only/partial tests; write paths that publish no-op.
func NewMessageReactionService(db *gorm.DB, bus messageReactionBus) *MessageReactionService {
	return &MessageReactionService{db: db, bus: bus}
}

// SetBus injects (or replaces) the event bus port.
func (s *MessageReactionService) SetBus(bus messageReactionBus) {
	if s == nil {
		return
	}
	s.bus = bus
}

// publish is a nil-safe wrapper over the bus port.
func (s *MessageReactionService) publish(ctx context.Context, event Event) {
	if s == nil || s.bus == nil {
		return
	}
	s.bus.Publish(ctx, event)
}

type MessageReactionResponse struct {
	MessageID   string `json:"message_id"`
	SessionID   string `json:"session_id"`
	Reaction    string `json:"reaction"`
	Count       int    `json:"count"`
	ReactedByMe bool   `json:"reacted_by_me"`
}

type MessageReactionEventPayload struct {
	Action    string `json:"action"`
	UserID    string `json:"user_id"`
	MessageID string `json:"message_id"`
	SessionID string `json:"session_id"`
	Reaction  string `json:"reaction"`
	Count     int    `json:"count"`
}

func (s *MessageReactionService) AddMessageReaction(ctx context.Context, userID, sessionID, messageID, reaction string) (*MessageReactionResponse, error) {
	reaction, err := normalizeMessageReaction(reaction)
	if err != nil {
		return nil, err
	}
	if err := s.ensureMessageReactionAccess(sessionID, messageID, userID); err != nil {
		return nil, err
	}

	before, err := s.messageReactionSnapshot(sessionID, messageID, userID, reaction)
	if err != nil {
		return nil, err
	}

	if err := repository.AddReaction(s.db, &model.MessageReaction{
		SessionID: sessionID,
		MessageID: messageID,
		UserID:    userID,
		Reaction:  reaction,
	}); err != nil {
		return nil, err
	}

	resp, err := s.messageReactionSnapshot(sessionID, messageID, userID, reaction)
	if err != nil {
		return nil, err
	}
	if !before.ReactedByMe {
		s.publishMessageReactionEvent(ctx, "message.reaction_added", "added", userID, resp)
	}
	return resp, nil
}

func (s *MessageReactionService) RemoveMessageReaction(ctx context.Context, userID, sessionID, messageID, reaction string) (*MessageReactionResponse, error) {
	reaction, err := normalizeMessageReaction(reaction)
	if err != nil {
		return nil, err
	}
	if err := s.ensureMessageReactionAccess(sessionID, messageID, userID); err != nil {
		return nil, err
	}

	before, err := s.messageReactionSnapshot(sessionID, messageID, userID, reaction)
	if err != nil {
		return nil, err
	}

	if err := repository.RemoveReaction(s.db, sessionID, messageID, userID, reaction); err != nil {
		return nil, err
	}

	resp, err := s.messageReactionSnapshot(sessionID, messageID, userID, reaction)
	if err != nil {
		return nil, err
	}
	if before.ReactedByMe {
		s.publishMessageReactionEvent(ctx, "message.reaction_removed", "removed", userID, resp)
	}
	return resp, nil
}

func (s *MessageReactionService) ListMessageReactions(ctx context.Context, userID, sessionID, messageID string) ([]MessageReactionResponse, error) {
	if err := s.ensureMessageReactionAccess(sessionID, messageID, userID); err != nil {
		return nil, err
	}

	summaries, err := repository.ReactionSummariesByMessage(s.db, sessionID, messageID)
	if err != nil {
		return nil, err
	}

	resp := make([]MessageReactionResponse, 0, len(summaries))
	for _, summary := range summaries {
		resp = append(resp, MessageReactionResponse{
			MessageID:   messageID,
			SessionID:   sessionID,
			Reaction:    summary.Reaction,
			Count:       summary.Count,
			ReactedByMe: im.UserReacted(summary.UserIDs, userID),
		})
	}
	return resp, nil
}

// normalizeMessageReaction is a thin alias to im.NormalizeMessageReaction that
// maps pure-helper errors to the package domain error.
func normalizeMessageReaction(reaction string) (string, error) {
	normalized, err := im.NormalizeMessageReaction(reaction)
	if err != nil {
		return "", errcode.ErrBadRequest
	}
	return normalized, nil
}

func (s *MessageReactionService) ensureMessageReactionAccess(sessionID, messageID, userID string) error {
	active, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, userID)
	if err != nil {
		return err
	}
	if !active {
		return errcode.SessionNotMember
	}

	if _, err := repository.GetMessageBySessionAndID(s.db, sessionID, messageID); err != nil {
		return errcode.MsgNotFound
	}
	return nil
}

func (s *MessageReactionService) messageReactionSnapshot(sessionID, messageID, userID, reaction string) (*MessageReactionResponse, error) {
	summaries, err := repository.ReactionSummariesByMessage(s.db, sessionID, messageID)
	if err != nil {
		return nil, err
	}

	count, reactedByMe := im.ReactionCountFor(summaries, reaction, userID)
	return &MessageReactionResponse{
		MessageID:   messageID,
		SessionID:   sessionID,
		Reaction:    reaction,
		Count:       count,
		ReactedByMe: reactedByMe,
	}, nil
}

func (s *MessageReactionService) publishMessageReactionEvent(ctx context.Context, eventType, action, userID string, resp *MessageReactionResponse) {
	if resp == nil {
		return
	}
	s.publish(ctx, Event{
		Type: eventType,
		Payload: MessageReactionEventPayload{
			Action:    action,
			UserID:    userID,
			MessageID: resp.MessageID,
			SessionID: resp.SessionID,
			Reaction:  resp.Reaction,
			Count:     resp.Count,
		},
	})
}
