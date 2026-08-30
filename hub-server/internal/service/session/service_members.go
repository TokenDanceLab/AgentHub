// #1161: Session Service pure-helper peel — member/group mgmt paths extracted from service.go.
package session

import (
	"context"
	"log/slog"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

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
		s.recordMemberAudit(ctx, auditActionMemberAdd, sessionID, currentUserID, auditOutcomeDenied, "not owner")
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
	s.recordMemberAudit(ctx, auditActionMemberAdd, sessionID, currentUserID, auditOutcomeSuccess, "")
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
		s.recordMemberAudit(ctx, auditActionMemberRemove, sessionID, currentUserID, auditOutcomeDenied, "not owner")
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
	s.recordMemberAudit(ctx, auditActionMemberRemove, sessionID, currentUserID, auditOutcomeSuccess, "")
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
	_ = resolveCache(s.cacheClient).Invalidate(ctx, SessionMembersCacheKey(sessionID))
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
	_ = resolveCache(s.cacheClient).Invalidate(ctx, SessionMembersCacheKey(sessionID))

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
