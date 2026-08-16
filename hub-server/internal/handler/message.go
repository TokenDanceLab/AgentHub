package handler

import (
	"context"
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service/message"
	"github.com/agenthub/hub-server/internal/service/messagereaction"
)

// MessageService is the subset of *message.Service used by MessageHandler.
// DTOs live in service/message (#720 sixth IM typed-service package).
// Reaction methods use messagereaction DTOs (#662 first IM typed-service package).
type MessageService interface {
	SendMessage(ctx context.Context, sessionID, senderUserID string, req message.SendMessageRequest) (*message.SendMessageResponse, error)
	GetMessages(ctx context.Context, sessionID, userID string, beforeSeq int64, limit int) ([]message.MessageResponse, error)
	GetMessagesIncremental(ctx context.Context, sessionID, userID string, afterSeq int64, limit int) ([]message.MessageResponse, error)
	EditMessage(ctx context.Context, msgID, userID string, req message.EditMessageRequest) (*message.EditMessageResponse, error)
	RecallMessage(ctx context.Context, msgID, userID string) error
	PinMessage(ctx context.Context, userID, sessionID, msgID string) error
	UnpinMessage(ctx context.Context, userID, sessionID, msgID string) error
	ListPinnedMessages(ctx context.Context, userID, sessionID string) ([]message.MessageResponse, error)
	ForwardMessage(ctx context.Context, userID, msgID string, targetSessionIDs []string) error
	MarkRead(ctx context.Context, userID, sessionID string, lastReadSeq int64) error
	SearchMessages(ctx context.Context, userID, q, sessionID, contentType, from, to string) ([]message.MessageResponse, error)
	AddMessageReaction(ctx context.Context, userID, sessionID, msgID, reaction string) (*messagereaction.MessageReactionResponse, error)
	RemoveMessageReaction(ctx context.Context, userID, sessionID, msgID, reaction string) (*messagereaction.MessageReactionResponse, error)
	ListMessageReactions(ctx context.Context, userID, sessionID, msgID string) ([]messagereaction.MessageReactionResponse, error)
}

type MessageHandler struct {
	service MessageService
}

func NewMessageHandler(s MessageService) *MessageHandler {
	return &MessageHandler{service: s}
}

func (h *MessageHandler) SendMessage(c *gin.Context) {
	userID := c.GetString("user_id")
	sessionID := c.Param("id")

	var req message.SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	if req.ClientMsgID != "" {
		normalized, ok := normalizeUUID(req.ClientMsgID)
		if !ok {
			Fail(c, errcode.ErrBadRequest)
			return
		}
		req.ClientMsgID = normalized
	}

	result, err := h.service.SendMessage(c.Request.Context(), sessionID, userID, req)
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

	limit := config.DefaultPaginationLimit
	if limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil {
			Fail(c, errcode.ErrBadRequest)
			return
		}
		limit = parsed
	}
	if limit <= 0 {
		limit = config.DefaultPaginationLimit
	}
	if limit > config.MaxMessagePageLimit {
		limit = config.MaxMessagePageLimit
	}

	result, err := h.service.GetMessages(c.Request.Context(), sessionID, userID, beforeSeq, limit)
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

	limit := config.DefaultPaginationLimit
	if limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil {
			Fail(c, errcode.ErrBadRequest)
			return
		}
		limit = parsed
	}
	if limit <= 0 {
		limit = config.DefaultPaginationLimit
	}
	if limit > config.MaxIncrementalMessageLimit {
		limit = config.MaxIncrementalMessageLimit
	}

	result, err := h.service.GetMessagesIncremental(c.Request.Context(), sessionID, userID, afterSeq, limit)
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

func (h *MessageHandler) EditMessage(c *gin.Context) {
	userID := c.GetString("user_id")
	msgID := c.Param("id")

	var req message.EditMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	result, err := h.service.EditMessage(c.Request.Context(), msgID, userID, req)
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

func (h *MessageHandler) RecallMessage(c *gin.Context) {
	userID := c.GetString("user_id")
	msgID := c.Param("id")

	if err := h.service.RecallMessage(c.Request.Context(), msgID, userID); err != nil {
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

func (h *MessageHandler) AddMessageReaction(c *gin.Context) {
	userID := c.GetString("user_id")
	msgID := c.Param("id")

	var req struct {
		SessionID string `json:"session_id"`
		Reaction  string `json:"reaction"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	// Defense in depth: reject oversized reaction values at the HTTP boundary.
	// The service layer also enforces maxMessageReactionLength (64 runes).
	if len([]rune(req.Reaction)) > 100 {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	result, err := h.service.AddMessageReaction(c.Request.Context(), userID, req.SessionID, msgID, req.Reaction)
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

func (h *MessageHandler) RemoveMessageReaction(c *gin.Context) {
	userID := c.GetString("user_id")
	msgID := c.Param("id")

	var req struct {
		SessionID string `json:"session_id"`
		Reaction  string `json:"reaction"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	// Defense in depth: reject oversized reaction values at the HTTP boundary.
	// The service layer also enforces maxMessageReactionLength (64 runes).
	if len([]rune(req.Reaction)) > 100 {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	result, err := h.service.RemoveMessageReaction(c.Request.Context(), userID, req.SessionID, msgID, req.Reaction)
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

func (h *MessageHandler) ListMessageReactions(c *gin.Context) {
	userID := c.GetString("user_id")
	msgID := c.Param("id")
	sessionID := c.Query("session_id")
	if sessionID == "" {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	result, err := h.service.ListMessageReactions(c.Request.Context(), userID, sessionID, msgID)
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

func (h *MessageHandler) ListPins(c *gin.Context) {
	userID := c.GetString("user_id")
	sessionID := c.Param("id")

	result, err := h.service.ListPinnedMessages(c.Request.Context(), userID, sessionID)
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

func (h *MessageHandler) ForwardMessage(c *gin.Context) {
	userID := c.GetString("user_id")
	msgID := c.Param("id")

	var req struct {
		TargetSessionIDs []string `json:"target_session_ids" binding:"required,max=50"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	if err := h.service.ForwardMessage(c.Request.Context(), userID, msgID, req.TargetSessionIDs); err != nil {
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
