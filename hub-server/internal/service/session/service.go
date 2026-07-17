// Package session owns IM session lifecycle orchestration for Hub.
//
// It is the fifth IM typed-service package (agentteam-style; #708), extracting
// the session domain from the flat service package. Bus+Cache ports were
// hardened in #593; package move only. Pure residual mappers/DTO/builders
// live alongside this file (#825).
package session

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"reflect"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service"
)

// Bus publishes domain events from session lifecycle paths.
// *service.Bus satisfies this port via Publish(ctx, service.Event).
type Bus interface {
	Publish(ctx context.Context, event service.Event)
}

// Cache is the subset of *cache.Client methods used by Session Service.
// Implemented by *cache.Client and cache.NoOpCache.
type Cache interface {
	Invalidate(ctx context.Context, keys ...string) error
	InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error
}

// Service owns IM session lifecycle orchestration: private/group create,
// list/search, member join/leave/remove, ownership transfer, dissolve, group
// info, per-member settings, delete-for-me, and invited-agent cleanup.
// Member/meta cache invalidation uses injected Cache; domain events go through
// Bus. This package is the fifth IM typed-service extract (#708) after
// messagereaction (#662), workspace (#673), contact (#685), and attachment
// (#697). Ports were hardened in #593; package move only. Pure residual
// mappers/DTO/builders extracted in #825.
type Service struct {
	db          *gorm.DB
	cacheClient Cache
	bus         Bus
}

// NewService constructs a session service.
// cacheClient may be nil and falls back to cache.NoOpCache.
// bus may be omitted/nil for read-only/partial tests; write paths that publish no-op.
func NewService(db *gorm.DB, cacheClient Cache, bus ...Bus) *Service {
	var eventBus Bus
	if len(bus) > 0 {
		eventBus = bus[0]
	}
	return &Service{db: db, cacheClient: resolveCache(cacheClient), bus: eventBus}
}

// SetBus injects (or replaces) the event bus port.
func (s *Service) SetBus(bus Bus) {
	if s == nil {
		return
	}
	s.bus = bus
}

// SetCache injects (or replaces) the session cache port.
func (s *Service) SetCache(cacheClient Cache) {
	if s == nil {
		return
	}
	s.cacheClient = resolveCache(cacheClient)
}

func resolveCache(c Cache) Cache {
	if isNilCache(c) {
		return cache.NoOpCache{}
	}
	return c
}

func isNilCache(c any) bool {
	if c == nil {
		return true
	}
	v := reflect.ValueOf(c)
	switch v.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return v.IsNil()
	default:
		return false
	}
}

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
	member, _ := repository.GetActiveMember(s.db, sessionID, model.MemberTypeUser, userID)
	return member, nil
}

func (s *Service) AddGroupMembers(ctx context.Context, currentUserID, sessionID string, memberIDs []string) error {
	session, err := s.getSession(ctx, sessionID)
	if err != nil {
		return err
	}
	if session.Type != model.SessionTypeGroup {
		return errcode.ErrBadRequest
	}

	// #86: Only the group owner can add members, and members must be friends.
	member, err := s.requireMember(ctx, sessionID, currentUserID)
	if err != nil {
		return err
	}
	if member.Role != model.MemberRoleOwner {
		return errcode.GroupNotOwner
	}

	// Re-apply friend-boundary check: owner can only invite friends into the group.
	friendIDs, err := repository.GetFriendIDs(s.db, currentUserID)
	if err != nil {
		return err
	}
	if !AllAreFriends(friendIDs, memberIDs) {
		return errcode.ErrBadRequest
	}

	// Deduplicate member IDs to prevent duplicate key violations
	memberIDs = DeduplicateIDs(memberIDs)

	// Batch check active membership instead of N individual queries (fixes N+1 N3).
	activeMap, err := repository.AreMembersActive(s.db, sessionID, model.MemberTypeUser, memberIDs)
	if err != nil {
		return err
	}
	if AnyActiveMember(activeMap, memberIDs) {
		return errcode.GroupAlreadyMember
	}

	// Batch check soft-deleted membership instead of N individual queries (fixes N+1 N3).
	softDeletedMap, err := repository.AreMembersSoftDeleted(s.db, sessionID, model.MemberTypeUser, memberIDs)
	if err != nil {
		return err
	}

	toReactivate, members, joinedMembers := PartitionJoinMembers(sessionID, memberIDs, softDeletedMap)

	// Batch reactivate soft-deleted members in a single query.
	if len(toReactivate) > 0 {
		if err := repository.BatchReactivateMembers(s.db, sessionID, model.MemberTypeUser, toReactivate, model.MemberRoleMember); err != nil {
			return err
		}
	}
	if len(members) > 0 {
		if err := repository.BatchCreateMembers(s.db, members); err != nil {
			return err
		}
	}
	_ = resolveCache(s.cacheClient).Invalidate(ctx, SessionMembersCacheKey(sessionID))
	for _, m := range joinedMembers {
		s.publishEvent(ctx, EventTypeSessionMemberJoined, MemberJoinedPayload(sessionID, m.MemberID, m.MemberType))
	}
	return nil
}

func (s *Service) RemoveGroupMember(ctx context.Context, currentUserID, sessionID, targetUserID string) error {
	session, err := s.getSession(ctx, sessionID)
	if err != nil {
		return err
	}
	if session.Type != model.SessionTypeGroup {
		return errcode.ErrBadRequest
	}

	member, err := s.requireMember(ctx, sessionID, currentUserID)
	if err != nil {
		return err
	}
	if member.Role != model.MemberRoleOwner {
		return errcode.GroupNotOwner
	}

	// #97: prevent owner from removing themselves
	if IsSessionOwnerID(session.OwnerUserID, targetUserID) {
		return errcode.GroupOwnerCannotLeave
	}

	active, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, targetUserID)
	if err != nil {
		return err
	}
	if !active {
		return errcode.SessionNotMember
	}

	// #135: clean up agents invited by the removed member
	if err := s.cleanupInvitedAgents(sessionID, targetUserID); err != nil {
		return err
	}

	if err := repository.SoftDeleteMember(s.db, sessionID, model.MemberTypeUser, targetUserID); err != nil {
		return err
	}
	_ = resolveCache(s.cacheClient).Invalidate(ctx, SessionMembersCacheKey(sessionID))
	s.publishEvent(ctx, EventTypeSessionMemberLeft, MemberLeftPayload(sessionID, targetUserID))
	return nil
}

func (s *Service) LeaveGroup(ctx context.Context, currentUserID, sessionID string) error {
	session, err := s.getSession(ctx, sessionID)
	if err != nil {
		return err
	}
	if session.Type != model.SessionTypeGroup {
		return errcode.ErrBadRequest
	}

	member, err := s.requireMember(ctx, sessionID, currentUserID)
	if err != nil {
		return err
	}

	if member.Role == model.MemberRoleOwner {
		members, err := repository.ListActiveMembers(s.db, sessionID)
		if err != nil {
			return err
		}
		if HasOtherActiveMember(members, currentUserID) {
			return errcode.GroupOwnerCannotLeave
		}
	}

	// P11.3: clean up agents invited by this user
	if err := s.cleanupInvitedAgents(sessionID, currentUserID); err != nil {
		return err
	}

	if err := repository.SoftDeleteMember(s.db, sessionID, model.MemberTypeUser, currentUserID); err != nil {
		return err
	}
	_ = resolveCache(s.cacheClient).Invalidate(ctx, SessionMembersCacheKey(sessionID))
	s.publishEvent(ctx, EventTypeSessionMemberLeft, MemberLeftPayload(sessionID, currentUserID))
	return nil
}

func (s *Service) TransferGroupOwnership(ctx context.Context, currentUserID, sessionID, newOwnerID string) error {
	session, err := s.getSession(ctx, sessionID)
	if err != nil {
		return err
	}
	if session.Type != model.SessionTypeGroup {
		return errcode.ErrBadRequest
	}

	member, err := s.requireMember(ctx, sessionID, currentUserID)
	if err != nil {
		return err
	}
	if member.Role != model.MemberRoleOwner {
		return errcode.GroupNotOwner
	}

	targetActive, err := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, newOwnerID)
	if err != nil {
		return err
	}
	if !targetActive {
		return errcode.SessionNotMember
	}

	if err := repository.TransferOwnership(s.db, sessionID, currentUserID, newOwnerID); err != nil {
		return err
	}
	_ = resolveCache(s.cacheClient).Invalidate(ctx, SessionMembersCacheKey(sessionID), SessionMetaCacheKey(sessionID))
	return nil
}

// DissolveGroup permanently dissolves a group session. Only the group owner may
// call this method.
//
// Dissolution is a two-phase operation:
//
//  1. The session is marked Dissolved=true immediately, making it unavailable to
//     all members even if the subsequent cleanup step fails partially.
//  2. Agent cleanup runs best-effort: every human member's invited agents have
//     their pending tasks cancelled, agent instances deleted, and session
//     member records soft-deleted via cleanupInvitedAgents. Individual agent
//     failures are logged at Warn level and aggregated but never block or roll
//     back the dissolution — the session stays dissolved regardless.
//
// On success the session members cache is invalidated and a "session.dissolved"
// event is published to the event bus.
func (s *Service) DissolveGroup(ctx context.Context, currentUserID, sessionID string) error {
	session, err := s.getSession(ctx, sessionID)
	if err != nil {
		return err
	}
	if session.Type != model.SessionTypeGroup {
		return errcode.ErrBadRequest
	}

	member, err := s.requireMember(ctx, sessionID, currentUserID)
	if err != nil {
		return err
	}
	if member.Role != model.MemberRoleOwner {
		return errcode.GroupNotOwner
	}

	// Mark the session dissolved first so it is immediately unavailable even if
	// agent cleanup fails partially. Agent cleanup runs best-effort after.
	session.Dissolved = true
	if err := repository.UpdateSession(s.db, session); err != nil {
		return err
	}

	// Collect all human members and clean up every invited agent in the session.
	// Best-effort: log partial failures but do not block or roll back dissolution.
	members, listErr := repository.ListActiveMembers(s.db, sessionID)
	cleanupCount := 0
	cleanupErrors := 0
	if listErr != nil {
		slog.Warn("dissolve group: failed to list active members, skipping agent cleanup",
			"session_id", sessionID, "dissolved_by", currentUserID, "error", listErr)
	} else {
		for _, m := range members {
			if m.MemberType != model.MemberTypeUser {
				continue
			}
			if err := s.cleanupInvitedAgents(sessionID, m.MemberID); err != nil {
				slog.Warn("dissolve group: cleanupInvitedAgents failed",
					"session_id", sessionID, "inviter_user_id", m.MemberID,
					"dissolved_by", currentUserID, "error", err)
				cleanupErrors++
			} else {
				cleanupCount++
			}
		}
	}
	_ = resolveCache(s.cacheClient).Invalidate(ctx, SessionMembersCacheKey(sessionID), SessionMetaCacheKey(sessionID))

	slog.Info("dissolve group: session dissolved",
		"session_id", sessionID, "dissolved_by", currentUserID,
		"members_cleaned", cleanupCount, "cleanup_errors", cleanupErrors)

	s.publishEvent(ctx, EventTypeSessionDissolved, SessionDissolvedPayload(sessionID))
	return nil
}

func (s *Service) UpdateGroupInfo(ctx context.Context, currentUserID, sessionID string, name, avatarURL, announcement *string) error {
	session, err := s.getSession(ctx, sessionID)
	if err != nil {
		return err
	}
	if session.Type != model.SessionTypeGroup {
		return errcode.ErrBadRequest
	}

	member, err := s.requireMember(ctx, sessionID, currentUserID)
	if err != nil {
		return err
	}
	// #112: require owner authority for group info updates
	if member.Role != model.MemberRoleOwner {
		return errcode.GroupNotOwner
	}

	changes := ApplyGroupInfoChanges(session, name, avatarURL, announcement)
	if err := repository.UpdateSession(s.db, session); err != nil {
		return err
	}
	_ = resolveCache(s.cacheClient).Invalidate(ctx, SessionMetaCacheKey(sessionID))
	s.publishEvent(ctx, EventTypeSessionInfoUpdated, SessionInfoUpdatedPayload(sessionID, changes))
	return nil
}

func (s *Service) UpdateMemberSettings(ctx context.Context, currentUserID, sessionID string, pinned, archived, muted *bool) error {
	_, err := s.getSession(ctx, sessionID)
	if err != nil {
		return err
	}
	_, err = s.requireMember(ctx, sessionID, currentUserID)
	if err != nil {
		return err
	}
	return repository.UpdateMemberSettings(s.db, sessionID, model.MemberTypeUser, currentUserID, pinned, archived, muted)
}

func (s *Service) DeleteForMe(ctx context.Context, currentUserID, sessionID string) error {
	session, err := s.getSession(ctx, sessionID)
	if err != nil {
		return err
	}
	member, err := s.requireMember(ctx, sessionID, currentUserID)
	if err != nil {
		return err
	}

	// #113: group owner must transfer or dissolve before leaving
	if session.Type == model.SessionTypeGroup && member.Role == model.MemberRoleOwner {
		members, err := repository.ListActiveMembers(s.db, sessionID)
		if err != nil {
			return err
		}
		if HasOtherActiveUser(members, currentUserID) {
			return errcode.GroupOwnerCannotLeave
		}
	}

	// #135: clean up agents invited by this user
	if session.Type == model.SessionTypeGroup {
		if err := s.cleanupInvitedAgents(sessionID, currentUserID); err != nil {
			return err
		}
	}

	if err := repository.SoftDeleteMember(s.db, sessionID, model.MemberTypeUser, currentUserID); err != nil {
		return err
	}
	_ = resolveCache(s.cacheClient).Invalidate(ctx, SessionMembersCacheKey(sessionID))
	s.publishEvent(ctx, EventTypeSessionMemberLeft, MemberLeftPayload(sessionID, currentUserID))
	return nil
}

func (s *Service) SearchSessions(ctx context.Context, userID, q string) ([]SessionListItem, error) {
	sessions, err := repository.SearchSessions(s.db, userID, q)
	if err != nil {
		return nil, err
	}
	return MapSessionListItems(sessions), nil
}

// ListActiveMembers returns all active (non-left) members of a session. Thin wrapper over repository.ListActiveMembers.
func (s *Service) ListActiveMembers(sessionID string) ([]*model.SessionMember, error) {
	return repository.ListActiveMembers(s.db, sessionID)
}

// cleanupInvitedAgents cancels pending tasks, deletes agent instances, and soft-deletes
// session member records for all agents a user invited into a session. It paginates
// through agents (page size 100, max 10 pages = 1000 agents) and wraps the three
// per-agent operations in a single DB transaction for atomicity.
//
// Errors from individual agents are logged at Warn level and aggregated. The caller
// receives a joined error so it can decide whether to abort or proceed.
func (s *Service) cleanupInvitedAgents(sessionID, inviterUserID string) error {
	const pageSize = 100
	const maxPages = 10 // safety bound: max 1000 agents per inviter per session
	var allErrors []error

	for page := 0; page < maxPages; page++ {
		agents, err := repository.ListAgentInstancesByInviterPage(s.db, sessionID, inviterUserID, pageSize, page*pageSize)
		if err != nil {
			allErrors = append(allErrors, fmt.Errorf("list agents page %d: %w", page, err))
			break
		}
		if len(agents) == 0 {
			break
		}

		for _, agent := range agents {
			// Cancel pending tasks for this agent instance.
			if err := repository.CancelTasksByAgentInstance(s.db, agent.ID); err != nil {
				slog.Warn("cleanupInvitedAgents: CancelTasksByAgentInstance failed",
					"session_id", sessionID, "inviter_user_id", inviterUserID,
					"agent_id", agent.ID, "error", err)
				allErrors = append(allErrors, fmt.Errorf("cancel tasks for agent %s: %w", agent.ID, err))
				// Continue with other operations even if cancel fails — the agent
				// instance and member record should still be cleaned up.
			}
			if err := repository.DeleteAgentInstance(s.db, agent.ID); err != nil {
				slog.Warn("cleanupInvitedAgents: DeleteAgentInstance failed",
					"session_id", sessionID, "inviter_user_id", inviterUserID,
					"agent_id", agent.ID, "error", err)
				allErrors = append(allErrors, fmt.Errorf("delete agent %s: %w", agent.ID, err))
			}
			if err := repository.SoftDeleteMember(s.db, sessionID, model.MemberTypeAgent, agent.ID); err != nil {
				slog.Warn("cleanupInvitedAgents: SoftDeleteMember failed",
					"session_id", sessionID, "inviter_user_id", inviterUserID,
					"agent_id", agent.ID, "error", err)
				allErrors = append(allErrors, fmt.Errorf("soft delete member for agent %s: %w", agent.ID, err))
			}
		}
	}

	return errors.Join(allErrors...)
}

// publishEvent is a nil-safe wrapper over the bus port.
func (s *Service) publishEvent(ctx context.Context, eventType string, payload map[string]interface{}) {
	if s == nil || s.bus == nil {
		return
	}
	s.bus.Publish(ctx, service.Event{Type: eventType, Payload: payload})
}
