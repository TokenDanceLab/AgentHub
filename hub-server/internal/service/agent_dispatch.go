package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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

// ── DTO aliases, ports, and wiring surface moved to agent_dispatch_ports.go (#1068).
// ── AgentService facade moved to agent_dispatch_facade.go (#1068).
// Core orchestration methods follow.

// dispatchToEdgeHTTP POSTs a task to local Edge /v1/runs. Returns Edge run ID on
// success, or empty string when unreachable / rejected / decode fails.
func (s *DispatchService) dispatchToEdgeHTTP(ctx context.Context, task *model.PendingAgentTask, dp *dispatchPayload) string {
	// Pure Edge HTTP prep (#946); client/request side-effects stay here.
	parts, insecure, err := dispatch.PrepareEdgeHTTPRequest(
		os.Getenv("AGENTHUB_EDGE_URL"),
		os.Getenv("AGENTHUB_EDGE_AUTH_TOKEN"),
		dp.Prompt, dp.AgentType, dp.SystemPrompt, task.ID, dp.DeliveryID,
		dp.Messages, dp.PinnedMessages, dp.OutputSchema,
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
	plan := dispatch.PlanEdgeHTTPClientResponse(resp.StatusCode, respBody)
	if plan.NonSuccess {
		slog.Warn(plan.LogMessage, "task_id", task.ID, "status", resp.StatusCode, "body", string(respBody))
		return ""
	}
	if plan.DecodeFail {
		slog.Warn(plan.LogMessage, "task_id", task.ID, "error", plan.DecodeErr)
		return ""
	}
	slog.Info(dispatch.EdgeHTTPLogDispatched, "task_id", task.ID, "edge_run_id", plan.RunID, "url", parts.RunsURL)
	return plan.RunID
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
	healthState := dispatch.ResolveExecutionTargetHealthState(target, time.Now())
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
	// Pure payload assembly (#902/#1033/#1056); history loaders stay orchestration-side.
	dp := dispatch.AssembleDispatchPayload(dispatch.AssembleInputCore(
		task.ID, ai.ID, ai.AgentType, task.TargetID, task.EdgeDeviceID, ai.SessionID,
		task.TriggerMessageID, task.TriggeredByUserID, prompt, ai.DisplayName,
		dispatch.CustomAgentIDValue(ai.CustomAgentID),
		dispatch.CustomAgentFieldsFromModel(customAgent),
		modelParams,
		s.resolveDispatchTeamContext(ai),
		s.loadThreadHistory(ai.SessionID, task.TriggerMessageID),
		s.loadPinnedMessages(ai.SessionID),
	))

	// Record delivery in outbox before dispatching (AH-SR-049).
	payload, _ := dispatch.MarshalPayload(dp)
	deliveryID, err := s.recordDelivery(ctx, task.ID, string(payload), task.EdgeDeviceID)
	if !dispatch.OutboxRecordSucceeded(err) {
		// Still dispatch for availability, but durability is degraded until outbox is healthy.
		slog.Error(dispatch.DispatchLogOutboxRecordFailed,
			"task_id", task.ID, "edge_device_id", task.EdgeDeviceID, "error", err)
	} else {
		// Re-serialize with delivery_id included (pure finalize #811/#902).
		dp, payload = dispatch.FinalizeAfterDeliveryRecord(dp, deliveryID)
	}

	// Primary route classification is pure (#800); side-effects stay here.
	route := dispatch.ClassifyPrimaryDispatchRoute(
		task.TargetID, targetType, task.EdgeDeviceID, dispatch.RelayPortAvailable(s.relay != nil),
	)
	cacheClient := s.cachePort()

	switch route {
	case dispatch.RouteHTTP:
		// Try HTTP direct dispatch to local Edge first for unbound tasks.
		if dispatch.IsHTTPEdgeDispatchSuccess(s.dispatchToEdgeHTTP(ctx, task, &dp)) {
			if err := repository.UpdatePendingTaskDispatched(s.db, task.ID, dispatch.SyntheticHTTPEdgeDeviceID); !dispatch.RepoUpdateSucceeded(err) {
				slog.Error(dispatch.DispatchLogHTTPMarkFailed, "task_id", task.ID, "error", err)
			}
			if dispatch.PlanLiveDispatchMark(deliveryID) {
				_ = s.markDeliverySent(ctx, deliveryID)
			}
			return
		}
		// HTTP miss: fall through to inviter desktop / offline.
		connID, err := cacheClient.GetRoute(ctx, ai.InviterUserID, dispatch.DesktopDeviceType)
		if dispatch.IsUnboundInviterDesktopRoute(dispatch.ClassifyUnboundFallbackRoute(connID, dispatch.ManagerPortAvailable(s.mgr != nil), err)) {
			conn := s.mgr.FindByConnID(connID)
			if !dispatch.InviterDesktopConnPresent(conn != nil) {
				if err := cacheClient.PushPendingTask(ctx, ai.InviterUserID, string(payload)); !dispatch.OfflineQueuePushSucceeded(err) {
					slog.Error(dispatch.DispatchLogOfflinePushConnNil, "task_id", task.ID, "user_id", ai.InviterUserID, "error", err)
				}
				// Offline queue acceptance is not Edge receipt (#1031).
				if dispatch.PlanOfflineDispatchMark(deliveryID) {
					_ = s.markDeliverySent(ctx, deliveryID)
				}
				return
			}
			frame := ws.NewFrame(ws.TypeAgentDispatch, json.RawMessage(payload))
			if err := repository.UpdatePendingTaskDispatched(s.db, task.ID, conn.DeviceID); !dispatch.RepoUpdateSucceeded(err) {
				slog.Error(dispatch.DispatchLogMarkAgentDispatched, "task_id", task.ID, "user_id", ai.InviterUserID, "device_id", conn.DeviceID, "error", err)
				return
			}
			result := s.mgr.PushToConn(connID, frame)
			if !dispatch.UnboundInviterDesktopWSQueued(result.Queued) {
				slog.Warn(dispatch.DispatchLogWSNotQueuedPreserve, "task_id", task.ID, "user_id", ai.InviterUserID, "device_id", conn.DeviceID, "conn_id", connID, "delivery_status", result.Status, "error", result.Err)
				if err := cacheClient.PushPendingTask(ctx, ai.InviterUserID, string(payload)); !dispatch.OfflineQueuePushSucceeded(err) {
					slog.Error(dispatch.DispatchLogPreserveAfterWSFailure, "task_id", task.ID, "user_id", ai.InviterUserID, "device_id", conn.DeviceID, "delivery_status", result.Status, "error", err)
				}
				// WS miss → offline queue only; outbox stays pending (#1031).
				if dispatch.PlanUnboundInviterDesktopMark(false, deliveryID) {
					_ = s.markDeliverySent(ctx, deliveryID)
				}
				return
			}
			if dispatch.PlanUnboundInviterDesktopMark(true, deliveryID) {
				_ = s.markDeliverySent(ctx, deliveryID)
			}
			return
		}
		if err := cacheClient.PushPendingTask(ctx, ai.InviterUserID, string(payload)); !dispatch.OfflineQueuePushSucceeded(err) {
			slog.Error(dispatch.DispatchLogOfflinePushFailed, "task_id", task.ID, "user_id", ai.InviterUserID, "error", err)
		}
		// Offline-only path: outbox retains ownership until Edge ack/stream (#1031).
		if dispatch.PlanOfflineDispatchMark(deliveryID) {
			_ = s.markDeliverySent(ctx, deliveryID)
		}
		return

	case dispatch.RouteMissingEdge:
		slog.Error(dispatch.DispatchLogMissingTargetEdgeDevice, "task_id", task.ID, "user_id", ai.InviterUserID, "target_id", task.TargetID)
		return

	case dispatch.RouteHubRelay:
		// hub_relay uses the relay service; failures fall back to offline target queue.
		_, err := s.relay.CreateCommand(ctx, ai.InviterUserID, dispatch.AgentDispatchRelayCommand, json.RawMessage(payload), ai.InviterUserID)
		if !dispatch.HubRelayCreateSucceeded(err) {
			slog.Error(dispatch.DispatchLogRelayCreateFailed, "task_id", task.ID, "user_id", ai.InviterUserID, "error", err)
			if pushErr := cacheClient.PushPendingTargetTask(ctx, ai.InviterUserID, task.TargetID, task.EdgeDeviceID, string(payload)); !dispatch.OfflineQueuePushSucceeded(pushErr) {
				slog.Error(dispatch.DispatchLogRelayOfflinePushFailed, "task_id", task.ID, "user_id", ai.InviterUserID, "error", pushErr)
			}
			return
		}
		if err := repository.UpdatePendingTaskDispatched(s.db, task.ID, task.EdgeDeviceID); !dispatch.RepoUpdateSucceeded(err) {
			slog.Error(dispatch.DispatchLogMarkHubRelayDispatched, "task_id", task.ID, "user_id", ai.InviterUserID, "error", err)
		}
		if dispatch.PlanLiveDispatchMark(deliveryID) {
			_ = s.markDeliverySent(ctx, deliveryID)
		}
		return

	case dispatch.RouteTargetBound:
		// local_edge / remote_ssh / cloud_edge / tailscale / hub_relay without relay.
		live := s.dispatchTargetBoundTask(ctx, cacheClient, task, ai.InviterUserID, task.EdgeDeviceID, payload)
		if dispatch.PlanTargetBoundDeliveryMark(live, deliveryID) {
			_ = s.markDeliverySent(ctx, deliveryID)
		}
		return
	}
}

func (s *DispatchService) resolveDispatchTeamContext(ai *model.AgentInstance) dispatchTeamContext {
	var rawCustomAgentID *string
	if ai != nil {
		rawCustomAgentID = ai.CustomAgentID
	}
	customAgentID := dispatch.CustomAgentIDFromAgentPresence(ai != nil, rawCustomAgentID)
	if !dispatch.TeamContextResolutionReady(s != nil, s != nil && s.db != nil, ai != nil, customAgentID) {
		return dispatch.EmptyTeamContext()
	}
	run, err := repository.GetTeamRunBySessionID(s.db, ai.SessionID)
	var rawRunID string
	if run != nil {
		rawRunID = run.ID
	}
	runID := dispatch.TeamRunIDValue(run != nil, rawRunID)
	if !dispatch.TeamRunLoadable(err, run != nil, runID) {
		return dispatch.EmptyTeamContext()
	}
	members, err := repository.ListTeamMembers(s.db, run.TeamID)
	if !dispatch.TeamMembersPresent(err) {
		return dispatch.EmptyTeamContext()
	}
	return dispatch.MatchTeamContext(run.TeamID, runID, dispatch.TeamMatchCustomAgentID(customAgentID), dispatch.TeamMemberRefsFromMembers(members))
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

// dispatchTargetBoundTask routes a target-bound task. Returns true when a live
// WS push was queued (caller may MarkDeliverySent). Offline queue acceptance
// alone returns false so outbox retains ownership (#1031).
func (s *DispatchService) dispatchTargetBoundTask(ctx context.Context, cacheClient dispatchCache, task *model.PendingAgentTask, userID, deviceID string, payload []byte) bool {
	queueTargetTask := func(reason string, err error) {
		if pushErr := cacheClient.PushPendingTargetTask(ctx, userID, task.TargetID, deviceID, string(payload)); !dispatch.OfflineQueuePushSucceeded(pushErr) {
			slog.Error(dispatch.DispatchLogTargetBoundOfflinePushFailed, "task_id", task.ID, "user_id", userID, "target_id", task.TargetID, "device_id", deviceID, "reason", reason, "error", pushErr)
			return
		}
		if dispatch.TargetBoundOfflinePushInfoLog(err) {
			slog.Info(dispatch.DispatchLogTargetBoundQueued, "task_id", task.ID, "user_id", userID, "target_id", task.TargetID, "device_id", deviceID, "reason", reason, "error", err)
		}
	}

	connID, err := cacheClient.GetRouteForDevice(ctx, userID, dispatch.DesktopDeviceType, deviceID)
	if dispatch.TargetBoundRouteUnavailable(err, connID, dispatch.ManagerPortAvailable(s.mgr != nil)) {
		queueTargetTask(dispatch.TargetBoundReasonRouteUnavailable, err)
		return false
	}
	conn := s.mgr.FindByConnID(connID)
	if !dispatch.TargetBoundConnFound(conn != nil) {
		queueTargetTask(dispatch.TargetBoundReasonConnMismatch, nil)
		return false
	}
	if dispatch.TargetBoundConnRejected(true, conn.UserID, conn.DeviceType, conn.DeviceID, userID, deviceID) {
		queueTargetTask(dispatch.TargetBoundReasonConnMismatch, nil)
		return false
	}
	frame := ws.NewFrame(ws.TypeAgentDispatch, json.RawMessage(payload))
	if err := repository.UpdatePendingTaskDispatched(s.db, task.ID, deviceID); !dispatch.RepoUpdateSucceeded(err) {
		slog.Error(dispatch.DispatchLogTargetBoundMarkFailed, "task_id", task.ID, "user_id", userID, "target_id", task.TargetID, "device_id", deviceID, "error", err)
		return false
	}
	result := s.mgr.PushToConn(connID, frame)
	if !dispatch.RedeliveryWSPushSucceeded(result.Queued) {
		slog.Warn(dispatch.DispatchLogTargetBoundWSNotQueued, "task_id", task.ID, "user_id", userID, "target_id", task.TargetID, "device_id", deviceID, "conn_id", connID, "delivery_status", result.Status, "error", result.Err)
		queueTargetTask(dispatch.TargetBoundReasonWSNotQueued, result.Err)
		return false
	}
	return true
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
// Empty when secret/device unavailable so local/dev dispatch still works.
func (s *DispatchService) issueRunStartCapability(dp *dispatchPayload) string {
	if !dispatch.CapabilityPayloadPresent(dp != nil) {
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
	args := dispatch.CapabilityTokenArgs(resolved)
	token, err := jwtutil.IssueCapabilityToken(
		args.Secret, args.UserID, args.DeviceID, args.ProjectID, args.Action, args.TTL,
		jwtutil.CapabilityIssueOptions{Action: args.Action, TargetID: args.TargetID, ThreadID: args.ThreadID},
	)
	mint := dispatch.PlanCapabilityMintResult(token, err)
	if mint.LogFailure {
		slog.Warn(dispatch.CapabilityMintFailedLog, "error", err, "device_id", args.DeviceID)
		return ""
	}
	return mint.Token
}

// ── Redispatch residual (moved from AgentService in #573) ────────────────────

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
	if prep := dispatch.PlanRedispatchPrepGate(err); prep.DeadLetter {
		slog.Error(prep.LogMessage,
			"delivery_id", rec.DeliveryID, "task_id", rec.TaskID, "error", err)
		s.moveDeliveryToDeadLetter(ctx, rec.DeliveryID, dispatch.DeadLetterReason(prep.Kind, prep.Unwrap))
		return nil
	}

	task, err := s.getPendingTaskForRedelivery(ctx, rec.TaskID)
	status := dispatch.TaskStatusOrEmpty(task)
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
	return dispatch.MapPendingTaskRedeliveryLookup(
		err,
		task.ID, task.AgentInstanceID, task.TriggeredByUserID, task.Status,
		task.EdgeDeviceID, task.EdgeRunID, task.TargetID,
	)
}

// retryDispatchToTarget re-dispatches a delivery to the target Edge device.
// rec is a redispatchTarget (opaque payload fields only), not the GORM model.
// Route classification is pure; WS/HTTP/offline side-effects stay here. Soft
// offline-queue failures return an error so callers do not false-mark sent (#999).
// Outbox MarkDeliverySent after success remains on DeliveryOutbox RedispatchDelivery.
func (s *DispatchService) retryDispatchToTarget(ctx context.Context, task *pendingTaskSnapshot, dp dispatchPayload, newPayload []byte, rec redispatchTarget) error {
	minimalTask := dispatch.MinimalPendingTaskForHTTP(*task)
	preferDevice := dispatch.RedeliveryPreferDeviceRoute(task.EdgeDeviceID)

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
		if conn := s.mgr.FindByConnID(connID); dispatch.TargetBoundConnFound(conn != nil) {
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
