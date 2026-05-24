package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// AgentService is the subset of *service.AgentService used by AgentHandler.
type AgentService interface {
	AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) error
	TriggerAgentTask(ctx context.Context, userID, triggerMessageID string) (*model.PendingAgentTask, error)
	CancelTask(ctx context.Context, userID, taskID string) error
	HandleTaskAck(ctx context.Context, taskID, edgeRunID string) error
	HandleTaskStream(ctx context.Context, taskID, content string) error
	HandleTaskDone(ctx context.Context, taskID, finalContent string) error
	HandleTaskFail(ctx context.Context, taskID, errMsg string) error
}

type AgentHandler struct {
	service AgentService
}

func NewAgentHandler(s AgentService) *AgentHandler {
	return &AgentHandler{service: s}
}

type addAgentReq struct {
	AgentType     string `json:"agent_type" binding:"required"`
	CustomAgentID string `json:"custom_agent_id,omitempty"`
	DisplayName   string `json:"display_name" binding:"required"`
}

// AddAgentToSession POST /client/sessions/:id/agents
func (h *AgentHandler) AddAgentToSession(c *gin.Context) {
	var req addAgentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	sessionID := c.Param("id")
	if err := h.service.AddAgentToSession(c.Request.Context(), userID, sessionID, req.AgentType, req.CustomAgentID, req.DisplayName); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

type triggerTaskReq struct {
	TriggerMessageID string `json:"trigger_message_id" binding:"required"`
}

// TriggerTask POST /web/agent-tasks
func (h *AgentHandler) TriggerTask(c *gin.Context) {
	var req triggerTaskReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	task, err := h.service.TriggerAgentTask(c.Request.Context(), userID, req.TriggerMessageID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, task)
}

// CancelTask POST /web/agent-tasks/:id/cancel
func (h *AgentHandler) CancelTask(c *gin.Context) {
	userID := c.GetString("user_id")
	taskID := c.Param("id")
	if err := h.service.CancelTask(c.Request.Context(), userID, taskID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

// TaskAck POST /edge/agent-tasks/:id/ack
func (h *AgentHandler) TaskAck(c *gin.Context) {
	var req taskAckReq
	if c.Request.Body != nil {
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			Fail(c, errcode.ErrBadRequest)
			return
		}
		if len(bytes.TrimSpace(body)) > 0 {
			if err := json.Unmarshal(body, &req); err != nil {
				Fail(c, errcode.ErrBadRequest)
				return
			}
		}
	}
	taskID := c.Param("id")
	if err := h.service.HandleTaskAck(c.Request.Context(), taskID, req.normalizedRunID()); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

type taskAckReq struct {
	RunID     string `json:"run_id"`
	EdgeRunID string `json:"edge_run_id"`
}

func (r taskAckReq) normalizedRunID() string {
	if r.EdgeRunID != "" {
		return r.EdgeRunID
	}
	return r.RunID
}

type taskStreamReq struct {
	Content string `json:"content" binding:"required"`
}

// TaskStream POST /edge/agent-tasks/:id/stream
func (h *AgentHandler) TaskStream(c *gin.Context) {
	var req taskStreamReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	taskID := c.Param("id")
	if err := h.service.HandleTaskStream(c.Request.Context(), taskID, req.Content); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

type taskDoneReq struct {
	FinalContent string `json:"final_content"`
}

// TaskDone POST /edge/agent-tasks/:id/done
func (h *AgentHandler) TaskDone(c *gin.Context) {
	var req taskDoneReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	taskID := c.Param("id")
	if err := h.service.HandleTaskDone(c.Request.Context(), taskID, req.FinalContent); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

type taskFailReq struct {
	Error string `json:"error" binding:"required"`
}

// TaskFail POST /edge/agent-tasks/:id/fail
func (h *AgentHandler) TaskFail(c *gin.Context) {
	var req taskFailReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	taskID := c.Param("id")
	if err := h.service.HandleTaskFail(c.Request.Context(), taskID, req.Error); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}
