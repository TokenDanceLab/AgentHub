package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service"
)

type NotificationHandler struct {
	service *service.NotificationService
}

func NewNotificationHandler(s *service.NotificationService) *NotificationHandler {
	return &NotificationHandler{service: s}
}

func (h *NotificationHandler) ListNotifications(c *gin.Context) {
	userID := c.GetString("user_id")

	unreadOnly, _ := strconv.ParseBool(c.DefaultQuery("unread_only", "false"))

	limit := 50
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
