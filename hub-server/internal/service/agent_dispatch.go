package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/ws"
)

// dispatchPayload is the payload sent to the edge for agent.dispatch
type dispatchPayload struct {
	TaskID           string `json:"task_id"`
	AgentInstanceID  string `json:"agent_instance_id"`
	AgentType        string `json:"agent_type"`
	CustomAgentID    string `json:"custom_agent_id,omitempty"`
	TargetID         string `json:"target_id,omitempty"`
	SessionID        string `json:"session_id"`
	TriggerMessageID string `json:"trigger_message_id"`
	TriggerUserID    string `json:"trigger_user_id"`
	Prompt           string `json:"prompt"`
	DisplayName      string `json:"display_name"`
	SystemPrompt     string `json:"system_prompt,omitempty"`
	ModelParams      string `json:"model_params,omitempty"`
	ToolWhitelist    string `json:"tool_whitelist,omitempty"`
	TeamID           string `json:"team_id,omitempty"`
	TeamRunID        string `json:"team_run_id,omitempty"`
	TeamMemberID     string `json:"team_member_id,omitempty"`
	TeamMemberRole   string `json:"team_member_role,omitempty"`
	// Context continuity: thread history and pinned messages for all agent runtimes.
	Messages       []dispatchMessage `json:"messages,omitempty"`
	PinnedMessages []dispatchMessage `json:"pinned_messages,omitempty"`
}

// dispatchMessage represents a single message in thread history or pinned context.
type dispatchMessage struct {
	Role      string `json:"role"`
	Content   string `json:"content"`
	Timestamp string `json:"timestamp"` // RFC 3339
}

type dispatchTeamContext struct {
	TeamID         string
	TeamRunID      string
	TeamMemberID   string
	TeamMemberRole string
}

type dispatchTargetSnapshot struct {
	ID         string
	TargetType string
	DeviceID   string
}

func normalizeRuntimeAgentType(agentType string) string {
	key := strings.TrimSpace(strings.ToLower(agentType))
	if key == "" {
		return ""
	}
	if key == "claude" || strings.Contains(key, "claude-code") || strings.Contains(key, "claude") {
		return "claude-code"
	}
	if strings.Contains(key, "opencode") {
		return "opencode"
	}
	if strings.Contains(key, "codex") || strings.Contains(key, "gpt") {
		return "codex"
	}
	return key
}

func selectAgentInstance(agents []model.AgentInstance, targetAgentInstanceID, targetAgentType, targetCustomAgentID string) (*model.AgentInstance, error) {
	targetAgentInstanceID = strings.TrimSpace(targetAgentInstanceID)
	targetAgentType = normalizeRuntimeAgentType(targetAgentType)
	targetCustomAgentID = strings.TrimSpace(targetCustomAgentID)
	targetRequested := targetAgentInstanceID != "" || targetAgentType != "" || targetCustomAgentID != ""

	if len(agents) == 0 {
		return nil, errcode.AgentNotFound
	}
	if !targetRequested {
		return &agents[0], nil
	}

	for i := range agents {
		agent := &agents[i]
		if targetAgentInstanceID != "" && agent.ID != targetAgentInstanceID {
			continue
		}
		if targetAgentType != "" && normalizeRuntimeAgentType(agent.AgentType) != targetAgentType {
			continue
		}
		if targetCustomAgentID != "" && (agent.CustomAgentID == nil || *agent.CustomAgentID != targetCustomAgentID) {
			continue
		}
		return agent, nil
	}
	return nil, errcode.AgentNotFound
}

func mergeModelParams(base, override string) string {
	base = strings.TrimSpace(base)
	override = strings.TrimSpace(override)
	if base == "" {
		return override
	}
	if override == "" {
		return base
	}

	var merged map[string]any
	if err := json.Unmarshal([]byte(base), &merged); err != nil || merged == nil {
		return override
	}
	var incoming map[string]any
	if err := json.Unmarshal([]byte(override), &incoming); err != nil || incoming == nil {
		return override
	}
	for key, value := range incoming {
		merged[key] = value
	}
	data, err := json.Marshal(merged)
	if err != nil {
		return override
	}
	return string(data)
}

// TriggerAgentTask creates a pending task for an agent and dispatches it to the inviter's edge.
func (s *AgentService) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	msg, err := repository.GetMessageByID(s.db, triggerMessageID)
	if err != nil {
		return nil, errcode.MsgNotFound
	}

	// #116: reject new agent tasks for dissolved sessions
	session, err := repository.GetSessionByID(s.db, msg.SessionID)
	if err != nil {
		return nil, errcode.SessionNotFound
	}
	if session.Dissolved {
		return nil, errcode.SessionDissolved
	}

	// find agent instances in this session invited by this user
	agents, err := repository.ListAgentInstancesByInviter(s.db, msg.SessionID, userID)
	if err != nil || len(agents) == 0 {
		return nil, errcode.AgentNotFound
	}
	ai, err := selectAgentInstance(agents, targetAgentInstanceID, targetAgentType, targetCustomAgentID)
	if err != nil {
		return nil, err
	}

	// check for active member
	active, _ := repository.IsMemberActive(s.db, ai.SessionID, model.MemberTypeUser, userID)
	if !active {
		return nil, errcode.SessionNotMember
	}

	dispatchTarget, err := s.validateDispatchTarget(ctx, userID, targetID)
	if err != nil {
		return nil, err
	}
	targetType := ""
	if dispatchTarget != nil {
		targetID = dispatchTarget.ID
		targetType = dispatchTarget.TargetType
	} else {
		targetID = ""
	}

	task := &model.PendingAgentTask{
		AgentInstanceID:   ai.ID,
		TriggeredByUserID: userID,
		TriggerMessageID:  triggerMessageID,
		TargetID:          targetID,
		Status:            model.TaskStatusQueued,
		ExpireAt:          time.Now().Add(config.PendingTaskTTL),
	}
	if dispatchTarget != nil {
		task.EdgeDeviceID = dispatchTarget.DeviceID
	}
	if err := repository.CreatePendingTask(s.db, task); err != nil {
		return nil, err
	}

	// Pre-query the CustomAgent to avoid a DB query inside the dispatch goroutine.
	var customAgent *model.CustomAgent
	if ai.CustomAgentID != nil && *ai.CustomAgentID != "" {
		ca, err := repository.GetCustomAgentByID(s.db, *ai.CustomAgentID)
		if err == nil {
			customAgent = ca
		}
	}

	// #100: Use context.WithoutCancel so the dispatch goroutine is not
	// cancelled when the HTTP handler's request context is cancelled.
	go s.dispatchTask(context.WithoutCancel(ctx), task, ai, promptFromMessage(msg), modelParams, targetType, customAgent)

	return task, nil
}

func (s *AgentService) validateDispatchTarget(ctx context.Context, userID, targetID string) (*dispatchTargetSnapshot, error) {
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return nil, nil
	}
	target, err := repository.GetExecutionTargetByID(s.db.WithContext(ctx), targetID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.TargetNotFound
		}
		return nil, err
	}
	if target.OwnerID != userID {
		return nil, errcode.TargetNotFound
	}
	if target.TargetType != "local_edge" {
		return nil, errcode.TargetNotRoutable.WithMessage("execution target type is not dispatchable yet")
	}
	if target.DeviceID == nil || strings.TrimSpace(*target.DeviceID) == "" {
		return nil, errcode.TargetNotRoutable.WithMessage("execution target is not bound to a device")
	}
	deviceID := strings.TrimSpace(*target.DeviceID)
	device, err := repository.GetDeviceByID(s.db.WithContext(ctx), deviceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.TargetNotRoutable.WithMessage("execution target device is not routable")
		}
		return nil, err
	}
	if device.UserID != userID || device.DeviceType != "desktop" {
		return nil, errcode.TargetNotRoutable.WithMessage("execution target device is not routable")
	}
	return &dispatchTargetSnapshot{
		ID:         target.ID,
		TargetType: target.TargetType,
		DeviceID:   deviceID,
	}, nil
}

func promptFromMessage(msg *model.Message) string {
	if msg == nil {
		return ""
	}
	switch msg.ContentType {
	case model.ContentTypeText, model.ContentTypeCode, model.ContentTypeDiff:
		var payload struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(msg.Content), &payload); err == nil && strings.TrimSpace(payload.Text) != "" {
			return payload.Text
		}
	}
	return msg.Content
}

func (s *AgentService) dispatchTask(ctx context.Context, task *model.PendingAgentTask, ai *model.AgentInstance, prompt, modelParams, targetType string, customAgent *model.CustomAgent) {
	dp := dispatchPayload{
		TaskID:           task.ID,
		AgentInstanceID:  ai.ID,
		AgentType:        normalizeRuntimeAgentType(ai.AgentType),
		TargetID:         task.TargetID,
		SessionID:        ai.SessionID,
		TriggerMessageID: task.TriggerMessageID,
		TriggerUserID:    task.TriggeredByUserID,
		Prompt:           prompt,
		DisplayName:      ai.DisplayName,
	}

	if ai.CustomAgentID != nil && *ai.CustomAgentID != "" {
		dp.CustomAgentID = *ai.CustomAgentID
		if customAgent != nil {
			dp.SystemPrompt = customAgent.SystemPrompt
			dp.ModelParams = customAgent.ModelParams
			dp.ToolWhitelist = customAgent.ToolWhitelist
		}
	}
	dp.ModelParams = mergeModelParams(dp.ModelParams, modelParams)
	if teamContext := s.resolveDispatchTeamContext(ai); teamContext.TeamRunID != "" {
		dp.TeamID = teamContext.TeamID
		dp.TeamRunID = teamContext.TeamRunID
		dp.TeamMemberID = teamContext.TeamMemberID
		dp.TeamMemberRole = teamContext.TeamMemberRole
	}

	// Load thread history for context continuity (all agent runtimes).
	dp.Messages = s.loadThreadHistory(ai.SessionID, task.TriggerMessageID)
	dp.PinnedMessages = s.loadPinnedMessages(ai.SessionID)

	payload, _ := json.Marshal(dp)

	cacheClient := resolveAgentCache(s.cacheClient)
	if task.TargetID != "" {
		if task.EdgeDeviceID == "" {
			slog.Error("target-bound agent task missing edge device id", "task_id", task.ID, "user_id", ai.InviterUserID, "target_id", task.TargetID)
			return
		}
		// Route by target type: hub_relay uses the relay service; all others
		// (local_edge, remote_ssh, cloud_edge, tailscale) go through the
		// device-bound WebSocket path.
		if targetType == "hub_relay" && s.relay != nil {
			_, err := s.relay.CreateCommand(ctx, ai.InviterUserID, "agent_dispatch", json.RawMessage(payload), ai.InviterUserID)
			if err != nil {
				slog.Error("failed to create relay command for hub_relay dispatch", "task_id", task.ID, "user_id", ai.InviterUserID, "error", err)
				if pushErr := cacheClient.PushPendingTargetTask(ctx, ai.InviterUserID, task.TargetID, task.EdgeDeviceID, string(payload)); pushErr != nil {
					slog.Error("failed to push hub_relay task to offline queue", "task_id", task.ID, "user_id", ai.InviterUserID, "error", pushErr)
				}
				return
			}
			if err := repository.UpdatePendingTaskDispatched(s.db, task.ID, task.EdgeDeviceID); err != nil {
				slog.Error("failed to mark hub_relay task dispatched", "task_id", task.ID, "user_id", ai.InviterUserID, "error", err)
			}
			return
		}
		s.dispatchTargetBoundTask(ctx, cacheClient, task, ai.InviterUserID, task.EdgeDeviceID, payload)
		return
	}

	// try to push to inviter's edge (desktop) via WebSocket
	connID, err := cacheClient.GetRoute(ctx, ai.InviterUserID, "desktop")
	if err == nil && connID != "" && s.mgr != nil {
		conn := s.mgr.FindByConnID(connID)
		if conn == nil {
			if err := cacheClient.PushPendingTask(ctx, ai.InviterUserID, string(payload)); err != nil {
				slog.Error("failed to push agent task to offline queue (conn nil)", "task_id", task.ID, "user_id", ai.InviterUserID, "error", err)
			}
			return
		}
		frame := ws.NewFrame(ws.TypeAgentDispatch, json.RawMessage(payload))
		if err := repository.UpdatePendingTaskDispatched(s.db, task.ID, conn.DeviceID); err != nil {
			slog.Error("failed to mark agent task dispatched", "task_id", task.ID, "user_id", ai.InviterUserID, "device_id", conn.DeviceID, "error", err)
			return
		}
		result := s.mgr.PushToConn(connID, frame)
		if !result.Queued {
			slog.Warn("agent task websocket dispatch not queued; preserving pending task", "task_id", task.ID, "user_id", ai.InviterUserID, "device_id", conn.DeviceID, "conn_id", connID, "delivery_status", result.Status, "error", result.Err)
			if err := cacheClient.PushPendingTask(ctx, ai.InviterUserID, string(payload)); err != nil {
				slog.Error("failed to preserve agent task after websocket dispatch failure", "task_id", task.ID, "user_id", ai.InviterUserID, "device_id", conn.DeviceID, "delivery_status", result.Status, "error", err)
			}
		}
		return
	}

	// offline: push to Redis pending queue
	if err := cacheClient.PushPendingTask(ctx, ai.InviterUserID, string(payload)); err != nil {
		slog.Error("failed to push agent task to offline queue", "task_id", task.ID, "user_id", ai.InviterUserID, "error", err)
	}
}

func (s *AgentService) resolveDispatchTeamContext(ai *model.AgentInstance) dispatchTeamContext {
	if s == nil || s.db == nil || ai == nil || ai.CustomAgentID == nil || strings.TrimSpace(*ai.CustomAgentID) == "" {
		return dispatchTeamContext{}
	}
	run, err := repository.GetTeamRunBySessionID(s.db, ai.SessionID)
	if err != nil || run == nil || run.ID == "" {
		return dispatchTeamContext{}
	}
	members, err := repository.ListTeamMembers(s.db, run.TeamID)
	if err != nil {
		return dispatchTeamContext{}
	}
	customAgentID := strings.TrimSpace(*ai.CustomAgentID)
	for _, member := range members {
		if member.AgentProfileID == nil || strings.TrimSpace(*member.AgentProfileID) != customAgentID {
			continue
		}
		return dispatchTeamContext{
			TeamID:         run.TeamID,
			TeamRunID:      run.ID,
			TeamMemberID:   member.ID,
			TeamMemberRole: member.Role,
		}
	}
	return dispatchTeamContext{
		TeamID:    run.TeamID,
		TeamRunID: run.ID,
	}
}

// loadThreadHistory loads recent thread messages (before the trigger message) for context continuity.
// Limits to a maximum of 50 messages to avoid oversized dispatch payloads.
func (s *AgentService) loadThreadHistory(sessionID, triggerMessageID string) []dispatchMessage {
	if sessionID == "" || triggerMessageID == "" {
		return nil
	}
	triggerMsg, err := repository.GetMessageByID(s.db, triggerMessageID)
	if err != nil || triggerMsg == nil {
		return nil
	}
	msgs, err := repository.GetMessagesBySession(s.db, sessionID, triggerMsg.SeqID, 50)
	if err != nil || len(msgs) == 0 {
		return nil
	}
	// Reverse to chronological order (GetMessagesBySession returns DESC).
	result := make([]dispatchMessage, len(msgs))
	for i := range msgs {
		content := extractMessageText(&msgs[i])
		result[len(msgs)-1-i] = dispatchMessage{
			Role:      mapSenderType(msgs[i].SenderType),
			Content:   content,
			Timestamp: msgs[i].CreatedAt.UTC().Format(time.RFC3339),
		}
	}
	return result
}

// loadPinnedMessages loads pinned messages for a session for context continuity.
func (s *AgentService) loadPinnedMessages(sessionID string) []dispatchMessage {
	if sessionID == "" {
		return nil
	}
	pins, err := repository.ListPinsBySession(s.db, sessionID)
	if err != nil || len(pins) == 0 {
		return nil
	}
	messageIDs := make([]string, len(pins))
	for i, p := range pins {
		messageIDs[i] = p.MessageID
	}
	msgs, err := repository.GetMessagesByIDs(s.db, messageIDs)
	if err != nil {
		return nil
	}
	result := make([]dispatchMessage, 0, len(msgs))
	for _, m := range msgs {
		content := extractMessageText(&m)
		if content == "" {
			continue
		}
		result = append(result, dispatchMessage{
			Role:      mapSenderType(m.SenderType),
			Content:   content,
			Timestamp: m.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return result
}

// extractMessageText extracts the human-readable text from a message's JSON content.
func extractMessageText(msg *model.Message) string {
	if msg == nil {
		return ""
	}
	switch msg.ContentType {
	case model.ContentTypeText, model.ContentTypeCode, model.ContentTypeDiff:
		var payload struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(msg.Content), &payload); err == nil && payload.Text != "" {
			return payload.Text
		}
	}
	// For non-text messages or unparseable content, just return raw content.
	return msg.Content
}

// mapSenderType maps Hub sender types to standard roles (user/assistant/system).
func mapSenderType(t string) string {
	switch t {
	case model.SenderTypeAgent:
		return "assistant"
	case model.SenderTypeUser:
		return "user"
	default:
		return t
	}
}

func (s *AgentService) dispatchTargetBoundTask(ctx context.Context, cacheClient agentCache, task *model.PendingAgentTask, userID, deviceID string, payload []byte) {
	queueTargetTask := func(reason string, err error) {
		if pushErr := cacheClient.PushPendingTargetTask(ctx, userID, task.TargetID, deviceID, string(payload)); pushErr != nil {
			slog.Error("failed to push target-bound agent task to offline queue", "task_id", task.ID, "user_id", userID, "target_id", task.TargetID, "device_id", deviceID, "reason", reason, "error", pushErr)
			return
		}
		if err != nil {
			slog.Info("queued target-bound agent task", "task_id", task.ID, "user_id", userID, "target_id", task.TargetID, "device_id", deviceID, "reason", reason, "error", err)
		}
	}

	connID, err := cacheClient.GetRouteForDevice(ctx, userID, "desktop", deviceID)
	if err != nil || connID == "" || s.mgr == nil {
		queueTargetTask("route unavailable", err)
		return
	}
	conn := s.mgr.FindByConnID(connID)
	if conn == nil || conn.UserID != userID || conn.DeviceType != "desktop" || conn.DeviceID != deviceID {
		queueTargetTask("connection mismatch", nil)
		return
	}
	frame := ws.NewFrame(ws.TypeAgentDispatch, json.RawMessage(payload))
	if err := repository.UpdatePendingTaskDispatched(s.db, task.ID, deviceID); err != nil {
		slog.Error("failed to mark target-bound agent task dispatched", "task_id", task.ID, "user_id", userID, "target_id", task.TargetID, "device_id", deviceID, "error", err)
		return
	}
	result := s.mgr.PushToConn(connID, frame)
	if !result.Queued {
		slog.Warn("target-bound agent task websocket dispatch not queued; preserving pending task", "task_id", task.ID, "user_id", userID, "target_id", task.TargetID, "device_id", deviceID, "conn_id", connID, "delivery_status", result.Status, "error", result.Err)
		queueTargetTask("websocket delivery not queued", result.Err)
	}
}

// CancelTask cancels a pending task by its ID.
func (s *AgentService) CancelTask(ctx context.Context, userID, taskID string) error {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentTaskNotFound
		}
		return err
	}
	if task.TriggeredByUserID != userID {
		return errcode.AgentTaskNotFound
	}
	if task.Status == model.TaskStatusDone || task.Status == model.TaskStatusFailed ||
		task.Status == model.TaskStatusCancelled || task.Status == model.TaskStatusTimeout {
		if task.Status == model.TaskStatusCancelled {
			return errcode.AgentTaskCancelled
		}
		return errcode.AgentTaskTimeout
	}

	ai, err := repository.GetAgentInstanceByID(s.db, task.AgentInstanceID)
	if err != nil {
		return err
	}

	rowsAffected, err := repository.UpdatePendingTaskStatusAtomic(s.db, taskID, task.Status, model.TaskStatusCancelled, "")
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errcode.ErrBadRequest
	}

	s.bus.Publish(ctx, Event{Type: "agent.cancel", Payload: map[string]string{
		"task_id":           taskID,
		"agent_instance_id": task.AgentInstanceID,
		"session_id":        ai.SessionID,
		"triggered_by":      task.TriggeredByUserID,
	}})

	return nil
}
