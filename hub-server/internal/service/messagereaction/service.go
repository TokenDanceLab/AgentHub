package messagereaction

import (
	"context"
	"log/slog"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/im"
)

// Bus publishes domain events from reaction write paths.
// *bus.Bus satisfies this port via Publish(ctx, bus.Event).
type Bus interface {
	Publish(ctx context.Context, event bus.Event) error
}

// Service owns IM message reaction orchestration: add/remove/list summaries +
// access checks. Domain events go through Bus. Pure reaction normalize/summary
// helpers remain in service/im (#628/#639/#651); this package is the first IM
// typed-service extract (#662).
type Service struct {
	db  *gorm.DB
	bus Bus
}

// NewService constructs a message-reaction service.
// bus may be nil for read-only/partial tests; write paths that publish no-op.
func NewService(db *gorm.DB, bus Bus) *Service {
	return &Service{db: db, bus: bus}
}

// SetBus injects (or replaces) the event bus port.
func (s *Service) SetBus(bus Bus) {
	if s == nil {
		return
	}
	s.bus = bus
}

// publish is a nil-safe wrapper over the bus port.
func (s *Service) publish(ctx context.Context, event bus.Event) {
	if s == nil || s.bus == nil {
		return
	}
	if err := s.bus.Publish(ctx, event); err != nil {
		slog.Warn("failed to publish reaction event", "event_type", event.Type, "error", err)
	}
}

// MessageReactionResponse is the API/handler summary DTO for one reaction key.
// JSON field names are contract-stable (OpenAPI MessageReactionResponse).
type MessageReactionResponse struct {
	MessageID   string `json:"message_id"`
	SessionID   string `json:"session_id"`
	Reaction    string `json:"reaction"`
	Count       int    `json:"count"`
	ReactedByMe bool   `json:"reacted_by_me"`
}

// MessageReactionEventPayload is the bus/WS payload for reaction add/remove.
// JSON field names are contract-stable for frame payloads.
type MessageReactionEventPayload struct {
	Action    string `json:"action"`
	UserID    string `json:"user_id"`
	MessageID string `json:"message_id"`
	SessionID string `json:"session_id"`
	Reaction  string `json:"reaction"`
	Count     int    `json:"count"`
}

// AddMessageReaction adds (or idempotently re-adds) a user reaction and returns
// the updated summary. Publishes message.reaction_added only on first add.
func (s *Service) AddMessageReaction(ctx context.Context, userID, sessionID, messageID, reaction string) (*MessageReactionResponse, error) {
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

// RemoveMessageReaction removes a user reaction (idempotent) and returns the
// updated summary. Publishes message.reaction_removed only when a row existed.
func (s *Service) RemoveMessageReaction(ctx context.Context, userID, sessionID, messageID, reaction string) (*MessageReactionResponse, error) {
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

// ListMessageReactions returns grouped reaction summaries for a message.
func (s *Service) ListMessageReactions(ctx context.Context, userID, sessionID, messageID string) ([]MessageReactionResponse, error) {
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

// normalizeMessageReaction maps pure-helper errors to the package domain error.
func normalizeMessageReaction(reaction string) (string, error) {
	normalized, err := im.NormalizeMessageReaction(reaction)
	if err != nil {
		return "", errcode.ErrBadRequest
	}
	return normalized, nil
}

func (s *Service) ensureMessageReactionAccess(sessionID, messageID, userID string) error {
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

func (s *Service) messageReactionSnapshot(sessionID, messageID, userID, reaction string) (*MessageReactionResponse, error) {
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

func (s *Service) publishMessageReactionEvent(ctx context.Context, eventType, action, userID string, resp *MessageReactionResponse) {
	if resp == nil {
		return
	}
	s.publish(ctx, bus.Event{
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
