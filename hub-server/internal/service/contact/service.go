package contact

import (
	"context"
	"log/slog"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// Bus publishes domain events from contact write paths.
// *bus.Bus satisfies this port via Publish(ctx, bus.Event).
type Bus interface {
	Publish(ctx context.Context, event bus.Event) error
}

// Cache is the subset of *cache.Client methods used by Contact Service.
// Implemented by *cache.Client and cache.NoOpCache.
type Cache interface {
	Invalidate(ctx context.Context, keys ...string) error
	IsOnline(ctx context.Context, userID string) (bool, error)
	// AreOnline batches presence lookups in one round trip (#2154 perf lane).
	AreOnline(ctx context.Context, userIDs []string) (map[string]bool, error)
}

// Service owns contact/friendship orchestration: user search, friend request
// lifecycle, contact list/remove, block/unblock, remark, and friend-ID
// projection. Friend-list invalidation and presence use injected Cache; domain
// events go through Bus. This package is the third IM typed-service extract
// (#685) after messagereaction (#662) and workspace (#673). Ports were
// hardened in #594; package move only.
type Service struct {
	db          *gorm.DB
	bus         Bus
	cacheClient Cache
}

// NewService constructs a contact service.
// bus may be nil for read-only/partial tests; write paths that publish no-op.
// cacheClient may be nil and falls back to cache.NoOpCache.
func NewService(db *gorm.DB, bus Bus, cacheClient Cache) *Service {
	return &Service{db: db, bus: bus, cacheClient: resolveCache(cacheClient)}
}

// SetBus injects (or replaces) the event bus port.
func (s *Service) SetBus(bus Bus) {
	if s == nil {
		return
	}
	s.bus = bus
}

// SetCache injects (or replaces) the contact cache port.
func (s *Service) SetCache(cacheClient Cache) {
	if s == nil {
		return
	}
	s.cacheClient = resolveCache(cacheClient)
}

// publish is a nil-safe wrapper over the bus port.
func (s *Service) publish(ctx context.Context, event bus.Event) {
	if s == nil || s.bus == nil {
		return
	}
	if err := s.bus.Publish(ctx, event); err != nil {
		slog.Warn("failed to publish contact event", "event_type", event.Type, "error", err)
	}
}

// resolveCache returns c, falling back to cache.NoOpCache when c is nil or a
// typed-nil cache port. Thin type-bridge over cache.ResolveCache so call sites
// stay on the package-local Cache interface; the nil-detection logic lives in
// the shared internal/cache helper (Audit-D §4 cluster 2).
func resolveCache(c Cache) Cache {
	return cache.ResolveCache[Cache](c, cache.NoOpCache{})
}

// SearchResult is the API/handler DTO for user search.
// JSON field names are contract-stable.
type SearchResult struct {
	UserID       string `json:"user_id"`
	Username     string `json:"username"`
	Nickname     string `json:"nickname"`
	AvatarURL    string `json:"avatar_url,omitempty"`
	Relationship string `json:"relationship"`
}

// RequestInfo is the API/handler DTO for a received friend request.
// JSON field names are contract-stable.
type RequestInfo struct {
	RequestID string `json:"request_id"`
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"avatar_url,omitempty"`
	Message   string `json:"message"`
	CreatedAt string `json:"created_at"`
}

// ContactInfo is the API/handler DTO for one accepted contact.
// JSON field names are contract-stable.
type ContactInfo struct {
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"avatar_url,omitempty"`
	Remark    string `json:"remark,omitempty"`
	Online    bool   `json:"online"`
	Type      string `json:"type"`
}

func (s *Service) SearchUser(ctx context.Context, currentUserID, targetID string) (*SearchResult, error) {
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

func (s *Service) SendFriendRequest(ctx context.Context, userID, friendID, message string) error {
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

	s.publish(ctx, bus.Event{Type: bus.EventTypeFriendRequest, Payload: map[string]interface{}{
		"request_id":   f.ID,
		"from_user_id": userID,
		"message":      message,
	}})

	return nil
}

func (s *Service) ListFriendRequests(ctx context.Context, userID string) ([]RequestInfo, error) {
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

func (s *Service) AcceptFriendRequest(ctx context.Context, userID, requestID string) error {
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

	s.publish(ctx, bus.Event{Type: "friend.accepted", Payload: map[string]interface{}{
		"friendship_id": r.ID,
		"user_id":       r.UserID,
		"accepter_id":   userID,
	}})
	return nil
}

func (s *Service) RejectFriendRequest(ctx context.Context, userID, requestID string) error {
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
	return nil
}

func (s *Service) ListContacts(ctx context.Context, userID string) ([]ContactInfo, error) {
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

	// Presence in one pipelined round trip instead of one per friend (#2154
	// perf lane); errors degrade to all-offline, matching the previous
	// per-item error swallowing.
	onlineSet, _ := resolveCache(s.cacheClient).AreOnline(ctx, friendIDs)

	result := make([]ContactInfo, 0, len(friends))
	for _, f := range friends {
		friend, ok := users[f.FriendID]
		if !ok {
			continue
		}
		online := onlineSet[friend.ID]
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

func (s *Service) RemoveContact(ctx context.Context, currentUserID, friendUserID string) error {
	_, err := repository.GetFriendship(s.db, currentUserID, friendUserID)
	if err != nil {
		return errcode.FriendRequestNotFound
	}
	if err := repository.DeleteFriendshipPair(s.db, currentUserID, friendUserID); err != nil {
		return err
	}
	return nil
}

func (s *Service) BlockContact(ctx context.Context, currentUserID, targetUserID string) error {
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
	return nil
}

func (s *Service) UnblockContact(ctx context.Context, currentUserID, targetUserID string) error {
	f, err := repository.GetFriendship(s.db, currentUserID, targetUserID)
	if err != nil || f.Status != model.StatusBlocked {
		return errcode.FriendRequestNotFound
	}
	if err := repository.DeleteFriendship(s.db, f); err != nil {
		return err
	}
	return nil
}

func (s *Service) UpdateRemark(ctx context.Context, currentUserID, friendUserID, remark string) error {
	if err := repository.UpdateFriendshipRemark(s.db, currentUserID, friendUserID, remark); err != nil {
		return repository.WrapNotFound(err, errcode.FriendRemarkNoRow)
	}
	return nil
}

// GetFriendIDs returns the IDs of all accepted friends of the given user. Thin wrapper over repository.GetFriendIDs.
func (s *Service) GetFriendIDs(userID string) ([]string, error) {
	return repository.GetFriendIDs(s.db, userID)
}
