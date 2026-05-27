package handler

import (
	"context"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
)

// AgentProfileService is the subset of *service.AgentProfileService used by AgentProfileHandler.
type AgentProfileService interface {
	Create(ctx context.Context, ownerID string, req *model.AgentProfile) (*model.AgentProfile, error)
	Get(ctx context.Context, id, ownerID string) (*model.AgentProfile, error)
	Update(ctx context.Context, id, ownerID string, updates map[string]interface{}) (*model.AgentProfile, error)
	Delete(ctx context.Context, id, ownerID string) error
	List(ctx context.Context, ownerID, runtimeID, q, cursor string, pageSize int) (*service.ListResult, error)
	Publish(ctx context.Context, id, ownerID string) error
	Unpublish(ctx context.Context, id, ownerID string) error
	Install(ctx context.Context, id, installerID string) (*model.AgentProfile, error)
}

type AgentProfileHandler struct {
	svc AgentProfileService
}

func NewAgentProfileHandler(svc AgentProfileService) *AgentProfileHandler {
	return &AgentProfileHandler{svc: svc}
}

type createProfileReq struct {
	Name              string `json:"name" binding:"required"`
	Description       string `json:"description"`
	RuntimeID         string `json:"runtime_id" binding:"required"`
	Model             string `json:"model"`
	Provider          string `json:"provider"`
	ReasoningEffort   string `json:"reasoning_effort"`
	ModelMapping      string `json:"model_mapping"`
	Skills            string `json:"skills"`
	MCPServers        string `json:"mcp_servers"`
	ToolAllowlist     string `json:"tool_allowlist"`
	ApprovalPolicy    string `json:"approval_policy"`
	PermissionMode    string `json:"permission_mode"`
	TargetPreferences string `json:"target_preferences"`
	ContextBudget     int    `json:"context_budget_max_tokens"`
}

func (h *AgentProfileHandler) CreateProfile(c *gin.Context) {
	var req createProfileReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")

	profile := &model.AgentProfile{
		Name: req.Name, Description: req.Description, RuntimeID: req.RuntimeID,
		Model: req.Model, Provider: req.Provider, ReasoningEffort: req.ReasoningEffort,
		PermissionMode: req.PermissionMode, ContextBudgetMaxTokens: req.ContextBudget,
	}
	if req.ModelMapping != "" {
		profile.ModelMapping = req.ModelMapping
	}
	if req.Skills != "" {
		profile.Skills = req.Skills
	}
	if req.MCPServers != "" {
		profile.MCPServers = req.MCPServers
	}
	if req.ToolAllowlist != "" {
		profile.ToolAllowlist = req.ToolAllowlist
	}
	if req.ApprovalPolicy != "" {
		profile.ApprovalPolicy = req.ApprovalPolicy
	}
	if req.TargetPreferences != "" {
		profile.TargetPreferences = req.TargetPreferences
	}

	result, err := h.svc.Create(c.Request.Context(), userID, profile)
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

func (h *AgentProfileHandler) GetProfile(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")
	profile, err := h.svc.Get(c.Request.Context(), id, userID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, profile)
}

func (h *AgentProfileHandler) ListProfiles(c *gin.Context) {
	userID := c.GetString("user_id")
	runtimeID := c.Query("runtime_id")
	q := c.Query("q")
	cursor := c.Query("pageCursor")
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "50"))

	result, err := h.svc.List(c.Request.Context(), userID, runtimeID, q, cursor, pageSize)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, gin.H{
		"items": result.Items,
		"page":  gin.H{"nextCursor": result.Cursor, "hasMore": result.HasMore},
	})
}

func (h *AgentProfileHandler) UpdateProfile(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	profile, err := h.svc.Update(c.Request.Context(), id, userID, updates)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, profile)
}

func (h *AgentProfileHandler) DeleteProfile(c *gin.Context) {
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

func (h *AgentProfileHandler) PublishProfile(c *gin.Context) {
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

func (h *AgentProfileHandler) InstallProfile(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	profile, err := h.svc.Install(c.Request.Context(), id, userID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, profile)
}
