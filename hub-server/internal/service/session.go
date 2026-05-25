package service

import (
	"context"
	"errors"
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
}

func NewSessionService(db *gorm.DB, cacheClient *cache.Client) *SessionService {
	return &SessionService{db: db, cacheClient: resolveSessionCache(cacheClient)}
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

	return &CreateSessionResponse{SessionID: session.ID, Type: model.SessionTypePrivate, Created: true}, nil
}

func (s *SessionService) CreateGroupSession(ctx context.Context, ownerUserID, name string, memberIDs []string) (*CreateSessionResponse, error) {
	if len(name) == 0 || len(name) > config.MaxGroupNameLength {
		return nil, errcode.ErrBadRequest
	}
	if len(memberIDs) == 0 {
		return nil, errcode.ErrBadRequest
	}

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

	session := &model.Session{Type: model.SessionTypeGroup, Name: name, OwnerUserID: &ownerUserID}
	err = s.db.Transaction(func(tx *gorm.DB) error {
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

	_, err = s.requireMember(ctx, sessionID, currentUserID)
	if err != nil {
		return err
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

	for _, mid := range memberIDs {
		active, _ := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, mid)
		if active {
			return errcode.GroupAlreadyMember
		}
	}

	members := make([]*model.SessionMember, 0, len(memberIDs))
	for _, mid := range memberIDs {
		// Reactivate soft-deleted members instead of creating duplicates.
		softDeleted, _ := repository.IsMemberSoftDeleted(s.db, sessionID, model.MemberTypeUser, mid)
		if softDeleted {
			if err := repository.ReactivateMember(s.db, sessionID, model.MemberTypeUser, mid, model.MemberRoleMember); err != nil {
				return err
			}
			continue
		}
		members = append(members, &model.SessionMember{
			SessionID: sessionID, MemberType: model.MemberTypeUser, MemberID: mid, Role: model.MemberRoleMember,
		})
	}
	if len(members) > 0 {
		if err := repository.BatchCreateMembers(s.db, members); err != nil {
			return err
		}
	}
	resolveSessionCache(s.cacheClient).Invalidate(ctx, "session:members:"+sessionID)
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

	active, _ := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, targetUserID)
	if !active {
		return errcode.SessionNotMember
	}

	if err := repository.SoftDeleteMember(s.db, sessionID, model.MemberTypeUser, targetUserID); err != nil {
		return err
	}
	resolveSessionCache(s.cacheClient).Invalidate(ctx, "session:members:"+sessionID)
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
		members, _ := repository.ListActiveMembers(s.db, sessionID)
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
	agents, _ := repository.ListAgentInstancesByInviter(s.db, sessionID, currentUserID)
	for _, agent := range agents {
		_ = repository.CancelTasksByAgentInstance(s.db, agent.ID)
		_ = repository.DeleteAgentInstance(s.db, agent.ID)
		_ = repository.SoftDeleteMember(s.db, sessionID, model.MemberTypeAgent, agent.ID)
	}

	if err := repository.SoftDeleteMember(s.db, sessionID, model.MemberTypeUser, currentUserID); err != nil {
		return err
	}
	resolveSessionCache(s.cacheClient).Invalidate(ctx, "session:members:"+sessionID)
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

	targetActive, _ := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, newOwnerID)
	if !targetActive {
		return errcode.SessionNotMember
	}

	if err := repository.TransferOwnership(s.db, sessionID, currentUserID, newOwnerID); err != nil {
		return err
	}
	resolveSessionCache(s.cacheClient).Invalidate(ctx, "session:members:"+sessionID, "session:meta:"+sessionID)
	return nil
}

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

	session.Dissolved = true
	if err := repository.UpdateSession(s.db, session); err != nil {
		return err
	}
	resolveSessionCache(s.cacheClient).Invalidate(ctx, "session:members:"+sessionID, "session:meta:"+sessionID)
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

	_, err = s.requireMember(ctx, sessionID, currentUserID)
	if err != nil {
		return err
	}

	if name != nil {
		session.Name = *name
	}
	if avatarURL != nil {
		session.AvatarURL = *avatarURL
	}
	if announcement != nil {
		session.Announcement = *announcement
	}
	if err := repository.UpdateSession(s.db, session); err != nil {
		return err
	}
	resolveSessionCache(s.cacheClient).Invalidate(ctx, "session:meta:"+sessionID)
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
	_, err := s.getSession(ctx, sessionID)
	if err != nil {
		return err
	}
	_, err = s.requireMember(ctx, sessionID, currentUserID)
	if err != nil {
		return err
	}
	return repository.SoftDeleteMember(s.db, sessionID, model.MemberTypeUser, currentUserID)
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
