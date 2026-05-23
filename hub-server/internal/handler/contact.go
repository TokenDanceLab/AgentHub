package handler

import (
	"context"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service"
)

// ContactService is the subset of *service.ContactService used by ContactHandler.
type ContactService interface {
	SearchUser(ctx context.Context, currentUserID, targetID string) (*service.SearchResult, error)
	SendFriendRequest(ctx context.Context, userID, friendID, message string) error
	ListFriendRequests(ctx context.Context, userID string) ([]service.RequestInfo, error)
	AcceptFriendRequest(ctx context.Context, userID, requestID string) error
	RejectFriendRequest(ctx context.Context, userID, requestID string) error
	ListContacts(ctx context.Context, userID string) ([]service.ContactInfo, error)
	RemoveContact(ctx context.Context, currentUserID, friendUserID string) error
	BlockContact(ctx context.Context, currentUserID, targetUserID string) error
	UnblockContact(ctx context.Context, currentUserID, targetUserID string) error
	UpdateRemark(ctx context.Context, currentUserID, friendUserID, remark string) error
}

type ContactHandler struct {
	service ContactService
}

func NewContactHandler(s ContactService) *ContactHandler {
	return &ContactHandler{service: s}
}

func (h *ContactHandler) SearchUser(c *gin.Context) {
	userID := c.GetString("user_id")
	targetID := c.Query("id")
	if targetID == "" {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	result, err := h.service.SearchUser(c.Request.Context(), userID, targetID)
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

type sendFriendRequestReq struct {
	FriendID string `json:"friend_id" binding:"required"`
	Message  string `json:"message"`
}

func (h *ContactHandler) SendFriendRequest(c *gin.Context) {
	var req sendFriendRequestReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	if err := h.service.SendFriendRequest(c.Request.Context(), userID, req.FriendID, req.Message); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *ContactHandler) ListFriendRequests(c *gin.Context) {
	userID := c.GetString("user_id")
	result, err := h.service.ListFriendRequests(c.Request.Context(), userID)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, result)
}

func (h *ContactHandler) AcceptFriendRequest(c *gin.Context) {
	userID := c.GetString("user_id")
	requestID := c.Param("id")
	if err := h.service.AcceptFriendRequest(c.Request.Context(), userID, requestID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *ContactHandler) RejectFriendRequest(c *gin.Context) {
	userID := c.GetString("user_id")
	requestID := c.Param("id")
	if err := h.service.RejectFriendRequest(c.Request.Context(), userID, requestID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *ContactHandler) ListContacts(c *gin.Context) {
	userID := c.GetString("user_id")
	result, err := h.service.ListContacts(c.Request.Context(), userID)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, result)
}

func (h *ContactHandler) RemoveContact(c *gin.Context) {
	userID := c.GetString("user_id")
	friendID := c.Param("user_id")
	if err := h.service.RemoveContact(c.Request.Context(), userID, friendID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *ContactHandler) BlockContact(c *gin.Context) {
	userID := c.GetString("user_id")
	targetID := c.Param("user_id")
	if err := h.service.BlockContact(c.Request.Context(), userID, targetID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *ContactHandler) UnblockContact(c *gin.Context) {
	userID := c.GetString("user_id")
	targetID := c.Param("user_id")
	if err := h.service.UnblockContact(c.Request.Context(), userID, targetID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

type updateRemarkReq struct {
	Remark string `json:"remark" binding:"required"`
}

func (h *ContactHandler) UpdateRemark(c *gin.Context) {
	var req updateRemarkReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	friendID := c.Param("user_id")
	if err := h.service.UpdateRemark(c.Request.Context(), userID, friendID, req.Remark); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}
