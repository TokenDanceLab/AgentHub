package handler

import (
	"context"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
)

// ExecutionTargetService is the subset of *service.ExecutionTargetService used by ExecutionTargetHandler.
type ExecutionTargetService interface {
	Create(ctx context.Context, ownerID string, req *model.ExecutionTarget) (*model.ExecutionTarget, error)
	Get(ctx context.Context, id string) (*model.ExecutionTarget, error)
	Update(ctx context.Context, id, ownerID string, req *model.ExecutionTarget) (*model.ExecutionTarget, error)
	Delete(ctx context.Context, id, ownerID string) error
	List(ctx context.Context, ownerID, targetType, cursor string, pageSize int) (*service.TargetListResult, error)
	Ping(ctx context.Context, id string) error
}

type ExecutionTargetHandler struct {
	svc ExecutionTargetService
}

func NewExecutionTargetHandler(svc ExecutionTargetService) *ExecutionTargetHandler {
	return &ExecutionTargetHandler{svc: svc}
}

type createTargetReq struct {
	Name          string `json:"name" binding:"required"`
	TargetType    string `json:"target_type"`
	Host          string `json:"host"`
	Port          int    `json:"port"`
	WorkspaceRoot string `json:"workspace_root"`
	AuthMethod    string `json:"auth_method"`
	DeviceID      string `json:"device_id"`
}

func (h *ExecutionTargetHandler) CreateTarget(c *gin.Context) {
	var req createTargetReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")

	target := &model.ExecutionTarget{
		Name:          req.Name,
		TargetType:    req.TargetType,
		Host:          req.Host,
		Port:          req.Port,
		WorkspaceRoot: req.WorkspaceRoot,
		AuthMethod:    req.AuthMethod,
	}
	if req.DeviceID != "" {
		target.DeviceID = &req.DeviceID
	}

	result, err := h.svc.Create(c.Request.Context(), userID, target)
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

func (h *ExecutionTargetHandler) GetTarget(c *gin.Context) {
	id := c.Param("id")
	target, err := h.svc.Get(c.Request.Context(), id)
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

	result, err := h.svc.List(c.Request.Context(), userID, targetType, cursor, pageSize)
	if err != nil {
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

	var updates model.ExecutionTarget
	if err := c.ShouldBindJSON(&updates); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	target, err := h.svc.Update(c.Request.Context(), id, userID, &updates)
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

	if err := h.svc.Delete(c.Request.Context(), id, userID); err != nil {
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

	if err := h.svc.Ping(c.Request.Context(), id); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}
