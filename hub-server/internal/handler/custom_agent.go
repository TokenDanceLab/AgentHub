package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
)

type CustomAgentHandler struct {
	service *service.AgentService
}

func NewCustomAgentHandler(s *service.AgentService) *CustomAgentHandler {
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
	ca, err := h.service.CreateCustomAgent(c.Request.Context(), userID, req.Name, req.AvatarURL, req.AgentType, req.SystemPrompt, req.CapabilityTags, req.ToolWhitelist, req.ModelParams)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
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
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, agents)
}

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
	if err := h.service.UpdateCustomAgent(c.Request.Context(), userID, ca); err != nil {
		if e, ok := err.(*errcode.Error); ok {
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
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}
