package message

import (
	"context"
	"fmt"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
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

	s.publish(ctx, bus.Event{Type: bus.EventTypeMessageRead, Payload: map[string]interface{}{
		"session_id":    sessionID,
		"user_id":       userID,
		"last_read_seq": lastReadSeq,
	}})

	return nil
}

// MessageSearchPage is one page of message-search results (#2136 P2). The
// cursor is opaque to clients: session-scoped searches encode "<seq>|<id>",
// cross-session searches "<createdAtUnixNano>|<id>".
type MessageSearchPage struct {
	Items      []MessageResponse `json:"items"`
	NextCursor string            `json:"nextCursor"`
	HasMore    bool              `json:"hasMore"`
}

// SearchMessages searches messages matching q either inside a single session
// (sessionID non-empty, ordered by seq_id DESC) or across all sessions the
// user is a member of (ordered by created_at DESC). cursor is the opaque
// nextCursor of a previous page; empty starts from the first page.
func (s *Service) SearchMessages(ctx context.Context, userID, q, sessionID, contentType, from, to, cursor string, pageSize int) (*MessageSearchPage, error) {
	page := &MessageSearchPage{}
	if sessionID != "" {
		active, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, userID)
		if err != nil || !active {
			return nil, errcode.SessionNotMember
		}
		msgs, hasMore, err := repository.SearchMessages(s.db, q, sessionID, contentType, from, to, cursor, pageSize)
		if err != nil {
			return nil, err
		}
		page.HasMore = hasMore
		if hasMore && len(msgs) > 0 {
			last := msgs[len(msgs)-1]
			page.NextCursor = fmt.Sprintf("%d|%s", last.SeqID, last.ID)
		}
		page.Items = s.toMessageResponses(msgs)
		return page, nil
	}

	msgs, hasMore, err := repository.SearchAllMessages(s.db, userID, q, contentType, from, to, cursor, pageSize)
	if err != nil {
		return nil, err
	}
	page.HasMore = hasMore
	if hasMore && len(msgs) > 0 {
		last := msgs[len(msgs)-1]
		page.NextCursor = fmt.Sprintf("%d|%s", last.CreatedAt.UnixNano(), last.ID)
	}
	page.Items = s.toMessageResponses(msgs)
	return page, nil
}
