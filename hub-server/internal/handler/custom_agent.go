package handler

import (
	"context"
	"errors"
	"log/slog"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/model"
)

// CustomAgentService is the subset of *agent.Service used by CustomAgentHandler.
type CustomAgentService interface {
	CreateCustomAgent(ctx context.Context, ownerID, name, avatarURL, agentType, systemPrompt, capabilityTags, toolWhitelist, modelParams string) (*model.CustomAgent, error)
	ListCustomAgents(ctx context.Context, ownerID string) ([]model.CustomAgent, error)
	UpdateCustomAgent(ctx context.Context, ownerID string, ca *model.CustomAgent) error
	DeleteCustomAgent(ctx context.Context, ownerID, id string) error
}

type CustomAgentHandler struct {
	service CustomAgentService
}

func NewCustomAgentHandler(s CustomAgentService) *CustomAgentHandler {
	return &CustomAgentHandler{service: s}
}

type createCustomAgentReq struct {
	Name           string `json:"name" binding:"required"`
	AvatarURL      string `json:"avatar_url,omitempty"`
	AgentType      string `json:"agent_type" binding:"required"`
	SystemPrompt   string `json:"system_prompt" binding:"required"`
	CapabilityTags string `json:"capability_tags,omitempty"`
	ToolWhitelist  string `json:"tool_whitelist,omitempty"`
	ModelParams    string `json:"model_params,omitempty"`
}

// Create POST /web/custom-agents
func (h *CustomAgentHandler) Create(c *gin.Context) {
	var req createCustomAgentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	// Pre-validate jsonb fields before DB insert.
	if err := (&model.CustomAgent{
		CapabilityTags: req.CapabilityTags,
		ToolWhitelist:  req.ToolWhitelist,
		ModelParams:    req.ModelParams,
	}).Validate(); err != nil {
		slog.Error("custom agent create validation failed", "request_id", middleware.GetRequestID(c), "user_id", userID, "error", err)
		FailWithMessage(c, errcode.ErrBadRequest, "invalid agent configuration")
		return
	}
	ca, err := h.service.CreateCustomAgent(c.Request.Context(), userID, req.Name, req.AvatarURL, req.AgentType, req.SystemPrompt, req.CapabilityTags, req.ToolWhitelist, req.ModelParams)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, ca)
}

// List GET /web/custom-agents
func (h *CustomAgentHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")
	agents, err := h.service.ListCustomAgents(c.Request.Context(), userID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, agents)
}

// updateCustomAgentReq is the whole body of PUT /web/custom-agents/:id.
//
// Do NOT add output_schema here. This struct is the contract for what an update
// request may change, and repository.UpdateCustomAgent derives its narrow column
// list from exactly these fields. Making the client echo output_schema back would
// outsource row integrity to the frontend: any client that does not know the
// field (every client today) would still send nothing, and the column is
// consumed by service/dispatch/payload.go as the edge's
// structured_output_schema. Columns the request cannot carry are left out of the
// UPDATE instead of round-tripped through it (#2253).
type updateCustomAgentReq struct {
	Name           string `json:"name" binding:"required"`
	AvatarURL      string `json:"avatar_url,omitempty"`
	AgentType      string `json:"agent_type" binding:"required"`
	SystemPrompt   string `json:"system_prompt" binding:"required"`
	CapabilityTags string `json:"capability_tags,omitempty"`
	ToolWhitelist  string `json:"tool_whitelist,omitempty"`
	ModelParams    string `json:"model_params,omitempty"`
}

// Update PUT /web/custom-agents/:id
func (h *CustomAgentHandler) Update(c *gin.Context) {
	var req updateCustomAgentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	id := c.Param("id")
	ca := &model.CustomAgent{
		ID:             id,
		Name:           req.Name,
		AvatarURL:      req.AvatarURL,
		AgentType:      req.AgentType,
		SystemPrompt:   req.SystemPrompt,
		CapabilityTags: req.CapabilityTags,
		ToolWhitelist:  req.ToolWhitelist,
		ModelParams:    req.ModelParams,
	}
	// Pre-validate jsonb fields before DB update.
	if err := ca.Validate(); err != nil {
		slog.Error("custom agent update validation failed", "request_id", middleware.GetRequestID(c), "user_id", userID, "agent_id", id, "error", err)
		FailWithMessage(c, errcode.ErrBadRequest, "invalid agent configuration")
		return
	}
	if err := h.service.UpdateCustomAgent(c.Request.Context(), userID, ca); err != nil {
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

// Delete DELETE /web/custom-agents/:id
func (h *CustomAgentHandler) Delete(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")
	if err := h.service.DeleteCustomAgent(c.Request.Context(), userID, id); err != nil {
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
