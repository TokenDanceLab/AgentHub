package handler

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service/relay"
)

// RelayService is the subset of *relay.Service used by RelayHandler.
type RelayService interface {
	CreateCommand(ctx context.Context, targetEdgeID, commandType string, payload json.RawMessage, createdBy string) (*relay.CommandData, error)
	GetCommand(ctx context.Context, id string, userID string) (*relay.CommandData, error)
	AckCommand(ctx context.Context, id string, userID string) error
}

// RelayHandler handles HTTP requests for relay commands between Hub and Edge.
type RelayHandler struct {
	service RelayService
}

// NewRelayHandler creates a new RelayHandler.
func NewRelayHandler(service RelayService) *RelayHandler {
	return &RelayHandler{service: service}
}

type createRelayReq struct {
	TargetEdgeID string          `json:"target_edge_id"`
	TargetID     string          `json:"target_id"`
	CommandType  string          `json:"command_type"`
	Payload      json.RawMessage `json:"payload"`
}

func (r createRelayReq) targetEdgeID() (string, bool) {
	targetEdgeID := strings.TrimSpace(r.TargetEdgeID)
	targetID := strings.TrimSpace(r.TargetID)
	if targetEdgeID != "" && targetID != "" && targetEdgeID != targetID {
		return "", false
	}
	if targetEdgeID != "" {
		return targetEdgeID, true
	}
	return targetID, targetID != ""
}

func (r createRelayReq) validPayload() bool {
	payload := strings.TrimSpace(string(r.Payload))
	return payload != "" && payload != "null"
}

// CreateCommand handles POST /web/relay/commands — creates and pushes a relay command.
func (h *RelayHandler) CreateCommand(c *gin.Context) {
	var req createRelayReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	targetEdgeID, ok := req.targetEdgeID()
	if !ok || strings.TrimSpace(req.CommandType) == "" || !req.validPayload() {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	cmd, err := h.service.CreateCommand(c.Request.Context(), targetEdgeID, strings.TrimSpace(req.CommandType), req.Payload, userID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, cmd)
}

// GetCommand handles GET /web/relay/commands/:id — retrieves a relay command.
func (h *RelayHandler) GetCommand(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")
	cmd, err := h.service.GetCommand(c.Request.Context(), id, userID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, cmd)
}

// AckCommand handles POST /web/relay/commands/:id/ack — acknowledges a relay command.
func (h *RelayHandler) AckCommand(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")
	if err := h.service.AckCommand(c.Request.Context(), id, userID); err != nil {
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
