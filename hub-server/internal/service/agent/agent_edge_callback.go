package agent

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/agentevent"
	"github.com/agenthub/hub-server/internal/uuidv7"
	"github.com/agenthub/hub-server/internal/ws"
)

// edgeCallbackBus publishes domain events from edge callback orchestration.
// Implemented by *Bus.
type edgeCallbackBus interface {
	Publish(ctx context.Context, event bus.Event) error
}

// edgeCallbackSeq allocates message sequence IDs for stream/done projections.
// Implemented by Service.allocateSeq via seqAllocatorFunc.
type edgeCallbackSeq interface {
	allocateSeq(ctx context.Context, sessionID string) (int64, error)
}

// edgeCallbackOutbox auto-acks delivery journal rows when Edge proves receipt
// (ack, first authorized stream, or done). Implemented solely by *deliveryoutbox.Outbox.
type edgeCallbackOutbox interface {
	AutoAckDeliveriesForTask(ctx context.Context, taskID string)
}

// seqAllocatorFunc adapts a function to edgeCallbackSeq.
type seqAllocatorFunc func(ctx context.Context, sessionID string) (int64, error)

func (f seqAllocatorFunc) allocateSeq(ctx context.Context, sessionID string) (int64, error) {
	return f(ctx, sessionID)
}

// publishToBus best-effort 发布总线事件：bus 未注入或发布失败都只记日志，
// 永不失败调用方（#1478 语义延续；#1574 显式处理返回值）。
func (s *EdgeCallbackService) publishToBus(ctx context.Context, event bus.Event, warnMsg string, warnAttrs ...any) {
	if s.bus == nil {
		return
	}
	if err := s.bus.Publish(ctx, event); err != nil {
		slog.Warn(warnMsg, append(warnAttrs, "error", err)...)
	}
}

// EdgeCallbackService owns Edge task ack/stream/done/fail orchestration.
// Pure validation/normalization lives in service/agentevent; bus/seq/outbox are injected.
type EdgeCallbackService struct {
	db     *gorm.DB
	bus    edgeCallbackBus
	seq    edgeCallbackSeq
	outbox edgeCallbackOutbox
	// ctxCache memoizes team-run ownership per pending task so the
	// team.subagent.stream fan-out (#1478 Phase A) does not re-run three DB
	// lookups per per-token run.agent.* event. Lazily allocated.
	ctxCache *teamRunContextCache
	// ctxCacheOnce serializes the lazy allocation of ctxCache so concurrent
	// teamCtxCache callers cannot both observe nil and double-allocate (a
	// check-then-write race detectable under -race).
	ctxCacheOnce sync.Once
	// ctxLookup resolves a pending task's team-run ownership; overridable in
	// tests via SetSubagentStreamLookup. Lazily backed by dbTeamRunLookup.
	ctxLookup subagentStreamLookup
	// ctxLookupOnce serializes the lazy allocation of ctxLookup for the same
	// reason as ctxCacheOnce.
	ctxLookupOnce sync.Once
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
	s.outbox.AutoAckDeliveriesForTask(ctx, taskID)
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
	s.bumpRunningTaskHeartbeat(taskID)

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
		return s.persistStreamRunEvent(tx, ai, runEvent, msg, eventPayload)
	})
	if err != nil {
		if errors.Is(err, repository.ErrRunEventLimitExceeded) {
			return errcode.ErrBadRequest.WithMessage("agent callback event limit exceeded")
		}
		return err
	}

	// #154: update session last_message_at when agent stream creates a message
	s.touchSessionLastMessage(ai.SessionID)

	// #1000: first authorized stream proves Edge received the task — ack outbox
	// so SentTimeout does not redispatch while Edge is already executing.
	// After successful persist only (matches HandleTaskAck post-transition ack).
	s.autoAck(ctx, taskID)

	s.publishStreamEvents(ctx, ai, taskID, msg, runEvent)
	s.tryAutoParseRouteDecision(ctx, ai.SessionID, runEvent.Payload)

	return nil
}

// persistStreamRunEvent inserts the run event + chat message projection for an
// agent stream tick, and maintains the team run token-usage counter inside the
// same transaction so the budget guard can short-circuit in O(1).
func (s *EdgeCallbackService) persistStreamRunEvent(tx *gorm.DB, ai *model.AgentInstance, runEvent *model.AgentRunEvent, msg *model.Message, eventPayload string) error {
	if err := repository.CreateAgentRunEventWithNextSeqLimited(tx, runEvent, config.MaxRunEventsPerTask); err != nil {
		return err
	}
	if err := repository.InsertMessage(tx, msg); err != nil {
		return err
	}
	// Maintain the team run's token_usage_total counter so the budget
	// guard (agent_team_guard.go) can short-circuit in O(1) instead of
	// scanning every run event on each route decision. Best-effort: a
	// non-team session (no team run for this session) is a no-op, and a
	// payload with no token usage (delta == 0) skips the lookup. The
	// lookup runs inside the same transaction so the counter increment
	// is atomic with the event insert; a failure here rolls back the
	// whole event+message insert to keep the counter and events in sync.
	if delta := agentevent.TokenUsageTotalFromPayload(eventPayload); delta > 0 {
		if teamRun, terr := repository.GetTeamRunBySessionID(tx, ai.SessionID); terr == nil && teamRun != nil {
			if incErr := repository.IncrementTeamRunTokenUsage(tx, teamRun.ID, delta); incErr != nil {
				return incErr
			}
		} else if terr != nil && !errors.Is(terr, gorm.ErrRecordNotFound) {
			// A real lookup error (not "no team run for this session")
			// must fail the transaction so the counter stays honest.
			return terr
		}
	}
	return nil
}

// bumpRunningTaskHeartbeat refreshes the task expire_at during activity.
// Best-effort: a failure warns + increments the heartbeat metric but never
// fails the stream path (the task is still alive, TTL just shortens).
func (s *EdgeCallbackService) bumpRunningTaskHeartbeat(taskID string) {
	if err := repository.BumpRunningTaskExpireAt(s.db, taskID, config.RunningTaskHeartbeatTTL); err != nil {
		slog.Warn("failed to bump running task heartbeat expire_at",
			"task_id", taskID,
			"error", err,
		)
		if metrics.AgentHeartbeatFailures != nil {
			metrics.AgentHeartbeatFailures.Inc()
		}
	}
}

// publishStreamEvents fans a stream persist out to the bus: the chat
// message-new projection, the WS agent-stream event, and the team-run view
// fan-out (no-op when the session is not a team run; never fails the chat-side
// stream path that already persisted).
func (s *EdgeCallbackService) publishStreamEvents(ctx context.Context, ai *model.AgentInstance, taskID string, msg *model.Message, runEvent *model.AgentRunEvent) {
	if s.bus == nil {
		return
	}
	s.publishToBus(ctx, bus.Event{Type: bus.EventTypeMessageNew, Payload: msg}, "failed to publish message-new event", "session_id", ai.SessionID)
	s.publishToBus(ctx, bus.Event{Type: ws.TypeAgentStream, Payload: runEvent}, "failed to publish agent-stream event", "task_id", taskID)
	// #1478 Phase A: fan the same run event into the team-run view when the
	// run belongs to a team run. No-op when the session is not a team run;
	// never fails the chat-side stream path that already succeeded above.
	s.publishTeamSubagentStream(ctx, runEvent, taskID)
}

// touchSessionLastMessage updates session.last_message_at when an agent
// callback creates a message. Best-effort: a failure warns + increments the
// metric but does not fail the callback path.
func (s *EdgeCallbackService) touchSessionLastMessage(sessionID string) {
	if err := repository.TouchSessionLastMessage(s.db, sessionID); err != nil {
		slog.Warn("failed to touch session last_message_at",
			"session_id", sessionID,
			"error", err,
		)
		if metrics.SessionTouchFailures != nil {
			metrics.SessionTouchFailures.Inc()
		}
	}
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

	s.publishToBus(ctx, bus.Event{
		Type: bus.EventTypeAgentRouteDecision,
		Payload: RouteDecisionPayload{
			UserID:   run.TriggerUserID,
			TeamID:   run.TeamID,
			RunID:    run.ID,
			Decision: decision,
		},
	}, "failed to publish agent route decision event", "run_id", run.ID)
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

	// #1408: the stream path already projects runtime text as chat messages.
	// When the session's latest agent message carries exactly the done-final
	// text (a single-chunk stream followed by a done callback with the same
	// content), skip inserting an identical duplicate so the chat does not
	// render the final answer twice.
	if shouldSkipDoneFinalInsert(s.db, ai.SessionID, task.AgentInstanceID, finalContent) {
		finalContent = ""
	}

	// insert final message if content is provided
	msg, err := s.buildDoneFinalMessage(ctx, ai, task, finalContent)
	if err != nil {
		return err
	}

	err = s.db.Transaction(func(tx *gorm.DB) error {
		return s.finishTaskDoneTx(tx, task, msg)
	})
	if err != nil {
		return err
	}

	s.publishTaskDoneEvents(ctx, ai, task, taskID, msg)

	return nil
}

// buildDoneFinalMessage produces the done message for the final content (or
// nil when there is no content to insert), sequencing it in the session.
func (s *EdgeCallbackService) buildDoneFinalMessage(ctx context.Context, ai *model.AgentInstance, task *model.PendingAgentTask, finalContent string) (*model.Message, error) {
	if finalContent == "" {
		return nil, nil
	}
	if err := agentevent.ValidateAgentCallbackPayloadSize(finalContent); err != nil {
		return nil, err
	}
	// messages.content is jsonb — plain text must be wrapped exactly like
	// the stream path does, or the insert fails with 22P02 (invalid json).
	messageContent, err := wrapFinalMessageContent(finalContent)
	if err != nil {
		return nil, err
	}
	if s.seq == nil {
		return nil, errcode.ErrInternal.WithMessage("edge callback sequence allocator not configured")
	}
	seq, err := s.seq.allocateSeq(ctx, ai.SessionID)
	if err != nil {
		return nil, err
	}
	return &model.Message{
		SessionID:   ai.SessionID,
		SenderType:  model.SenderTypeAgent,
		SenderID:    task.AgentInstanceID,
		ClientMsgID: uuidv7.Must(),
		ContentType: model.ContentTypeText,
		Content:     messageContent,
		SeqID:       seq,
	}, nil
}

// wrapFinalMessageContent wraps plain-text final content in the same jsonb
// shape the stream path uses; valid JSON passes through unchanged.
func wrapFinalMessageContent(finalContent string) (string, error) {
	if json.Valid([]byte(finalContent)) {
		return finalContent, nil
	}
	wrapped, err := json.Marshal(map[string]string{"content": finalContent})
	if err != nil {
		return "", err
	}
	return string(wrapped), nil
}

// finishTaskDoneTx inserts the done message (when present) and CAS-updates the
// task status to done inside one transaction.
func (s *EdgeCallbackService) finishTaskDoneTx(tx *gorm.DB, task *model.PendingAgentTask, msg *model.Message) error {
	if msg != nil {
		if err := repository.InsertMessage(tx, msg); err != nil {
			return err
		}
	}
	rowsAffected, err := repository.UpdatePendingTaskStatusAtomic(tx, task.ID, task.Status, model.TaskStatusDone, "")
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errcode.ErrBadRequest
	}
	return nil
}

// publishTaskDoneEvents publishes the post-completion side effects: session
// touch + message-new (when a message was inserted), outbox ack, and the
// agent-done bus event.
func (s *EdgeCallbackService) publishTaskDoneEvents(ctx context.Context, ai *model.AgentInstance, task *model.PendingAgentTask, taskID string, msg *model.Message) {
	if msg != nil {
		// #154: update session last_message_at when agent done creates a message
		s.touchSessionLastMessage(ai.SessionID)
		if s.bus != nil {
			s.publishToBus(ctx, bus.Event{Type: bus.EventTypeMessageNew, Payload: msg}, "failed to publish message-new event", "session_id", ai.SessionID)
		}
	}
	// #1000: done also acks outbox (covers Edge paths that skip stream/ack).
	s.autoAck(ctx, taskID)

	if s.bus != nil {
		s.publishToBus(ctx, bus.Event{Type: bus.EventTypeAgentDone, Payload: bus.AgentTaskPayload{
			TaskID:          taskID,
			AgentInstanceID: task.AgentInstanceID,
			SessionID:       ai.SessionID,
		}}, "failed to publish agent-done event", "task_id", taskID)
	}
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
		s.publishToBus(ctx, bus.Event{Type: "agent.failed", Payload: bus.AgentFailedPayload{
			AgentTaskPayload: bus.AgentTaskPayload{
				TaskID:          taskID,
				AgentInstanceID: task.AgentInstanceID,
				SessionID:       ai.SessionID,
			},
			Error: errMsg,
		}}, "failed to publish agent-failed event", "task_id", taskID)
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
	// Offline-queued tasks (#99) have no device binding until an edge acks
	// them; the matching user's edge is allowed to claim an unbound task.
	// Bound tasks must come from the bound device.
	if task.EdgeDeviceID != "" && task.EdgeDeviceID != edgeDeviceID {
		return nil, errcode.AgentTaskNotFound
	}
	if task.EdgeRunID != "" && task.EdgeRunID != edgeRunID {
		return nil, errcode.ErrBadRequest
	}
	return ai, nil
}

// shouldSkipDoneFinalInsert reports whether HandleTaskDone should skip
// inserting its final message because the session's latest agent message
// already carries exactly the same text (stream projection landed it first).
// The comparison is strict: sender must be the same agent instance and the
// unwrapped plain text must match, so a partial stream (fragments) or an
// interleaved user message never suppresses the authoritative final message.
// JSON-shaped content is compared canonically: Postgres jsonb re-serializes
// stored JSON (key order + whitespace), so raw string equality would miss
// duplicates for decision/structured outputs (#1414).
func shouldSkipDoneFinalInsert(db *gorm.DB, sessionID, senderID, finalContent string) bool {
	if finalContent == "" {
		return false
	}
	latest, err := repository.GetMessagesBySession(db, sessionID, 0, 1)
	if err != nil || len(latest) == 0 {
		return false
	}
	last := latest[0]
	if last.SenderType != model.SenderTypeAgent || last.SenderID != senderID {
		return false
	}
	return canonicalContent(last.Content) == canonicalContent(finalContent)
}

// canonicalContent normalizes message content into a canonical compact form
// so jsonb-stored values compare equal to the raw stream text they came from:
// the projection wrapper {"content": X} is unwrapped first, then JSON-shaped
// values are re-marshaled (stable whitespace/key order). Non-JSON values pass
// through unchanged.
func canonicalContent(raw string) string {
	var wrapper struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapper); err == nil && wrapper.Content != "" {
		return canonicalContent(wrapper.Content)
	}
	if !json.Valid([]byte(raw)) {
		return raw
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return raw
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return raw
	}
	return string(canonical)
}

// unwrapMessageContentText extracts plain text from a messages.content jsonb
// string. Stream-path messages are stored as {"content": "..."}; any other
// shape (or a non-JSON value) is returned as-is.
func unwrapMessageContentText(raw string) string {
	var wrapper struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapper); err != nil {
		return raw
	}
	if wrapper.Content == "" {
		return raw
	}
	return wrapper.Content
}

// ── Service facade (wiring/handler stability) ───────────────────────────

// edgeCallbackService returns the composed EdgeCallbackService, lazily constructing
// one from Service deps when tests use struct literals without NewService.
func (s *Service) edgeCallbackService() *EdgeCallbackService {
	if s.edgeCallbacks != nil {
		return s.edgeCallbacks
	}
	// DeliveryOutbox is the sole edgeCallbackOutbox implementer (owns model).
	return NewEdgeCallbackService(
		s.db,
		s.bus,
		seqAllocatorFunc(s.allocateSeq),
		s.deliveryOutboxService(),
	)
}

// HandleTaskAck marks a task as running and optionally records the Edge run id.
func (s *Service) HandleTaskAck(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string) error {
	return s.edgeCallbackService().HandleTaskAck(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID)
}

// HandleTaskStream records a typed runtime event and projects message.new for chat.
func (s *Service) HandleTaskStream(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID string, stream model.AgentRunEventInput) error {
	return s.edgeCallbackService().HandleTaskStream(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, stream)
}

// HandleTaskDone marks a task as done and inserts the final content as a message.
func (s *Service) HandleTaskDone(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent string) error {
	return s.edgeCallbackService().HandleTaskDone(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, finalContent)
}

// HandleTaskFail marks a task as failed.
func (s *Service) HandleTaskFail(ctx context.Context, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg string) error {
	return s.edgeCallbackService().HandleTaskFail(ctx, edgeUserID, edgeDeviceID, taskID, edgeRunID, errMsg)
}
