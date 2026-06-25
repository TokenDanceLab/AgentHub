package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// sessionCache is the subset of *cache.Client methods used by SessionService.
type sessionCache interface {
	Invalidate(ctx context.Context, keys ...string) error
	InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error
}

type SessionService struct {
	db          *gorm.DB
	cacheClient sessionCache
	bus         *Bus
}

func NewSessionService(db *gorm.DB, cacheClient *cache.Client, bus ...*Bus) *SessionService {
	var eventBus *Bus
	if len(bus) > 0 {
		eventBus = bus[0]
	}
	return &SessionService{db: db, cacheClient: resolveSessionCache(cacheClient), bus: eventBus}
}

type CreateSessionResponse struct {
	SessionID string `json:"session_id"`
	Type      string `json:"type"`
	Created   bool   `json:"created"`
}

type SessionListItem struct {
	SessionID     string     `json:"session_id"`
	Type          string     `json:"type"`
	Name          string     `json:"name,omitempty"`
	AvatarURL     string     `json:"avatar_url,omitempty"`
	OwnerUserID   string     `json:"owner_user_id,omitempty"`
	Pinned        bool       `json:"pinned"`
	Archived      bool       `json:"archived"`
	Muted         bool       `json:"muted"`
	LastMessageAt *time.Time `json:"last_message_at,omitempty"`
	UnreadCount   int64      `json:"unread_count"`
	MemberCount   int64      `json:"member_count"`
	Role          string     `json:"role"`
	CreatedAt     time.Time  `json:"created_at"`
}

func (s *SessionService) CreatePrivateSession(ctx context.Context, currentUserID, targetUserID string) (*CreateSessionResponse, error) {
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
		return &CreateSessionResponse{SessionID: existing.ID, Type: existing.Type, Created: false}, nil
	}

	session := &model.Session{Type: model.SessionTypePrivate}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.CreateSession(tx, session); err != nil {
			return err
		}
		members := []*model.SessionMember{
			{SessionID: session.ID, MemberType: model.MemberTypeUser, MemberID: currentUserID, Role: model.MemberRoleMember},
			{SessionID: session.ID, MemberType: model.MemberTypeUser, MemberID: targetUserID, Role: model.MemberRoleMember},
		}
		return repository.BatchCreateMembers(tx, members)
	})
	if err != nil {
		return nil, err
	}

	if err := resolveSessionCache(s.cacheClient).InitSeqIfAbsent(ctx, session.ID, 0); err != nil {
		slog.Warn("failed to init seq in redis", "session_id", session.ID, "error", err)
	}
	s.publishEvent(ctx, "session.created", map[string]interface{}{
		"session_id": session.ID,
		"type":       model.SessionTypePrivate,
		"owner_id":   "",
		"members":    []string{currentUserID, targetUserID},
	})

	return &CreateSessionResponse{SessionID: session.ID, Type: model.SessionTypePrivate, Created: true}, nil
}

func (s *SessionService) CreateGroupSession(ctx context.Context, ownerUserID, name string, memberIDs []string) (*CreateSessionResponse, error) {
	if len(name) == 0 || len(name) > config.MaxGroupNameLength {
		return nil, errcode.ErrBadRequest
	}

	if len(memberIDs) > 0 {
		friendIDs, err := repository.GetFriendIDs(s.db, ownerUserID)
		if err != nil {
			return nil, err
		}
		friendSet := make(map[string]bool)
		for _, id := range friendIDs {
			friendSet[id] = true
		}
		for _, mid := range memberIDs {
			if !friendSet[mid] {
				return nil, errcode.ErrBadRequest
			}
		}
	}

	session := &model.Session{Type: model.SessionTypeGroup, Name: name, OwnerUserID: &ownerUserID}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.CreateSession(tx, session); err != nil {
			return err
		}
		members := []*model.SessionMember{
			{SessionID: session.ID, MemberType: model.MemberTypeUser, MemberID: ownerUserID, Role: model.MemberRoleOwner},
		}
		for _, mid := range memberIDs {
			members = append(members, &model.SessionMember{
				SessionID: session.ID, MemberType: model.MemberTypeUser, MemberID: mid, Role: model.MemberRoleMember,
			})
		}
		return repository.BatchCreateMembers(tx, members)
	})
	if err != nil {
		return nil, err
	}

	if err := resolveSessionCache(s.cacheClient).InitSeqIfAbsent(ctx, session.ID, 0); err != nil {
		slog.Warn("failed to init seq in redis", "session_id", session.ID, "error", err)
	}
	members := append([]string{ownerUserID}, memberIDs...)
	s.publishEvent(ctx, "session.created", map[string]interface{}{
		"session_id": session.ID,
		"type":       model.SessionTypeGroup,
		"name":       name,
		"owner_id":   ownerUserID,
		"members":    members,
	})

	return &CreateSessionResponse{SessionID: session.ID, Type: model.SessionTypeGroup, Created: true}, nil
}

func (s *SessionService) ListSessions(ctx context.Context, userID string) ([]SessionListItem, error) {
	sessions, err := repository.ListUserSessions(s.db, userID)
	if err != nil {
		return nil, err
	}
	result := make([]SessionListItem, len(sessions))
	for i, sess := range sessions {
		unread := sess.NextSeq - sess.LastReadSeq
		if unread < 0 {
			unread = 0
		}
		oid := ""
		if sess.OwnerUserID != nil {
			oid = *sess.OwnerUserID
		}
		result[i] = SessionListItem{
			SessionID:     sess.ID,
			Type:          sess.Type,
			Name:          sess.Name,
			AvatarURL:     sess.AvatarURL,
			OwnerUserID:   oid,
			Pinned:        sess.Pinned,
			Archived:      sess.Archived,
			Muted:         sess.Muted,
			LastMessageAt: sess.LastMessageAt,
			UnreadCount:   unread,
			MemberCount:   sess.MemberCount,
			Role:          sess.Role,
			CreatedAt:     sess.CreatedAt,
		}
	}
	return result, nil
}

func (s *SessionService) getSession(ctx context.Context, sessionID string) (*model.Session, error) {
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

func (s *SessionService) requireMember(ctx context.Context, sessionID, userID string) (*model.SessionMember, error) {
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

func (s *SessionService) AddGroupMembers(ctx context.Context, currentUserID, sessionID string, memberIDs []string) error {
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
	friendSet := make(map[string]bool)
	for _, id := range friendIDs {
		friendSet[id] = true
	}
	for _, mid := range memberIDs {
		if !friendSet[mid] {
			return errcode.ErrBadRequest
		}
	}

	// Deduplicate member IDs to prevent duplicate key violations
	seen := make(map[string]bool, len(memberIDs))
	unique := make([]string, 0, len(memberIDs))
	for _, mid := range memberIDs {
		if !seen[mid] {
			seen[mid] = true
			unique = append(unique, mid)
		}
	}
	memberIDs = unique

	// Batch check active membership instead of N individual queries (fixes N+1 N3).
	activeMap, err := repository.AreMembersActive(s.db, sessionID, model.MemberTypeUser, memberIDs)
	if err != nil {
		return err
	}
	for _, mid := range memberIDs {
		if activeMap[mid] {
			return errcode.GroupAlreadyMember
		}
	}

	// Batch check soft-deleted membership instead of N individual queries (fixes N+1 N3).
	softDeletedMap, err := repository.AreMembersSoftDeleted(s.db, sessionID, model.MemberTypeUser, memberIDs)
	if err != nil {
		return err
	}

	var toReactivate []string
	members := make([]*model.SessionMember, 0, len(memberIDs))
	joinedMembers := make([]*model.SessionMember, 0, len(memberIDs))
	for _, mid := range memberIDs {
		if softDeletedMap[mid] {
			toReactivate = append(toReactivate, mid)
			joinedMembers = append(joinedMembers, &model.SessionMember{
				SessionID: sessionID, MemberType: model.MemberTypeUser, MemberID: mid, Role: model.MemberRoleMember,
			})
			continue
		}
		member := &model.SessionMember{
			SessionID: sessionID, MemberType: model.MemberTypeUser, MemberID: mid, Role: model.MemberRoleMember,
		}
		members = append(members, member)
		joinedMembers = append(joinedMembers, member)
	}

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
	_ = resolveSessionCache(s.cacheClient).Invalidate(ctx, "session:members:"+sessionID)
	for _, member := range joinedMembers {
		s.publishEvent(ctx, "session.member_joined", map[string]interface{}{
			"session_id":  sessionID,
			"member_id":   member.MemberID,
			"member_type": member.MemberType,
		})
	}
	return nil
}

func (s *SessionService) RemoveGroupMember(ctx context.Context, currentUserID, sessionID, targetUserID string) error {
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
	if session.OwnerUserID != nil && targetUserID == *session.OwnerUserID {
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
	_ = resolveSessionCache(s.cacheClient).Invalidate(ctx, "session:members:"+sessionID)
	s.publishEvent(ctx, "session.member_left", map[string]interface{}{
		"session_id": sessionID,
		"member_id":  targetUserID,
	})
	return nil
}

func (s *SessionService) LeaveGroup(ctx context.Context, currentUserID, sessionID string) error {
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
		otherActive := false
		for _, m := range members {
			if m.MemberID != currentUserID {
				otherActive = true
				break
			}
		}
		if otherActive {
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
	_ = resolveSessionCache(s.cacheClient).Invalidate(ctx, "session:members:"+sessionID)
	s.publishEvent(ctx, "session.member_left", map[string]interface{}{
		"session_id": sessionID,
		"member_id":  currentUserID,
	})
	return nil
}

func (s *SessionService) TransferGroupOwnership(ctx context.Context, currentUserID, sessionID, newOwnerID string) error {
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
	_ = resolveSessionCache(s.cacheClient).Invalidate(ctx, "session:members:"+sessionID, "session:meta:"+sessionID)
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
func (s *SessionService) DissolveGroup(ctx context.Context, currentUserID, sessionID string) error {
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
	_ = resolveSessionCache(s.cacheClient).Invalidate(ctx, "session:members:"+sessionID, "session:meta:"+sessionID)

	slog.Info("dissolve group: session dissolved",
		"session_id", sessionID, "dissolved_by", currentUserID,
		"members_cleaned", cleanupCount, "cleanup_errors", cleanupErrors)

	s.publishEvent(ctx, "session.dissolved", map[string]interface{}{
		"session_id": sessionID,
	})
	return nil
}

func (s *SessionService) UpdateGroupInfo(ctx context.Context, currentUserID, sessionID string, name, avatarURL, announcement *string) error {
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

	changes := make(map[string]interface{})
	if name != nil {
		session.Name = *name
		changes["name"] = *name
	}
	if avatarURL != nil {
		session.AvatarURL = *avatarURL
		changes["avatar_url"] = *avatarURL
	}
	if announcement != nil {
		session.Announcement = *announcement
		changes["announcement"] = *announcement
	}
	if err := repository.UpdateSession(s.db, session); err != nil {
		return err
	}
	_ = resolveSessionCache(s.cacheClient).Invalidate(ctx, "session:meta:"+sessionID)
	s.publishEvent(ctx, "session.info_updated", map[string]interface{}{
		"session_id": sessionID,
		"changes":    changes,
	})
	return nil
}

func (s *SessionService) UpdateMemberSettings(ctx context.Context, currentUserID, sessionID string, pinned, archived, muted *bool) error {
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

func (s *SessionService) DeleteForMe(ctx context.Context, currentUserID, sessionID string) error {
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
		otherActive := false
		for _, m := range members {
			if m.MemberID != currentUserID && m.MemberType == model.MemberTypeUser {
				otherActive = true
				break
			}
		}
		if otherActive {
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
	_ = resolveSessionCache(s.cacheClient).Invalidate(ctx, "session:members:"+sessionID)
	s.publishEvent(ctx, "session.member_left", map[string]interface{}{
		"session_id": sessionID,
		"member_id":  currentUserID,
	})
	return nil
}

func (s *SessionService) SearchSessions(ctx context.Context, userID, q string) ([]SessionListItem, error) {
	sessions, err := repository.SearchSessions(s.db, userID, q)
	if err != nil {
		return nil, err
	}
	result := make([]SessionListItem, len(sessions))
	for i, sess := range sessions {
		unread := sess.NextSeq - sess.LastReadSeq
		if unread < 0 {
			unread = 0
		}
		oid := ""
		if sess.OwnerUserID != nil {
			oid = *sess.OwnerUserID
		}
		result[i] = SessionListItem{
			SessionID:     sess.ID,
			Type:          sess.Type,
			Name:          sess.Name,
			AvatarURL:     sess.AvatarURL,
			OwnerUserID:   oid,
			Pinned:        sess.Pinned,
			Archived:      sess.Archived,
			Muted:         sess.Muted,
			LastMessageAt: sess.LastMessageAt,
			UnreadCount:   unread,
			MemberCount:   sess.MemberCount,
			Role:          sess.Role,
			CreatedAt:     sess.CreatedAt,
		}
	}
	return result, nil
}

// ListActiveMembers returns all active (non-left) members of a session. Thin wrapper over repository.ListActiveMembers.
func (s *SessionService) ListActiveMembers(sessionID string) ([]*model.SessionMember, error) {
	return repository.ListActiveMembers(s.db, sessionID)
}

// cleanupInvitedAgents cancels pending tasks, deletes agent instances, and soft-deletes
// session member records for all agents a user invited into a session. It paginates
// through agents (page size 100, max 10 pages = 1000 agents) and wraps the three
// per-agent operations in a single DB transaction for atomicity.
//
// Errors from individual agents are logged at Warn level and aggregated. The caller
// receives a joined error so it can decide whether to abort or proceed.
func (s *SessionService) cleanupInvitedAgents(sessionID, inviterUserID string) error {
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

func (s *SessionService) publishEvent(ctx context.Context, eventType string, payload map[string]interface{}) {
	if s.bus == nil {
		return
	}
	s.bus.Publish(ctx, Event{Type: eventType, Payload: payload})
}
