package app

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/agent"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"github.com/agenthub/hub-server/internal/service/messagereaction"
	"github.com/agenthub/hub-server/internal/ws"
)

// setupWSManager creates the WebSocket manager and configures callbacks.
func (a *App) setupWSManager() {
	a.mgr = ws.NewManager()
	a.mgr.OnRouteSet = a.onRouteSet
	a.mgr.OnRouteDel = a.onRouteDel
	a.mgr.ResolveMembers = func(sessionID string) []string {
		ctx := a.bg.Ctx()
		ids, err := cache.GetOrLoad(a.CacheClient, ctx, "session:members:"+sessionID, config.SessionMemberCacheTTL, func(ctx context.Context) ([]string, error) {
			members, err := a.SessionService.ListActiveMembers(sessionID)
			if err != nil {
				return nil, err
			}
			ids := make([]string, len(members))
			for i, m := range members {
				ids[i] = m.MemberID
			}
			return ids, nil
		})
		if err != nil {
			return nil
		}
		return ids
	}

	// WebSocket handler (created once here; reused by routes)
	a.WebSocketHandler = handler.NewWebSocketHandler(a.mgr, a.Config.Server.Env)
	a.WebSocketHandler.SetOnTyping(a.handleTypingFrame)
}

// handleTypingFrame fans a typing indicator out to the sender's session
// peers. Member resolution goes through mgr.ResolveMembers — the same
// cache.GetOrLoad path (session:members:<id>, TTL 5min, singleflight) that
// canTypeInSession and PushToSession already use — instead of a fresh
// ListActiveMembers DB query per frame: typing frames arrive continuously
// while a user types, and the previous per-frame query was the only
// uncached member lookup on the hot path (#2154 perf lane).
func (a *App) handleTypingFrame(userID, sessionID string) {
	frame := ws.NewFrame(ws.TypeTyping, map[string]interface{}{
		"user_id":    userID,
		"session_id": sessionID,
	})
	memberIDs := a.mgr.ResolveMembers(sessionID)
	senderIsMember := false
	for _, memberID := range memberIDs {
		if memberID == userID {
			senderIsMember = true
			break
		}
	}
	if !senderIsMember {
		return
	}
	for _, memberID := range memberIDs {
		if memberID != userID {
			a.mgr.PushToUser(memberID, frame)
		}
	}
}

// startEventSubscriptions subscribes to all bus events for WebSocket push.
// Each event domain is extracted to its own method for readability.
func (a *App) startEventSubscriptions(_ context.Context) {
	a.subscribeMessageEvents()
	a.subscribeAgentEvents()
	a.subscribeTeamEvents()
	a.subscribeContactEvents()
	a.subscribeSessionEvents()
}

// ── Message events ──────────────────────────────────────────────────────

func (a *App) subscribeMessageEvents() {
	a.bus.Subscribe(bus.EventTypeMessageNew, func(ctx context.Context, event bus.Event) {
		msg, ok := event.Payload.(*model.Message)
		if !ok {
			return
		}
		if msg.SenderType == model.SenderTypeAgent {
			return
		}
		frame := ws.NewFrame(ws.TypeMessageNew, msg)
		a.mgr.PushToSession(msg.SessionID, frame)
	})

	a.bus.Subscribe(bus.EventTypeMessageRecall, func(ctx context.Context, event bus.Event) {
		msg, ok := event.Payload.(*model.Message)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessageRecall, map[string]string{
			"message_id": msg.ID,
			"session_id": msg.SessionID,
		})
		a.mgr.PushToSession(msg.SessionID, frame)
	})

	// message.edited: fan the updated message to session members so peers
	// replace content live without a refetch (previously published but had no
	// subscriber, so edits were silently invisible to other clients).
	//
	// Wire type is the bus constant directly: a ws.TypeMessageEdited constant
	// is intentionally NOT added to ws/frame.go in this lane because the
	// OpenAPI parity test (handler/device_openapi_test.go) enforces frame.go
	// constants == api/openapi.yaml enum, and api/openapi.yaml is owned by the
	// openapi lane. Adding the frame constant here without the OpenAPI sync
	// breaks that gate. The openapi+frontend lanes must add the ws constant,
	// OpenAPI enum, and hubEvents.ts entry together; until then the wire value
	// "message.edited" still flows correctly (bus constant == wire value).
	a.bus.Subscribe(bus.EventTypeMessageEdited, func(ctx context.Context, event bus.Event) {
		msg, ok := event.Payload.(*model.Message)
		if !ok {
			return
		}
		frame := ws.NewFrame(bus.EventTypeMessageEdited, msg)
		a.mgr.PushToSession(msg.SessionID, frame)
	})

	a.bus.Subscribe(bus.EventTypeMessagePin, func(ctx context.Context, event bus.Event) {
		pin, ok := event.Payload.(*model.MessagePin)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessagePin, pin)
		a.mgr.PushToSession(pin.SessionID, frame)
	})

	a.bus.Subscribe(bus.EventTypeMessageUnpin, func(ctx context.Context, event bus.Event) {
		payload, ok := event.Payload.(map[string]string)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessageUnpin, payload)
		a.mgr.PushToSession(payload["session_id"], frame)
	})

	for _, reactionEvent := range []struct {
		eventType string
		frameType string
	}{
		{eventType: ws.TypeMessageReactionAdded, frameType: ws.TypeMessageReactionAdded},
		{eventType: ws.TypeMessageReactionRemoved, frameType: ws.TypeMessageReactionRemoved},
	} {
		reactionEvent := reactionEvent
		a.bus.Subscribe(reactionEvent.eventType, func(ctx context.Context, event bus.Event) {
			payload, ok := event.Payload.(messagereaction.MessageReactionEventPayload)
			if !ok {
				return
			}
			frame := ws.NewFrame(reactionEvent.frameType, payload)
			a.mgr.PushToSession(payload.SessionID, frame)
		})
	}

	a.bus.Subscribe(bus.EventTypeMessageRead, func(ctx context.Context, event bus.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessageRead, payload)
		sessionID, _ := payload["session_id"].(string)
		a.mgr.PushToSession(sessionID, frame)
	})
}

// ── Agent stream events ─────────────────────────────────────────────────

func (a *App) subscribeAgentEvents() {
	a.bus.Subscribe(bus.EventTypeAgentStream, func(ctx context.Context, event bus.Event) {
		runEvent, ok := event.Payload.(*model.AgentRunEvent)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentStream, runEvent)
		a.mgr.PushToSession(runEvent.SessionID, frame)
	})

	a.bus.Subscribe(bus.EventTypeAgentDone, func(ctx context.Context, event bus.Event) {
		payload, ok := event.Payload.(bus.AgentTaskPayload)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentDone, payload)
		a.mgr.PushToSession(payload.SessionID, frame)

		// The notification side-effect is optional: it depends on
		// AgentService + NotificationService being wired. A misconfigured or
		// test App that has not wired these must not nil-deref here (the bus
		// recover would otherwise swallow the panic, producing a false-green
		// test that only appears to exercise the dispatch path). Guard exactly
		// like the delivery-status branch below (a.AgentService != nil).
		if payload.TaskID != "" && a.AgentService != nil && a.NotificationService != nil {
			task, err := a.AgentService.GetPendingTaskByID(payload.TaskID)
			if err == nil && task != nil {
				if err := a.NotificationService.Notify(ctx, task.TriggeredByUserID, model.TypeAgentDone, map[string]interface{}{
					"task_id":           payload.TaskID,
					"agent_instance_id": payload.AgentInstanceID,
					"session_id":        payload.SessionID,
				}); err != nil {
					slog.Warn("failed to notify agent.done",
						"task_id", payload.TaskID,
						"triggered_by_user_id", task.TriggeredByUserID,
						"error", err,
					)
					if metrics.NotificationDeliveryFailures != nil {
						metrics.NotificationDeliveryFailures.WithLabelValues("agent_done").Inc()
					}
				}
			}
		}
	})

	a.bus.Subscribe(bus.EventTypeAgentFailed, func(ctx context.Context, event bus.Event) {
		payload, ok := event.Payload.(bus.AgentFailedPayload)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentFailed, payload)
		a.mgr.PushToSession(payload.SessionID, frame)
	})

	a.bus.Subscribe(bus.EventTypeAgentTimeout, func(ctx context.Context, event bus.Event) {
		payload, ok := event.Payload.(bus.AgentTaskPayload)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentFailed, payload)
		a.mgr.PushToSession(payload.SessionID, frame)
	})

	a.bus.Subscribe(bus.EventTypeAgentCancel, func(ctx context.Context, event bus.Event) {
		payload, ok := event.Payload.(bus.AgentCancelPayload)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentCancel, payload)
		a.mgr.PushToSession(payload.SessionID, frame)
	})

	// agent.regenerate: surface that a fresh task was spawned from an original
	// so clients swap the originating bubble's task binding (previously
	// published but had no subscriber, so the regenerate signal was silently
	// invisible to other clients in the session).
	//
	// Wire type is the bus constant directly; see the message.edited note for
	// why a ws.Type* constant is not added here (OpenAPI parity gate owns the
	// ws constant + openapi enum + hubEvents.ts sync across lanes).
	a.bus.Subscribe(bus.EventTypeAgentRegenerate, func(ctx context.Context, event bus.Event) {
		payload, ok := event.Payload.(bus.AgentRegeneratePayload)
		if !ok {
			return
		}
		frame := ws.NewFrame(bus.EventTypeAgentRegenerate, payload)
		a.mgr.PushToSession(payload.SessionID, frame)
	})

	// agent.route_decision: surface the supervisor's auto-parsed route choice
	// to the team-run owner across all their devices. Desktop otherwise only
	// observes the decision via the direct Edge stream; this gives web/mobile
	// the same live signal (previously published but had no subscriber, so the
	// route decision was silently dropped for non-desktop clients).
	//
	// Wire type is the bus constant directly; see the message.edited note for
	// why a ws.Type* constant is not added here (OpenAPI parity gate owns the
	// ws constant + openapi enum + hubEvents.ts sync across lanes).
	a.bus.Subscribe(bus.EventTypeAgentRouteDecision, func(ctx context.Context, event bus.Event) {
		payload, ok := event.Payload.(agent.RouteDecisionPayload)
		if !ok {
			return
		}
		frame := ws.NewFrame(bus.EventTypeAgentRouteDecision, payload)
		a.mgr.PushToUser(payload.UserID, frame)
	})
}

// ── Team events ─────────────────────────────────────────────────────────

func (a *App) subscribeTeamEvents() {
	for _, teamEvent := range []struct {
		eventType        string
		frameType        string
		pushUserIfNoSess bool
	}{
		{eventType: bus.EventTypeTeamRunStarted, frameType: ws.TypeTeamRunStarted, pushUserIfNoSess: true},
		{eventType: bus.EventTypeTeamEvent, frameType: ws.TypeTeamEvent},
		{eventType: bus.EventTypeTeamAssignmentDone, frameType: ws.TypeTeamAssignmentDone},
		{eventType: bus.EventTypeTeamAssignmentFail, frameType: ws.TypeTeamAssignmentFailed},
		{eventType: bus.EventTypeTeamSubagentStream, frameType: ws.TypeTeamSubagentStream},
	} {
		teamEvent := teamEvent
		a.bus.Subscribe(teamEvent.eventType, func(ctx context.Context, event bus.Event) {
			payload, ok := event.Payload.(map[string]interface{})
			if !ok {
				return
			}
			frame := ws.NewFrame(teamEvent.frameType, payload)
			sessionID, _ := payload["session_id"].(string)
			if sessionID != "" {
				a.mgr.PushToSession(sessionID, frame)
				return
			}
			if teamEvent.pushUserIfNoSess {
				userID, _ := payload["user_id"].(string)
				if userID != "" {
					a.mgr.PushToUser(userID, frame)
				}
			}
		})
	}
}

// ── Contact / social events ─────────────────────────────────────────────

func (a *App) subscribeContactEvents() {
	a.bus.Subscribe(bus.EventTypeFriendRequest, func(ctx context.Context, event bus.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		receiverID, _ := payload["receiver_id"].(string)
		if receiverID != "" {
			if err := a.NotificationService.Notify(ctx, receiverID, model.TypeFriendRequest, payload); err != nil {
				slog.Warn("failed to notify friend.request",
					"receiver_id", receiverID,
					"error", err,
				)
				if metrics.NotificationDeliveryFailures != nil {
					metrics.NotificationDeliveryFailures.WithLabelValues("friend_request").Inc()
				}
			}
		}
	})

	a.bus.Subscribe(ws.TypeFriendAccepted, func(ctx context.Context, event bus.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		userID, _ := payload["user_id"].(string)
		if userID == "" {
			return
		}
		a.mgr.PushToUser(userID, ws.NewFrame(ws.TypeFriendAccepted, payload))
	})
}

// ── Session lifecycle events ────────────────────────────────────────────

func (a *App) subscribeSessionEvents() {
	a.bus.Subscribe(ws.TypeSessionCreated, func(ctx context.Context, event bus.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeSessionCreated, payload)
		if members := payloadStringSlice(payload, "members"); len(members) > 0 {
			for _, userID := range members {
				a.mgr.PushToUser(userID, frame)
			}
			return
		}
		sessionID, _ := payload["session_id"].(string)
		a.mgr.PushToSession(sessionID, frame)
	})

	for _, eventType := range []string{
		ws.TypeSessionMemberJoined,
		ws.TypeSessionMemberLeft,
		ws.TypeSessionInfoUpdated,
		ws.TypeSessionDissolved,
	} {
		eventType := eventType
		a.bus.Subscribe(eventType, func(ctx context.Context, event bus.Event) {
			payload, ok := event.Payload.(map[string]interface{})
			if !ok {
				return
			}
			sessionID, _ := payload["session_id"].(string)
			if sessionID == "" {
				return
			}
			a.mgr.PushToSession(sessionID, ws.NewFrame(eventType, payload))
		})
	}
}

func payloadStringSlice(payload map[string]interface{}, key string) []string {
	switch value := payload[key].(type) {
	case []string:
		return value
	case []interface{}:
		result := make([]string, 0, len(value))
		for _, item := range value {
			if s, ok := item.(string); ok && s != "" {
				result = append(result, s)
			}
		}
		return result
	default:
		return nil
	}
}

// ── WebSocket route callbacks ──────────────────────────────────────────────

func (a *App) onRouteSet(userID, deviceType, deviceID, connID, oldConnID string, wasOffline bool) {
	ctx := a.bg.Ctx()

	if oldConnID != "" && oldConnID != connID {
		_ = a.CacheClient.MarkKicked(ctx, oldConnID)
		a.mgr.PushToConn(oldConnID, ws.NewFrame(ws.TypeDeviceKicked, map[string]string{
			"reason": "logged_in_elsewhere",
		}))
		if c := a.mgr.FindByConnID(oldConnID); c != nil {
			c.Close()
		}
	}

	routeField := deviceType
	if deviceID != "" {
		routeField = deviceType + ":" + deviceID
	}
	if err := a.CacheClient.SetRoute(ctx, userID, routeField, connID); err != nil {
		slog.Error("ws set route failed; online-status broadcast skipped",
			"user_id", userID, "route_field", routeField, "conn_id", connID, "error", err)
		if metrics.WSRouteSetFailures != nil {
			metrics.WSRouteSetFailures.Inc()
		}
		// Do not broadcast online status: the route table does not track
		// this connection, so advertising "online" would mislead peers whose
		// route lookups would miss. Pending-task pushes use connID directly
		// and are not affected by the route table, so they still proceed.
	} else if wasOffline {
		go a.broadcastOnlineStatus(ctx, userID, true)
	}

	if deviceType == "desktop" {
		if deviceID != "" {
			go a.pushPendingTargetTasks(ctx, userID, deviceID, connID)
			go a.pushPendingAgentControls(ctx, userID, deviceID, connID)
		}
		go a.pushPendingTasks(ctx, userID, connID)
	}
}

func (a *App) pushPendingTargetTasks(ctx context.Context, userID, deviceID, connID string) {
	tasks, err := a.CacheClient.ListPendingTargetTasksForDevice(ctx, userID, deviceID)
	if err != nil || len(tasks) == 0 {
		return
	}
	for _, task := range tasks {
		a.replayTargetBoundTask(ctx, userID, deviceID, connID, task)
	}
}

// replayTargetBoundTask replays one target-bound pending task onto the
// connection. Tasks that were already handed to the outbox, failed to
// dispatch, or could not be queued stay pending in the offline list.
func (a *App) replayTargetBoundTask(ctx context.Context, userID, deviceID, connID string, task cache.PendingTargetTask) {
	var payload json.RawMessage
	if json.Unmarshal([]byte(task.Payload), &payload) != nil {
		return
	}
	var meta struct {
		TaskID     string `json:"task_id"`
		DeliveryID string `json:"delivery_id"`
	}
	_ = json.Unmarshal([]byte(task.Payload), &meta)
	if meta.DeliveryID != "" && a.AgentService != nil {
		status, stErr := a.AgentService.GetDeliveryStatus(ctx, meta.DeliveryID)
		if !dispatch.ShouldReplayOfflinePayload(meta.DeliveryID, status, stErr == nil) {
			slog.Info("skip target-bound offline replay; outbox owns delivery",
				"task_id", meta.TaskID, "delivery_id", meta.DeliveryID,
				"outbox_status", status, "user_id", userID, "device_id", deviceID)
			// Drop from offline queue so it cannot dual-fire later.
			if err := a.CacheClient.AckPendingTargetTask(ctx, userID, task.TargetID, deviceID, task.Payload); err != nil {
				slog.Error("failed to ack target-bound queued task in skip-replay branch",
					"task_id", meta.TaskID, "target_id", task.TargetID,
					"user_id", userID, "device_id", deviceID, "error", err)
			}
			return
		}
	}
	if meta.TaskID != "" {
		if err := a.AgentService.UpdatePendingTaskDispatched(meta.TaskID, deviceID); err != nil {
			slog.Error("failed to mark target-bound queued task dispatched", "task_id", meta.TaskID, "user_id", userID, "device_id", deviceID, "error", err)
			return
		}
	}
	result := a.mgr.PushToConn(connID, ws.NewFrame(ws.TypeAgentDispatch, payload))
	if !result.Queued {
		slog.Warn("target-bound queued task replay not queued; keeping pending task", "task_id", meta.TaskID, "target_id", task.TargetID, "user_id", userID, "device_id", deviceID, "conn_id", connID, "delivery_status", result.Status, "error", result.Err)
		return
	}
	if err := a.CacheClient.AckPendingTargetTask(ctx, userID, task.TargetID, deviceID, task.Payload); err != nil {
		slog.Error("failed to ack target-bound queued task", "task_id", meta.TaskID, "target_id", task.TargetID, "user_id", userID, "device_id", deviceID, "error", err)
		return
	}
	if meta.DeliveryID != "" && a.AgentService != nil {
		if err := a.AgentService.MarkDeliverySent(ctx, meta.DeliveryID); err != nil {
			slog.Warn("failed to mark target-bound offline-replayed delivery sent",
				"task_id", meta.TaskID, "delivery_id", meta.DeliveryID, "error", err)
		}
	}
}

func (a *App) pushPendingAgentControls(ctx context.Context, userID, deviceID, connID string) {
	controls, err := a.CacheClient.ListPendingAgentControlsForDevice(ctx, userID, deviceID)
	if err != nil || len(controls) == 0 {
		return
	}
	for _, controlJSON := range controls {
		var payload json.RawMessage
		if json.Unmarshal([]byte(controlJSON), &payload) == nil {
			result := a.mgr.PushToConn(connID, ws.NewFrame(ws.TypeAgentControl, payload))
			if !result.Queued {
				slog.Warn("agent control replay not queued; keeping pending control", "user_id", userID, "device_id", deviceID, "conn_id", connID, "delivery_status", result.Status, "error", result.Err)
				continue
			}
			if err := a.CacheClient.AckPendingAgentControl(ctx, userID, deviceID, controlJSON); err != nil {
				slog.Error("failed to ack pending agent control", "user_id", userID, "device_id", deviceID, "error", err)
				continue
			}
		}
	}
}

func (a *App) pushPendingTasks(ctx context.Context, userID, connID string) {
	tasks, err := a.CacheClient.PopPendingTasks(ctx, userID)
	if err != nil || len(tasks) == 0 {
		return
	}
	conn := a.mgr.FindByConnID(connID)
	edgeDeviceID := ""
	if conn != nil {
		edgeDeviceID = conn.DeviceID
	}
	failedTasks := make([]string, 0)
	for _, taskJSON := range tasks {
		if a.replayPendingTask(ctx, userID, connID, edgeDeviceID, taskJSON) {
			failedTasks = append(failedTasks, taskJSON)
		}
	}
	// Requeue failed deliveries. Use the eviction-aware push so the cap
	// (pendingTaskQueueMaxLen, mirroring the control queue) is enforced and
	// evicted oldest tasks are counted via client_pending_dropped_total
	// instead of being silently lost. Also warn when the queue is close to
	// the TTL horizon so operators can act before silent expiry drops tasks.
	for i := len(failedTasks) - 1; i >= 0; i-- {
		evicted, err := a.CacheClient.PushPendingTaskWithEviction(ctx, userID, failedTasks[i])
		if err != nil {
			slog.Error("failed to requeue pending task after websocket delivery failure",
				"user_id", userID, "conn_id", connID, "error", err)
			if metrics.AgentDispatchOfflinePushFailures != nil {
				metrics.AgentDispatchOfflinePushFailures.WithLabelValues("pending_task_requeue").Inc()
			}
			continue
		}
		if evicted {
			// The cap evicted an oldest pending task. Record the drop so the
			// operator sees the backpressure event instead of Redis quietly
			// trimming the list.
			if metrics.ClientPendingDropped != nil {
				metrics.ClientPendingDropped.Inc()
			}
			slog.Warn("pending task queue saturated; evicted oldest task to requeue failed delivery",
				"user_id", userID, "conn_id", connID,
				"requeued_task", failedTasks[i])
		}
		// Warn when the queue is close to the TTL horizon. PendingTaskTTL is
		// 24h; we cannot read the per-entry TTL cheaply here, so this warning
		// is a saturation proxy: when eviction is happening, the queue is
		// also at risk of silent TTL expiry. The metric above is the durable
		// signal; this log line is the operator breadcrumb.
	}
}

// replayPendingTask replays one popped pending task onto the connection.
// Returns true when the frame could not be queued and the task must be
// requeued for a later attempt.
func (a *App) replayPendingTask(ctx context.Context, userID, connID, edgeDeviceID, taskJSON string) bool {
	var payload json.RawMessage
	if json.Unmarshal([]byte(taskJSON), &payload) != nil {
		return false
	}
	var meta struct {
		TaskID     string `json:"task_id"`
		DeliveryID string `json:"delivery_id"`
	}
	_ = json.Unmarshal([]byte(taskJSON), &meta)
	// Coordinate offline reconnect with outbox ownership (#1031): do not
	// re-fire deliveries already sent/acked (outbox redispatch owns those).
	if meta.DeliveryID != "" && a.AgentService != nil {
		status, stErr := a.AgentService.GetDeliveryStatus(ctx, meta.DeliveryID)
		if !dispatch.ShouldReplayOfflinePayload(meta.DeliveryID, status, stErr == nil) {
			slog.Info("skip offline reconnect replay; outbox owns delivery",
				"task_id", meta.TaskID, "delivery_id", meta.DeliveryID,
				"outbox_status", status, "user_id", userID)
			return false
		}
	}
	if meta.TaskID != "" {
		if err := a.AgentService.UpdatePendingTaskDispatched(meta.TaskID, edgeDeviceID); err != nil {
			slog.Error("failed to mark queued task dispatched", "task_id", meta.TaskID, "user_id", userID, "device_id", edgeDeviceID, "error", err)
			return false
		}
	}
	result := a.mgr.PushToConn(connID, ws.NewFrame(ws.TypeAgentDispatch, payload))
	if !result.Queued {
		slog.Warn("queued task replay not queued; requeueing pending task", "task_id", meta.TaskID, "user_id", userID, "device_id", edgeDeviceID, "conn_id", connID, "delivery_status", result.Status, "error", result.Err)
		return true
	}
	// Live reconnect push: mark outbox sent so SentTimeout owns further
	// recovery until Edge ack/stream (avoid dual offline+outbox fire) (#1031).
	if meta.DeliveryID != "" && a.AgentService != nil {
		if err := a.AgentService.MarkDeliverySent(ctx, meta.DeliveryID); err != nil {
			slog.Warn("failed to mark offline-replayed delivery sent",
				"task_id", meta.TaskID, "delivery_id", meta.DeliveryID, "error", err)
		}
	}
	return false
}

func (a *App) onRouteDel(userID, deviceType, deviceID, connID string) {
	ctx := a.bg.Ctx()

	kicked, _ := a.CacheClient.IsKicked(ctx, connID)
	if !kicked {
		routeField := deviceType
		if deviceID != "" {
			routeField = deviceType + ":" + deviceID
		}
		_ = a.CacheClient.DeleteRoute(ctx, userID, routeField)
		online, _ := a.CacheClient.IsOnline(ctx, userID)
		if !online {
			go a.broadcastOnlineStatus(ctx, userID, false)
		}
	}
}

func (a *App) broadcastOnlineStatus(ctx context.Context, userID string, online bool) {
	friendIDs, err := a.ContactService.GetFriendIDs(userID)
	if err != nil || len(friendIDs) == 0 {
		return
	}

	var eventType string
	if online {
		eventType = ws.TypeDeviceOnline
	} else {
		eventType = ws.TypeDeviceOffline
	}

	frame := ws.NewFrame(eventType, map[string]string{"user_id": userID})
	// One pipelined presence round trip for all friends instead of one per
	// friend (#2154 perf lane); errors degrade to no fanout.
	onlineSet, err := a.CacheClient.AreOnline(ctx, friendIDs)
	if err != nil {
		return
	}
	for _, friendID := range friendIDs {
		if onlineSet[friendID] {
			a.mgr.PushToUser(friendID, frame)
		}
	}
}
