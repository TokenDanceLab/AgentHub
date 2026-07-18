package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"github.com/agenthub/hub-server/internal/ws"
)

// dispatchPayload is a same-package alias for the pure dispatch.Payload DTO so
// edge JSON tags and redispatch unmarshaling stay stable (#789).
type dispatchPayload = dispatch.Payload

// dispatchMessage is a same-package alias for the pure dispatch.Message DTO so
// payload JSON tags and redispatch unmarshaling stay stable (#756).
type dispatchMessage = dispatch.Message

// Same-package aliases for pure dispatch DTOs (#768 residual).
// Kept for signatures + redispatch unmarshal surface (#834).
type dispatchTeamContext = dispatch.TeamContext
type dispatchTargetSnapshot = dispatch.TargetSnapshot
type pendingTaskSnapshot = dispatch.PendingTaskSnapshot

// ── DispatchService ports + type ─────────────────────────────────────────────
//
// Pure residual continue (#977) after #946 edge-http/trigger/target-bound peel,
// #902 assemble/target/redispatch-prep, #823 close + #834 alias drop, and the
// #811/#800/#789/#779/#768/#756/#732 pure helpers. Call dispatch.* directly; DTO
// type aliases retained for JSON/redispatch stability. Pure surface lives in
// service/dispatch; orchestration + ports stay flat here. Do not re-open outbox
// redispatch MarkDeliverySent semantics from #866. No OpenAPI/handler/frontend;
// no typed DispatchService package move.

// dispatchOutbox records, marks, and dead-letters delivery journal rows during
// dispatch / redispatch. Implemented by *DeliveryOutbox (AgentService facades
// also satisfy it for tests that pass *AgentService as outbox).
type dispatchOutbox interface {
	RecordDelivery(ctx context.Context, taskID, payload, edgeDeviceID string) (string, error)
	MarkDeliverySent(ctx context.Context, deliveryID string) error
	MoveDeliveryToDeadLetter(ctx context.Context, deliveryID string, lastError string) error
}

// dispatchBus publishes cancel/regenerate domain events from dispatch lifecycle.
// Implemented by *Bus.
type dispatchBus interface {
	Publish(ctx context.Context, event Event)
}

// dispatchCache is the route / offline-queue subset of agentCache used by
// DispatchService. Narrower than agentCache (no AllocateSeq) so dispatch
// composition does not depend on agent catalog/control cache surface.
// Implemented by *cache.Client and cache.NoOpCache.
type dispatchCache interface {
	GetRoute(ctx context.Context, userID, deviceType string) (string, error)
	GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error)
	PushPendingTask(ctx context.Context, userID, taskJSON string) error
	PushPendingTargetTask(ctx context.Context, userID, targetID, deviceID, taskJSON string) error
}

// dispatchWS is the WebSocket connection lookup/push port used for device-bound
// and inviter desktop dispatch. Implemented by *ws.Manager.
type dispatchWS interface {
	FindByConnID(connID string) *ws.Conn
	PushToConn(connID string, frame ws.Frame) ws.DeliveryResult
}

// DispatchService owns agent task dispatch orchestration: trigger, payload build,
// edge HTTP / WS / offline routing, capability minting, history/pins loading, and
// redispatch residual (payload unmarshal + route selection). DeliveryOutbox
// retries call in through Redispatcher; Payload DTO lives in service/dispatch
// with a thin same-package alias. Same-package extract (#563/#573/#617) + pure
// helpers in service/dispatch (#732→#977) — typed package move still deferred.
type DispatchService struct {
	db          *gorm.DB
	bus         dispatchBus
	mgr         dispatchWS
	cacheClient dispatchCache
	relay       relayDispatcher
	outbox      dispatchOutbox
}

// NewDispatchService constructs a DispatchService. bus/outbox/relay/mgr may be
// nil for partial tests; write paths that need them fail, degrade, or no-op.
func NewDispatchService(db *gorm.DB, bus dispatchBus, mgr dispatchWS, cacheClient dispatchCache, relay relayDispatcher, outbox dispatchOutbox) *DispatchService {
	return &DispatchService{
		db:          db,
		bus:         bus,
		mgr:         mgr,
		cacheClient: resolveDispatchCache(cacheClient),
		relay:       relay,
		outbox:      outbox,
	}
}

// SetOutbox injects (or replaces) the delivery outbox port.
func (s *DispatchService) SetOutbox(outbox dispatchOutbox) {
	if s == nil {
		return
	}
	s.outbox = outbox
}

// SetBus injects (or replaces) the event bus port.
func (s *DispatchService) SetBus(bus dispatchBus) {
	if s == nil {
		return
	}
	s.bus = bus
}

// SetCache injects (or replaces) the route / offline-queue cache port.
func (s *DispatchService) SetCache(cacheClient dispatchCache) {
	if s == nil {
		return
	}
	s.cacheClient = resolveDispatchCache(cacheClient)
}

// SetManager injects (or replaces) the WebSocket manager port.
func (s *DispatchService) SetManager(mgr dispatchWS) {
	if s == nil {
		return
	}
	s.mgr = mgr
}

// SetRelay injects (or replaces) the hub_relay command dispatcher port.
func (s *DispatchService) SetRelay(relay relayDispatcher) {
	if s == nil {
		return
	}
	s.relay = relay
}

// publish is a nil-safe wrapper over the bus port (cancel/regenerate events).
func (s *DispatchService) publish(ctx context.Context, event Event) {
	if !dispatch.BusPortAvailable(s != nil, s != nil && s.bus != nil) {
		return
	}
	s.bus.Publish(ctx, event)
}

// cachePort is a nil-safe accessor for the route / offline-queue cache port.
func (s *DispatchService) cachePort() dispatchCache {
	if s == nil {
		return resolveDispatchCache(nil)
	}
	return resolveDispatchCache(s.cacheClient)
}

// recordDelivery is a nil-safe wrapper over the outbox port.
func (s *DispatchService) recordDelivery(ctx context.Context, taskID, payload, edgeDeviceID string) (string, error) {
	if !dispatch.OutboxPortAvailable(s != nil, s != nil && s.outbox != nil) {
		return "", dispatch.ErrOutboxUnavailable()
	}
	return s.outbox.RecordDelivery(ctx, taskID, payload, edgeDeviceID)
}

// markDeliverySent is a nil-safe wrapper over the outbox port.
func (s *DispatchService) markDeliverySent(ctx context.Context, deliveryID string) error {
	if !dispatch.OutboxPortAvailable(s != nil, s != nil && s.outbox != nil) {
		return dispatch.ErrOutboxUnavailable()
	}
	return s.outbox.MarkDeliverySent(ctx, deliveryID)
}

// moveDeliveryToDeadLetter is a nil-safe wrapper over the outbox port used by redispatch.
func (s *DispatchService) moveDeliveryToDeadLetter(ctx context.Context, deliveryID, lastError string) {
	if !dispatch.OutboxPortAvailable(s != nil, s != nil && s.outbox != nil) {
		return
	}
	_ = s.outbox.MoveDeliveryToDeadLetter(ctx, deliveryID, lastError)
}

// dispatchToEdgeHTTP attempts to dispatch a task directly via HTTP POST to a
// local Edge server. Returns the Edge run ID on success, or empty string if
// the Edge server is unreachable or returns an error.
func (s *DispatchService) dispatchToEdgeHTTP(ctx context.Context, task *model.PendingAgentTask, dp *dispatchPayload) string {
	// Pure Edge HTTP prep (#946); client/request side-effects stay here.
	parts, insecure, err := dispatch.PrepareEdgeHTTPRequest(
		os.Getenv("AGENTHUB_EDGE_URL"),
		os.Getenv("AGENTHUB_EDGE_AUTH_TOKEN"),
		dp.Prompt,
		dp.AgentType,
		dp.SystemPrompt,
		task.ID,
		dp.DeliveryID,
		dp.Messages,
		dp.PinnedMessages,
		dp.OutputSchema,
		s.issueRunStartCapability(dp),
	)
	if insecure {
		// AH-SR-053: non-loopback cleartext rejected.
		slog.Error(dispatch.EdgeHTTPLogInsecureCleartext, "edge_url", parts.EdgeURL)
		return ""
	}
	if err != nil {
		slog.Error(dispatch.EdgeHTTPLogMarshalFailed, "task_id", task.ID, "error", err)
		return ""
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, parts.RunsURL, bytes.NewReader(parts.Body))
	if err != nil {
		slog.Error(dispatch.EdgeHTTPLogCreateReqFailed, "task_id", task.ID, "error", err)
		return ""
	}
	httpReq.Header = parts.Headers

	client := &http.Client{Timeout: parts.Timeout}
	resp, err := client.Do(httpReq)
	if err != nil {
		slog.Debug(dispatch.EdgeHTTPLogUnreachable, "task_id", task.ID, "url", parts.RunsURL, "error", err)
		return ""
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, dispatch.EdgeHTTPResponseBodyLimit))
	runID, nonSuccess, decodeErr := dispatch.EdgeHTTPDispatchResult(resp.StatusCode, respBody)
	if nonSuccess {
		slog.Warn(dispatch.EdgeHTTPLogNonSuccess, "task_id", task.ID, "status", resp.StatusCode, "body", string(respBody))
		return ""
	}
	if decodeErr != nil {
		slog.Warn(dispatch.EdgeHTTPLogDecodeFailed, "task_id", task.ID, "error", decodeErr)
		return ""
	}
	slog.Info(dispatch.EdgeHTTPLogDispatched, "task_id", task.ID, "edge_run_id", runID, "url", parts.RunsURL)
	return runID
}

// TriggerAgentTask creates a pending task for an agent and dispatches it to the inviter's edge.
func (s *DispatchService) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	msg, err := repository.GetMessageByID(s.db, triggerMessageID)
	if err := dispatch.MapTriggerMessageLookupError(err); err != nil {
		return nil, err
	}

	// #116: reject new agent tasks for dissolved sessions
	session, err := repository.GetSessionByID(s.db, msg.SessionID)
	if err := dispatch.MapSessionLookupError(err); err != nil {
		return nil, err
	}
	if err := dispatch.TriggerSessionDissolvedError(session.Dissolved); err != nil {
		return nil, err
	}

	// find agent instances in this session invited by this user
	agents, err := repository.ListAgentInstancesByInviter(s.db, msg.SessionID, userID)
	if err := dispatch.TriggerAgentsAvailableError(err, len(agents)); err != nil {
		return nil, err
	}
	ai, err := dispatch.SelectAgentInstance(agents, targetAgentInstanceID, targetAgentType, targetCustomAgentID)
	if err != nil {
		return nil, err
	}

	// check for active member
	active, _ := repository.IsMemberActive(s.db, ai.SessionID, model.MemberTypeUser, userID)
	if err := dispatch.TriggerMemberActiveError(active); err != nil {
		return nil, err
	}

	dispatchTarget, err := s.validateDispatchTarget(ctx, userID, targetID)
	if err != nil {
		return nil, err
	}
	targetID, targetType, edgeDeviceID := dispatch.ApplyValidatedTarget(dispatchTarget)

	task := dispatch.NewQueuedPendingTask(
		ai.ID, userID, triggerMessageID, targetID, edgeDeviceID,
		time.Now().Add(config.PendingTaskTTL),
	)
	if err := repository.CreatePendingTask(s.db, task); err != nil {
		return nil, err
	}

	// Pre-query the CustomAgent to avoid a DB query inside the dispatch goroutine.
	var customAgent *model.CustomAgent
	if dispatch.NeedsCustomAgentPreload(ai.CustomAgentID) {
		ca, err := repository.GetCustomAgentByID(s.db, dispatch.CustomAgentIDValue(ai.CustomAgentID))
		customAgent = dispatch.CustomAgentPreloadOrNil(err, ca)
	}

	// #100: Use context.WithoutCancel so the dispatch goroutine is not
	// cancelled when the HTTP handler's request context is cancelled.
	go s.dispatchTask(context.WithoutCancel(ctx), task, ai, dispatch.PromptFromMessage(msg), modelParams, targetType, customAgent)

	return task, nil
}

func (s *DispatchService) validateDispatchTarget(ctx context.Context, userID, targetID string) (*dispatchTargetSnapshot, error) {
	targetID = dispatch.NormalizeOptionalTargetID(targetID)
	if dispatch.IsEmptyTargetID(targetID) {
		return nil, nil
	}
	target, err := repository.GetExecutionTargetByID(s.db.WithContext(ctx), targetID)
	if err := dispatch.MapTargetLookupError(err, errors.Is(err, gorm.ErrRecordNotFound)); err != nil {
		return nil, err
	}
	// Pure ownership / type / health / binding checks (#768/#902) — order matches
	// prior behavior so error precedence stays stable.
	healthState := resolveExecutionTargetHealthState(target, time.Now())
	if err := dispatch.PreDeviceTargetValidation(target.OwnerID, userID, target.TargetType, healthState); err != nil {
		return nil, err
	}
	deviceID, err := dispatch.BoundDeviceID(target.DeviceID)
	if err != nil {
		return nil, err
	}
	device, err := repository.GetDeviceByID(s.db.WithContext(ctx), deviceID)
	if err := dispatch.MapBoundDeviceLookupError(err, errors.Is(err, gorm.ErrRecordNotFound)); err != nil {
		return nil, err
	}
	if err := dispatch.PostDeviceTargetValidation(userID, device.UserID, device.DeviceType); err != nil {
		return nil, err
	}
	return dispatch.NewTargetSnapshot(target.ID, target.TargetType, deviceID), nil
}

func (s *DispatchService) dispatchTask(ctx context.Context, task *model.PendingAgentTask, ai *model.AgentInstance, prompt, modelParams, targetType string, customAgent *model.CustomAgent) {
	// Pure payload assembly (#902); history loaders stay orchestration-side.
	dp := dispatch.AssembleDispatchPayload(dispatch.AssemblePayloadInput{
		TaskID:           task.ID,
		AgentInstanceID:  ai.ID,
		AgentType:        ai.AgentType,
		TargetID:         task.TargetID,
		EdgeDeviceID:     task.EdgeDeviceID,
		SessionID:        ai.SessionID,
		TriggerMessageID: task.TriggerMessageID,
		TriggerUserID:    task.TriggeredByUserID,
		Prompt:           prompt,
		DisplayName:      ai.DisplayName,
		CustomAgentID:    dispatch.CustomAgentIDValue(ai.CustomAgentID),
		CustomFields:     dispatch.CustomAgentFieldsFromModel(customAgent),
		ModelParams:      modelParams,
		Team:             s.resolveDispatchTeamContext(ai),
		Messages:         s.loadThreadHistory(ai.SessionID, task.TriggerMessageID),
		PinnedMessages:   s.loadPinnedMessages(ai.SessionID),
	})

	// Record delivery in outbox before dispatching (AH-SR-049).
	payload, _ := dispatch.MarshalPayload(dp)
	deliveryID, err := s.recordDelivery(ctx, task.ID, string(payload), task.EdgeDeviceID)
	if err != nil {
		// Still dispatch for availability, but durability is degraded until outbox is healthy.
		slog.Error("AH-SR-049 delivery outbox record failed; dispatch continues without durable tracking",
			"task_id", task.ID, "edge_device_id", task.EdgeDeviceID, "error", err)
	} else {
		// Re-serialize with delivery_id included (pure finalize #811/#902).
		dp, payload = dispatch.FinalizeAfterDeliveryRecord(dp, deliveryID)
	}

	// Primary route classification is pure (#800); side-effects stay here.
	route := dispatch.ClassifyPrimaryDispatchRoute(
		task.TargetID, targetType, task.EdgeDeviceID, s.relay != nil,
	)
	cacheClient := s.cachePort()

	switch route {
	case dispatch.RouteHTTP:
		// Try HTTP direct dispatch to local Edge first for unbound tasks.
		if dispatch.IsHTTPEdgeDispatchSuccess(s.dispatchToEdgeHTTP(ctx, task, &dp)) {
			if err := repository.UpdatePendingTaskDispatched(s.db, task.ID, dispatch.SyntheticHTTPEdgeDeviceID); err != nil {
				slog.Error("failed to mark http-dispatched task", "task_id", task.ID, "error", err)
			}
			if dispatch.DeliveryMarkAfterDispatch(deliveryID) {
				_ = s.markDeliverySent(ctx, deliveryID)
			}
			return
		}
		// HTTP miss: fall through to inviter desktop / offline.
		connID, err := cacheClient.GetRoute(ctx, ai.InviterUserID, dispatch.DesktopDeviceType)
		if dispatch.ClassifyUnboundFallbackRoute(connID, dispatch.ManagerPortAvailable(s.mgr != nil), err) == dispatch.RouteInviterDesktop {
			conn := s.mgr.FindByConnID(connID)
			if conn == nil {
				if err := cacheClient.PushPendingTask(ctx, ai.InviterUserID, string(payload)); err != nil {
					slog.Error("failed to push agent task to offline queue (conn nil)", "task_id", task.ID, "user_id", ai.InviterUserID, "error", err)
				}
				if dispatch.DeliveryMarkAfterDispatch(deliveryID) {
					_ = s.markDeliverySent(ctx, deliveryID)
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
			if dispatch.DeliveryMarkAfterDispatch(deliveryID) {
				_ = s.markDeliverySent(ctx, deliveryID)
			}
			return
		}
		if err := cacheClient.PushPendingTask(ctx, ai.InviterUserID, string(payload)); err != nil {
			slog.Error("failed to push agent task to offline queue", "task_id", task.ID, "user_id", ai.InviterUserID, "error", err)
		}
		if dispatch.DeliveryMarkAfterDispatch(deliveryID) {
			_ = s.markDeliverySent(ctx, deliveryID)
		}
		return

	case dispatch.RouteMissingEdge:
		slog.Error("target-bound agent task missing edge device id", "task_id", task.ID, "user_id", ai.InviterUserID, "target_id", task.TargetID)
		return

	case dispatch.RouteHubRelay:
		// hub_relay uses the relay service; failures fall back to offline target queue.
		_, err := s.relay.CreateCommand(ctx, ai.InviterUserID, dispatch.AgentDispatchRelayCommand, json.RawMessage(payload), ai.InviterUserID)
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
		if dispatch.DeliveryMarkAfterDispatch(deliveryID) {
			_ = s.markDeliverySent(ctx, deliveryID)
		}
		return

	case dispatch.RouteTargetBound:
		// local_edge / remote_ssh / cloud_edge / tailscale / hub_relay without relay.
		s.dispatchTargetBoundTask(ctx, cacheClient, task, ai.InviterUserID, task.EdgeDeviceID, payload)
		if dispatch.DeliveryMarkAfterDispatch(deliveryID) {
			_ = s.markDeliverySent(ctx, deliveryID)
		}
		return
	}
}

func (s *DispatchService) resolveDispatchTeamContext(ai *model.AgentInstance) dispatchTeamContext {
	var customAgentID *string
	if ai != nil {
		customAgentID = ai.CustomAgentID
	}
	if !dispatch.TeamContextResolutionReady(s != nil, s != nil && s.db != nil, ai != nil, customAgentID) {
		return dispatch.EmptyTeamContext()
	}
	run, err := repository.GetTeamRunBySessionID(s.db, ai.SessionID)
	runID := ""
	if run != nil {
		runID = run.ID
	}
	if !dispatch.TeamRunLoadable(err, run != nil, runID) {
		return dispatch.EmptyTeamContext()
	}
	members, err := repository.ListTeamMembers(s.db, run.TeamID)
	if !dispatch.TeamMembersPresent(err) {
		return dispatch.EmptyTeamContext()
	}
	refs := dispatch.TeamMemberRefsFromMembers(members)
	return dispatch.MatchTeamContext(run.TeamID, run.ID, dispatch.CustomAgentIDValue(ai.CustomAgentID), refs)
}

// loadThreadHistory loads recent thread messages (before the trigger message) for context continuity.
// Limits to dispatch.MaxThreadHistory messages to avoid oversized dispatch payloads.
func (s *DispatchService) loadThreadHistory(sessionID, triggerMessageID string) []dispatchMessage {
	if !dispatch.HistoryLoadIDs(sessionID, triggerMessageID) {
		return nil
	}
	triggerMsg, err := repository.GetMessageByID(s.db, triggerMessageID)
	if !dispatch.HistoryTriggerMessageLoadable(err, triggerMsg != nil) {
		return nil
	}
	msgs, err := repository.GetMessagesBySession(s.db, sessionID, triggerMsg.SeqID, dispatch.MaxThreadHistory)
	if !dispatch.HistoryMessagesPresent(err, len(msgs)) {
		return nil
	}
	// Reverse to chronological order (GetMessagesBySession returns DESC) via pure mapper (#756).
	return dispatch.MapMessagesChronological(msgs, true)
}

// loadPinnedMessages loads pinned messages for a session for context continuity.
func (s *DispatchService) loadPinnedMessages(sessionID string) []dispatchMessage {
	if !dispatch.ShouldLoadPinnedMessages(sessionID) {
		return nil
	}
	pins, err := repository.ListPinsBySession(s.db, sessionID)
	if !dispatch.PinnedRowsPresent(err, len(pins)) {
		return nil
	}
	messageIDs := dispatch.PinMessageIDsFromModels(pins)
	msgs, err := repository.GetMessagesByIDs(s.db, messageIDs)
	if !dispatch.PinMessagesLoadable(err) {
		return nil
	}
	return dispatch.MapPinnedMessages(msgs)
}

func (s *DispatchService) dispatchTargetBoundTask(ctx context.Context, cacheClient dispatchCache, task *model.PendingAgentTask, userID, deviceID string, payload []byte) {
	queueTargetTask := func(reason string, err error) {
		if pushErr := cacheClient.PushPendingTargetTask(ctx, userID, task.TargetID, deviceID, string(payload)); pushErr != nil {
			slog.Error("failed to push target-bound agent task to offline queue", "task_id", task.ID, "user_id", userID, "target_id", task.TargetID, "device_id", deviceID, "reason", reason, "error", pushErr)
			return
		}
		if err != nil {
			slog.Info("queued target-bound agent task", "task_id", task.ID, "user_id", userID, "target_id", task.TargetID, "device_id", deviceID, "reason", reason, "error", err)
		}
	}

	connID, err := cacheClient.GetRouteForDevice(ctx, userID, dispatch.DesktopDeviceType, deviceID)
	if dispatch.TargetBoundRouteUnavailable(err, connID, dispatch.ManagerPortAvailable(s.mgr != nil)) {
		queueTargetTask(dispatch.TargetBoundReasonRouteUnavailable, err)
		return
	}
	conn := s.mgr.FindByConnID(connID)
	if conn == nil || !dispatch.IsTargetBoundConnUsable(true, conn.UserID, conn.DeviceType, conn.DeviceID, userID, deviceID) {
		queueTargetTask(dispatch.TargetBoundReasonConnMismatch, nil)
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
		queueTargetTask(dispatch.TargetBoundReasonWSNotQueued, result.Err)
	}
}

// CancelTask cancels a pending task by its ID.
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
// Returns empty string when secret/device are unavailable so local/dev dispatch still works.
func (s *DispatchService) issueRunStartCapability(dp *dispatchPayload) string {
	if dp == nil {
		return ""
	}
	resolved := dispatch.CapabilityMintFromEnv(
		os.Getenv("AGENTHUB_JWT_SECRET"),
		dp.EdgeDeviceID,
		os.Getenv("AGENTHUB_EDGE_DEVICE_ID"),
		dp.TriggerUserID,
		dp.TargetID,
	)
	if !dispatch.ShouldIssueCapabilityToken(resolved) {
		return ""
	}
	// Edge HTTP dispatch currently uses LocalProjectID / LocalThreadID; keep capability bindings aligned.
	args := dispatch.CapabilityTokenArgs(resolved)
	token, err := jwtutil.IssueCapabilityToken(
		args.Secret,
		args.UserID,
		args.DeviceID,
		args.ProjectID,
		args.Action,
		args.TTL,
		jwtutil.CapabilityIssueOptions{
			Action:   args.Action,
			TargetID: args.TargetID,
			ThreadID: args.ThreadID,
		},
	)
	if err != nil {
		slog.Warn("AH-SR-046 failed to issue capability token", "error", err, "device_id", args.DeviceID)
		return ""
	}
	return token
}

// ── Redispatch residual (moved from AgentService in #573) ────────────────────

// redispatchDelivery re-dispatches a delivery by parsing the stored payload
// and routing it to the target Edge device. Pure JSON prep is in dispatch
// (#800); dead-letter + routing stay here. Accepts redispatchTarget only —
// never the private GORM row type.
//
// Returns nil on successful route (HTTP / WS / offline queue) and on
// intentional dead-letter (already terminal). Soft route failures return
// an error so DeliveryOutbox.retryDeliveries does not MarkDeliverySent (#999).
func (s *DispatchService) redispatchDelivery(ctx context.Context, rec redispatchTarget) error {
	dp, newPayload, err := dispatch.PrepareRedispatchPayload(rec.Payload, rec.DeliveryID)
	if err != nil {
		kind, unwrap := dispatch.RedispatchPrepFailure(err)
		slog.Error(dispatch.RedispatchPrepLogMessage(kind),
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
			"error", err,
		)
		s.moveDeliveryToDeadLetter(ctx, rec.DeliveryID, dispatch.DeadLetterReason(kind, unwrap))
		return nil
	}

	// Look up the task for dispatch routing.
	task, err := s.getPendingTaskForRedelivery(ctx, rec.TaskID)
	if err != nil {
		slog.Warn(dispatch.RedispatchLogTaskLookupFailed,
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
			"error", err,
		)
		s.moveDeliveryToDeadLetter(ctx, rec.DeliveryID, dispatch.DeadLetterReason(dispatch.DeadLetterKindTaskLookup, err))
		return nil
	}

	// Only retry if task is still in a retryable state.
	if !dispatch.IsRetryableTaskStatus(task.Status) {
		slog.Info(dispatch.RedispatchLogTaskTerminal,
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
			"task_status", task.Status,
		)
		s.moveDeliveryToDeadLetter(ctx, rec.DeliveryID, dispatch.DeadLetterTaskStatus(task.Status))
		return nil
	}

	// Re-dispatch via HTTP (if local Edge) or WebSocket / offline queue.
	return s.retryDispatchToTarget(ctx, task, dp, newPayload, rec)
}

// getPendingTaskForRedelivery looks up a task for redelivery purposes.
func (s *DispatchService) getPendingTaskForRedelivery(ctx context.Context, taskID string) (*pendingTaskSnapshot, error) {
	var task struct {
		ID                string
		AgentInstanceID   string
		TriggeredByUserID string
		Status            string
		EdgeDeviceID      string
		EdgeRunID         string
		TargetID          string
	}
	err := s.db.WithContext(ctx).
		Table("pending_agent_tasks").
		Select(dispatch.PendingTaskRedeliverySelect).
		Where("id = ?", taskID).
		First(&task).Error
	if err != nil {
		return nil, err
	}
	snap := dispatch.NewPendingTaskSnapshot(
		task.ID,
		task.AgentInstanceID,
		task.TriggeredByUserID,
		task.Status,
		task.EdgeDeviceID,
		task.EdgeRunID,
		task.TargetID,
	)
	return &snap, nil
}

// retryDispatchToTarget re-dispatches a delivery to the target Edge device.
// rec is a redispatchTarget (opaque payload fields only), not the GORM model.
// Primary / connection route classification is pure (#811/#902); WS/HTTP/offline
// side-effects stay here. Outbox MarkDeliverySent after success remains on the
// DeliveryOutbox RedispatchDelivery path (#866) — not reopened here.
// Soft offline-queue failures return an error so callers do not false-mark sent (#999).
func (s *DispatchService) retryDispatchToTarget(ctx context.Context, task *pendingTaskSnapshot, dp dispatchPayload, newPayload []byte, rec redispatchTarget) error {
	minimalTask := dispatch.MinimalPendingTaskForHTTP(*task)
	preferDevice := dispatch.PreferDeviceBoundRedelivery(task.EdgeDeviceID)

	if dispatch.ClassifyRedeliveryPrimaryRoute(task.TargetID, task.EdgeDeviceID) == dispatch.RouteHTTP {
		if edgeRunID := s.dispatchToEdgeHTTP(ctx, minimalTask, &dp); dispatch.IsHTTPEdgeDispatchSuccess(edgeRunID) {
			slog.Info(dispatch.RedispatchLogHTTPSucceeded,
				"delivery_id", rec.DeliveryID, "task_id", rec.TaskID, "edge_run_id", edgeRunID)
			return nil
		}
	}

	cacheClient := s.cachePort()
	var connID string
	var routeErr error
	if preferDevice {
		connID, routeErr = cacheClient.GetRouteForDevice(ctx, task.TriggeredByUserID, dispatch.DesktopDeviceType, task.EdgeDeviceID)
	} else {
		connID, routeErr = cacheClient.GetRoute(ctx, task.TriggeredByUserID, dispatch.DesktopDeviceType)
	}

	facts := dispatch.RedeliveryConnFacts{}
	if dispatch.CanPushInviterDesktop(connID, dispatch.ManagerPortAvailable(s.mgr != nil), routeErr) {
		if conn := s.mgr.FindByConnID(connID); conn != nil {
			facts = dispatch.ObserveRedeliveryConn(true, conn.UserID, task.TriggeredByUserID)
		}
	}

	switch dispatch.ClassifyRedeliveryRoute(preferDevice, connID, dispatch.ManagerPortAvailable(s.mgr != nil), routeErr, facts.ConnFound, facts.ConnUserMatch) {
	case dispatch.RouteTargetBound:
		result := s.mgr.PushToConn(connID, ws.NewFrame(ws.TypeAgentDispatch, json.RawMessage(newPayload)))
		if dispatch.RedeliveryWSPushSucceeded(result.Queued) {
			slog.Info(dispatch.RedispatchLogWSSucceeded,
				"delivery_id", rec.DeliveryID, "task_id", rec.TaskID, "device_id", task.EdgeDeviceID)
			return nil
		}
		slog.Warn(dispatch.RedispatchLogWSNotQueued,
			"delivery_id", rec.DeliveryID, "task_id", rec.TaskID,
			"delivery_status", result.Status, "error", result.Err)
	case dispatch.RouteInviterDesktop:
		result := s.mgr.PushToConn(connID, ws.NewFrame(ws.TypeAgentDispatch, json.RawMessage(newPayload)))
		if dispatch.RedeliveryWSPushSucceeded(result.Queued) {
			slog.Info(dispatch.RedispatchLogWSFallbackSucceeded,
				"delivery_id", rec.DeliveryID, "task_id", rec.TaskID)
			return nil
		}
	}

	if err := cacheClient.PushPendingTask(ctx, task.TriggeredByUserID, string(newPayload)); err != nil {
		slog.Error(dispatch.RedispatchOfflinePushFailedLogMessage(preferDevice),
			"delivery_id", rec.DeliveryID, "task_id", rec.TaskID, "error", err)
		return fmt.Errorf("redispatch offline queue: %w", err)
	}
	if dispatch.RedispatchOfflineSuccessIncludesUserID(preferDevice) {
		slog.Info(dispatch.RedispatchOfflineSuccessLogMessage(preferDevice),
			"delivery_id", rec.DeliveryID, "task_id", rec.TaskID, "user_id", task.TriggeredByUserID)
	} else {
		slog.Info(dispatch.RedispatchOfflineSuccessLogMessage(preferDevice),
			"delivery_id", rec.DeliveryID, "task_id", rec.TaskID)
	}
	return nil
}

// ── AgentService facade (wiring/handler stability) ───────────────────────────

// dispatchService returns the composed DispatchService, lazily constructing one
// from AgentService deps when tests use struct literals without NewAgentService.
func (s *AgentService) dispatchService() *DispatchService {
	if s.dispatch != nil {
		return s.dispatch
	}
	return NewDispatchService(s.db, s.bus, s.mgr, s.cacheClient, s.relay, s.deliveryOutboxService())
}

// TriggerAgentTask creates a pending task for an agent and dispatches it to the inviter's edge.
func (s *AgentService) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	return s.dispatchService().TriggerAgentTask(ctx, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID)
}

// CancelTask cancels a pending task by its ID.
func (s *AgentService) CancelTask(ctx context.Context, userID, taskID string) error {
	return s.dispatchService().CancelTask(ctx, userID, taskID)
}

// RegenerateAgentTask creates a new task using the same prompt as an existing task.
func (s *AgentService) RegenerateAgentTask(ctx context.Context, userID, taskID string) (*model.PendingAgentTask, error) {
	return s.dispatchService().RegenerateAgentTask(ctx, userID, taskID)
}
