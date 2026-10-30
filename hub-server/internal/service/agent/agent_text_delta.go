package agent

import (
	"context"
	"errors"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/agentevent"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Text fragments are durable runtime evidence, not completed chat messages.
// Keep their existing UUID as the event identity; the task lock serializes
// replay checks with completion and the bounded event-sequence allocator.
func (s *EdgeCallbackService) handleRuntimeEvent(ctx context.Context, task *model.PendingAgentTask, ai *model.AgentInstance, runID, clientID, eventType, payload string) error {
	id, err := uuid.Parse(clientID)
	if err != nil || id == uuid.Nil {
		return errcode.ErrBadRequest.WithMessage("runtime event requires a UUID event identity")
	}
	event := &model.AgentRunEvent{ID: id.String(), TaskID: task.ID, EdgeRunID: agentevent.FirstNonEmpty(runID, task.EdgeRunID), SessionID: ai.SessionID, AgentInstanceID: ai.ID, EventType: eventType, Payload: payload}
	created := false
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var locked model.PendingAgentTask
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&locked, "id = ?", task.ID).Error; err != nil {
			return err
		}
		if locked.Status != model.TaskStatusRunning && locked.Status != model.TaskStatusDispatched {
			return errcode.ErrBadRequest
		}
		if locked.AgentInstanceID != task.AgentInstanceID || locked.EdgeDeviceID != task.EdgeDeviceID || locked.EdgeRunID != task.EdgeRunID {
			return errcode.ErrBadRequest.WithMessage("runtime task binding changed")
		}
		var existing model.AgentRunEvent
		if err := tx.First(&existing, "id = ?", event.ID).Error; err == nil {
			if !sameRuntimeEvent(&existing, event) {
				return errcode.ErrBadRequest.WithMessage("runtime event identity conflict")
			}
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if locked.Status == model.TaskStatusDispatched {
			rows, err := repository.UpdatePendingTaskStatusAtomic(tx, task.ID, locked.Status, model.TaskStatusRunning, "")
			if err != nil {
				return err
			}
			if rows != 1 {
				return errcode.ErrBadRequest
			}
		}
		if err := repository.CreateAgentRunEventWithNextSeqLimited(tx, event, config.MaxRunEventsPerTask); err != nil {
			return err
		}
		created = true
		return nil
	})
	if errors.Is(err, repository.ErrRunEventLimitExceeded) {
		return errcode.ErrBadRequest.WithMessage("agent callback event limit exceeded")
	}
	if err != nil || !created {
		return err
	}
	s.bumpRunningTaskHeartbeat(task.ID)
	s.autoAckOnce(ctx, task.ID)
	s.touchSessionLastMessageThrottled(ai.SessionID)
	s.publishStreamEvents(ctx, ai, task.ID, nil, event)
	return nil
}

// A replay must retain the whole event binding, not just the visible text.
func sameRuntimeEvent(existing, incoming *model.AgentRunEvent) bool {
	return existing.TaskID == incoming.TaskID &&
		existing.EdgeRunID == incoming.EdgeRunID &&
		existing.SessionID == incoming.SessionID &&
		existing.AgentInstanceID == incoming.AgentInstanceID &&
		existing.EventType == incoming.EventType &&
		canonicalJSON(existing.Payload) == canonicalJSON(incoming.Payload)
}
