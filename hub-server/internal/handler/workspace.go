package handler

import (
	"context"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
)

// WorkspaceService is the subset of *service.WorkspaceService used by WorkspaceHandler.
type WorkspaceService interface {
	Create(ctx context.Context, ownerID string, req *model.Workspace) (*model.Workspace, error)
	Get(ctx context.Context, id, ownerID string) (*model.Workspace, error)
	Update(ctx context.Context, id, ownerID string, req *service.WorkspaceUpdate) (*model.Workspace, error)
	List(ctx context.Context, ownerID, q, cursor string, pageSize int) (*service.WorkspaceListResult, error)
}

type WorkspaceHandler struct {
	service WorkspaceService
}

func NewWorkspaceHandler(service WorkspaceService) *WorkspaceHandler {
	return &WorkspaceHandler{service: service}
}

type createWorkspaceReq struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
}

type updateWorkspaceReq struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
}

func (h *WorkspaceHandler) CreateWorkspace(c *gin.Context) {
	var req createWorkspaceReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	workspace, err := h.service.Create(c.Request.Context(), c.GetString("user_id"), &model.Workspace{
		Name:        req.Name,
		Description: req.Description,
	})
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, Response{Code: errcode.OK.Code, Data: workspace})
}

func (h *WorkspaceHandler) GetWorkspace(c *gin.Context) {
	workspace, err := h.service.Get(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, workspace)
}

func (h *WorkspaceHandler) ListWorkspaces(c *gin.Context) {
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "50"))
	result, err := h.service.List(c.Request.Context(), c.GetString("user_id"), c.Query("q"), c.Query("pageCursor"), pageSize)
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

func (h *WorkspaceHandler) UpdateWorkspace(c *gin.Context) {
	var req updateWorkspaceReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	workspace, err := h.service.Update(c.Request.Context(), c.Param("id"), c.GetString("user_id"), &service.WorkspaceUpdate{
		Name:        req.Name,
		Description: req.Description,
	})
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, workspace)
}
