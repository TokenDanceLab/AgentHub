package handler

import (
	"context"
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/mcpserver"
)

// MCPService is the subset of *mcpserver.Service used by MCPServerHandler.
type MCPService interface {
	Create(ctx context.Context, ownerID string, req *model.MCPServer) (*model.MCPServer, error)
	Get(ctx context.Context, id, ownerID string) (*model.MCPServer, error)
	Update(ctx context.Context, id, ownerID string, req *model.MCPServer) (*model.MCPServer, error)
	Delete(ctx context.Context, id, ownerID string) error
	List(ctx context.Context, ownerID, q, transport, cursor string, pageSize int) (*mcpserver.ListResult, error)
	Publish(ctx context.Context, id, ownerID string) error
	Unpublish(ctx context.Context, id, ownerID string) error
	SearchPublic(ctx context.Context, q, transport, cursor string, pageSize int) (*mcpserver.ListResult, error)
}

type MCPServerHandler struct {
	service MCPService
}

func NewMCPServerHandler(service MCPService) *MCPServerHandler {
	return &MCPServerHandler{service: service}
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

	result, err := h.service.Create(c.Request.Context(), userID, srv)
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

func (h *MCPServerHandler) GetMCPServer(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")
	srv, err := h.service.Get(c.Request.Context(), id, userID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
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
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", strconv.Itoa(config.DefaultPaginationLimit)))
	isPublic := c.DefaultQuery("is_public", "")
	// Ceiling = repository.ListMCPServers / ListPublicMCPServers (both
	// MaxListPageSize), which is also the PageSize maximum api/openapi.yaml
	// declares for GET /web/mcp-servers (#2243).
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, config.DefaultPaginationLimit)

	if isPublic == "true" {
		// Public market: return all published MCP servers (no owner filter).
		result, err := h.service.SearchPublic(c.Request.Context(), q, transport, cursor, pageSize)
		if err != nil {
			Fail(c, errcode.ErrInternal)
			return
		}
		// #2154 security lane: market results must never expose author-side
		// secrets. env_vars commonly holds API keys and auth_config can hold
		// client secrets; write-time masking only guards auth_config, so both
		// fields are blanked here for every market consumer (the owner's own
		// full record remains available via the owner-scoped list).
		for i := range result.Items {
			result.Items[i].EnvVars = ""
			result.Items[i].AuthConfig = ""
		}
		OK(c, gin.H{
			"items": result.Items,
			"page":  gin.H{"nextCursor": result.Cursor, "hasMore": result.HasMore},
		})
		return
	}

	result, err := h.service.List(c.Request.Context(), userID, q, transport, cursor, pageSize)
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

func (h *MCPServerHandler) UpdateMCPServer(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	var updates model.MCPServer
	if err := c.ShouldBindJSON(&updates); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	srv, err := h.service.Update(c.Request.Context(), id, userID, &updates)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
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

	if err := h.service.Delete(c.Request.Context(), id, userID); err != nil {
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

func (h *MCPServerHandler) PublishMCPServer(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	if err := h.service.Publish(c.Request.Context(), id, userID); err != nil {
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

func (h *MCPServerHandler) UnpublishMCPServer(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	if err := h.service.Unpublish(c.Request.Context(), id, userID); err != nil {
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
