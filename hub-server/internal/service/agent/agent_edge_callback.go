package agent

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

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
//
// The error result is what lets the stream path dedupe this call per task
// (#2154 P2-9): only a successful ack is recorded, so a transient store
// failure leaves the next chunk free to retry.
type edgeCallbackOutbox interface {
	AutoAckDeliveriesForTask(ctx context.Context, taskID string) error
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
	// ackedTasks dedupes the per-chunk delivery-outbox auto-ack down to one
	// attempt per task (#2154 P2-9). Bounded, fail-open, cleared on terminal
	// callbacks — see ackedTaskSet. Lazily allocated.
	ackedTasks *ackedTaskSet
	// ackedOnce serializes the lazy allocation of ackedTasks so concurrent
	// first-callers cannot both observe nil and double-allocate.
	ackedOnce sync.Once
	// touchThrottle caps session.last_message_at writes at one per session per
	// second on the stream path (#2154 P2-9). Bounded and fail-open — see
	// sessionTouchThrottle. Lazily allocated.
	touchThrottle *sessionTouchThrottle
	// touchOnce serializes the lazy allocation of touchThrottle.
	touchOnce sync.Once
	// clock overrides time.Now for the throttle window. Nil in production;
	// tests set it to drive the window deterministically without sleeping.
	clock func() time.Time
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

// autoAck acks the task's delivery-outbox rows unconditionally. Used by the
// once-per-task callbacks (ack / done) where the round-trip is already O(1)
// per task and where a late-created active row must still be picked up.
func (s *EdgeCallbackService) autoAck(ctx context.Context, taskID string) {
	if s.outbox == nil {
		return
	}
	// The error is already warn-logged inside the outbox; swallowing it here
	// keeps the callback contract (never fail the Edge call on a journal
	// maintenance write) unchanged.
	_ = s.outbox.AutoAckDeliveriesForTask(ctx, taskID)
}

// autoAckOnce is the per-chunk variant used by HandleTaskStream.
//
// #1000's contract is that the *first* authorized stream proves Edge received
// the task, so the ack only has to happen once per task; running it on every
// chunk (per token, in practice) meant one UPDATE that matched 0 rows forever
// after the first (#2154 P2-9). The dedupe lives in bounded process memory
// rather than a new DB column.
//
// Skipping is safe in both directions:
//   - the ack itself is idempotent (Store.UpdateByTaskID only matches
//     ActiveStatuses(), so a repeat matches 0 rows and changes nothing) —
//     which is also why a process restart emptying ackedTasks can only cause a
//     redundant 0-row UPDATE, never a missed or duplicated state change;
//   - the entry is recorded only after the outbox call returned no error, so a
//     transient failure is retried by the next chunk exactly as before.
func (s *EdgeCallbackService) autoAckOnce(ctx context.Context, taskID string) {
	if s.outbox == nil {
		return
	}
	if !s.ackedSet().addIfAbsent(taskID) {
		return
	}
	if err := s.outbox.AutoAckDeliveriesForTask(ctx, taskID); err != nil {
		// Un-record so the next chunk retries; the outbox already warn-logged.
		s.ackedSet().remove(taskID)
	}
}

// ackedSet lazily allocates the per-task ack dedupe set (sync.Once for the same
// race-safety reason as teamCtxCache).
func (s *EdgeCallbackService) ackedSet() *ackedTaskSet {
	s.ackedOnce.Do(func() {
		if s.ackedTasks == nil {
			s.ackedTasks = newAckedTaskSet(defaultStreamStateCapacity)
		}
	})
	return s.ackedTasks
}

// touchThrottler lazily allocates the per-session touch throttle.
func (s *EdgeCallbackService) touchThrottler() *sessionTouchThrottle {
	s.touchOnce.Do(func() {
		if s.touchThrottle == nil {
			s.touchThrottle = newSessionTouchThrottle(defaultStreamStateCapacity, time.Second)
		}
	})
	return s.touchThrottle
}

// now returns the current time, honoring an injected test clock.
func (s *EdgeCallbackService) now() time.Time {
	if s.clock != nil {
		return s.clock()
	}
	return time.Now()
}

// forgetTaskStreamState drops the per-task / per-session hot-path state once a
// task reaches a terminal state. task IDs are never reused, so this is memory
// hygiene rather than correctness; the session throttle entry is reset too so
// the *next* task on the same session touches last_message_at immediately
// instead of inheriting the finished task's window.
func (s *EdgeCallbackService) forgetTaskStreamState(taskID, sessionID string) {
	s.ackedSet().remove(taskID)
	s.touchThrottler().reset(sessionID)
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
	// #2274 B-1: stamp the producing task id into the projected message so the
	// transcript can offer "regenerate" with the identity the endpoint actually
	// requires (task id), instead of the shell guessing from a message id.
	messageContent = agentevent.StampAgentTaskRef(messageContent, taskID)

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

	// #154: update session last_message_at when agent stream creates a message.
	// Throttled to one write per session per second (#2154 P2-9) — the column
	// is only the conversation-list sort key, and HandleTaskDone force-touches
	// so the settled value is exact. See sessionTouchThrottle.
	s.touchSessionLastMessageThrottled(ai.SessionID)

	// #1000: first authorized stream proves Edge received the task — ack outbox
	// so SentTimeout does not redispatch while Edge is already executing.
	// After successful persist only (matches HandleTaskAck post-transition ack).
	// Deduped to the first successful ack per task (#2154 P2-9).
	s.autoAckOnce(ctx, taskID)

	s.publishStreamEvents(ctx, ai, taskID, msg, runEvent)
	s.tryAutoParseRouteDecision(ctx, ai.SessionID, taskID, eventType, runEvent.Payload)

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

// touchSessionLastMessage updates session.last_message_at unconditionally and
// clears the throttle window for that session. Used by the terminal callbacks,
// where the write happens once per task and the final value must be exact.
// Best-effort: a failure warns + increments the metric but does not fail the
// callback path.
func (s *EdgeCallbackService) touchSessionLastMessage(sessionID string) {
	// Clear first so a failed write does not leave the session suppressed for
	// the rest of the interval: the next callback is free to retry.
	s.touchThrottler().reset(sessionID)
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

// touchSessionLastMessageThrottled is the per-chunk variant: at most one
// session.last_message_at write per session per second (#2154 P2-9). The
// column only feeds the conversation-list ORDER BY
// (repository/session.go: COALESCE(last_message_at, created_at) DESC), so
// second-level precision is indistinguishable to users, while the unthrottled
// per-token write made `sessions` a dead-tuple generator and the hottest row
// lock on the stream path. See sessionTouchThrottle for the bounding and
// fail-open guarantees.
func (s *EdgeCallbackService) touchSessionLastMessageThrottled(sessionID string) {
	if !s.touchThrottler().allow(sessionID, s.now()) {
		return
	}
	if err := repository.TouchSessionLastMessage(s.db, sessionID); err != nil {
		slog.Warn("failed to touch session last_message_at",
			"session_id", sessionID,
			"error", err,
		)
		if metrics.SessionTouchFailures != nil {
			metrics.SessionTouchFailures.Inc()
		}
		// Do not leave a failed write suppressed for the rest of the window.
		s.touchThrottler().reset(sessionID)
	}
}

// tryAutoParseRouteDecision re-publishes a supervisor's flat
// {"action": ...} stream payload as the agent.route_decision bus event that
// web/mobile clients subscribe to (app/events.go). It is a pure side channel:
// it never fails the stream callback and it is not the authoritative routing
// path (that is POST /teams/:id/runs/:run_id/route-decision).
//
// #2154 P1-4 removed two per-chunk round-trips from this function without
// changing what it publishes:
//
//  1. A sound payload pre-filter. CoordinatorRouteDecision is only ever acted
//     on when Action normalizes into model.ValidActions(), and encoding/json
//     can only fill Action from a JSON key `action` (matched case-
//     insensitively). A payload that does not contain that key therefore
//     cannot produce a decision, so both the team-run SELECT and the
//     json.Unmarshal are skipped. payloadHasActionKey is the case-insensitive
//     scan that makes this exact rather than heuristic.
//
//     NOTE on event-type gating: the perf report suggested skipping whole event
//     types (text_delta / run.output.batch). That cannot be done without
//     changing behavior — the Edge callback client
//     (edge-server/internal/hub/callback.go TaskStream) sends only `content`,
//     so NormalizeRunEventInput falls back to run.output.batch for *every*
//     untyped chunk, including the supervisor's flat JSON decision that this
//     function exists to catch. Denying run.output.batch would silently drop
//     agent.route_decision frames, so the gate is placed on the payload key
//     (provably equivalent) instead of on the event type.
//
//  2. Reuse of the team-run context that publishStreamEvents already resolved
//     one line earlier. cachedTeamRunContext negative-caches "this task's
//     session has no team run" per task ID (UUIDv7, never reused), so the
//     non-team majority now costs one mutex lookup instead of one
//     GetTeamRunBySessionID per chunk. The remaining lookup for team sessions
//     is deliberately *not* cached: it re-reads run.Status, and freezing the
//     status for a task's lifetime would keep emitting route decisions after
//     the run left `running`.
func (s *EdgeCallbackService) tryAutoParseRouteDecision(ctx context.Context, sessionID, taskID, eventType, payload string) {
	if !payloadHasActionKey(payload) {
		return
	}
	// Reuse the (negative-)cached team-run verdict for this task. Only a
	// *definitive* "no team run" short-circuits: an inconclusive lookup falls
	// through to the direct read below, exactly as before caching existed, so a
	// transient DB error can never suppress a route decision.
	if lookup := s.subagentLookup(); lookup != nil {
		if _, outcome := s.cachedTeamRunContext(ctx, lookup, sessionID, taskID); outcome == teamRunLookupNoTeam {
			return
		}
	}
	run, err := repository.GetTeamRunBySessionID(s.db, sessionID)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			slog.Warn("route decision team run lookup failed",
				"session_id", sessionID, "task_id", taskID, "event_type", eventType, "error", err)
		}
		return
	}
	if run.Status != model.TeamRunStatusRunning {
		return
	}

	var decision model.CoordinatorRouteDecision
	if err := json.Unmarshal([]byte(payload), &decision); err != nil {
		slog.Debug("route decision payload did not parse",
			"session_id", sessionID, "task_id", taskID, "event_type", eventType, "error", err)
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

// routeDecisionActionKey is the JSON key that encoding/json must find before
// CoordinatorRouteDecision.Action can be non-empty.
const routeDecisionActionKey = `"action"`

// payloadHasActionKey reports whether payload contains the JSON key "action"
// in any ASCII casing.
//
// This is a *sound* pre-filter for tryAutoParseRouteDecision, not a heuristic:
// the only field the auto-parse acts on is Decision.Action (it must normalize
// into model.ValidActions()), and encoding/json can only populate it from a key
// that equals "action" under Go's case-insensitive fallback matching. A payload
// without such a key can never produce a decision, so skipping the team-run
// SELECT and the json.Unmarshal for it is exactly equivalent to running them
// and discarding the result (#2154 P1-4).
//
// The scan is case-insensitive because encoding/json's fallback matching is;
// it is written by hand instead of using strings.Contains(strings.ToLower(...))
// because a stream payload may be up to model.RunEventPayloadMaxBytes and
// lowering it would allocate a full copy on the hottest path in the Hub.
// Quote characters are compared exactly (case has no meaning for '"'), and only
// the six ASCII letters between them are folded.
func payloadHasActionKey(payload string) bool {
	const needle = routeDecisionActionKey
	n := len(needle)
	for i := 0; i < len(payload); {
		// Jump to the next possible key opening quote instead of scanning
		// every byte: strings.IndexByte is SIMD-accelerated in the stdlib.
		idx := strings.IndexByte(payload[i:], '"')
		if idx < 0 {
			return false
		}
		start := i + idx
		if start+n <= len(payload) && asciiEqualFold(payload[start:start+n], needle) {
			return true
		}
		i = start + 1
	}
	return false
}

// asciiEqualFold reports whether a and b are equal after ASCII case folding.
// Both must already be the same length. Non-ASCII bytes are compared exactly,
// which is what encoding/json does too (its fold is defined over ASCII).
func asciiEqualFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if ca >= 'A' && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if cb >= 'A' && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
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
	// #2274 B-1: same task-ref stamp as the stream projection path, so both
	// agent messages of one run carry the identity of the run that made them.
	messageContent = agentevent.StampAgentTaskRef(messageContent, task.ID)
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
	// Unconditional (not autoAckOnce): this is the terminal callback, it runs
	// once per task, and it must still pick up an active row that a transient
	// failure left un-acked during streaming.
	s.autoAck(ctx, taskID)
	// Terminal state: drop the per-task/per-session hot-path caches.
	s.forgetTaskStreamState(taskID, ai.SessionID)

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

	// Terminal state: drop the per-task/per-session hot-path caches (#2154
	// P2-9). HandleTaskFail writes neither the outbox ack nor last_message_at,
	// so this is pure memory hygiene.
	s.forgetTaskStreamState(taskID, ai.SessionID)

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
