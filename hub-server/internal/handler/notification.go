package handler

import (
	"context"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// NotificationService is the subset of *service.NotificationService used by NotificationHandler.
type NotificationService interface {
	ListNotifications(ctx context.Context, userID string, unreadOnly bool, limit, offset int) ([]model.Notification, error)
	MarkRead(ctx context.Context, userID, notifID string) error
	MarkAllRead(ctx context.Context, userID string) error
}

type NotificationHandler struct {
	service NotificationService
}

func NewNotificationHandler(s NotificationService) *NotificationHandler {
	return &NotificationHandler{service: s}
}

func (h *NotificationHandler) ListNotifications(c *gin.Context) {
	userID := c.GetString("user_id")

	unreadOnly, _ := strconv.ParseBool(c.DefaultQuery("unread_only", "false"))

	limit := config.DefaultPaginationLimit
	if l := c.Query("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil {
			limit = v
		}
	}

	offset := 0
	if o := c.Query("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil {
			offset = v
		}
	}

	result, err := h.service.ListNotifications(c.Request.Context(), userID, unreadOnly, limit, offset)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}

	OK(c, result)
}

func (h *NotificationHandler) MarkRead(c *gin.Context) {
	userID := c.GetString("user_id")
	notifID := c.Param("id")

	if err := h.service.MarkRead(c.Request.Context(), userID, notifID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *NotificationHandler) ReadAll(c *gin.Context) {
	userID := c.GetString("user_id")

	if err := h.service.MarkAllRead(c.Request.Context(), userID); err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}
