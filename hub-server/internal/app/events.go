package app

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
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
		ctx := a.coreCtx
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
	a.WebSocketHandler.SetOnTyping(func(userID, sessionID string) {
		frame := ws.NewFrame(ws.TypeTyping, map[string]interface{}{
			"user_id":    userID,
			"session_id": sessionID,
		})
		members, err := a.SessionService.ListActiveMembers(sessionID)
		if err != nil {
			return
		}
		senderIsMember := false
		for _, member := range members {
			if member.MemberID == userID {
				senderIsMember = true
				break
			}
		}
		if !senderIsMember {
			return
		}
		for _, member := range members {
			if member.MemberID != userID {
				a.mgr.PushToUser(member.MemberID, frame)
			}
		}
	})
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
	a.bus.Subscribe("message.new", func(ctx context.Context, event service.Event) {
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

	a.bus.Subscribe("message.recall", func(ctx context.Context, event service.Event) {
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

	a.bus.Subscribe("message.pin", func(ctx context.Context, event service.Event) {
		pin, ok := event.Payload.(*model.MessagePin)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeMessagePin, pin)
		a.mgr.PushToSession(pin.SessionID, frame)
	})

	a.bus.Subscribe("message.unpin", func(ctx context.Context, event service.Event) {
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
		a.bus.Subscribe(reactionEvent.eventType, func(ctx context.Context, event service.Event) {
			payload, ok := event.Payload.(messagereaction.MessageReactionEventPayload)
			if !ok {
				return
			}
			frame := ws.NewFrame(reactionEvent.frameType, payload)
			a.mgr.PushToSession(payload.SessionID, frame)
		})
	}

	a.bus.Subscribe("message.read", func(ctx context.Context, event service.Event) {
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
	a.bus.Subscribe(ws.TypeAgentStream, func(ctx context.Context, event service.Event) {
		runEvent, ok := event.Payload.(*model.AgentRunEvent)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentStream, runEvent)
		a.mgr.PushToSession(runEvent.SessionID, frame)
	})

	a.bus.Subscribe("agent.done", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentDone, payload)
		sessionID, _ := payload["session_id"].(string)
		a.mgr.PushToSession(sessionID, frame)

		taskID, _ := payload["task_id"].(string)
		if taskID != "" {
			task, err := a.AgentService.GetPendingTaskByID(taskID)
			if err == nil && task != nil {
				if err := a.NotificationService.Notify(ctx, task.TriggeredByUserID, model.TypeAgentDone, map[string]interface{}{
					"task_id":           payload["task_id"],
					"agent_instance_id": payload["agent_instance_id"],
					"session_id":        payload["session_id"],
				}); err != nil {
					slog.Warn("failed to notify agent.done",
						"task_id", taskID,
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

	a.bus.Subscribe("agent.failed", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentFailed, payload)
		sessionID, _ := payload["session_id"].(string)
		a.mgr.PushToSession(sessionID, frame)
	})

	a.bus.Subscribe("agent.timeout", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentFailed, payload)
		sessionID, _ := payload["session_id"].(string)
		a.mgr.PushToSession(sessionID, frame)
	})

	a.bus.Subscribe("agent.cancel", func(ctx context.Context, event service.Event) {
		payload, ok := event.Payload.(map[string]string)
		if !ok {
			return
		}
		frame := ws.NewFrame(ws.TypeAgentCancel, payload)
		sessionID := payload["session_id"]
		a.mgr.PushToSession(sessionID, frame)
	})
}

// ── Team events ─────────────────────────────────────────────────────────

func (a *App) subscribeTeamEvents() {
	for _, teamEvent := range []struct {
		eventType        string
		frameType        string
		pushUserIfNoSess bool
	}{
		{eventType: "team.run.started", frameType: ws.TypeTeamRunStarted, pushUserIfNoSess: true},
		{eventType: "team.event", frameType: ws.TypeTeamEvent},
		{eventType: "team.assignment.completed", frameType: ws.TypeTeamAssignmentDone},
		{eventType: "team.assignment.failed", frameType: ws.TypeTeamAssignmentFailed},
	} {
		teamEvent := teamEvent
		a.bus.Subscribe(teamEvent.eventType, func(ctx context.Context, event service.Event) {
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
	a.bus.Subscribe("friend.request", func(ctx context.Context, event service.Event) {
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

	a.bus.Subscribe(ws.TypeFriendAccepted, func(ctx context.Context, event service.Event) {
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
	a.bus.Subscribe(ws.TypeSessionCreated, func(ctx context.Context, event service.Event) {
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
		a.bus.Subscribe(eventType, func(ctx context.Context, event service.Event) {
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
	ctx := a.coreCtx

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
	_ = a.CacheClient.SetRoute(ctx, userID, routeField, connID)

	if wasOffline {
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
		var payload json.RawMessage
		if json.Unmarshal([]byte(task.Payload), &payload) == nil {
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
					_ = a.CacheClient.AckPendingTargetTask(ctx, userID, task.TargetID, deviceID, task.Payload)
					continue
				}
			}
			if meta.TaskID != "" {
				if err := a.AgentService.UpdatePendingTaskDispatched(meta.TaskID, deviceID); err != nil {
					slog.Error("failed to mark target-bound queued task dispatched", "task_id", meta.TaskID, "user_id", userID, "device_id", deviceID, "error", err)
					continue
				}
			}
			result := a.mgr.PushToConn(connID, ws.NewFrame(ws.TypeAgentDispatch, payload))
			if !result.Queued {
				slog.Warn("target-bound queued task replay not queued; keeping pending task", "task_id", meta.TaskID, "target_id", task.TargetID, "user_id", userID, "device_id", deviceID, "conn_id", connID, "delivery_status", result.Status, "error", result.Err)
				continue
			}
			if err := a.CacheClient.AckPendingTargetTask(ctx, userID, task.TargetID, deviceID, task.Payload); err != nil {
				slog.Error("failed to ack target-bound queued task", "task_id", meta.TaskID, "target_id", task.TargetID, "user_id", userID, "device_id", deviceID, "error", err)
				continue
			}
			if meta.DeliveryID != "" && a.AgentService != nil {
				if err := a.AgentService.MarkDeliverySent(ctx, meta.DeliveryID); err != nil {
					slog.Warn("failed to mark target-bound offline-replayed delivery sent",
						"task_id", meta.TaskID, "delivery_id", meta.DeliveryID, "error", err)
				}
			}
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
		var payload json.RawMessage
		if json.Unmarshal([]byte(taskJSON), &payload) == nil {
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
					continue
				}
			}
			if meta.TaskID != "" {
				if err := a.AgentService.UpdatePendingTaskDispatched(meta.TaskID, edgeDeviceID); err != nil {
					slog.Error("failed to mark queued task dispatched", "task_id", meta.TaskID, "user_id", userID, "device_id", edgeDeviceID, "error", err)
					continue
				}
			}
			result := a.mgr.PushToConn(connID, ws.NewFrame(ws.TypeAgentDispatch, payload))
			if !result.Queued {
				slog.Warn("queued task replay not queued; requeueing pending task", "task_id", meta.TaskID, "user_id", userID, "device_id", edgeDeviceID, "conn_id", connID, "delivery_status", result.Status, "error", result.Err)
				failedTasks = append(failedTasks, taskJSON)
				continue
			}
			// Live reconnect push: mark outbox sent so SentTimeout owns further
			// recovery until Edge ack/stream (avoid dual offline+outbox fire) (#1031).
			if meta.DeliveryID != "" && a.AgentService != nil {
				if err := a.AgentService.MarkDeliverySent(ctx, meta.DeliveryID); err != nil {
					slog.Warn("failed to mark offline-replayed delivery sent",
						"task_id", meta.TaskID, "delivery_id", meta.DeliveryID, "error", err)
				}
			}
		}
	}
	for i := len(failedTasks) - 1; i >= 0; i-- {
		if err := a.CacheClient.PushPendingTask(ctx, userID, failedTasks[i]); err != nil {
			slog.Error("failed to requeue pending task after websocket delivery failure", "user_id", userID, "conn_id", connID, "error", err)
		}
	}
}

func (a *App) onRouteDel(userID, deviceType, deviceID, connID string) {
	ctx := a.coreCtx

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
	for _, friendID := range friendIDs {
		if online, _ := a.CacheClient.IsOnline(ctx, friendID); online {
			a.mgr.PushToUser(friendID, frame)
		}
	}
}
