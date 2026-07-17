package service

import (
	"context"
	"log/slog"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// ── ContactService ports + type ──────────────────────────────────────────────
//
// Same-package thin first seam (#594): ContactService already owns contact/
// friendship orchestration (search/request/accept/reject/list/remove/block/
// unblock/remark). This seam hardens replaceable ports (bus + cache) without a
// package move — same pattern as MessageService (#585) / DispatchService /
// EdgeCallbackService. Full service/im subpackage extract remains deferred.
// SessionService is owned by #593 and is out of scope here.

// contactBus publishes domain events from contact write paths.
// Implemented by *Bus.
type contactBus interface {
	Publish(ctx context.Context, event Event)
}

// contactCache is the subset of *cache.Client methods used by ContactService.
// Implemented by *cache.Client and cache.NoOpCache.
type contactCache interface {
	Invalidate(ctx context.Context, keys ...string) error
	IsOnline(ctx context.Context, userID string) (bool, error)
}

// ContactService owns contact/friendship orchestration in the flat service
// package: user search, friend request lifecycle, contact list/remove, block/
// unblock, remark, and friend-ID projection. Friend-list invalidation and
// presence use injected contactCache; domain events go through contactBus.
// Not a package move (#594).
type ContactService struct {
	db          *gorm.DB
	bus         contactBus
	cacheClient contactCache
}

// NewContactService constructs a ContactService.
// bus may be nil for read-only/partial tests; write paths that publish no-op.
// cacheClient may be nil and falls back to cache.NoOpCache.
func NewContactService(db *gorm.DB, bus contactBus, cacheClient contactCache) *ContactService {
	return &ContactService{db: db, bus: bus, cacheClient: resolveContactCache(cacheClient)}
}

// SetBus injects (or replaces) the event bus port.
func (s *ContactService) SetBus(bus contactBus) {
	if s == nil {
		return
	}
	s.bus = bus
}

// SetCache injects (or replaces) the contact cache port.
func (s *ContactService) SetCache(cacheClient contactCache) {
	if s == nil {
		return
	}
	s.cacheClient = resolveContactCache(cacheClient)
}

// publish is a nil-safe wrapper over the bus port.
func (s *ContactService) publish(ctx context.Context, event Event) {
	if s == nil || s.bus == nil {
		return
	}
	s.bus.Publish(ctx, event)
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
		return nil, repository.WrapNotFound(err, errcode.UserNotFound)
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
		return repository.WrapNotFound(err, errcode.UserNotFound)
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

	_ = resolveContactCache(s.cacheClient).Invalidate(ctx, "user:friends:"+userID, "user:friends:"+friendID)
	s.publish(ctx, Event{Type: "friend.request", Payload: map[string]interface{}{
		"request_id":   f.ID,
		"from_user_id": userID,
		"message":      message,
	}})

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

	_ = resolveContactCache(s.cacheClient).Invalidate(ctx, "user:friends:"+userID, "user:friends:"+r.UserID)
	s.publish(ctx, Event{Type: "friend.accepted", Payload: map[string]interface{}{
		"friendship_id": r.ID,
		"user_id":       r.UserID,
		"accepter_id":   userID,
	}})
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
	if err := repository.DeleteFriendship(s.db, r); err != nil {
		return err
	}
	_ = resolveContactCache(s.cacheClient).Invalidate(ctx, "user:friends:"+userID, "user:friends:"+r.UserID)
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
		online, _ := resolveContactCache(s.cacheClient).IsOnline(ctx, friend.ID)
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
	_ = resolveContactCache(s.cacheClient).Invalidate(ctx, "user:friends:"+currentUserID, "user:friends:"+friendUserID)
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

	// #183: Only upsert the caller→target direction to blocked.
	// Do not delete the reverse direction — that would wipe a target→caller
	// blocked row (cross-user data loss).
	if err := repository.UpsertFriendship(s.db, &model.Friendship{
		UserID: currentUserID, FriendID: targetUserID, Status: model.StatusBlocked,
	}); err != nil {
		return err
	}
	_ = resolveContactCache(s.cacheClient).Invalidate(ctx, "user:friends:"+currentUserID, "user:friends:"+targetUserID)
	return nil
}

func (s *ContactService) UnblockContact(ctx context.Context, currentUserID, targetUserID string) error {
	f, err := repository.GetFriendship(s.db, currentUserID, targetUserID)
	if err != nil || f.Status != model.StatusBlocked {
		return errcode.FriendRequestNotFound
	}
	if err := repository.DeleteFriendship(s.db, f); err != nil {
		return err
	}
	_ = resolveContactCache(s.cacheClient).Invalidate(ctx, "user:friends:"+currentUserID, "user:friends:"+targetUserID)
	return nil
}

func (s *ContactService) UpdateRemark(ctx context.Context, currentUserID, friendUserID, remark string) error {
	if err := repository.UpdateFriendshipRemark(s.db, currentUserID, friendUserID, remark); err != nil {
		return repository.WrapNotFound(err, errcode.FriendRemarkNoRow)
	}
	return nil
}

// GetFriendIDs returns the IDs of all accepted friends of the given user. Thin wrapper over repository.GetFriendIDs.
func (s *ContactService) GetFriendIDs(userID string) ([]string, error) {
	return repository.GetFriendIDs(s.db, userID)
}
