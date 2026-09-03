package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/workspace"
)

// WorkspaceService is the subset of *workspace.Service used by WorkspaceHandler.
// DTOs live in service/workspace (#673 second IM typed-service package).
type WorkspaceService interface {
	Create(ctx context.Context, ownerID string, req *model.Workspace) (*model.Workspace, error)
	Get(ctx context.Context, id, ownerID string) (*model.Workspace, error)
	Update(ctx context.Context, id, ownerID string, req *workspace.WorkspaceUpdate) (*model.Workspace, error)
	List(ctx context.Context, ownerID, q, cursor string, pageSize int) (*workspace.WorkspaceListResult, error)
	ListThreads(ctx context.Context, projectID, ownerID string) ([]workspace.WorkspaceThread, error)
	CreateThread(ctx context.Context, projectID, ownerID string, req *workspace.CreateWorkspaceThreadRequest) (*workspace.WorkspaceThread, error)
	CreateThreadMessage(ctx context.Context, projectID, threadID, ownerID string, req workspace.SendWorkspaceThreadMessageRequest) (*workspace.WorkspaceThreadMessage, error)
	ListThreadMessages(ctx context.Context, projectID, threadID, ownerID string, limit int) ([]workspace.WorkspaceThreadMessage, error)
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

	ws, err := h.service.Create(c.Request.Context(), c.GetString("user_id"), &model.Workspace{
		Name:        req.Name,
		Description: req.Description,
	})
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, Response{Code: errcode.OK.Code, Data: ws})
}

func (h *WorkspaceHandler) GetWorkspace(c *gin.Context) {
	ws, err := h.service.Get(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, ws)
}

func (h *WorkspaceHandler) ListWorkspaces(c *gin.Context) {
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", strconv.Itoa(config.DefaultPaginationLimit)))
	// Ceiling = repository.ListWorkspaces (MaxListPageSize), which is also the
	// PageSize maximum api/openapi.yaml declares for GET /web/projects (#2243).
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, config.DefaultPaginationLimit)
	result, err := h.service.List(c.Request.Context(), c.GetString("user_id"), c.Query("q"), c.Query("pageCursor"), pageSize)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
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

	ws, err := h.service.Update(c.Request.Context(), c.Param("id"), c.GetString("user_id"), &workspace.WorkspaceUpdate{
		Name:        req.Name,
		Description: req.Description,
	})
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, ws)
}

type createProjectThreadReq struct {
	Name string `json:"name" binding:"required"`
}

func (h *WorkspaceHandler) ListProjectThreads(c *gin.Context) {
	threads, err := h.service.ListThreads(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, threads)
}

func (h *WorkspaceHandler) CreateProjectThread(c *gin.Context) {
	var req createProjectThreadReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	thread, err := h.service.CreateThread(c.Request.Context(), c.Param("id"), c.GetString("user_id"), &workspace.CreateWorkspaceThreadRequest{
		Name: req.Name,
	})
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, thread)
}

func (h *WorkspaceHandler) CreateProjectThreadMessage(c *gin.Context) {
	var req workspace.SendWorkspaceThreadMessageRequest
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
	message, err := h.service.CreateThreadMessage(c.Request.Context(), c.Param("id"), c.Param("threadId"), c.GetString("user_id"), req)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, message)
}

func (h *WorkspaceHandler) ListProjectThreadMessages(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", strconv.Itoa(config.DefaultPaginationLimit)))
	// Ceiling = workspace.Service.ListThreadMessages, which clamps to
	// MaxMessagePageLimit before calling repository.GetMessagesBySession (itself
	// clamped to the same value), and = the maximum api/openapi.yaml declares for
	// this endpoint's own `limit` parameter (100). The response is a bare array
	// with no cursor, so a page shortened below the handler reads as "end of
	// thread" (#2243).
	limit = config.ClampPageSize(limit, config.MaxMessagePageLimit, config.DefaultPaginationLimit)
	messages, err := h.service.ListThreadMessages(c.Request.Context(), c.Param("id"), c.Param("threadId"), c.GetString("user_id"), limit)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, messages)
}
