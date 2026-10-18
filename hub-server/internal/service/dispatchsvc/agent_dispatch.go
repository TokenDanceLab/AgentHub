package dispatchsvc

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"github.com/agenthub/pkg/safego"
)

// dispatchSemaphoreCapacity bounds concurrent dispatchTask goroutines launched
// by TriggerAgentTask. It is intentionally generous so that normal load never
// backs off, while a dispatch storm cannot exhaust goroutines/connections.
const dispatchSemaphoreCapacity = 64

// launchDispatchTask starts dispatchTask on a bounded goroutine. It performs a
// non-blocking acquire on s.dispatchSem: when at capacity it does NOT spawn a
// new goroutine and instead leaves the already-persisted queued task for the
// TTL/redispatch path. This bounds live dispatchTask goroutines to the
// semaphore capacity. The goroutine releases the slot before returning.
func (s *DispatchService) launchDispatchTask(ctx context.Context, task *model.PendingAgentTask, ai *model.AgentInstance, prompt, modelParams, targetType string, customAgent *model.CustomAgent) {
	if s.dispatchSem == nil {
		// Unsupported partial construction: keep the historical unbounded
		// launch instead of dropping the queued task on a nil channel.
		safego.SafeGo("dispatch.launch", func() {
			s.DispatchTask(ctx, task, ai, prompt, modelParams, targetType, customAgent)
		})
		return
	}
	select {
	case s.dispatchSem <- struct{}{}:
	default:
		// Semaphore full: back off. The task is already persisted as queued;
		// the TTL sweeper / redispatch path will pick it up. Avoid spawning
		// another goroutine that would only block on the semaphore.
		slog.Warn(dispatch.DispatchLogSemaphoreFull,
			"task_id", task.ID, "agent_instance_id", ai.ID, "capacity", dispatchSemaphoreCapacity)
		return
	}
	safego.SafeGo("dispatch.launch", func() {
		defer func() { <-s.dispatchSem }()
		s.DispatchTask(ctx, task, ai, prompt, modelParams, targetType, customAgent)
	})
}

// dispatchToEdgeHTTP POSTs a task to local Edge /v1/runs. Returns Edge run ID on
// success, or empty string when unreachable / rejected / decode fails.
func (s *DispatchService) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	msg, err := repository.GetMessageByID(s.db, triggerMessageID)
	if err := dispatch.MapTriggerMessageLookupError(err, errors.Is(err, gorm.ErrRecordNotFound)); err != nil {
		return nil, err
	}

	// Reject new agent tasks for dissolved sessions.
	session, err := repository.GetSessionByID(s.db, msg.SessionID)
	if err := dispatch.MapSessionLookupError(err, errors.Is(err, gorm.ErrRecordNotFound)); err != nil {
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

	// check for active member — a lookup failure must surface, not read as inactive.
	active, err := repository.IsMemberActive(s.db, ai.SessionID, model.MemberTypeUser, userID)
	if err := dispatch.TriggerMemberActiveError(err, active); err != nil {
		s.recordDispatchAudit(ctx, auditActionTaskDispatch, "", userID, auditOutcomeDenied, "member not active")
		return nil, err
	}

	dispatchTarget, err := s.validateDispatchTarget(ctx, userID, targetID)
	if err != nil {
		return nil, err
	}
	targetID, targetType, edgeDeviceID := dispatch.ApplyValidatedTarget(dispatchTarget)

	// Pre-query the CustomAgent to avoid a DB query inside the dispatch goroutine.
	// A missing row is best-effort: deleting a custom agent soft-deletes it
	// without clearing existing AgentInstance bindings, so failing closed here
	// would permanently block those instances.
	var customAgent *model.CustomAgent
	if id := dispatch.CustomAgentIDValue(ai.CustomAgentID); id != "" {
		ca, loadErr := repository.GetCustomAgentByID(s.db, id)
		switch {
		case loadErr == nil:
			customAgent = ca
		case errors.Is(loadErr, gorm.ErrRecordNotFound):
			slog.Warn(dispatch.DispatchLogCustomAgentUnavailable, "agent_instance_id", ai.ID, "custom_agent_id", id)
		default:
			return nil, loadErr
		}
	}

	task := dispatch.NewQueuedPendingTask(
		ai.ID, userID, triggerMessageID, targetID, edgeDeviceID,
		time.Now().Add(config.PendingTaskTTL),
	)
	task.ModelParams = modelParams
	// #1430: per-agent_instance TurnInProgress gate. Rejects a second concurrent
	// trigger while one task is non-terminal (queued/dispatched/running). The
	// check-then-create runs inside a transaction with a row lock so concurrent
	// triggers for the same agent_instance serialize; the already-persisted
	// trigger message is not rolled back (IM model — SendMessage is independent).
	created, createErr := repository.CreatePendingTaskUnlessActive(s.db, task)
	if err := dispatch.TurnInProgressError(createErr, errors.Is(createErr, repository.ErrTurnInProgressActive)); err != nil {
		return nil, err
	}
	task = created

	// #100: Use context.WithoutCancel so the dispatch goroutine is not
	// cancelled when the HTTP handler's request context is cancelled.
	// launchDispatchTask bounds concurrent dispatch goroutines via
	// dispatchSem; on backoff the already-queued task is left for the
	// TTL/redispatch path instead of spawning an unbounded goroutine.
	s.launchDispatchTask(context.WithoutCancel(ctx), task, ai, dispatch.PromptFromMessage(msg), modelParams, targetType, customAgent)

	s.recordDispatchAudit(ctx, auditActionTaskDispatch, task.ID, userID, auditOutcomeSuccess, "")
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
	// prior behavior so error precedence stays stable. Health is projected from
	// the same evidence the API uses (#1544), so scheduling and UI agree.
	evidence, err := repository.GetExecutionTargetEvidence(s.db.WithContext(ctx), target.ID)
	if err != nil && !repository.IsEvidenceNotFound(err) {
		return nil, err
	}
	healthState := dispatch.ResolveExecutionTargetHealthState(target, evidence, time.Now())
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

// DispatchTask runs the full dispatch orchestration for an already-persisted
// queued task: payload assembly, outbox record, route classification, and
// delivery (HTTP / WS / offline / relay). Exported so the AgentService
// facade and the service-level integration tests can drive it directly.
func (s *DispatchService) DispatchTask(ctx context.Context, task *model.PendingAgentTask, ai *model.AgentInstance, prompt, modelParams, targetType string, customAgent *model.CustomAgent) {
	// Payload assembly is pure; history loaders stay orchestration-side.
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

	// Record delivery in outbox before dispatching.
	payload, err := dispatch.MarshalPayload(dp)
	if err != nil {
		// A payload that cannot serialize cannot be dispatched on any route and
		// must not produce a corrupt outbox record; the task stays queued until TTL.
		slog.Error(dispatch.DispatchLogPayloadMarshalFailed,
			"task_id", task.ID, "edge_device_id", task.EdgeDeviceID, "error", err)
		return
	}
	deliveryID, err := s.recordDelivery(ctx, task.ID, string(payload), task.EdgeDeviceID)
	if err != nil {
		// Still dispatch for availability, but durability is degraded until outbox is healthy.
		slog.Error(dispatch.DispatchLogOutboxRecordFailed,
			"task_id", task.ID, "edge_device_id", task.EdgeDeviceID, "error", err)
	} else {
		// Re-serialize with delivery_id included (pure finalize #811/#902).
		dp, payload = dispatch.FinalizeAfterDeliveryRecord(dp, deliveryID)
	}

	// Primary route classification is pure (#800); side-effects stay here.
	route := dispatch.ClassifyPrimaryDispatchRoute(
		task.TargetID, targetType, task.EdgeDeviceID, s.relay != nil,
	)
	cacheClient := s.cacheClient

	switch route {
	case dispatch.RouteHTTP:
		// Try HTTP direct dispatch to local Edge first for unbound tasks;
		// misses fall through to inviter desktop / offline.
		s.dispatchRouteHTTP(ctx, task, ai, &dp, payload, deliveryID, cacheClient)
	case dispatch.RouteMissingEdge:
		slog.Error(dispatch.DispatchLogMissingTargetEdgeDevice, "task_id", task.ID, "user_id", ai.InviterUserID, "target_id", task.TargetID)
	case dispatch.RouteHubRelay:
		s.dispatchRouteHubRelay(ctx, task, ai, payload, deliveryID, cacheClient)
	case dispatch.RouteTargetBound:
		s.dispatchRouteTargetBound(ctx, task, ai, payload, deliveryID, cacheClient)
	}
}

// dispatchRouteHTTP first tries the HTTP direct path to the local Edge
// instance; on a miss it falls back to the inviter desktop connection or the
// offline target queue (exactly the previous inline route branch).
func (s *DispatchService) dispatchRouteHTTP(ctx context.Context, task *model.PendingAgentTask, ai *model.AgentInstance, dp *dispatchPayload, payload []byte, deliveryID string, cacheClient dispatchCache) {
	result := s.dispatchToEdgeHTTP(ctx, task, dp)
	if result.RunID != "" {
		if err := repository.RecordPendingTaskDirectReceipt(s.db, task.ID, task.EdgeDeviceID, result.RunID); err != nil {
			slog.Error(dispatch.DispatchLogHTTPMarkFailed, "task_id", task.ID, "error", err)
			return
		}
		task.EdgeRunID = result.RunID
		if result.CallbackOwner == "edge" {
			s.markDeliverySentIfLive(ctx, deliveryID, task.ID)
			return
		}
		// The original run belongs to Desktop. Restore only that device's
		// bridge, never the inviter's other connected executor.
		boundPayload, err := dispatch.MarshalPayload(*dp)
		if err != nil {
			slog.Error(dispatch.DispatchLogPayloadMarshalFailed, "task_id", task.ID, "error", err)
			return
		}
		s.dispatchRouteTargetBound(ctx, task, ai, boundPayload, deliveryID, cacheClient)
		return
	}
	if !result.SafeToFallback {
		return // uncertain admission retains its durable device reservation
	}
	// No execution was attempted and no device was reserved; normal fallback.
	connID, err := cacheClient.GetRoute(ctx, ai.InviterUserID, dispatch.DesktopDeviceType)
	if dispatch.ClassifyUnboundFallbackRoute(connID, s.mgr != nil, err) == dispatch.RouteInviterDesktop {
		s.dispatchUnboundInviterDesktop(ctx, task, ai, payload, deliveryID, connID, cacheClient)
		return
	}
	s.pushPendingTaskOffline(ctx, ai.InviterUserID, task.ID, payload, "unbound_only", dispatch.DispatchLogOfflinePushFailed, cacheClient)
}

// dispatchUnboundInviterDesktop pushes the unbound payload to the inviter's
// desktop connection, or queues it offline when no live connection exists.
func (s *DispatchService) dispatchUnboundInviterDesktop(ctx context.Context, task *model.PendingAgentTask, ai *model.AgentInstance, payload []byte, deliveryID, connID string, cacheClient dispatchCache) {
	conn := s.mgr.FindByConnID(connID)
	if conn == nil {
		s.pushPendingTaskOffline(ctx, ai.InviterUserID, task.ID, payload, "unbound_inviter_desktop", dispatch.DispatchLogOfflinePushConnNil, cacheClient)
		return
	}
	frame := FramePort{Type: frameTypeAgentDispatch, Payload: json.RawMessage(payload)}
	if err := repository.UpdatePendingTaskDispatched(s.db, task.ID, conn.DeviceID); err != nil {
		slog.Error(dispatch.DispatchLogMarkAgentDispatched, "task_id", task.ID, "user_id", ai.InviterUserID, "device_id", conn.DeviceID, "error", err)
		return
	}
	result := s.mgr.PushToConn(connID, frame)
	if !result.Queued {
		slog.Warn(dispatch.DispatchLogWSNotQueuedPreserve, "task_id", task.ID, "user_id", ai.InviterUserID, "device_id", conn.DeviceID, "conn_id", connID, "delivery_status", result.Status, "error", result.Err)
		if err := cacheClient.PushPendingTask(ctx, ai.InviterUserID, string(payload)); err != nil {
			if metrics.AgentDispatchOfflinePushFailures != nil {
				metrics.AgentDispatchOfflinePushFailures.WithLabelValues("unbound_ws_miss").Inc()
			}
			slog.Error(dispatch.DispatchLogPreserveAfterWSFailure, "task_id", task.ID, "user_id", ai.InviterUserID, "device_id", conn.DeviceID, "conn_id", connID, "delivery_status", result.Status, "error", err)
		}
		// WS miss → offline queue only; outbox stays pending (#1031).
		return
	}
	s.markDeliverySentIfLive(ctx, deliveryID, task.ID)
}

// dispatchRouteHubRelay sends the task through the relay service; failures
// fall back to the offline target queue. When the WS push does not reach an
// active connection the task stays queued so the outbox retry loop can
// redeliver; only a confirmed live push marks the delivery sent (#2073).
func (s *DispatchService) dispatchRouteHubRelay(ctx context.Context, task *model.PendingAgentTask, ai *model.AgentInstance, payload []byte, deliveryID string, cacheClient dispatchCache) {
	// Target the bound device, not the inviter: relay.PushToDevice is keyed by
	// device_id (the edge WS connection registers with its device UUID from
	// JWT claims). Passing the user id here made the hub_relay live push
	// silently miss on every dispatch (#2154 — functional,
	// not a security issue). Fall back to the inviter id only for legacy
	// unbound rows so the old behavior is preserved instead of an empty key.
	targetEdgeID := task.EdgeDeviceID
	if targetEdgeID == "" {
		targetEdgeID = ai.InviterUserID
	}
	pushReached, err := s.relay.CreateCommand(ctx, targetEdgeID, dispatch.AgentDispatchRelayCommand, json.RawMessage(payload), ai.InviterUserID)
	if err != nil {
		slog.Error(dispatch.DispatchLogRelayCreateFailed, "task_id", task.ID, "user_id", ai.InviterUserID, "error", err)
		s.pushPendingTargetTaskOffline(ctx, task, ai, payload, cacheClient)
		return
	}
	if !pushReached {
		// Command persisted in Redis but no active WS connection received it.
		// Leave the task queued and the outbox row pending so the existing
		// retry→dead-letter path can redeliver when the edge reconnects.
		slog.Info("relay push did not reach active connection; leaving task queued for outbox retry",
			"task_id", task.ID, "user_id", ai.InviterUserID)
		if metrics.RelayPushNoConn != nil {
			metrics.RelayPushNoConn.Inc()
		}
		return
	}
	if err := repository.UpdatePendingTaskDispatched(s.db, task.ID, task.EdgeDeviceID); err != nil {
		slog.Error(dispatch.DispatchLogMarkHubRelayDispatched, "task_id", task.ID, "user_id", ai.InviterUserID, "error", err)
	}
	// Hub-relay live push confirmed: mark the delivery sent.
	if metrics.RelayPushDelivered != nil {
		metrics.RelayPushDelivered.Inc()
	}
	// Route through the plan helper so a failed mark warns instead of being
	// swallowed: an unmarked delivery stays pending and the outbox retry loop
	// would redeliver — the Warn is the only signal of that double-send risk.
	s.markDeliverySentIfLive(ctx, deliveryID, task.ID)
}

// pushPendingTargetTaskOffline best-effort queues the payload on the target
// device's pending-target queue (hub_relay fallback); failures bump the
// hub_relay offline-push metric and log DispatchLogRelayOfflinePushFailed.
func (s *DispatchService) pushPendingTargetTaskOffline(ctx context.Context, task *model.PendingAgentTask, ai *model.AgentInstance, payload []byte, cacheClient dispatchCache) {
	if pushErr := cacheClient.PushPendingTargetTask(ctx, ai.InviterUserID, task.TargetID, task.EdgeDeviceID, string(payload)); pushErr != nil {
		if metrics.AgentDispatchOfflinePushFailures != nil {
			metrics.AgentDispatchOfflinePushFailures.WithLabelValues("hub_relay").Inc()
		}
		slog.Error(dispatch.DispatchLogRelayOfflinePushFailed, "task_id", task.ID, "user_id", ai.InviterUserID, "error", pushErr)
	}
}

// pushPendingTaskOffline best-effort enqueues an unbound payload on the user's
// offline queue; failures bump the labelled offline-push metric and log the
// given message key (same attr shape as the previous inline paths).
func (s *DispatchService) pushPendingTaskOffline(ctx context.Context, userID, taskID string, payload []byte, metricLabel, logMessage string, cacheClient dispatchCache) {
	if err := cacheClient.PushPendingTask(ctx, userID, string(payload)); err != nil {
		if metrics.AgentDispatchOfflinePushFailures != nil {
			metrics.AgentDispatchOfflinePushFailures.WithLabelValues(metricLabel).Inc()
		}
		slog.Error(logMessage, "task_id", taskID, "user_id", userID, "error", err)
	}
}

// dispatchRouteTargetBound delivers to a bound target (local_edge /
// remote_ssh / cloud_edge / tailscale / hub_relay without relay).
func (s *DispatchService) dispatchRouteTargetBound(ctx context.Context, task *model.PendingAgentTask, ai *model.AgentInstance, payload []byte, deliveryID string, cacheClient dispatchCache) {
	live := s.dispatchTargetBoundTask(ctx, cacheClient, task, ai.InviterUserID, task.EdgeDeviceID, payload)
	if live {
		s.markDeliverySentIfLive(ctx, deliveryID, task.ID)
	}
}

// markDeliverySentIfLive marks the delivery sent after a live push; an empty
// delivery id means outbox recording failed and durability is already degraded.
// Failures warn — the delivery stays pending for the outbox retry loop.
func (s *DispatchService) markDeliverySentIfLive(ctx context.Context, deliveryID, taskID string) {
	if deliveryID == "" {
		return
	}
	if err := s.markDeliverySent(ctx, deliveryID); err != nil {
		slog.Warn(dispatch.DispatchLogMarkDeliverySentFailed, "task_id", taskID, "delivery_id", deliveryID, "error", err)
	}
}

func (s *DispatchService) issueRunStartCapability(dp *dispatchPayload) string {
	if dp == nil {
		return ""
	}
	resolved := dispatch.CapabilityMintFromEnv(
		s.jwtSecret,
		dp.EdgeDeviceID,
		s.edgeCfg.DeviceID,
		dp.TriggerUserID,
		dp.TargetID,
	)
	if !resolved.Ok {
		return ""
	}
	args := dispatch.CapabilityTokenArgs(resolved)
	token, err := jwtutil.IssueCapabilityToken(
		args.Secret, args.UserID, args.DeviceID, args.ProjectID, args.Action, args.TTL,
		jwtutil.CapabilityIssueOptions{Action: args.Action, TargetID: args.TargetID, ThreadID: args.ThreadID},
	)
	if err != nil {
		slog.Warn(dispatch.CapabilityMintFailedLog, "error", err, "device_id", args.DeviceID)
		return ""
	}
	return token
}

// ── Redispatch adapters ─────────────────────────────────────────────────────

// redispatchTarget carries only the opaque fields the redispatch path needs to
// re-send a stored payload. It is not a GORM model and must not grow journal
// columns — that keeps redispatch free of the outbox row type.
type redispatchTarget struct {
	TaskID       string
	DeliveryID   string
	Payload      string
	EdgeDeviceID string
}

// RedispatchDelivery re-dispatches a stored delivery by payload fields. This
// is the exported seam the service-layer outbox retry loop calls; it builds
// the internal redispatchTarget so the outbox never touches dispatch internals.
func (s *DispatchService) RedispatchDelivery(ctx context.Context, taskID, deliveryID, payloadJSON, edgeDeviceID string) error {
	return s.redispatchDelivery(ctx, redispatchTarget{
		TaskID:       taskID,
		DeliveryID:   deliveryID,
		Payload:      payloadJSON,
		EdgeDeviceID: edgeDeviceID,
	})
}

// redispatchDelivery re-dispatches a delivery by parsing the stored payload and
// routing it to the target Edge device. Pure JSON prep is in dispatch; dead-letter
// + routing stay here. Accepts redispatchTarget only — never the private GORM row.
//
// Returns nil on successful route (HTTP / WS / offline queue) and on intentional
// dead-letter. Soft route failures return an error so retryDeliveries does not
// MarkDeliverySent (#999). Initial offline dispatch does not mark sent (#1031);
// outbox-owned redispatch offline success still marks sent (#866). Running is
// non-retryable (#1000).
func (s *DispatchService) redispatchDelivery(ctx context.Context, rec redispatchTarget) error {
	dp, newPayload, err := dispatch.PrepareRedispatchPayload(rec.Payload, rec.DeliveryID)
	if err != nil {
		kind, unwrap := dispatch.RedispatchPrepFailure(err)
		slog.Error(dispatch.RedispatchPrepLogMessage(kind),
			"delivery_id", rec.DeliveryID, "task_id", rec.TaskID, "error", err)
		s.moveDeliveryToDeadLetter(ctx, rec.DeliveryID, dispatch.DeadLetterReason(kind, unwrap))
		return nil
	}

	task, err := s.getPendingTaskForRedelivery(ctx, rec.TaskID)
	var status string
	if task != nil {
		status = task.Status
	}
	gate := dispatch.PlanRedispatchTaskGate(err, status)
	switch gate.Kind {
	case dispatch.RedispatchGateDeadLetterLookup:
		slog.Warn(gate.LogMessage, "delivery_id", rec.DeliveryID, "task_id", rec.TaskID, "error", err)
		s.moveDeliveryToDeadLetter(ctx, rec.DeliveryID, gate.DeadLetterReason)
		return nil
	case dispatch.RedispatchGateDeadLetterStatus:
		slog.Info(gate.LogMessage, "delivery_id", rec.DeliveryID, "task_id", rec.TaskID, "task_status", status)
		s.moveDeliveryToDeadLetter(ctx, rec.DeliveryID, gate.DeadLetterReason)
		return nil
	}
	return s.retryDispatchToTarget(ctx, task, dp, newPayload, rec)
}

// getPendingTaskForRedelivery looks up a task for redelivery purposes.
func (s *DispatchService) getPendingTaskForRedelivery(ctx context.Context, taskID string) (*pendingTaskSnapshot, error) {
	var task struct {
		ID, AgentInstanceID, TriggeredByUserID, Status, EdgeDeviceID, EdgeRunID, TargetID string
	}
	err := s.db.WithContext(ctx).
		Table("pending_agent_tasks").
		Select(dispatch.PendingTaskRedeliverySelect).
		Where("id = ?", taskID).
		First(&task).Error
	if err != nil {
		return nil, err
	}
	snap := dispatch.MapPendingTaskRedeliveryRow(
		task.ID, task.AgentInstanceID, task.TriggeredByUserID, task.Status,
		task.EdgeDeviceID, task.EdgeRunID, task.TargetID,
	)
	return &snap, nil
}

// retryDispatchToTarget re-dispatches a delivery to the target Edge device.
// rec is a redispatchTarget (opaque payload fields only), not the GORM model.
// Route classification is pure; WS/HTTP/offline side-effects stay here. Soft
// offline-queue failures return an error so callers do not false-mark sent (#999).
// Outbox MarkDeliverySent after success remains on DeliveryOutbox RedispatchDelivery.
func (s *DispatchService) retryDispatchToTarget(ctx context.Context, task *pendingTaskSnapshot, dp dispatchPayload, newPayload []byte, rec redispatchTarget) error {
	minimalTask := dispatch.MinimalPendingTaskForHTTP(*task)

	reservedDirectDevice := task.TargetID == "" && task.EdgeDeviceID != "" && task.EdgeDeviceID == strings.TrimSpace(s.edgeCfg.DeviceID)
	if reservedDirectDevice || dispatch.ClassifyRedeliveryPrimaryRoute(task.TargetID, task.EdgeDeviceID) == dispatch.RouteHTTP {
		result := s.dispatchToEdgeHTTP(ctx, minimalTask, &dp)
		task.EdgeDeviceID = minimalTask.EdgeDeviceID
		if result.RunID != "" {
			if err := repository.RecordPendingTaskDirectReceipt(s.db, task.ID, task.EdgeDeviceID, result.RunID); err != nil {
				return err
			}
			if result.CallbackOwner == "edge" {
				slog.Info(dispatch.RedispatchLogHTTPSucceeded,
					"delivery_id", rec.DeliveryID, "task_id", rec.TaskID, "edge_run_id", result.RunID)
				return nil
			}
		} else if !result.SafeToFallback {
			return errors.New("direct admission is unconfirmed; preserve device binding")
		}
	}
	preferDevice := dispatch.PreferDeviceBoundRedelivery(task.EdgeDeviceID)
	if preferDevice {
		dp.EdgeDeviceID = task.EdgeDeviceID
		var err error
		newPayload, err = dispatch.MarshalPayload(dp)
		if err != nil {
			return err
		}
	}

	cacheClient := s.cacheClient
	var connID string
	var routeErr error
	if preferDevice {
		connID, routeErr = cacheClient.GetRouteForDevice(ctx, task.TriggeredByUserID, dispatch.DesktopDeviceType, task.EdgeDeviceID)
	} else {
		connID, routeErr = cacheClient.GetRoute(ctx, task.TriggeredByUserID, dispatch.DesktopDeviceType)
	}

	facts := dispatch.RedeliveryConnFacts{}
	if dispatch.CanPushInviterDesktop(connID, s.mgr != nil, routeErr) {
		if conn := s.mgr.FindByConnID(connID); conn != nil {
			facts = dispatch.ObserveRedeliveryConn(true, conn.UserID, task.TriggeredByUserID)
		}
	}

	switch dispatch.ClassifyRedeliveryRoute(preferDevice, connID, s.mgr != nil, routeErr, facts.ConnFound, facts.ConnUserMatch) {
	case dispatch.RouteTargetBound:
		result := s.mgr.PushToConn(connID, FramePort{Type: frameTypeAgentDispatch, Payload: json.RawMessage(newPayload)})
		if result.Queued {
			slog.Info(dispatch.RedispatchLogWSSucceeded,
				"delivery_id", rec.DeliveryID, "task_id", rec.TaskID, "device_id", task.EdgeDeviceID)
			return nil
		}
		slog.Warn(dispatch.RedispatchLogWSNotQueued,
			"delivery_id", rec.DeliveryID, "task_id", rec.TaskID,
			"delivery_status", result.Status, "error", result.Err)
	case dispatch.RouteInviterDesktop:
		result := s.mgr.PushToConn(connID, FramePort{Type: frameTypeAgentDispatch, Payload: json.RawMessage(newPayload)})
		if result.Queued {
			slog.Info(dispatch.RedispatchLogWSFallbackSucceeded,
				"delivery_id", rec.DeliveryID, "task_id", rec.TaskID)
			return nil
		}
	}

	if err := cacheClient.PushPendingTask(ctx, task.TriggeredByUserID, string(newPayload)); err != nil {
		if metrics.AgentDispatchOfflinePushFailures != nil {
			metrics.AgentDispatchOfflinePushFailures.WithLabelValues("redispatch").Inc()
		}
		slog.Error(dispatch.RedispatchOfflinePushFailedLogMessage(preferDevice),
			"delivery_id", rec.DeliveryID, "task_id", rec.TaskID, "error", err)
		// Soft offline-queue failure: return error so callers do not false-mark sent (#999).
		return dispatch.RedispatchOfflineQueueError(err)
	}
	slog.Info(dispatch.RedispatchOfflineSuccessLogMessage(preferDevice),
		dispatch.RedispatchOfflineSuccessLogAttrs(preferDevice, rec.DeliveryID, rec.TaskID, task.TriggeredByUserID)...)
	// Outbox-owned redispatch may MarkDeliverySent after this nil (#866). Reconnect
	// offline replay still consults outbox status so sent/acked rows do not dual-fire (#1031).
	return nil
}

// ── AgentService facade (wiring/handler stability) ───────────────────────────
//
// Moved to agent_dispatch_facade.go (#1068) to match delivery_outbox_facade.go
// pattern (#801). Thin delegating methods: dispatchService, TriggerAgentTask,
// CancelTask, RegenerateAgentTask.
