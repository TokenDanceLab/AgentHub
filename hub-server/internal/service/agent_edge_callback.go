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
	"github.com/agenthub/hub-server/internal/service/agentevent"
	"github.com/agenthub/hub-server/internal/ws"
	"github.com/agenthub/hub-server/pkg/uuidv7"
)

// edgeCallbackBus publishes domain events from edge callback orchestration.
// Implemented by *Bus.
type edgeCallbackBus interface {
	Publish(ctx context.Context, event Event)
}

// edgeCallbackSeq allocates message sequence IDs for stream/done projections.
// Implemented by AgentService.allocateSeq via seqAllocatorFunc.
type edgeCallbackSeq interface {
	allocateSeq(ctx context.Context, sessionID string) (int64, error)
}

// edgeCallbackOutbox auto-acks delivery journal rows when Edge acks a task.
// Implemented by deliveryOutboxAcker (same-package outbox model access).
type edgeCallbackOutbox interface {
	autoAckDeliveriesForTask(ctx context.Context, taskID string)
}

// seqAllocatorFunc adapts a function to edgeCallbackSeq.
type seqAllocatorFunc func(ctx context.Context, sessionID string) (int64, error)

func (f seqAllocatorFunc) allocateSeq(ctx context.Context, sessionID string) (int64, error) {
	return f(ctx, sessionID)
}

// deliveryOutboxAcker implements edgeCallbackOutbox against the delivery outbox table.
type deliveryOutboxAcker struct {
	db *gorm.DB
}

// autoAckDeliveriesForTask marks all pending/sent/retrying delivery outbox
// entries for a task as delivered. This is called when the Edge acks the task.
func (a *deliveryOutboxAcker) autoAckDeliveriesForTask(ctx context.Context, taskID string) {
	if a == nil || a.db == nil {
		return
	}
	now := time.Now()
	result := a.db.WithContext(ctx).
		Model(&deliveryOutboxRecord{}).
		Where("task_id = ? AND status IN ?", taskID, []string{DeliveryStatusPending, DeliveryStatusSent, DeliveryStatusRetrying}).
		Updates(map[string]interface{}{
			"status":       DeliveryStatusDelivered,
			"delivered_at": &now,
		})
	if result.Error != nil {
		slog.Warn("failed to auto-ack deliveries for task", "task_id", taskID, "error", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		slog.Debug("auto-acked deliveries for task", "task_id", taskID, "count", result.RowsAffected)
	}
}

// EdgeCallbackService owns Edge task ack/stream/done/fail orchestration.
// Pure validation/normalization lives in service/agentevent; bus/seq/outbox are injected.
type EdgeCallbackService struct {
	db     *gorm.DB
	bus    edgeCallbackBus
	seq    edgeCallbackSeq
	outbox edgeCallbackOutbox
}

// NewEdgeCallbackService constructs an EdgeCallbackService.
// bus, seq, and outbox may be nil for read-only/partial tests; write paths that
// need them will fail or no-op accordingly.
func NewEdgeCallbackService(db *gorm.DB, bus edgeCallbackBus, seq edgeCallbackSeq, outbox edgeCallbackOutbox) *EdgeCallbackService {
	return &EdgeCallbackService{db: db, bus: bus, seq: seq, outbox: outbox}
}

// SetBus injects (or replaces) the event bus port.
func (s *EdgeCallbackService) SetBus(bus edgeCallbackBus) {
	s.bus = bus
}

// SetSeq injects (or replaces) the sequence allocator port.
func (s *EdgeCallbackService) SetSeq(seq edgeCallbackSeq) {
	s.seq = seq
}

// SetOutbox injects (or replaces) the delivery outbox auto-ack port.
func (s *EdgeCallbackService) SetOutbox(outbox edgeCallbackOutbox) {
	s.outbox = outbox
}

// HandleTaskAck marks a task as running and optionally records the Edge run id
// that is executing it. It also auto-acks any pending delivery outbox entries
// for this task (AH-SR-049: outbox delivery journal).
func (s *EdgeCallbackService) HandleTaskAck(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
	if err := agentevent.ValidateAgentCallbackEdgeRunID(edgeRunID); err != nil {
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
				s.autoAck(ctx, taskID)
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
				s.autoAck(ctx, taskID)
				return nil
			}
			return errcode.ErrBadRequest
		}
		s.autoAck(ctx, taskID)
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
	s.autoAck(ctx, taskID)
	return nil
}

func (s *EdgeCallbackService) autoAck(ctx context.Context, taskID string) {
	if s.outbox == nil {
		return
	}
	s.outbox.autoAckDeliveriesForTask(ctx, taskID)
}

// HandleTaskStream records a typed runtime event and keeps the existing
// message.new projection for current Web/Desktop chat consumers.
func (s *EdgeCallbackService) HandleTaskStream(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
	if err := agentevent.ValidateAgentCallbackEdgeRunID(edgeRunID); err != nil {
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

	eventType, eventPayload, messageContent, err := agentevent.NormalizeRunEventInput(stream)
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
		EdgeRunID:       agentevent.FirstNonEmpty(edgeRunID, task.EdgeRunID),
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

	if s.seq == nil {
		return errcode.ErrInternal.WithMessage("edge callback sequence allocator not configured")
	}
	seq, err := s.seq.allocateSeq(ctx, ai.SessionID)
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

	if s.bus != nil {
		s.bus.Publish(ctx, Event{Type: "message.new", Payload: msg})
		s.bus.Publish(ctx, Event{Type: ws.TypeAgentStream, Payload: runEvent})
	}
	s.tryAutoParseRouteDecision(ctx, ai.SessionID, runEvent.Payload)

	return nil
}

func (s *EdgeCallbackService) tryAutoParseRouteDecision(ctx context.Context, sessionID string, payload string) {
	run, err := repository.GetTeamRunBySessionID(s.db, sessionID)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			slog.Warn("route decision team run lookup failed", "session_id", sessionID, "error", err)
		}
		return
	}
	if run.Status != model.TeamRunStatusRunning {
		return
	}

	var decision model.CoordinatorRouteDecision
	if err := json.Unmarshal([]byte(payload), &decision); err != nil {
		return
	}
	decision.Action = strings.ToLower(strings.TrimSpace(decision.Action))
	if !model.ValidActions()[decision.Action] {
		return
	}

	if s.bus != nil {
		s.bus.Publish(ctx, Event{
			Type: "agent.route_decision",
			Payload: RouteDecisionPayload{
				UserID:   run.TriggerUserID,
				TeamID:   run.TeamID,
				RunID:    run.ID,
				Decision: decision,
			},
		})
	}
}

func (s *EdgeCallbackService) transitionDispatchedTaskToRunning(taskID string) error {
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
func (s *EdgeCallbackService) HandleTaskDone(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
	if err := agentevent.ValidateAgentCallbackEdgeRunID(edgeRunID); err != nil {
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
		if err := agentevent.ValidateAgentCallbackPayloadSize(finalContent); err != nil {
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
		if s.seq == nil {
			return errcode.ErrInternal.WithMessage("edge callback sequence allocator not configured")
		}
		seq, err := s.seq.allocateSeq(ctx, ai.SessionID)
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
		if s.bus != nil {
			s.bus.Publish(ctx, Event{Type: "message.new", Payload: msg})
		}
	}

	if s.bus != nil {
		s.bus.Publish(ctx, Event{Type: "agent.done", Payload: map[string]interface{}{
			"task_id":           taskID,
			"agent_instance_id": task.AgentInstanceID,
			"session_id":        ai.SessionID,
		}})
	}

	return nil
}

// HandleTaskFail marks a task as failed.
func (s *EdgeCallbackService) HandleTaskFail(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error {
	if err := agentevent.ValidateAgentCallbackEdgeRunID(edgeRunID); err != nil {
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
		if err := agentevent.ValidateAgentCallbackPayloadSize(errMsg); err != nil {
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

	if s.bus != nil {
		s.bus.Publish(ctx, Event{Type: "agent.failed", Payload: map[string]interface{}{
			"task_id":           taskID,
			"agent_instance_id": task.AgentInstanceID,
			"session_id":        ai.SessionID,
			"error":             errMsg,
		}})
	}

	return nil
}

func (s *EdgeCallbackService) authorizeTaskEdgeCallback(task *model.PendingAgentTask, edgeUserID, edgeDeviceID, edgeRunID string) (*model.AgentInstance, error) {
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

// ── AgentService facade (wiring/handler stability) ───────────────────────────

// edgeCallbackService returns the composed EdgeCallbackService, lazily constructing
// one from AgentService deps when tests use struct literals without NewAgentService.
func (s *AgentService) edgeCallbackService() *EdgeCallbackService {
	if s.edgeCallbacks != nil {
		return s.edgeCallbacks
	}
	return NewEdgeCallbackService(
		s.db,
		s.bus,
		seqAllocatorFunc(s.allocateSeq),
		&deliveryOutboxAcker{db: s.db},
	)
}

// HandleTaskAck marks a task as running and optionally records the Edge run id.
func (s *AgentService) HandleTaskAck(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
	return s.edgeCallbackService().HandleTaskAck(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID)
}

// HandleTaskStream records a typed runtime event and projects message.new for chat.
func (s *AgentService) HandleTaskStream(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
	return s.edgeCallbackService().HandleTaskStream(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, stream)
}

// HandleTaskDone marks a task as done and inserts the final content as a message.
func (s *AgentService) HandleTaskDone(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
	return s.edgeCallbackService().HandleTaskDone(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent)
}

// HandleTaskFail marks a task as failed.
func (s *AgentService) HandleTaskFail(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error {
	return s.edgeCallbackService().HandleTaskFail(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg)
}
