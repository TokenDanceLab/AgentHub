package session

import "github.com/agenthub/hub-server/internal/model"

// FriendIDSet builds an O(1) lookup set from accepted friend ids.
func FriendIDSet(friendIDs []string) map[string]bool {
	set := make(map[string]bool, len(friendIDs))
	for _, id := range friendIDs {
		set[id] = true
	}
	return set
}

// AllAreFriends reports whether every memberID is present in friendIDs.
// Empty memberIDs is vacuously true.
func AllAreFriends(friendIDs []string, memberIDs []string) bool {
	if len(memberIDs) == 0 {
		return true
	}
	set := FriendIDSet(friendIDs)
	for _, mid := range memberIDs {
		if !set[mid] {
			return false
		}
	}
	return true
}

// DeduplicateIDs returns memberIDs with first-occurrence order preserved.
func DeduplicateIDs(memberIDs []string) []string {
	seen := make(map[string]bool, len(memberIDs))
	unique := make([]string, 0, len(memberIDs))
	for _, mid := range memberIDs {
		if !seen[mid] {
			seen[mid] = true
			unique = append(unique, mid)
		}
	}
	return unique
}

// NewUserMember builds a user SessionMember row (no DB side effects).
func NewUserMember(sessionID, memberID, role string) *model.SessionMember {
	return &model.SessionMember{
		SessionID:  sessionID,
		MemberType: model.MemberTypeUser,
		MemberID:   memberID,
		Role:       role,
	}
}

// PrivateSessionMembers builds the two-user membership set for a private session.
func PrivateSessionMembers(sessionID, currentUserID, targetUserID string) []*model.SessionMember {
	return []*model.SessionMember{
		NewUserMember(sessionID, currentUserID, model.MemberRoleMember),
		NewUserMember(sessionID, targetUserID, model.MemberRoleMember),
	}
}

// GroupSessionMembers builds owner + invitee membership rows for a new group.
// ownerUserID is always the owner; memberIDs are regular members (not deduped here).
func GroupSessionMembers(sessionID, ownerUserID string, memberIDs []string) []*model.SessionMember {
	members := make([]*model.SessionMember, 0, 1+len(memberIDs))
	members = append(members, NewUserMember(sessionID, ownerUserID, model.MemberRoleOwner))
	for _, mid := range memberIDs {
		members = append(members, NewUserMember(sessionID, mid, model.MemberRoleMember))
	}
	return members
}

// GroupMemberIDsForEvent returns owner + memberIDs for session.created payloads.
func GroupMemberIDsForEvent(ownerUserID string, memberIDs []string) []string {
	return append([]string{ownerUserID}, memberIDs...)
}

// PartitionJoinMembers splits candidate user ids into soft-deleted reactivations
// versus brand-new member rows. softDeletedMap is keyed by member id.
// joinedMembers preserves input order for event publish.
func PartitionJoinMembers(
	sessionID string,
	memberIDs []string,
	softDeletedMap map[string]bool,
) (toReactivate []string, toCreate []*model.SessionMember, joinedMembers []*model.SessionMember) {
	toCreate = make([]*model.SessionMember, 0, len(memberIDs))
	joinedMembers = make([]*model.SessionMember, 0, len(memberIDs))
	for _, mid := range memberIDs {
		if softDeletedMap[mid] {
			toReactivate = append(toReactivate, mid)
			joinedMembers = append(joinedMembers, NewUserMember(sessionID, mid, model.MemberRoleMember))
			continue
		}
		member := NewUserMember(sessionID, mid, model.MemberRoleMember)
		toCreate = append(toCreate, member)
		joinedMembers = append(joinedMembers, member)
	}
	return toReactivate, toCreate, joinedMembers
}

// AnyActiveMember reports whether any active membership map entry is true.
func AnyActiveMember(activeMap map[string]bool, memberIDs []string) bool {
	for _, mid := range memberIDs {
		if activeMap[mid] {
			return true
		}
	}
	return false
}

// HasOtherActiveMember reports whether any listed member differs from currentUserID.
// Used by LeaveGroup (any member type counts).
func HasOtherActiveMember(members []*model.SessionMember, currentUserID string) bool {
	for _, m := range members {
		if m.MemberID != currentUserID {
			return true
		}
	}
	return false
}

// HasOtherActiveUser reports whether any active human member differs from currentUserID.
// Used by DeleteForMe owner guard.
func HasOtherActiveUser(members []*model.SessionMember, currentUserID string) bool {
	for _, m := range members {
		if m.MemberID != currentUserID && m.MemberType == model.MemberTypeUser {
			return true
		}
	}
	return false
}

// IsSessionOwnerID reports whether targetUserID matches the nullable session owner.
func IsSessionOwnerID(ownerUserID *string, targetUserID string) bool {
	return ownerUserID != nil && targetUserID == *ownerUserID
}
