package service

import (
	"context"
	"errors"
	"log/slog"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// contactCache is the subset of *cache.Client methods used by ContactService.
type contactCache interface {
	Invalidate(ctx context.Context, keys ...string) error
	IsOnline(ctx context.Context, userID string) (bool, error)
}

type ContactService struct {
	db          *gorm.DB
	bus         *Bus
	cacheClient contactCache
}

func NewContactService(db *gorm.DB, bus *Bus, cacheClient *cache.Client) *ContactService {
	return &ContactService{db: db, bus: bus, cacheClient: cacheClient}
}

type SearchResult struct {
	UserID       string `json:"user_id"`
	Username     string `json:"username"`
	Nickname     string `json:"nickname"`
	AvatarURL    string `json:"avatar_url,omitempty"`
	Relationship string `json:"relationship"`
}

type RequestInfo struct {
	RequestID string `json:"request_id"`
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"avatar_url,omitempty"`
	Message   string `json:"message"`
	CreatedAt string `json:"created_at"`
}

type ContactInfo struct {
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"avatar_url,omitempty"`
	Remark    string `json:"remark,omitempty"`
	Online    bool   `json:"online"`
	Type      string `json:"type"`
}

func (s *ContactService) SearchUser(ctx context.Context, currentUserID, targetID string) (*SearchResult, error) {
	if targetID == currentUserID {
		return nil, errcode.UserInvalidParam
	}

	target, err := repository.GetUserByID(s.db, targetID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}

	rel := "stranger"
	f, err := repository.FindFriendshipBetween(s.db, currentUserID, targetID)
	if err != nil {
		return nil, err
	}
	if f != nil {
		switch f.Status {
		case model.StatusAccepted:
			rel = "friend"
		case model.StatusPending:
			if f.UserID == currentUserID {
				rel = "pending_sent"
			} else {
				rel = "pending_received"
			}
		case model.StatusBlocked:
			if f.UserID == targetID {
				return nil, errcode.FriendBlocked
			}
			rel = "blocked"
		}
	}

	return &SearchResult{
		UserID:       target.ID,
		Username:     target.Username,
		Nickname:     target.Nickname,
		AvatarURL:    target.AvatarURL,
		Relationship: rel,
	}, nil
}

func (s *ContactService) SendFriendRequest(ctx context.Context, userID, friendID, message string) error {
	if friendID == userID {
		return errcode.UserInvalidParam
	}

	_, err := repository.GetUserByID(s.db, friendID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.UserNotFound
		}
		return err
	}

	existing, err := repository.FindFriendshipBetween(s.db, userID, friendID)
	if err != nil {
		return err
	}
	if existing != nil {
		switch existing.Status {
		case model.StatusBlocked:
			if existing.UserID == friendID {
				return errcode.FriendBlocked
			}
			return errcode.FriendAlready
		case model.StatusPending:
			return errcode.FriendAlready
		case model.StatusAccepted:
			return errcode.FriendAlready
		}
	}

	f := &model.Friendship{
		UserID:         userID,
		FriendID:       friendID,
		Status:         model.StatusPending,
		RequestMessage: message,
	}
	if err := repository.CreateFriendship(s.db, f); err != nil {
		return err
	}

	if s.bus != nil {
		s.bus.Publish(ctx, Event{Type: "friend.request", Payload: map[string]interface{}{
			"sender_id":  userID,
			"receiver_id": friendID,
			"message":    message,
		}})
	}

	return nil
}

func (s *ContactService) ListFriendRequests(ctx context.Context, userID string) ([]RequestInfo, error) {
	requests, err := repository.ListReceivedRequests(s.db, userID)
	if err != nil {
		return nil, err
	}

	if len(requests) == 0 {
		return []RequestInfo{}, nil
	}

	// Collect sender IDs for batch query (P2-1: fix N+1)
	senderIDs := make([]string, 0, len(requests))
	for _, r := range requests {
		senderIDs = append(senderIDs, r.UserID)
	}

	users, err := repository.GetUsersByIDs(s.db, senderIDs)
	if err != nil {
		return nil, err
	}

	result := make([]RequestInfo, 0, len(requests))
	for _, r := range requests {
		sender, ok := users[r.UserID]
		if !ok {
			slog.Debug("friend request sender not found in batch lookup", "sender_id", r.UserID, "request_id", r.ID)
			continue
		}
		result = append(result, RequestInfo{
			RequestID: r.ID,
			UserID:    sender.ID,
			Username:  sender.Username,
			Nickname:  sender.Nickname,
			AvatarURL: sender.AvatarURL,
			Message:   r.RequestMessage,
			CreatedAt: r.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	return result, nil
}

func (s *ContactService) AcceptFriendRequest(ctx context.Context, userID, requestID string) error {
	r, err := repository.GetFriendshipByID(s.db, requestID)
	if err != nil {
		return errcode.FriendRequestNotFound
	}
	if r.FriendID != userID || r.Status != model.StatusPending {
		return errcode.FriendRequestNotFound
	}

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.UpdateFriendshipByID(tx, r.ID, model.StatusAccepted); err != nil {
			return err
		}

		reciprocal := &model.Friendship{
			UserID:   userID,
			FriendID: r.UserID,
			Status:   model.StatusAccepted,
		}
		return repository.UpsertFriendship(tx, reciprocal)
	}); err != nil {
		return err
	}

	s.cacheClient.Invalidate(ctx, "user:friends:"+userID, "user:friends:"+r.UserID)
	return nil
}

func (s *ContactService) RejectFriendRequest(ctx context.Context, userID, requestID string) error {
	r, err := repository.GetFriendshipByID(s.db, requestID)
	if err != nil {
		return errcode.FriendRequestNotFound
	}
	if r.FriendID != userID || r.Status != model.StatusPending {
		return errcode.FriendRequestNotFound
	}
	if err := s.db.Delete(r).Error; err != nil {
		return err
	}
	s.cacheClient.Invalidate(ctx, "user:friends:"+userID, "user:friends:"+r.UserID)
	return nil
}

func (s *ContactService) ListContacts(ctx context.Context, userID string) ([]ContactInfo, error) {
	friends, err := repository.ListAcceptedFriends(s.db, userID)
	if err != nil {
		return nil, err
	}

	if len(friends) == 0 {
		return []ContactInfo{}, nil
	}

	// Collect friend IDs for batch query (P2-2: fix N+1)
	friendIDs := make([]string, 0, len(friends))
	for _, f := range friends {
		friendIDs = append(friendIDs, f.FriendID)
	}

	users, err := repository.GetUsersByIDs(s.db, friendIDs)
	if err != nil {
		return nil, err
	}

	result := make([]ContactInfo, 0, len(friends))
	for _, f := range friends {
		friend, ok := users[f.FriendID]
		if !ok {
			continue
		}
		online, _ := s.cacheClient.IsOnline(ctx, friend.ID)
		result = append(result, ContactInfo{
			UserID:    friend.ID,
			Username:  friend.Username,
			Nickname:  friend.Nickname,
			AvatarURL: friend.AvatarURL,
			Remark:    f.Remark,
			Online:    online,
			Type:      "user",
		})
	}
	return result, nil
}

func (s *ContactService) RemoveContact(ctx context.Context, currentUserID, friendUserID string) error {
	_, err := repository.GetFriendship(s.db, currentUserID, friendUserID)
	if err != nil {
		return errcode.FriendRequestNotFound
	}
	if err := repository.DeleteFriendshipPair(s.db, currentUserID, friendUserID); err != nil {
		return err
	}
	s.cacheClient.Invalidate(ctx, "user:friends:"+currentUserID, "user:friends:"+friendUserID)
	return nil
}

func (s *ContactService) BlockContact(ctx context.Context, currentUserID, targetUserID string) error {
	if targetUserID == currentUserID {
		return errcode.UserInvalidParam
	}

	_, err := repository.GetUserByID(s.db, targetUserID)
	if err != nil {
		return errcode.UserNotFound
	}

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
			currentUserID, targetUserID, targetUserID, currentUserID).Delete(&model.Friendship{}).Error; err != nil {
			return err
		}
		return repository.CreateFriendship(tx, &model.Friendship{
			UserID: currentUserID, FriendID: targetUserID, Status: model.StatusBlocked,
		})
	}); err != nil {
		return err
	}
	s.cacheClient.Invalidate(ctx, "user:friends:"+currentUserID, "user:friends:"+targetUserID)
	return nil
}

func (s *ContactService) UnblockContact(ctx context.Context, currentUserID, targetUserID string) error {
	f, err := repository.GetFriendship(s.db, currentUserID, targetUserID)
	if err != nil || f.Status != model.StatusBlocked {
		return errcode.FriendRequestNotFound
	}
	if err := s.db.Delete(f).Error; err != nil {
		return err
	}
	s.cacheClient.Invalidate(ctx, "user:friends:"+currentUserID, "user:friends:"+targetUserID)
	return nil
}

func (s *ContactService) UpdateRemark(ctx context.Context, currentUserID, friendUserID, remark string) error {
	return repository.UpdateFriendshipRemark(s.db, currentUserID, friendUserID, remark)
}
