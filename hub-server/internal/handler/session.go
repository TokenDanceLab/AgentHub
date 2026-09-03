package handler

import (
	"context"
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service/session"
)

// SessionService is the subset of *session.Service used by SessionHandler.
// DTOs live in service/session (#708 fifth IM typed-service package).
type SessionService interface {
	CreatePrivateSession(ctx context.Context, currentUserID, targetUserID string) (*session.CreateSessionResponse, error)
	CreateGroupSession(ctx context.Context, ownerUserID, name string, memberIDs []string) (*session.CreateSessionResponse, error)
	ListSessions(ctx context.Context, userID string) ([]session.SessionListItem, error)
	AddGroupMembers(ctx context.Context, currentUserID, sessionID string, memberIDs []string) error
	RemoveGroupMember(ctx context.Context, currentUserID, sessionID, targetUserID string) error
	LeaveGroup(ctx context.Context, currentUserID, sessionID string) error
	TransferGroupOwnership(ctx context.Context, currentUserID, sessionID, newOwnerID string) error
	DissolveGroup(ctx context.Context, currentUserID, sessionID string) error
	UpdateGroupInfo(ctx context.Context, currentUserID, sessionID string, name, avatarURL, announcement *string) error
	UpdateMemberSettings(ctx context.Context, currentUserID, sessionID string, pinned, archived, muted *bool) error
	DeleteForMe(ctx context.Context, currentUserID, sessionID string) error
	SearchSessions(ctx context.Context, userID, q, cursor string, pageSize int) (*session.SessionSearchPage, error)
}

type SessionHandler struct {
	service SessionService
}

func NewSessionHandler(s SessionService) *SessionHandler {
	return &SessionHandler{service: s}
}

type createPrivateReq struct {
	TargetUserID string `json:"target_user_id" binding:"required"`
}

func (h *SessionHandler) CreatePrivate(c *gin.Context) {
	var req createPrivateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	result, err := h.service.CreatePrivateSession(c.Request.Context(), userID, req.TargetUserID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, result)
}

// createSessionReq is the unified request body for POST /sessions.
// It dispatches to CreatePrivate or CreateGroup based on the type field.
type createSessionReq struct {
	Type         string   `json:"type" binding:"required"`
	TargetUserID string   `json:"target_user_id"`
	Name         string   `json:"name"`
	MemberIDs    []string `json:"member_ids"`
}

func (h *SessionHandler) Create(c *gin.Context) {
	var req createSessionReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	var e *errcode.Error
	switch req.Type {
	case "private":
		if req.TargetUserID == "" {
			Fail(c, errcode.ErrBadRequest.WithMessage("target_user_id is required for private sessions"))
			return
		}
		result, err := h.service.CreatePrivateSession(c.Request.Context(), userID, req.TargetUserID)
		if err != nil {
			if errors.As(err, &e) {
				Fail(c, e)
				return
			}
			Fail(c, errcode.ErrInternal)
			return
		}
		OK(c, result)
	case "group":
		if req.Name == "" {
			Fail(c, errcode.ErrBadRequest.WithMessage("name is required for group sessions"))
			return
		}
		result, err := h.service.CreateGroupSession(c.Request.Context(), userID, req.Name, req.MemberIDs)
		if err != nil {
			if errors.As(err, &e) {
				Fail(c, e)
				return
			}
			Fail(c, errcode.ErrInternal)
			return
		}
		OK(c, result)
	default:
		Fail(c, errcode.ErrBadRequest.WithMessage("type must be 'private' or 'group'"))
	}
}

type createGroupReq struct {
	Name      string   `json:"name" binding:"required"`
	MemberIDs []string `json:"member_ids" binding:"required"`
}

func (h *SessionHandler) CreateGroup(c *gin.Context) {
	var req createGroupReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	result, err := h.service.CreateGroupSession(c.Request.Context(), userID, req.Name, req.MemberIDs)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, result)
}

func (h *SessionHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")
	result, err := h.service.ListSessions(c.Request.Context(), userID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, result)
}

type addMembersReq struct {
	MemberIDs []string `json:"member_ids" binding:"required"`
}

func (h *SessionHandler) AddMembers(c *gin.Context) {
	var req addMembersReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	sessionID := c.Param("id")
	if err := h.service.AddGroupMembers(c.Request.Context(), userID, sessionID, req.MemberIDs); err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *SessionHandler) RemoveMember(c *gin.Context) {
	userID := c.GetString("user_id")
	sessionID := c.Param("id")
	targetID := c.Param("target_user_id")
	if err := h.service.RemoveGroupMember(c.Request.Context(), userID, sessionID, targetID); err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *SessionHandler) Leave(c *gin.Context) {
	userID := c.GetString("user_id")
	sessionID := c.Param("id")
	if err := h.service.LeaveGroup(c.Request.Context(), userID, sessionID); err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

// transferOwnerReq is the request body for POST /sessions/:id/transfer-owner.
// Prefer new_owner_user_id; new_owner_id is accepted for backward compatibility.
type transferOwnerReq struct {
	NewOwnerUserID string `json:"new_owner_user_id"`
	NewOwnerID     string `json:"new_owner_id"` // deprecated: prefer new_owner_user_id
}

func (r transferOwnerReq) resolveNewOwnerID() string {
	if r.NewOwnerUserID != "" {
		return r.NewOwnerUserID
	}
	return r.NewOwnerID
}

func (h *SessionHandler) TransferOwner(c *gin.Context) {
	var req transferOwnerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	newOwnerID := req.resolveNewOwnerID()
	if newOwnerID == "" {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	sessionID := c.Param("id")
	if err := h.service.TransferGroupOwnership(c.Request.Context(), userID, sessionID, newOwnerID); err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *SessionHandler) Dissolve(c *gin.Context) {
	userID := c.GetString("user_id")
	sessionID := c.Param("id")
	if err := h.service.DissolveGroup(c.Request.Context(), userID, sessionID); err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

type updateGroupInfoReq struct {
	Name         *string `json:"name"`
	AvatarURL    *string `json:"avatar_url"`
	Announcement *string `json:"announcement"`
}

func (h *SessionHandler) UpdateGroupInfo(c *gin.Context) {
	var req updateGroupInfoReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	sessionID := c.Param("id")
	if err := h.service.UpdateGroupInfo(c.Request.Context(), userID, sessionID, req.Name, req.AvatarURL, req.Announcement); err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

type updateMemberSettingsReq struct {
	Pinned   *bool `json:"pinned"`
	Archived *bool `json:"archived"`
	Muted    *bool `json:"muted"`
}

func (h *SessionHandler) UpdateMemberSettings(c *gin.Context) {
	var req updateMemberSettingsReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	sessionID := c.Param("id")
	if err := h.service.UpdateMemberSettings(c.Request.Context(), userID, sessionID, req.Pinned, req.Archived, req.Muted); err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *SessionHandler) DeleteForMe(c *gin.Context) {
	userID := c.GetString("user_id")
	sessionID := c.Param("id")
	if err := h.service.DeleteForMe(c.Request.Context(), userID, sessionID); err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *SessionHandler) SearchSessions(c *gin.Context) {
	userID := c.GetString("user_id")
	q := c.Query("q")
	if q == "" {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	cursor := c.Query("pageCursor")
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", strconv.Itoa(config.DefaultPaginationLimit)))
	// This handler is the enforcement point: repository.SearchSessions turns
	// pageSize straight into `LIMIT pageSize+1` with no ceiling of its own, so
	// before #2243 this endpoint served up to 500 rows while its openapi parameter
	// (the shared PageSize) declares maximum: 200.
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, config.DefaultPaginationLimit)

	result, err := h.service.SearchSessions(c.Request.Context(), userID, q, cursor, pageSize)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, gin.H{
		"items": result.Items,
		"page":  gin.H{"nextCursor": result.NextCursor, "hasMore": result.HasMore},
	})
}
