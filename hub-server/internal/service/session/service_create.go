// #1161: Session Service pure-helper peel — create paths extracted from service.go.
package session

import (
	"context"
	"errors"
	"log/slog"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

func (s *Service) CreatePrivateSession(ctx context.Context, currentUserID, targetUserID string) (*CreateSessionResponse, error) {
	if targetUserID == currentUserID {
		return nil, errcode.ErrBadRequest
	}

	_, err := repository.GetUserByID(s.db, targetUserID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}

	// #122: verify both users are friends before creating a private session.
	f, err := repository.FindFriendshipBetween(s.db, currentUserID, targetUserID)
	if err != nil {
		return nil, err
	}
	if f == nil || f.Status != model.StatusAccepted {
		return nil, errcode.FriendNotFriend
	}

	existing, err := repository.FindPrivateSessionBetween(s.db, currentUserID, targetUserID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return NewExistingSessionResponse(existing.ID, existing.Type), nil
	}

	session := &model.Session{Type: model.SessionTypePrivate}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.CreateSession(tx, session); err != nil {
			return err
		}
		return repository.BatchCreateMembers(tx, PrivateSessionMembers(session.ID, currentUserID, targetUserID))
	})
	if err != nil {
		return nil, err
	}

	if err := resolveCache(s.cacheClient).InitSeqIfAbsent(ctx, session.ID, 0); err != nil {
		slog.Warn("failed to init seq in redis", "session_id", session.ID, "error", err)
	}
	s.publishEvent(ctx, EventTypeSessionCreated, PrivateSessionCreatedPayload(session.ID, currentUserID, targetUserID))

	return NewCreateSessionResponse(session.ID, model.SessionTypePrivate, true), nil
}

func (s *Service) CreateGroupSession(ctx context.Context, ownerUserID, name string, memberIDs []string) (*CreateSessionResponse, error) {
	if len(name) == 0 || len(name) > config.MaxGroupNameLength {
		return nil, errcode.ErrBadRequest
	}

	if len(memberIDs) > 0 {
		friendIDs, err := repository.GetFriendIDs(s.db, ownerUserID)
		if err != nil {
			return nil, err
		}
		if !AllAreFriends(friendIDs, memberIDs) {
			return nil, errcode.ErrBadRequest
		}
	}

	session := &model.Session{Type: model.SessionTypeGroup, Name: name, OwnerUserID: &ownerUserID}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.CreateSession(tx, session); err != nil {
			return err
		}
		return repository.BatchCreateMembers(tx, GroupSessionMembers(session.ID, ownerUserID, memberIDs))
	})
	if err != nil {
		return nil, err
	}

	if err := resolveCache(s.cacheClient).InitSeqIfAbsent(ctx, session.ID, 0); err != nil {
		slog.Warn("failed to init seq in redis", "session_id", session.ID, "error", err)
	}
	s.publishEvent(ctx, EventTypeSessionCreated, GroupSessionCreatedPayload(
		session.ID, name, ownerUserID, GroupMemberIDsForEvent(ownerUserID, memberIDs),
	))

	return NewCreateSessionResponse(session.ID, model.SessionTypeGroup, true), nil
}

func (s *Service) ListSessions(ctx context.Context, userID string) ([]SessionListItem, error) {
	sessions, err := repository.ListUserSessions(s.db, userID)
	if err != nil {
		return nil, err
	}
	return MapSessionListItems(sessions), nil
}

func (s *Service) getSession(ctx context.Context, sessionID string) (*model.Session, error) {
	session, err := repository.GetSessionByID(s.db, sessionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.SessionNotFound
		}
		return nil, err
	}
	if session.Dissolved {
		return nil, errcode.SessionDissolved
	}
	return session, nil
}

func (s *Service) requireMember(ctx context.Context, sessionID, userID string) (*model.SessionMember, error) {
	active, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, userID)
	if err != nil {
		return nil, err
	}
	if !active {
		return nil, errcode.SessionNotMember
	}
	member, err := repository.GetActiveMember(s.db, sessionID, model.MemberTypeUser, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// IsMemberActive saw the member but the row disappeared before the
			// read: report not-a-member instead of masking the DB error or
			// leaking a zero-value member.Role to permission checks.
			return nil, errcode.SessionNotMember
		}
		return nil, err
	}
	return member, nil
}
