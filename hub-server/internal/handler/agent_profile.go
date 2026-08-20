package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/agentprofile"
)

// AgentProfileService is the subset of *agentprofile.Service used by AgentProfileHandler.
type AgentProfileService interface {
	Create(ctx context.Context, ownerID string, req *model.AgentProfile) (*model.AgentProfile, error)
	Get(ctx context.Context, id, ownerID string) (*model.AgentProfile, error)
	Update(ctx context.Context, id, ownerID string, updates map[string]interface{}) (*model.AgentProfile, error)
	Delete(ctx context.Context, id, ownerID string) error
	List(ctx context.Context, ownerID, runtimeID, q, cursor string, pageSize int) (*agentprofile.ListResult, error)
	Publish(ctx context.Context, id, ownerID string) error
	Unpublish(ctx context.Context, id, ownerID string) error
	Install(ctx context.Context, id, installerID string) (*model.AgentProfile, error)
}

type AgentProfileHandler struct {
	service AgentProfileService
}

func NewAgentProfileHandler(service AgentProfileService) *AgentProfileHandler {
	return &AgentProfileHandler{service: service}
}

type createProfileReq struct {
	Name              string `json:"name" binding:"required"`
	Description       string `json:"description"`
	RuntimeID         string `json:"runtime_id" binding:"required"`
	Model             string `json:"model"`
	Provider          string `json:"provider"`
	ReasoningEffort   string `json:"reasoning_effort"`
	ModelMapping      any    `json:"model_mapping"`
	Skills            any    `json:"skills"`
	MCPServers        any    `json:"mcp_servers"`
	ToolAllowlist     any    `json:"tool_allowlist"`
	ApprovalPolicy    any    `json:"approval_policy"`
	PermissionMode    string `json:"permission_mode"`
	TargetPreferences any    `json:"target_preferences"`
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
	modelMapping, normErr := normalizeAgentProfileJSONField("model_mapping", req.ModelMapping, true)
	if normErr != nil {
		Fail(c, normErr)
		return
	}
	if modelMapping != "" {
		profile.ModelMapping = modelMapping
	}
	skills, normErr := normalizeAgentProfileJSONField("skills", req.Skills, false)
	if normErr != nil {
		Fail(c, normErr)
		return
	}
	if skills != "" {
		profile.Skills = skills
	}
	mcpServers, normErr := normalizeAgentProfileJSONField("mcp_servers", req.MCPServers, false)
	if normErr != nil {
		Fail(c, normErr)
		return
	}
	if mcpServers != "" {
		profile.MCPServers = mcpServers
	}
	toolAllowlist, normErr := normalizeAgentProfileJSONField("tool_allowlist", req.ToolAllowlist, false)
	if normErr != nil {
		Fail(c, normErr)
		return
	}
	if toolAllowlist != "" {
		profile.ToolAllowlist = toolAllowlist
	}
	approvalPolicy, normErr := normalizeAgentProfileJSONField("approval_policy", req.ApprovalPolicy, true)
	if normErr != nil {
		Fail(c, normErr)
		return
	}
	if approvalPolicy != "" {
		profile.ApprovalPolicy = approvalPolicy
	}
	targetPreferences, normErr := normalizeAgentProfileJSONField("target_preferences", req.TargetPreferences, true)
	if normErr != nil {
		Fail(c, normErr)
		return
	}
	if targetPreferences != "" {
		profile.TargetPreferences = targetPreferences
	}

	result, err := h.service.Create(c.Request.Context(), userID, profile)
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

func (h *AgentProfileHandler) GetProfile(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")
	profile, err := h.service.Get(c.Request.Context(), id, userID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
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
	if pageSize <= 0 {
		pageSize = config.DefaultPaginationLimit
	}
	if pageSize > config.MaxPageLimit {
		pageSize = config.MaxPageLimit
	}

	result, err := h.service.List(c.Request.Context(), userID, runtimeID, q, cursor, pageSize)
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
	if err := normalizeAgentProfileUpdateJSONFields(updates); err != nil {
		Fail(c, err)
		return
	}

	profile, err := h.service.Update(c.Request.Context(), id, userID, updates)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, profile)
}

func normalizeAgentProfileUpdateJSONFields(updates map[string]interface{}) *errcode.Error {
	for _, field := range []string{"model_mapping", "approval_policy", "target_preferences"} {
		normalized, err := normalizeAgentProfileJSONField(field, updates[field], true)
		if err != nil {
			return err
		}
		if normalized != "" {
			updates[field] = normalized
		}
	}
	for _, field := range []string{"skills", "mcp_servers", "tool_allowlist"} {
		normalized, err := normalizeAgentProfileJSONField(field, updates[field], false)
		if err != nil {
			return err
		}
		if normalized != "" {
			updates[field] = normalized
		}
	}
	return nil
}

func normalizeAgentProfileJSONField(field string, value any, wantObject bool) (string, *errcode.Error) {
	if value == nil {
		return "", nil
	}
	if s, ok := value.(string); ok {
		if s == "" {
			return "", nil
		}
		if wantObject {
			var obj map[string]any
			if err := json.Unmarshal([]byte(s), &obj); err != nil {
				return "", errcode.ErrBadRequest.WithMessage(fmt.Sprintf("%s must be a JSON object", field))
			}
			return s, nil
		}
		var arr []any
		if err := json.Unmarshal([]byte(s), &arr); err != nil {
			return "", errcode.ErrBadRequest.WithMessage(fmt.Sprintf("%s must be a JSON array", field))
		}
		return s, nil
	}
	if wantObject {
		if _, ok := value.(map[string]any); !ok {
			return "", errcode.ErrBadRequest.WithMessage(fmt.Sprintf("%s must be a JSON object", field))
		}
	} else {
		if _, ok := value.([]any); !ok {
			return "", errcode.ErrBadRequest.WithMessage(fmt.Sprintf("%s must be a JSON array", field))
		}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", errcode.ErrBadRequest.WithMessage(fmt.Sprintf("%s is not valid JSON", field))
	}
	return string(encoded), nil
}

func (h *AgentProfileHandler) DeleteProfile(c *gin.Context) {
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

func (h *AgentProfileHandler) PublishProfile(c *gin.Context) {
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

func (h *AgentProfileHandler) InstallProfile(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	profile, err := h.service.Install(c.Request.Context(), id, userID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, profile)
}
