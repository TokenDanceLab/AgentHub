package handler

import (
	"context"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
)

// MCPService is the subset of *service.MCPService used by MCPServerHandler.
type MCPService interface {
	Create(ctx context.Context, ownerID string, req *model.MCPServer) (*model.MCPServer, error)
	Get(ctx context.Context, id, ownerID string) (*model.MCPServer, error)
	Update(ctx context.Context, id, ownerID string, req *model.MCPServer) (*model.MCPServer, error)
	Delete(ctx context.Context, id, ownerID string) error
	List(ctx context.Context, ownerID, q, transport, cursor string, pageSize int) (*service.MCPListResult, error)
	Publish(ctx context.Context, id, ownerID string) error
	Unpublish(ctx context.Context, id, ownerID string) error
	SearchPublic(ctx context.Context, q, transport, cursor string, pageSize int) (*service.MCPListResult, error)
}

type MCPServerHandler struct {
	svc MCPService
}

func NewMCPServerHandler(svc MCPService) *MCPServerHandler {
	return &MCPServerHandler{svc: svc}
}

type createMCPServerReq struct {
	Name       string `json:"name" binding:"required"`
	Transport  string `json:"transport" binding:"required"`
	Command    string `json:"command"`
	Args       string `json:"args"`
	EnvVars    string `json:"env_vars"`
	URL        string `json:"url"`
	AuthType   string `json:"auth_type"`
	AuthConfig string `json:"auth_config"`
	ToolSchema string `json:"tool_schema"`
}

func (h *MCPServerHandler) CreateMCPServer(c *gin.Context) {
	var req createMCPServerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")

	srv := &model.MCPServer{
		Name:       req.Name,
		Transport:  req.Transport,
		Command:    req.Command,
		Args:       req.Args,
		EnvVars:    req.EnvVars,
		URL:        req.URL,
		AuthType:   req.AuthType,
		AuthConfig: req.AuthConfig,
		ToolSchema: req.ToolSchema,
	}

	result, err := h.svc.Create(c.Request.Context(), userID, srv)
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

func (h *MCPServerHandler) GetMCPServer(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")
	srv, err := h.svc.Get(c.Request.Context(), id, userID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, srv)
}

func (h *MCPServerHandler) ListMCPServers(c *gin.Context) {
	userID := c.GetString("user_id")
	q := c.Query("q")
	transport := c.Query("transport")
	cursor := c.Query("pageCursor")
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "50"))

	result, err := h.svc.List(c.Request.Context(), userID, q, transport, cursor, pageSize)
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

func (h *MCPServerHandler) UpdateMCPServer(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	var updates model.MCPServer
	if err := c.ShouldBindJSON(&updates); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	srv, err := h.svc.Update(c.Request.Context(), id, userID, &updates)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, srv)
}

func (h *MCPServerHandler) DeleteMCPServer(c *gin.Context) {
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

func (h *MCPServerHandler) PublishMCPServer(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	if err := h.svc.Publish(c.Request.Context(), id, userID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (h *MCPServerHandler) UnpublishMCPServer(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	if err := h.svc.Unpublish(c.Request.Context(), id, userID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}
