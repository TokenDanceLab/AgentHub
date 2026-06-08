package service

import (
	"context"
	"strings"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

const maxMessageReactionLength = 64

type MessageReactionService struct {
	db  *gorm.DB
	bus *Bus
}

func NewMessageReactionService(db *gorm.DB, bus *Bus) *MessageReactionService {
	return &MessageReactionService{db: db, bus: bus}
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
		item := MessageReactionResponse{
			MessageID: messageID,
			SessionID: sessionID,
			Reaction:  summary.Reaction,
			Count:     summary.Count,
		}
		for _, reactedUserID := range summary.UserIDs {
			if reactedUserID == userID {
				item.ReactedByMe = true
				break
			}
		}
		resp = append(resp, item)
	}
	return resp, nil
}

func normalizeMessageReaction(reaction string) (string, error) {
	reaction = strings.TrimSpace(reaction)
	if reaction == "" || len([]rune(reaction)) > maxMessageReactionLength {
		return "", errcode.ErrBadRequest
	}
	return reaction, nil
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

	resp := &MessageReactionResponse{
		MessageID: messageID,
		SessionID: sessionID,
		Reaction:  reaction,
	}
	for _, summary := range summaries {
		if summary.Reaction != reaction {
			continue
		}
		resp.Count = summary.Count
		for _, reactedUserID := range summary.UserIDs {
			if reactedUserID == userID {
				resp.ReactedByMe = true
				break
			}
		}
		break
	}
	return resp, nil
}

func (s *MessageReactionService) publishMessageReactionEvent(ctx context.Context, eventType, action, userID string, resp *MessageReactionResponse) {
	if s.bus == nil || resp == nil {
		return
	}
	s.bus.Publish(ctx, Event{
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
