package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// AgentService is the subset of *service.AgentService used by AgentHandler.
type AgentService interface {
	AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) error
	TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error)
	CancelTask(ctx context.Context, userID, taskID string) error
	HandleTaskAck(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error
	HandleTaskStream(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error
	HandleTaskDone(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error
	HandleTaskFail(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error
	ListTaskRunEvents(ctx context.Context, userID, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error)
	GetTaskRunEventSummary(ctx context.Context, userID, taskID string) (*model.AgentRunEventSummary, error)
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
	AgentInstanceID  string `json:"agent_instance_id,omitempty"`
	AgentType        string `json:"agent_type,omitempty"`
	CustomAgentID    string `json:"custom_agent_id,omitempty"`
	ModelParams      string `json:"model_params,omitempty"`
	TargetID         string `json:"target_id,omitempty"`
}

// TriggerTask POST /web/agent-tasks
func (h *AgentHandler) TriggerTask(c *gin.Context) {
	var req triggerTaskReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	task, err := h.service.TriggerAgentTask(
		c.Request.Context(),
		userID,
		req.TriggerMessageID,
		req.AgentInstanceID,
		req.AgentType,
		req.CustomAgentID,
		req.ModelParams,
		req.TargetID,
	)
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
	edgeUserID := c.GetString("user_id")
	edgeDeviceID := c.GetString("device_id")
	if err := h.service.HandleTaskAck(c.Request.Context(), edgeUserID, edgeDeviceID, taskID, req.normalizedRunID()); err != nil {
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
	RunID       string          `json:"run_id"`
	EdgeRunID   string          `json:"edge_run_id"`
	Content     string          `json:"content"`
	Chunk       string          `json:"chunk"`
	EventType   string          `json:"event_type"`
	Payload     json.RawMessage `json:"payload"`
	ClientMsgID string          `json:"client_msg_id"`
}

// TaskStream POST /edge/agent-tasks/:id/stream
func (h *AgentHandler) TaskStream(c *gin.Context) {
	var req taskStreamReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	taskID := c.Param("id")
	edgeUserID := c.GetString("user_id")
	edgeDeviceID := c.GetString("device_id")
	stream := req.normalizedStream()
	if stream.Content == "" && len(stream.Payload) == 0 {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	if req.ClientMsgID != "" {
		normalized, ok := normalizeUUID(req.ClientMsgID)
		if !ok {
			Fail(c, errcode.ErrBadRequest)
			return
		}
		stream.ClientMsgID = normalized
	}
	if err := h.service.HandleTaskStream(c.Request.Context(), edgeUserID, edgeDeviceID, taskID, req.normalizedRunID(), stream); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

// TaskEvents GET /web/agent-tasks/:id/events
func (h *AgentHandler) TaskEvents(c *gin.Context) {
	userID := c.GetString("user_id")
	taskID := c.Param("id")
	filter, parseErr := runEventFilterFromQuery(c)
	if parseErr != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	events, err := h.service.ListTaskRunEvents(c.Request.Context(), userID, taskID, filter)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, events)
}

// TaskEventSummary GET /web/agent-tasks/:id/events/summary
func (h *AgentHandler) TaskEventSummary(c *gin.Context) {
	userID := c.GetString("user_id")
	taskID := c.Param("id")
	summary, err := h.service.GetTaskRunEventSummary(c.Request.Context(), userID, taskID)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, summary)
}

func runEventFilterFromQuery(c *gin.Context) (model.AgentRunEventFilter, error) {
	filter := model.AgentRunEventFilter{
		EventType: c.Query("event_type"),
	}
	if raw := c.Query("after_seq"); raw != "" {
		seq, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || seq < 0 {
			return filter, errcode.ErrBadRequest
		}
		filter.AfterSeq = seq
	}
	if raw := c.Query("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 0 {
			return filter, errcode.ErrBadRequest
		}
		filter.Limit = limit
	}
	return filter, nil
}

type taskDoneReq struct {
	RunID        string `json:"run_id"`
	EdgeRunID    string `json:"edge_run_id"`
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
	edgeUserID := c.GetString("user_id")
	edgeDeviceID := c.GetString("device_id")
	if err := h.service.HandleTaskDone(c.Request.Context(), edgeUserID, edgeDeviceID, taskID, req.normalizedRunID(), req.FinalContent); err != nil {
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
	RunID     string `json:"run_id"`
	EdgeRunID string `json:"edge_run_id"`
	Error     string `json:"error" binding:"required"`
}

// TaskFail POST /edge/agent-tasks/:id/fail
func (h *AgentHandler) TaskFail(c *gin.Context) {
	var req taskFailReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	taskID := c.Param("id")
	edgeUserID := c.GetString("user_id")
	edgeDeviceID := c.GetString("device_id")
	if err := h.service.HandleTaskFail(c.Request.Context(), edgeUserID, edgeDeviceID, taskID, req.normalizedRunID(), req.Error); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}

func (r taskStreamReq) normalizedRunID() string {
	if r.EdgeRunID != "" {
		return r.EdgeRunID
	}
	return r.RunID
}

func (r taskStreamReq) normalizedStream() model.AgentRunEventInput {
	content := r.Content
	if content == "" {
		content = r.Chunk
	}
	return model.AgentRunEventInput{
		EventType:   r.EventType,
		Payload:     r.Payload,
		Content:     content,
		ClientMsgID: r.ClientMsgID,
	}
}

func (r taskDoneReq) normalizedRunID() string {
	if r.EdgeRunID != "" {
		return r.EdgeRunID
	}
	return r.RunID
}

func (r taskFailReq) normalizedRunID() string {
	if r.EdgeRunID != "" {
		return r.EdgeRunID
	}
	return r.RunID
}
