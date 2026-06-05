package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
)

// ExecutionTargetService is the subset of *service.ExecutionTargetService used by ExecutionTargetHandler.
type ExecutionTargetService interface {
	Create(ctx context.Context, ownerID string, req *model.ExecutionTarget) (*model.ExecutionTarget, error)
	Get(ctx context.Context, id, ownerID string) (*model.ExecutionTarget, error)
	Update(ctx context.Context, id, ownerID string, req *model.ExecutionTarget) (*model.ExecutionTarget, error)
	Delete(ctx context.Context, id, ownerID string) error
	List(ctx context.Context, ownerID, targetType, cursor string, pageSize int) (*service.TargetListResult, error)
	Ping(ctx context.Context, id, ownerID string) error
}

type ExecutionTargetHandler struct {
	service ExecutionTargetService
}

func NewExecutionTargetHandler(service ExecutionTargetService) *ExecutionTargetHandler {
	return &ExecutionTargetHandler{service: service}
}

type createTargetReq struct {
	Name               string   `json:"name" binding:"required"`
	TargetType         string   `json:"target_type"`
	Host               string   `json:"host"`
	Port               int      `json:"port"`
	WorkspaceRoot      string   `json:"workspace_root"`
	WorkspaceAllowlist []string `json:"workspace_allowlist"`
	TrustLevel         string   `json:"trust_level"`
	HealthState        string   `json:"health_state"`
	AuthMethod         string   `json:"auth_method"`
	DeviceID           string   `json:"device_id"`
	Capabilities       string   `json:"capabilities"`
	Metadata           string   `json:"metadata"`
}

type updateTargetReq struct {
	Name               string   `json:"name"`
	TargetType         string   `json:"target_type"`
	Host               string   `json:"host"`
	Port               int      `json:"port"`
	WorkspaceRoot      string   `json:"workspace_root"`
	WorkspaceAllowlist []string `json:"workspace_allowlist"`
	TrustLevel         string   `json:"trust_level"`
	HealthState        string   `json:"health_state"`
	AuthMethod         string   `json:"auth_method"`
	DeviceID           string   `json:"device_id"`
	Capabilities       string   `json:"capabilities"`
	Metadata           string   `json:"metadata"`
}

func marshalStringArray(values []string) (string, error) {
	if values == nil {
		return "", nil
	}
	b, err := json.Marshal(values)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (h *ExecutionTargetHandler) CreateTarget(c *gin.Context) {
	var req createTargetReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")

	if strings.TrimSpace(req.HealthState) != "" {
		Fail(c, errcode.ErrBadRequest.WithMessage("health_state is system-managed"))
		return
	}

	workspaceAllowlist, err := marshalStringArray(req.WorkspaceAllowlist)
	if err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	target := &model.ExecutionTarget{
		Name:               req.Name,
		TargetType:         req.TargetType,
		Host:               req.Host,
		Port:               req.Port,
		WorkspaceRoot:      req.WorkspaceRoot,
		WorkspaceAllowlist: workspaceAllowlist,
		TrustLevel:         req.TrustLevel,
		AuthMethod:         req.AuthMethod,
		Capabilities:       req.Capabilities,
		Metadata:           req.Metadata,
	}
	if req.DeviceID != "" {
		target.DeviceID = &req.DeviceID
	}

	result, err := h.service.Create(c.Request.Context(), userID, target)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	c.JSON(http.StatusCreated, Response{
		Code: errcode.OK.Code,
		Data: result,
	})
}

func (h *ExecutionTargetHandler) GetTarget(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")
	target, err := h.service.Get(c.Request.Context(), id, userID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, target)
}

func (h *ExecutionTargetHandler) ListTargets(c *gin.Context) {
	userID := c.GetString("user_id")
	targetType := c.Query("target_type")
	cursor := c.Query("pageCursor")
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "50"))

	result, err := h.service.List(c.Request.Context(), userID, targetType, cursor, pageSize)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, gin.H{
		"items": result.Items,
		"page":  gin.H{"nextCursor": result.Cursor, "hasMore": result.HasMore},
	})
}

func (h *ExecutionTargetHandler) UpdateTarget(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	var req updateTargetReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	workspaceAllowlist, err := marshalStringArray(req.WorkspaceAllowlist)
	if err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	updates := model.ExecutionTarget{
		Name:               req.Name,
		TargetType:         req.TargetType,
		Host:               req.Host,
		Port:               req.Port,
		WorkspaceRoot:      req.WorkspaceRoot,
		WorkspaceAllowlist: workspaceAllowlist,
		TrustLevel:         req.TrustLevel,
		HealthState:        req.HealthState,
		AuthMethod:         req.AuthMethod,
		Capabilities:       req.Capabilities,
		Metadata:           req.Metadata,
	}
	if req.DeviceID != "" {
		updates.DeviceID = &req.DeviceID
	}

	target, err := h.service.Update(c.Request.Context(), id, userID, &updates)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, target)
}

func (h *ExecutionTargetHandler) DeleteTarget(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	if err := h.service.Delete(c.Request.Context(), id, userID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *ExecutionTargetHandler) PingTarget(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	if err := h.service.Ping(c.Request.Context(), id, userID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}
