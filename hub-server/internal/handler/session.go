package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service"
)

type SessionHandler struct {
	service *service.SessionService
}

func NewSessionHandler(s *service.SessionService) *SessionHandler {
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
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, result)
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
		if e, ok := err.(*errcode.Error); ok {
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
		if e, ok := err.(*errcode.Error); ok {
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
	targetID := c.Param("user_id")
	if err := h.service.RemoveGroupMember(c.Request.Context(), userID, sessionID, targetID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
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
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

type transferOwnerReq struct {
	NewOwnerID string `json:"new_owner_id" binding:"required"`
}

func (h *SessionHandler) TransferOwner(c *gin.Context) {
	var req transferOwnerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	sessionID := c.Param("id")
	if err := h.service.TransferGroupOwnership(c.Request.Context(), userID, sessionID, req.NewOwnerID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
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
		if e, ok := err.(*errcode.Error); ok {
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
		if e, ok := err.(*errcode.Error); ok {
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
		if e, ok := err.(*errcode.Error); ok {
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
		if e, ok := err.(*errcode.Error); ok {
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

	result, err := h.service.SearchSessions(c.Request.Context(), userID, q)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, result)
}
