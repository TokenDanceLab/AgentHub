package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service"
)

type MessageHandler struct {
	service *service.MessageService
}

func NewMessageHandler(s *service.MessageService) *MessageHandler {
	return &MessageHandler{service: s}
}

func (h *MessageHandler) SendMessage(c *gin.Context) {
	userID := c.GetString("user_id")
	sessionID := c.Param("id")

	var req service.SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	result, err := h.service.SendMessage(c.Request.Context(), sessionID, userID, req)
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

func (h *MessageHandler) GetMessages(c *gin.Context) {
	userID := c.GetString("user_id")
	sessionID := c.Param("id")

	beforeSeqStr := c.Query("before_seq")
	limitStr := c.Query("limit")

	var beforeSeq int64
	if beforeSeqStr != "" {
		parsed, err := strconv.ParseInt(beforeSeqStr, 10, 64)
		if err != nil {
			Fail(c, errcode.ErrBadRequest)
			return
		}
		beforeSeq = parsed
	}

	limit := 50
	if limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil {
			Fail(c, errcode.ErrBadRequest)
			return
		}
		limit = parsed
	}

	result, err := h.service.GetMessages(c.Request.Context(), sessionID, userID, beforeSeq, limit)
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

func (h *MessageHandler) GetIncrementalMessages(c *gin.Context) {
	userID := c.GetString("user_id")
	sessionID := c.Param("id")

	afterSeqStr := c.Query("after_seq")
	limitStr := c.Query("limit")

	var afterSeq int64
	if afterSeqStr != "" {
		parsed, err := strconv.ParseInt(afterSeqStr, 10, 64)
		if err != nil {
			Fail(c, errcode.ErrBadRequest)
			return
		}
		afterSeq = parsed
	}

	limit := 50
	if limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil {
			Fail(c, errcode.ErrBadRequest)
			return
		}
		limit = parsed
	}

	result, err := h.service.GetMessagesIncremental(c.Request.Context(), sessionID, userID, afterSeq, limit)
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

func (h *MessageHandler) RecallMessage(c *gin.Context) {
	userID := c.GetString("user_id")
	msgID := c.Param("id")

	if err := h.service.RecallMessage(c.Request.Context(), msgID, userID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *MessageHandler) PinMessage(c *gin.Context) {
	userID := c.GetString("user_id")
	msgID := c.Param("id")

	var req struct {
		SessionID string `json:"session_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	if err := h.service.PinMessage(c.Request.Context(), userID, req.SessionID, msgID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *MessageHandler) UnpinMessage(c *gin.Context) {
	userID := c.GetString("user_id")
	msgID := c.Param("id")

	var req struct {
		SessionID string `json:"session_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	if err := h.service.UnpinMessage(c.Request.Context(), userID, req.SessionID, msgID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *MessageHandler) ListPins(c *gin.Context) {
	userID := c.GetString("user_id")
	sessionID := c.Param("id")

	result, err := h.service.ListPinnedMessages(c.Request.Context(), userID, sessionID)
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

func (h *MessageHandler) ForwardMessage(c *gin.Context) {
	userID := c.GetString("user_id")
	msgID := c.Param("id")

	var req struct {
		TargetSessionIDs []string `json:"target_session_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	if err := h.service.ForwardMessage(c.Request.Context(), userID, msgID, req.TargetSessionIDs); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *MessageHandler) MarkRead(c *gin.Context) {
	userID := c.GetString("user_id")
	sessionID := c.Param("id")

	var req struct {
		LastReadSeq int64 `json:"last_read_seq"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	if err := h.service.MarkRead(c.Request.Context(), userID, sessionID, req.LastReadSeq); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *MessageHandler) SearchMessages(c *gin.Context) {
	userID := c.GetString("user_id")
	q := c.Query("q")
	if q == "" {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	sessionID := c.Query("session_id")
	contentType := c.Query("content_type")
	from := c.Query("from")
	to := c.Query("to")

	result, err := h.service.SearchMessages(c.Request.Context(), userID, q, sessionID, contentType, from, to)
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

func (h *MessageHandler) SearchSessionMessages(c *gin.Context) {
	userID := c.GetString("user_id")
	sessionID := c.Param("id")
	q := c.Query("q")
	if q == "" {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	contentType := c.Query("content_type")
	from := c.Query("from")
	to := c.Query("to")

	result, err := h.service.SearchMessages(c.Request.Context(), userID, q, sessionID, contentType, from, to)
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
