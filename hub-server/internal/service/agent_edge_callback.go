package service

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/ws"
	"github.com/agenthub/hub-server/pkg/uuidv7"
)

// HandleTaskAck marks a task as running and optionally records the Edge run id
// that is executing it.
func (s *AgentService) HandleTaskAck(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
	if err := validateAgentCallbackEdgeRunID(edgeRunID); err != nil {
		return err
	}
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
			rowsAffected, err := repository.UpdatePendingTaskEdgeRunID(s.db, taskID, edgeRunID)
			if err != nil {
				return err
			}
			if rowsAffected > 0 {
				return nil
			}
			latestTask, err := repository.GetPendingTaskByID(s.db, taskID)
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return errcode.AgentTaskNotFound
				}
				return err
			}
			if latestTask.EdgeRunID == edgeRunID {
				return nil
			}
			return errcode.ErrBadRequest
		}
		return nil
	}
	// #99: accept queued tasks for offline-replayed tasks, transitioning to running.
	if task.Status != model.TaskStatusDispatched && task.Status != model.TaskStatusQueued {
		return errcode.ErrBadRequest
	}
	rowsAffected, err := repository.UpdatePendingTaskStatusAtomicWithEdgeRunID(s.db, taskID, task.Status, model.TaskStatusRunning, "", edgeRunID)
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
	if err := validateAgentCallbackEdgeRunID(edgeRunID); err != nil {
		return err
	}
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
	if task.Status == model.TaskStatusDispatched {
		if err := s.transitionDispatchedTaskToRunning(taskID); err != nil {
			return err
		}
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
		if err := repository.CreateAgentRunEventWithNextSeqLimited(tx, runEvent, config.MaxRunEventsPerTask); err != nil {
			return err
		}
		return repository.InsertMessage(tx, msg)
	})
	if err != nil {
		if errors.Is(err, repository.ErrRunEventLimitExceeded) {
			return errcode.ErrBadRequest.WithMessage("agent callback event limit exceeded")
		}
		return err
	}

	// #154: update session last_message_at when agent stream creates a message
	_ = repository.TouchSessionLastMessage(s.db, ai.SessionID)

	s.bus.Publish(ctx, Event{Type: "message.new", Payload: msg})
	s.bus.Publish(ctx, Event{Type: ws.TypeAgentStream, Payload: runEvent})

	return nil
}

func (s *AgentService) transitionDispatchedTaskToRunning(taskID string) error {
	rowsAffected, err := repository.UpdatePendingTaskStatusAtomic(s.db, taskID, model.TaskStatusDispatched, model.TaskStatusRunning, "")
	if err != nil {
		return err
	}
	if rowsAffected > 0 {
		return nil
	}
	current, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentTaskNotFound
		}
		return err
	}
	if current.Status == model.TaskStatusRunning {
		return nil
	}
	return errcode.ErrBadRequest
}

// HandleTaskDone marks a task as done and inserts the final content as a message.
func (s *AgentService) HandleTaskDone(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
	if err := validateAgentCallbackEdgeRunID(edgeRunID); err != nil {
		return err
	}
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
	var msg *model.Message
	if finalContent != "" {
		if err := validateAgentCallbackPayloadSize(finalContent); err != nil {
			return err
		}
		msg = &model.Message{
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
	}

	err = s.db.Transaction(func(tx *gorm.DB) error {
		if msg != nil {
			if err := repository.InsertMessage(tx, msg); err != nil {
				return err
			}
		}
		rowsAffected, err := repository.UpdatePendingTaskStatusAtomic(tx, taskID, task.Status, model.TaskStatusDone, "")
		if err != nil {
			return err
		}
		if rowsAffected == 0 {
			return errcode.ErrBadRequest
		}
		return nil
	})
	if err != nil {
		return err
	}

	if msg != nil {
		// #154: update session last_message_at when agent done creates a message
		_ = repository.TouchSessionLastMessage(s.db, ai.SessionID)
		s.bus.Publish(ctx, Event{Type: "message.new", Payload: msg})
	}

	s.bus.Publish(ctx, Event{Type: "agent.done", Payload: map[string]interface{}{
		"task_id":           taskID,
		"agent_instance_id": task.AgentInstanceID,
		"session_id":        ai.SessionID,
	}})

	return nil
}

// HandleTaskFail marks a task as failed.
func (s *AgentService) HandleTaskFail(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error {
	if err := validateAgentCallbackEdgeRunID(edgeRunID); err != nil {
		return err
	}
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
	if errMsg != "" {
		if err := validateAgentCallbackPayloadSize(errMsg); err != nil {
			return err
		}
	}

	rowsAffected, err := repository.UpdatePendingTaskStatusAtomic(s.db, taskID, task.Status, model.TaskStatusFailed, errMsg)
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errcode.ErrBadRequest
	}

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
