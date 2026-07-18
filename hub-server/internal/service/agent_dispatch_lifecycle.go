package service

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

func (s *DispatchService) CancelTask(ctx context.Context, userID, taskID string) error {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err := dispatch.MapPendingTaskLookupError(err, errors.Is(err, gorm.ErrRecordNotFound)); err != nil {
		return err
	}
	if err := dispatch.TaskNotFoundIfNotOwner(task.TriggeredByUserID, userID); err != nil {
		return err
	}
	if err := dispatch.CancelTaskTerminalError(task.Status); err != nil {
		return err
	}

	ai, err := repository.GetAgentInstanceByID(s.db, task.AgentInstanceID)
	if err != nil {
		return err
	}

	rowsAffected, err := repository.UpdatePendingTaskStatusAtomic(s.db, taskID, task.Status, model.TaskStatusCancelled, "")
	if err != nil {
		return err
	}
	if err := dispatch.CancelTaskNoRowsError(rowsAffected); err != nil {
		return err
	}

	s.publish(ctx, Event{Type: dispatch.EventTypeAgentCancel, Payload: dispatch.CancelEventPayload(
		taskID, task.AgentInstanceID, ai.SessionID, task.TriggeredByUserID,
	)})

	return nil
}

// RegenerateAgentTask creates a new task using the same prompt as an existing task.
// It looks up the original task, verifies ownership, and triggers a new task with
// the same trigger message, agent instance, and target.
func (s *DispatchService) RegenerateAgentTask(ctx context.Context, userID, taskID string) (*model.PendingAgentTask, error) {
	original, err := repository.GetPendingTaskByID(s.db, taskID)
	if err := dispatch.MapPendingTaskLookupError(err, errors.Is(err, gorm.ErrRecordNotFound)); err != nil {
		return nil, err
	}
	if err := dispatch.TaskNotFoundIfNotOwner(original.TriggeredByUserID, userID); err != nil {
		return nil, err
	}

	// Only allow regenerating from terminal tasks (done/failed/cancelled/timeout).
	if err := dispatch.RegenerateTaskStatusError(original.Status); err != nil {
		return nil, err
	}

	ai, err := repository.GetAgentInstanceByID(s.db, original.AgentInstanceID)
	if err != nil {
		return nil, err
	}

	newTask, err := s.TriggerAgentTask(ctx, userID, original.TriggerMessageID, ai.ID, ai.AgentType, "", "", original.TargetID)
	if err != nil {
		return nil, err
	}

	s.publish(ctx, Event{Type: dispatch.EventTypeAgentRegenerate, Payload: dispatch.RegenerateEventPayload(
		taskID, newTask.ID, ai.ID, ai.SessionID, original.TriggerMessageID,
	)})

	return newTask, nil
}

// issueRunStartCapability mints a short-lived capability token for Edge dual-token auth.
