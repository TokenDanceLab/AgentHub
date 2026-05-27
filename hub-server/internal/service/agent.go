package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/ws"
	"github.com/agenthub/hub-server/pkg/uuidv7"
)

// agentCache is the subset of *cache.Client methods used by AgentService.
type agentCache interface {
	GetRoute(ctx context.Context, userID, deviceType string) (string, error)
	GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error)
	PushPendingTask(ctx context.Context, userID, taskJSON string) error
	PushPendingTargetTask(ctx context.Context, userID, targetID, deviceID, taskJSON string) error
	AllocateSeq(ctx context.Context, sessionID string) (int64, error)
}

type AgentService struct {
	db          *gorm.DB
	bus         *Bus
	mgr         *ws.Manager
	cacheClient agentCache
}

func NewAgentService(db *gorm.DB, bus *Bus, mgr *ws.Manager, cacheClient *cache.Client) *AgentService {
	return &AgentService{db: db, bus: bus, mgr: mgr, cacheClient: resolveAgentCache(cacheClient)}
}

// CustomAgent CRUD

func (s *AgentService) CreateCustomAgent(ctx context.Context, ownerID, name, avatarURL, agentType, systemPrompt, capabilityTags, toolWhitelist, modelParams string) (*model.CustomAgent, error) {
	ca := &model.CustomAgent{
		OwnerUserID:    ownerID,
		Name:           name,
		AvatarURL:      avatarURL,
		AgentType:      agentType,
		SystemPrompt:   systemPrompt,
		CapabilityTags: capabilityTags,
		ToolWhitelist:  toolWhitelist,
		ModelParams:    modelParams,
	}
	if err := repository.CreateCustomAgent(s.db, ca); err != nil {
		return nil, err
	}
	return ca, nil
}

func (s *AgentService) GetCustomAgent(ctx context.Context, ownerID, id string) (*model.CustomAgent, error) {
	ca, err := repository.GetCustomAgentByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentNotFound
		}
		return nil, err
	}
	if ca.OwnerUserID != ownerID {
		return nil, errcode.AgentNotFound
	}
	return ca, nil
}

func (s *AgentService) ListCustomAgents(ctx context.Context, ownerID string) ([]model.CustomAgent, error) {
	return repository.ListCustomAgentsByOwner(s.db, ownerID)
}

func (s *AgentService) UpdateCustomAgent(ctx context.Context, ownerID string, ca *model.CustomAgent) error {
	existing, err := repository.GetCustomAgentByID(s.db, ca.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentNotFound
		}
		return err
	}
	if existing.OwnerUserID != ownerID {
		return errcode.AgentNotFound
	}
	ca.OwnerUserID = ownerID
	if ca.CapabilityTags == "" {
		ca.CapabilityTags = existing.CapabilityTags
	}
	if ca.ToolWhitelist == "" {
		ca.ToolWhitelist = existing.ToolWhitelist
	}
	if ca.ModelParams == "" {
		ca.ModelParams = existing.ModelParams
	}
	ca.CreatedAt = existing.CreatedAt
	return repository.UpdateCustomAgent(s.db, ca)
}

func (s *AgentService) DeleteCustomAgent(ctx context.Context, ownerID, id string) error {
	ca, err := repository.GetCustomAgentByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentNotFound
		}
		return err
	}
	if ca.OwnerUserID != ownerID {
		return errcode.AgentNotFound
	}
	return repository.SoftDeleteCustomAgent(s.db, id)
}

// AddAgentToSession adds an agent instance to a session (invite agent into group).
func (s *AgentService) AddAgentToSession(ctx context.Context, userID, sessionID, agentType, customAgentID, displayName string) error {
	session, err := repository.GetSessionByID(s.db, sessionID)
	if err != nil {
		return errcode.SessionNotFound
	}
	if session.Type != model.SessionTypeGroup {
		return errcode.ErrBadRequest
	}
	if session.Dissolved {
		return errcode.SessionDissolved
	}

	active, _ := repository.IsMemberActive(s.db, sessionID, model.MemberTypeUser, userID)
	if !active {
		return errcode.SessionNotMember
	}

	// validate custom agent if provided
	if customAgentID != "" {
		ca, err := repository.GetCustomAgentByID(s.db, customAgentID)
		if err != nil {
			return errcode.AgentNotFound
		}
		if ca.OwnerUserID != userID {
			return errcode.AgentNotFound
		}
		if agentType == "" {
			agentType = ca.AgentType
		}
	}

	ai := &model.AgentInstance{
		AgentType:     agentType,
		SessionID:     sessionID,
		InviterUserID: userID,
		DisplayName:   displayName,
	}
	if customAgentID != "" {
		ai.CustomAgentID = &customAgentID
	}

	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.CreateAgentInstance(tx, ai); err != nil {
			return err
		}
		member := &model.SessionMember{
			SessionID:  sessionID,
			MemberType: model.MemberTypeAgent,
			MemberID:   ai.ID,
			Role:       model.MemberRoleMember,
		}
		return repository.CreateSessionMember(tx, member)
	})
	if err != nil {
		return err
	}

	return nil
}

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
	if dispatchTarget != nil {
		targetID = dispatchTarget.ID
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

	// #100: Use context.WithoutCancel so the dispatch goroutine is not
	// cancelled when the HTTP handler's request context is cancelled.
	go s.dispatchTask(context.WithoutCancel(ctx), task, ai, promptFromMessage(msg), modelParams)

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
	switch target.TargetType {
	case "local_edge", "hub_relay":
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
	default:
		return nil, errcode.TargetNotRoutable.WithMessage("execution target type is not dispatchable yet")
	}
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

func (s *AgentService) dispatchTask(ctx context.Context, task *model.PendingAgentTask, ai *model.AgentInstance, prompt, modelParams string) {
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
		ca, err := repository.GetCustomAgentByID(s.db, *ai.CustomAgentID)
		if err == nil {
			dp.CustomAgentID = *ai.CustomAgentID
			dp.SystemPrompt = ca.SystemPrompt
			dp.ModelParams = ca.ModelParams
			dp.ToolWhitelist = ca.ToolWhitelist
		}
	}
	dp.ModelParams = mergeModelParams(dp.ModelParams, modelParams)
	if teamContext := s.resolveDispatchTeamContext(ai); teamContext.TeamRunID != "" {
		dp.TeamID = teamContext.TeamID
		dp.TeamRunID = teamContext.TeamRunID
		dp.TeamMemberID = teamContext.TeamMemberID
		dp.TeamMemberRole = teamContext.TeamMemberRole
	}

	payload, _ := json.Marshal(dp)

	cacheClient := resolveAgentCache(s.cacheClient)
	if task.TargetID != "" {
		if task.EdgeDeviceID == "" {
			slog.Error("target-bound agent task missing edge device id", "task_id", task.ID, "user_id", ai.InviterUserID, "target_id", task.TargetID)
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
		s.mgr.PushToConn(connID, frame)
		_ = repository.UpdatePendingTaskDispatched(s.db, task.ID, conn.DeviceID)
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
	s.mgr.PushToConn(connID, frame)
	_ = repository.UpdatePendingTaskDispatched(s.db, task.ID, deviceID)
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

// allocateSeq returns the next message sequence number for a session.
// It tries Redis INCR first and falls back to the DB row-level lock.
func (s *AgentService) allocateSeq(ctx context.Context, sessionID string) (int64, error) {
	seq, err := resolveAgentCache(s.cacheClient).AllocateSeq(ctx, sessionID)
	if err == nil {
		return seq, nil
	}
	slog.Warn("redis seq allocation failed, falling back to DB", "session_id", sessionID, "error", err)
	var fallbackSeq int64
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var txErr error
		fallbackSeq, txErr = repository.AllocateSeqID(tx, sessionID)
		return txErr
	})
	return fallbackSeq, err
}

// HandleTaskAck marks a task as running and optionally records the Edge run id
// that is executing it.
func (s *AgentService) HandleTaskAck(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentTaskNotFound
		}
		return err
	}
	if _, err := s.authorizeTaskEdgeCallback(task, edgeUserID, edgeDeviceID, edgeRunID); err != nil {
		return err
	}
	if task.Status == model.TaskStatusRunning {
		if edgeRunID != "" && task.EdgeRunID == "" {
			return repository.UpdatePendingTaskEdgeRunID(s.db, taskID, edgeRunID)
		}
		return nil
	}
	// #99: accept queued tasks for offline-replayed tasks, transitioning to dispatched
	if task.Status != model.TaskStatusDispatched && task.Status != model.TaskStatusQueued {
		return errcode.ErrBadRequest
	}
	rowsAffected, err := repository.UpdatePendingTaskStatusAtomicWithEdgeRunID(s.db, taskID, model.TaskStatusDispatched, model.TaskStatusRunning, "", edgeRunID)
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errcode.ErrBadRequest
	}
	return nil
}

// HandleTaskStream records a typed runtime event and keeps the existing
// message.new projection for current Web/Desktop chat consumers.
func (s *AgentService) HandleTaskStream(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentTaskNotFound
		}
		return err
	}
	if task.Status != model.TaskStatusRunning && task.Status != model.TaskStatusDispatched {
		return errcode.ErrBadRequest
	}

	ai, err := s.authorizeTaskEdgeCallback(task, edgeUserID, edgeDeviceID, edgeRunID)
	if err != nil {
		return err
	}

	eventType, eventPayload, messageContent, err := normalizeRunEventInput(stream)
	if err != nil {
		return err
	}

	// #130: idempotent stream-to-message — skip if a message with this client_msg_id already exists
	if stream.ClientMsgID != "" {
		existing, _ := repository.GetMessageByClientMsgID(s.db, ai.SessionID, stream.ClientMsgID)
		if existing != nil {
			return nil // already persisted, idempotent
		}
	}

	// ensure status is running
	if task.Status != model.TaskStatusRunning {
		_ = repository.UpdatePendingTaskStatus(s.db, taskID, model.TaskStatusRunning, "")
	}

	// #132: bump expire_at to keep running task alive while activity continues
	_ = repository.BumpRunningTaskExpireAt(s.db, taskID, config.RunningTaskHeartbeatTTL)

	runEvent := &model.AgentRunEvent{
		TaskID:          taskID,
		EdgeRunID:       firstNonEmpty(edgeRunID, task.EdgeRunID),
		SessionID:       ai.SessionID,
		AgentInstanceID: task.AgentInstanceID,
		EventType:       eventType,
		Payload:         eventPayload,
	}

	msg := &model.Message{
		SessionID:   "", // will be set from agent instance
		SenderType:  model.SenderTypeAgent,
		SenderID:    task.AgentInstanceID,
		ClientMsgID: uuidv7.Must(),
		ContentType: model.ContentTypeText,
		Content:     messageContent,
	}
	// #130: use caller-provided client_msg_id when available for dedup
	if stream.ClientMsgID != "" {
		msg.ClientMsgID = stream.ClientMsgID
	}
	msg.SessionID = ai.SessionID

	seq, err := s.allocateSeq(ctx, ai.SessionID)
	if err != nil {
		return err
	}
	msg.SeqID = seq

	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.CreateAgentRunEventWithNextSeq(tx, runEvent); err != nil {
			return err
		}
		return repository.InsertMessage(tx, msg)
	})
	if err != nil {
		return err
	}

	// #154: update session last_message_at when agent stream creates a message
	_ = repository.TouchSessionLastMessage(s.db, ai.SessionID)

	s.bus.Publish(ctx, Event{Type: "message.new", Payload: msg})
	s.bus.Publish(ctx, Event{Type: ws.TypeAgentStream, Payload: runEvent})

	return nil
}

func (s *AgentService) ListTaskRunEvents(ctx context.Context, userID, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error) {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentTaskNotFound
		}
		return nil, err
	}
	if task.TriggeredByUserID != userID {
		return nil, errcode.AgentTaskNotFound
	}
	filter.EventType = strings.TrimSpace(filter.EventType)
	if filter.Limit < 0 || filter.AfterSeq < 0 {
		return nil, errcode.ErrBadRequest
	}
	if filter.Limit > 500 {
		filter.Limit = 500
	}
	return repository.ListAgentRunEventsByTaskIDFiltered(s.db, taskID, filter)
}

func (s *AgentService) GetTaskRunEventSummary(ctx context.Context, userID, taskID string) (*model.AgentRunEventSummary, error) {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentTaskNotFound
		}
		return nil, err
	}
	if task.TriggeredByUserID != userID {
		return nil, errcode.AgentTaskNotFound
	}
	events, err := repository.ListAgentRunEventsByTaskID(s.db, taskID)
	if err != nil {
		return nil, err
	}
	summary := summarizeAgentRunEvents(task, events)
	return &summary, nil
}

func summarizeAgentRunEvents(task *model.PendingAgentTask, events []model.AgentRunEvent) model.AgentRunEventSummary {
	summary := model.AgentRunEventSummary{
		TaskID:          task.ID,
		EdgeRunID:       task.EdgeRunID,
		Status:          task.Status,
		TotalEvents:     len(events),
		EventTypeCounts: make(map[string]int),
	}
	startedAt := task.CreatedAt
	if startedAt.IsZero() && len(events) > 0 {
		startedAt = events[0].CreatedAt
	}
	if !startedAt.IsZero() {
		summary.StartedAt = &startedAt
	}
	if task.FinishedAt != nil {
		finishedAt := task.FinishedAt.UTC()
		summary.FinishedAt = &finishedAt
	}

	approvalStates := map[string]string{}
	for _, event := range events {
		if event.EventSeq > summary.LastEventSeq {
			summary.LastEventSeq = event.EventSeq
		}
		if summary.EdgeRunID == "" {
			summary.EdgeRunID = event.EdgeRunID
		}
		summary.EventTypeCounts[event.EventType]++
		if strings.HasPrefix(event.EventType, "run.agent.") {
			summary.StepCount++
		}

		payload := map[string]any{}
		_ = json.Unmarshal([]byte(event.Payload), &payload)
		switch event.EventType {
		case model.RunEventTypeOutputBatch:
			summary.OutputBytes += outputBytesFromPayload(payload)
		case "run.agent.tool_call":
			summary.ToolCallCount++
		case "run.agent.permission_requested":
			key := firstRuntimeString(payload, "requestId", "request_id", "toolUseId", "tool_use_id")
			if key == "" {
				key = event.ID
			}
			approvalStates[key] = firstNonEmpty(firstRuntimeString(payload, "status"), "pending")
		case "run.agent.permission_decided":
			key := firstRuntimeString(payload, "requestId", "request_id", "toolUseId", "tool_use_id")
			if key == "" {
				key = event.ID
			}
			approvalStates[key] = firstNonEmpty(firstRuntimeString(payload, "decision", "status"), "decided")
		case "run.agent.file_change":
			summary.ArtifactCount++
		case "run.agent.result", "run.agent.context_usage":
			inputTokens, outputTokens := tokenUsageFromPayload(payload)
			summary.InputTokens += inputTokens
			summary.OutputTokens += outputTokens
		}
	}
	for _, status := range approvalStates {
		summary.ApprovalCount++
		if pendingApprovalStatus(status) {
			summary.PendingApprovals++
		} else {
			summary.DecidedApprovals++
		}
	}

	if summary.StartedAt != nil {
		end := time.Time{}
		if summary.FinishedAt != nil {
			end = *summary.FinishedAt
		} else if len(events) > 0 {
			end = events[len(events)-1].CreatedAt
		}
		if !end.IsZero() && end.After(*summary.StartedAt) {
			summary.ElapsedMs = end.Sub(*summary.StartedAt).Milliseconds()
		}
	}
	return summary
}

func outputBytesFromPayload(payload map[string]any) int {
	total := len(runtimeString(payload, "content", "text"))
	if chunks, ok := payload["chunks"].([]any); ok {
		for _, chunk := range chunks {
			chunkMap, ok := chunk.(map[string]any)
			if !ok {
				continue
			}
			total += len(runtimeString(chunkMap, "content", "text"))
		}
	}
	return total
}

func tokenUsageFromPayload(payload map[string]any) (int, int) {
	source := payload
	if usage, ok := payload["usage"].(map[string]any); ok {
		source = usage
	}
	inputTokens := firstRuntimeInt(source, "input_tokens", "inputTokens", "prompt_tokens", "promptTokens")
	outputTokens := firstRuntimeInt(source, "output_tokens", "outputTokens", "completion_tokens", "completionTokens")
	return inputTokens, outputTokens
}

func firstRuntimeString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := payload[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func runtimeString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := payload[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

func firstRuntimeInt(payload map[string]any, keys ...string) int {
	for _, key := range keys {
		switch value := payload[key].(type) {
		case int:
			return value
		case int64:
			return int(value)
		case float64:
			return int(value)
		case json.Number:
			n, _ := value.Int64()
			return int(n)
		case string:
			n, _ := strconv.Atoi(strings.TrimSpace(value))
			return n
		}
	}
	return 0
}

func normalizeRunEventInput(stream model.AgentRunEventInput) (eventType, payload, messageContent string, err error) {
	eventType = strings.TrimSpace(stream.EventType)
	content := strings.TrimSpace(stream.Content)

	if len(stream.Payload) > 0 {
		if !json.Valid(stream.Payload) {
			return "", "", "", errcode.ErrBadRequest
		}
		payload = string(stream.Payload)
	} else if content != "" {
		if json.Valid([]byte(content)) {
			payload = content
		} else {
			wrapped, marshalErr := json.Marshal(map[string]string{"content": stream.Content})
			if marshalErr != nil {
				return "", "", "", marshalErr
			}
			payload = string(wrapped)
		}
	} else {
		return "", "", "", errcode.ErrBadRequest
	}
	if err := validateRunEventPayloadSize(payload); err != nil {
		return "", "", "", err
	}

	if eventType == "" {
		eventType = inferRunEventType(payload)
	}
	if eventType == "" {
		eventType = model.RunEventTypeOutputBatch
	}
	if err := validateRunEventType(eventType); err != nil {
		return "", "", "", err
	}

	messageContent = content
	if messageContent == "" {
		messageContent = payload
	}
	if !json.Valid([]byte(messageContent)) {
		wrapped, marshalErr := json.Marshal(map[string]string{"content": messageContent})
		if marshalErr != nil {
			return "", "", "", marshalErr
		}
		messageContent = string(wrapped)
	}
	if err := validateRunEventPayloadSize(messageContent); err != nil {
		return "", "", "", err
	}

	return eventType, payload, messageContent, nil
}

func validateRunEventPayloadSize(value string) error {
	if len(value) > model.RunEventPayloadMaxBytes {
		return errcode.ErrBadRequest.WithMessage("run event payload exceeds maximum size")
	}
	return nil
}

func validateRunEventType(eventType string) error {
	if eventType == "" || len(eventType) > model.RunEventTypeMaxLength {
		return errcode.ErrBadRequest
	}
	for _, r := range eventType {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '.', r == '_', r == '-':
		default:
			return errcode.ErrBadRequest
		}
	}
	return nil
}

func inferRunEventType(payload string) string {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(payload), &fields); err != nil {
		return ""
	}
	for _, key := range []string{"event_type", "type"} {
		if raw, ok := fields[key]; ok {
			var value string
			if err := json.Unmarshal(raw, &value); err == nil {
				return strings.TrimSpace(value)
			}
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// HandleTaskDone marks a task as done and inserts the final content as a message.
func (s *AgentService) HandleTaskDone(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentTaskNotFound
		}
		return err
	}
	// #109: only accept done callbacks for running or dispatched tasks
	if task.Status != model.TaskStatusRunning && task.Status != model.TaskStatusDispatched {
		return errcode.ErrBadRequest
	}

	ai, err := s.authorizeTaskEdgeCallback(task, edgeUserID, edgeDeviceID, edgeRunID)
	if err != nil {
		return err
	}

	// insert final message if content is provided
	if finalContent != "" {
		msg := &model.Message{
			SessionID:   ai.SessionID,
			SenderType:  model.SenderTypeAgent,
			SenderID:    task.AgentInstanceID,
			ClientMsgID: uuidv7.Must(),
			ContentType: model.ContentTypeText,
			Content:     finalContent,
		}
		seq, err := s.allocateSeq(ctx, ai.SessionID)
		if err != nil {
			return err
		}
		msg.SeqID = seq

		err = s.db.Transaction(func(tx *gorm.DB) error {
			return repository.InsertMessage(tx, msg)
		})
		if err != nil {
			return err
		}
		// #154: update session last_message_at when agent done creates a message
		_ = repository.TouchSessionLastMessage(s.db, ai.SessionID)
		s.bus.Publish(ctx, Event{Type: "message.new", Payload: msg})
	}

	_, _ = repository.UpdatePendingTaskStatusAtomic(s.db, taskID, task.Status, model.TaskStatusDone, "")

	s.bus.Publish(ctx, Event{Type: "agent.done", Payload: map[string]interface{}{
		"task_id":           taskID,
		"agent_instance_id": task.AgentInstanceID,
		"session_id":        ai.SessionID,
	}})

	return nil
}

// HandleTaskFail marks a task as failed.
func (s *AgentService) HandleTaskFail(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentTaskNotFound
		}
		return err
	}
	// #109: only accept fail callbacks for running or dispatched tasks
	if task.Status != model.TaskStatusRunning && task.Status != model.TaskStatusDispatched {
		return errcode.ErrBadRequest
	}

	ai, err := s.authorizeTaskEdgeCallback(task, edgeUserID, edgeDeviceID, edgeRunID)
	if err != nil {
		return err
	}

	_, _ = repository.UpdatePendingTaskStatusAtomic(s.db, taskID, task.Status, model.TaskStatusFailed, errMsg)

	s.bus.Publish(ctx, Event{Type: "agent.failed", Payload: map[string]interface{}{
		"task_id":           taskID,
		"agent_instance_id": task.AgentInstanceID,
		"session_id":        ai.SessionID,
		"error":             errMsg,
	}})

	return nil
}

func (s *AgentService) authorizeTaskEdgeCallback(task *model.PendingAgentTask, edgeUserID, edgeDeviceID, edgeRunID string) (*model.AgentInstance, error) {
	if edgeUserID == "" {
		return nil, errcode.AgentTaskNotFound
	}
	ai, err := repository.GetAgentInstanceByID(s.db, task.AgentInstanceID)
	if err != nil {
		return nil, err
	}
	if ai.InviterUserID != edgeUserID {
		return nil, errcode.AgentTaskNotFound
	}
	if task.EdgeDeviceID == "" || task.EdgeDeviceID != edgeDeviceID {
		return nil, errcode.AgentTaskNotFound
	}
	if task.EdgeRunID != "" && task.EdgeRunID != edgeRunID {
		return nil, errcode.ErrBadRequest
	}
	return ai, nil
}

// ── Thin wrappers for repository calls needed by the app layer ──────────

// GetPendingTaskByID returns a pending agent task by ID. Thin wrapper over repository.GetPendingTaskByID.
func (s *AgentService) GetPendingTaskByID(taskID string) (*model.PendingAgentTask, error) {
	return repository.GetPendingTaskByID(s.db, taskID)
}

// ScanExpiredTasks returns all pending tasks whose deadline has passed. Thin wrapper over repository.ScanExpiredTasks.
func (s *AgentService) ScanExpiredTasks() ([]model.PendingAgentTask, error) {
	return repository.ScanExpiredTasks(s.db)
}

// UpdatePendingTaskStatus updates the status of a pending agent task. Thin wrapper over repository.UpdatePendingTaskStatus.
func (s *AgentService) UpdatePendingTaskStatus(taskID, status, errMsg string) error {
	return repository.UpdatePendingTaskStatus(s.db, taskID, status, errMsg)
}

// GetAgentInstanceByID returns an agent instance by ID. Thin wrapper over repository.GetAgentInstanceByID.
func (s *AgentService) GetAgentInstanceByID(id string) (*model.AgentInstance, error) {
	return repository.GetAgentInstanceByID(s.db, id)
}

// UpdatePendingTaskDispatched records the edge device that a task was dispatched to. Thin wrapper over repository.UpdatePendingTaskDispatched.
func (s *AgentService) UpdatePendingTaskDispatched(taskID, edgeDeviceID string) error {
	return repository.UpdatePendingTaskDispatched(s.db, taskID, edgeDeviceID)
}
