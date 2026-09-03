package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// AgentService is the subset of *agent.Service used by AgentHandler.
type AgentService interface {
	AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) (*model.AgentInstance, error)
	TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error)
	RegenerateAgentTask(ctx context.Context, userID, taskID string) (*model.PendingAgentTask, error)
	CancelTask(ctx context.Context, userID, taskID string) error
	HandleTaskAck(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error
	HandleTaskStream(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error
	HandleTaskDone(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error
	HandleTaskFail(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error
	ListTaskRunEvents(ctx context.Context, userID, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error)
	GetTaskRunEventSummary(ctx context.Context, userID, taskID string) (*model.AgentRunEventSummary, error)
}

type agentTaskProjectionService interface {
	ListTaskApprovals(ctx context.Context, userID, taskID string) (*model.AgentTaskApprovalList, error)
	DecideTaskApproval(ctx context.Context, userID, taskID, approvalID string, decision model.TeamApprovalDecision) (*model.AgentTaskApproval, error)
	ListTaskArtifacts(ctx context.Context, userID, taskID string) (*model.AgentTaskArtifactList, error)
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
	agent, err := h.service.AddAgentToSession(c.Request.Context(), userID, sessionID, req.AgentType, req.CustomAgentID, req.DisplayName)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, agent)
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
		var e *errcode.Error
		if errors.As(err, &e) {
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

// RegenerateTask POST /web/agent-tasks/:id/regenerate
func (h *AgentHandler) RegenerateTask(c *gin.Context) {
	userID := c.GetString("user_id")
	taskID := c.Param("id")
	newTask, err := h.service.RegenerateAgentTask(c.Request.Context(), userID, taskID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, newTask)
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
		} else {
			slog.Warn("TaskAck received empty body", "task_id", c.Param("id"))
		}
	} else {
		slog.Warn("TaskAck received nil body", "task_id", c.Param("id"))
	}
	taskID, ok := taskIDParam(c)
	if !ok {
		return
	}
	edgeUserID := c.GetString("user_id")
	edgeDeviceID := c.GetString("device_id")
	if err := h.service.HandleTaskAck(c.Request.Context(), edgeUserID, edgeDeviceID, taskID, req.normalizedRunID()); err != nil {
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
	taskID, ok := taskIDParam(c)
	if !ok {
		return
	}
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
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, events)
}

// TaskEventSummary GET /web/agent-tasks/:id/events/summary or /web/agent-tasks/:id/summary
func (h *AgentHandler) TaskEventSummary(c *gin.Context) {
	userID := c.GetString("user_id")
	taskID := c.Param("id")
	summary, err := h.service.GetTaskRunEventSummary(c.Request.Context(), userID, taskID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, summary)
}

// TaskApprovals GET /web/agent-tasks/:id/approvals
func (h *AgentHandler) TaskApprovals(c *gin.Context) {
	userID := c.GetString("user_id")
	taskID := c.Param("id")
	projectionSvc, ok := h.service.(agentTaskProjectionService)
	if !ok {
		Fail(c, errcode.ErrInternal)
		return
	}
	approvals, err := projectionSvc.ListTaskApprovals(c.Request.Context(), userID, taskID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, approvals)
}

// DecideTaskApproval POST /web/agent-tasks/:id/approvals/:approval_id/decide
func (h *AgentHandler) DecideTaskApproval(c *gin.Context) {
	var req decideApprovalReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")
	taskID := c.Param("id")
	projectionSvc, ok := h.service.(agentTaskProjectionService)
	if !ok {
		Fail(c, errcode.ErrInternal)
		return
	}
	approval, err := projectionSvc.DecideTaskApproval(c.Request.Context(), userID, taskID, c.Param("approval_id"), model.TeamApprovalDecision{
		Decision: req.Decision,
		Reason:   req.Reason,
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
	OK(c, approval)
}

// TaskArtifacts GET /web/agent-tasks/:id/artifacts
func (h *AgentHandler) TaskArtifacts(c *gin.Context) {
	userID := c.GetString("user_id")
	taskID := c.Param("id")
	projectionSvc, ok := h.service.(agentTaskProjectionService)
	if !ok {
		Fail(c, errcode.ErrInternal)
		return
	}
	artifacts, err := projectionSvc.ListTaskArtifacts(c.Request.Context(), userID, taskID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, artifacts)
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
		// Ceiling stays MaxPageLimit: api/openapi.yaml declares maximum: 500 for
		// this endpoint's own `limit` parameter ("values above 500 are clamped by
		// Hub"), and repository.ListAgentRunEventsByTaskIDFiltered applies no
		// ceiling to an explicit limit — this handler is the enforcement point.
		// def is the requested value itself so limit=0 keeps its meaning of "no
		// explicit limit", which the repository answers with
		// maxAgentEventsPerQuery (#2243).
		filter.Limit = config.ClampPageSize(limit, config.MaxPageLimit, limit)
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
	taskID, ok := taskIDParam(c)
	if !ok {
		return
	}
	edgeUserID := c.GetString("user_id")
	edgeDeviceID := c.GetString("device_id")
	if err := h.service.HandleTaskDone(c.Request.Context(), edgeUserID, edgeDeviceID, taskID, req.normalizedRunID(), req.FinalContent); err != nil {
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
	taskID, ok := taskIDParam(c)
	if !ok {
		return
	}
	edgeUserID := c.GetString("user_id")
	edgeDeviceID := c.GetString("device_id")
	if err := h.service.HandleTaskFail(c.Request.Context(), edgeUserID, edgeDeviceID, taskID, req.normalizedRunID(), req.Error); err != nil {
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
