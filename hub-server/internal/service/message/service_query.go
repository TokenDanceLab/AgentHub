package message

import (
	"context"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service"
)

// Residual pure-helper peel #1153: history/search/pin-list/mark-read query paths.

func (s *Service) GetMessages(ctx context.Context, sessionID, userID string, beforeSeq int64, limit int) ([]MessageResponse, error) {
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

func (s *Service) GetMessagesIncremental(ctx context.Context, sessionID, userID string, afterSeq int64, limit int) ([]MessageResponse, error) {
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

func (s *Service) ListPinnedMessages(ctx context.Context, userID, sessionID string) ([]MessageResponse, error) {
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

	ordered := orderMessagesByIDs(msgMap, msgIDs)
	return s.toMessageResponses(ordered), nil
}

func (s *Service) MarkRead(ctx context.Context, userID, sessionID string, lastReadSeq int64) error {
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

	s.publish(ctx, service.Event{Type: "message.read", Payload: map[string]interface{}{
		"session_id":    sessionID,
		"user_id":       userID,
		"last_read_seq": lastReadSeq,
	}})

	return nil
}

func (s *Service) SearchMessages(ctx context.Context, userID, q, sessionID, contentType, from, to string) ([]MessageResponse, error) {
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
