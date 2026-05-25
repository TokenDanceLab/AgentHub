package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
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
	PushPendingTask(ctx context.Context, userID, taskJSON string) error
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
	SessionID        string `json:"session_id"`
	TriggerMessageID string `json:"trigger_message_id"`
	TriggerUserID    string `json:"trigger_user_id"`
	DisplayName      string `json:"display_name"`
	SystemPrompt     string `json:"system_prompt,omitempty"`
	ModelParams      string `json:"model_params,omitempty"`
	ToolWhitelist    string `json:"tool_whitelist,omitempty"`
}

// TriggerAgentTask creates a pending task for an agent and dispatches it to the inviter's edge.
func (s *AgentService) TriggerAgentTask(ctx context.Context, userID, triggerMessageID string) (*model.PendingAgentTask, error) {
	msg, err := repository.GetMessageByID(s.db, triggerMessageID)
	if err != nil {
		return nil, errcode.MsgNotFound
	}

	// find agent instances in this session invited by this user
	agents, err := repository.ListAgentInstancesByInviter(s.db, msg.SessionID, userID)
	if err != nil || len(agents) == 0 {
		return nil, errcode.AgentNotFound
	}
	ai := &agents[0]

	// check for active member
	active, _ := repository.IsMemberActive(s.db, ai.SessionID, model.MemberTypeUser, userID)
	if !active {
		return nil, errcode.SessionNotMember
	}

	task := &model.PendingAgentTask{
		AgentInstanceID:   ai.ID,
		TriggeredByUserID: userID,
		TriggerMessageID:  triggerMessageID,
		Status:            model.TaskStatusQueued,
		ExpireAt:          time.Now().Add(config.PendingTaskTTL),
	}
	if err := repository.CreatePendingTask(s.db, task); err != nil {
		return nil, err
	}

	go s.dispatchTask(ctx, task, ai)

	return task, nil
}

func (s *AgentService) dispatchTask(ctx context.Context, task *model.PendingAgentTask, ai *model.AgentInstance) {
	dp := dispatchPayload{
		TaskID:           task.ID,
		AgentInstanceID:  ai.ID,
		AgentType:        ai.AgentType,
		SessionID:        ai.SessionID,
		TriggerMessageID: task.TriggerMessageID,
		TriggerUserID:    task.TriggeredByUserID,
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

	payload, _ := json.Marshal(dp)

	// try to push to inviter's edge (desktop) via WebSocket
	cacheClient := resolveAgentCache(s.cacheClient)
	connID, err := cacheClient.GetRoute(ctx, ai.InviterUserID, "desktop")
	if err == nil && connID != "" && s.mgr != nil {
		conn := s.mgr.FindByConnID(connID)
		if conn == nil {
			_ = cacheClient.PushPendingTask(ctx, ai.InviterUserID, string(payload))
			return
		}
		frame := ws.NewFrame(ws.TypeAgentDispatch, json.RawMessage(payload))
		s.mgr.PushToConn(connID, frame)
		_ = repository.UpdatePendingTaskDispatched(s.db, task.ID, conn.DeviceID)
		return
	}

	// offline: push to Redis pending queue
	_ = cacheClient.PushPendingTask(ctx, ai.InviterUserID, string(payload))
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
	if task.Status != model.TaskStatusDispatched {
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

// HandleTaskStream inserts an agent message into the session (streaming chunk).
func (s *AgentService) HandleTaskStream(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, payload string) error {
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

	// ensure status is running
	if task.Status != model.TaskStatusRunning {
		_ = repository.UpdatePendingTaskStatus(s.db, taskID, model.TaskStatusRunning, "")
	}

	msg := &model.Message{
		SessionID:   "", // will be set from agent instance
		SenderType:  model.SenderTypeAgent,
		SenderID:    task.AgentInstanceID,
		ClientMsgID: uuidv7.Must(),
		ContentType: model.ContentTypeText,
		Content:     payload,
	}
	msg.SessionID = ai.SessionID

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

	s.bus.Publish(ctx, Event{Type: "message.new", Payload: msg})

	return nil
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
	if task.Status == model.TaskStatusDone || task.Status == model.TaskStatusFailed ||
		task.Status == model.TaskStatusCancelled || task.Status == model.TaskStatusTimeout {
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
	if task.Status == model.TaskStatusDone || task.Status == model.TaskStatusFailed ||
		task.Status == model.TaskStatusCancelled || task.Status == model.TaskStatusTimeout {
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
	if task.EdgeDeviceID != "" && task.EdgeDeviceID != edgeDeviceID {
		return nil, errcode.AgentTaskNotFound
	}
	if task.EdgeRunID != "" && task.EdgeRunID != edgeRunID {
		return nil, errcode.ErrBadRequest
	}
	return ai, nil
}
