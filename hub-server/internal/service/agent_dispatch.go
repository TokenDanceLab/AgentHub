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
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"github.com/agenthub/hub-server/internal/ws"
)

// dispatchPayload is the payload sent to the edge for agent.dispatch
type dispatchPayload struct {
	TaskID           string `json:"task_id"`
	DeliveryID       string `json:"delivery_id,omitempty"`
	AgentInstanceID  string `json:"agent_instance_id"`
	AgentType        string `json:"agent_type"`
	CustomAgentID    string `json:"custom_agent_id,omitempty"`
	TargetID         string `json:"target_id,omitempty"`
	EdgeDeviceID     string `json:"edge_device_id,omitempty"`
	SessionID        string `json:"session_id"`
	TriggerMessageID string `json:"trigger_message_id"`
	TriggerUserID    string `json:"trigger_user_id"`
	Prompt           string `json:"prompt"`
	DisplayName      string `json:"display_name"`
	SystemPrompt     string `json:"system_prompt,omitempty"`
	ModelParams      string `json:"model_params,omitempty"`
	ToolWhitelist    string `json:"tool_whitelist,omitempty"`
	TeamID           string `json:"team_id,omitempty"`
	TeamRunID        string `json:"team_run_id,omitempty"`
	TeamMemberID     string `json:"team_member_id,omitempty"`
	TeamMemberRole   string `json:"team_member_role,omitempty"`
	// Context continuity: thread history and pinned messages for all agent runtimes.
	Messages       []dispatchMessage `json:"messages,omitempty"`
	PinnedMessages []dispatchMessage `json:"pinned_messages,omitempty"`
	// OutputSchema is the JSON Schema for structured output (--json-schema).
	OutputSchema *json.RawMessage `json:"structured_output_schema,omitempty"`
}

// dispatchMessage is a same-package alias for the pure dispatch.Message DTO so
// payload JSON tags and redispatch unmarshaling stay stable (#756).
type dispatchMessage = dispatch.Message

// Same-package aliases for pure dispatch DTOs (#768 residual).
type dispatchTeamContext = dispatch.TeamContext
type dispatchTargetSnapshot = dispatch.TargetSnapshot
type pendingTaskSnapshot = dispatch.PendingTaskSnapshot
type edgeRunResponse = dispatch.EdgeRunResponse

// ── DispatchService ports + type ─────────────────────────────────────────────
//
// Residual pure surface (#768) after #756/#732 pure helpers, thin first seam
// (#563), redispatch residual (#573), and residual ports (#617). Pure surface
// lives in service/dispatch (loopback / runtime type / select / merge /
// prompt+history text / task-status / edge constants / Message DTO / Edge run
// request builder / team+target+capability+redelivery pure helpers) with thin
// same-package aliases below. Orchestration + ports stay flat; dispatchPayload
// stays package-private; no OpenAPI/handler/frontend; no typed DispatchService
// package move.

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
// retries call in through Redispatcher; dispatchPayload stays package-private.
// Same-package extract (#563/#573/#617) + pure helpers in service/dispatch
// (#732/#756) - typed package move still deferred.
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
	if s == nil || s.bus == nil {
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
	if s == nil || s.outbox == nil {
		return "", errors.New("dispatch outbox unavailable")
	}
	return s.outbox.RecordDelivery(ctx, taskID, payload, edgeDeviceID)
}

// markDeliverySent is a nil-safe wrapper over the outbox port.
func (s *DispatchService) markDeliverySent(ctx context.Context, deliveryID string) error {
	if s == nil || s.outbox == nil {
		return errors.New("dispatch outbox unavailable")
	}
	return s.outbox.MarkDeliverySent(ctx, deliveryID)
}

// moveDeliveryToDeadLetter is a nil-safe wrapper over the outbox port used by redispatch.
func (s *DispatchService) moveDeliveryToDeadLetter(ctx context.Context, deliveryID, lastError string) {
	if s == nil || s.outbox == nil {
		return
	}
	_ = s.outbox.MoveDeliveryToDeadLetter(ctx, deliveryID, lastError)
}

// dispatchToEdgeHTTP attempts to dispatch a task directly via HTTP POST to a
// local Edge server. Returns the Edge run ID on success, or empty string if
// the Edge server is unreachable or returns an error.
func (s *DispatchService) dispatchToEdgeHTTP(ctx context.Context, task *model.PendingAgentTask, dp *dispatchPayload) string {
	edgeURL := dispatch.ResolveEdgeHTTPURL(os.Getenv("AGENTHUB_EDGE_URL"))

	// AH-SR-053: Warn when AGENTHUB_EDGE_URL is non-loopback and non-HTTPS —
	// dispatch payloads contain user prompts and system instructions sent in
	// cleartext over the network.
	if dispatch.IsInsecureNonLoopbackEdge(edgeURL) {
		slog.Error("edge http dispatch: non-loopback URL without TLS, dispatch payloads sent in cleartext", "edge_url", edgeURL)
		return ""
	}

	// Build the Edge run request from the dispatch payload (pure builder #756).
	reqBody := dispatch.BuildEdgeRunRequest(
		dp.Prompt,
		dp.AgentType,
		dp.SystemPrompt,
		task.ID,
		dp.DeliveryID,
		dp.Messages,
		dp.PinnedMessages,
		dp.OutputSchema,
	)

	body, err := json.Marshal(reqBody)
	if err != nil {
		slog.Error("edge http dispatch: failed to marshal request", "task_id", task.ID, "error", err)
		return ""
	}

	url := edgeURL + "/v1/runs"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		slog.Error("edge http dispatch: failed to create request", "task_id", task.ID, "error", err)
		return ""
	}
	httpReq.Header.Set("Content-Type", "application/json")

	// AH-SR-014: If AGENTHUB_EDGE_AUTH_TOKEN is configured, pass it as a
	// Bearer token so the Edge server's localAuthMiddleware can verify it.
	// This is the shared-secret trust chain between Hub and Edge for HTTP
	// dispatch. In dev mode (AGENTHUB_DEV=1) the Edge skips auth entirely.
	if edgeAuthToken := dispatch.EdgeAuthBearerToken(os.Getenv("AGENTHUB_EDGE_AUTH_TOKEN")); edgeAuthToken != "" {
		httpReq.Header.Set("Authorization", "Bearer "+edgeAuthToken)
	}
	// AH-SR-046: attach per-run capability when Hub JWT secret and Edge device are known.
	if capToken := s.issueRunStartCapability(dp); capToken != "" {
		httpReq.Header.Set("X-AgentHub-Capability-Token", capToken)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		slog.Debug("edge http dispatch: edge server unreachable", "task_id", task.ID, "url", url, "error", err)
		return ""
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))

	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		slog.Warn("edge http dispatch: edge returned non-success", "task_id", task.ID, "status", resp.StatusCode, "body", string(respBody))
		return ""
	}

	runID, err := dispatch.ParseEdgeRunID(respBody)
	if err != nil {
		slog.Warn("edge http dispatch: failed to decode response", "task_id", task.ID, "error", err)
		return ""
	}
	slog.Info("edge http dispatch: task dispatched to local Edge", "task_id", task.ID, "edge_run_id", runID, "url", url)
	return runID
}

// Thin aliases to service/dispatch pure helpers (#732/#756). Keep same-package
// call sites and existing tests stable without re-embedding helper bodies here.
func isLoopback(rawURL string) bool {
	return dispatch.IsLoopback(rawURL)
}

func normalizeRuntimeAgentType(agentType string) string {
	return dispatch.NormalizeRuntimeAgentType(agentType)
}

func selectAgentInstance(agents []model.AgentInstance, targetAgentInstanceID, targetAgentType, targetCustomAgentID string) (*model.AgentInstance, error) {
	return dispatch.SelectAgentInstance(agents, targetAgentInstanceID, targetAgentType, targetCustomAgentID)
}

func mergeModelParams(base, override string) string {
	return dispatch.MergeModelParams(base, override)
}

func isTerminalTaskStatus(status string) bool {
	return dispatch.IsTerminalTaskStatus(status)
}

func canRegenerateTaskStatus(status string) bool {
	return dispatch.CanRegenerateTaskStatus(status)
}

func isRetryableTaskStatus(status string) bool {
	return dispatch.IsRetryableTaskStatus(status)
}

// TriggerAgentTask creates a pending task for an agent and dispatches it to the inviter's edge.
func (s *DispatchService) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	msg, err := repository.GetMessageByID(s.db, triggerMessageID)
	if err != nil {
		return nil, errcode.MsgNotFound
	}

	// #116: reject new agent tasks for dissolved sessions
	session, err := repository.GetSessionByID(s.db, msg.SessionID)
	if err != nil {
		return nil, errcode.SessionNotFound
	}
	if session.Dissolved {
		return nil, errcode.SessionDissolved
	}

	// find agent instances in this session invited by this user
	agents, err := repository.ListAgentInstancesByInviter(s.db, msg.SessionID, userID)
	if err != nil || len(agents) == 0 {
		return nil, errcode.AgentNotFound
	}
	ai, err := selectAgentInstance(agents, targetAgentInstanceID, targetAgentType, targetCustomAgentID)
	if err != nil {
		return nil, err
	}

	// check for active member
	active, _ := repository.IsMemberActive(s.db, ai.SessionID, model.MemberTypeUser, userID)
	if !active {
		return nil, errcode.SessionNotMember
	}

	dispatchTarget, err := s.validateDispatchTarget(ctx, userID, targetID)
	if err != nil {
		return nil, err
	}
	targetType := ""
	if dispatchTarget != nil {
		targetID = dispatchTarget.ID
		targetType = dispatchTarget.TargetType
	} else {
		targetID = ""
	}

	task := &model.PendingAgentTask{
		AgentInstanceID:   ai.ID,
		TriggeredByUserID: userID,
		TriggerMessageID:  triggerMessageID,
		TargetID:          targetID,
		Status:            model.TaskStatusQueued,
		ExpireAt:          time.Now().Add(config.PendingTaskTTL),
	}
	if dispatchTarget != nil {
		task.EdgeDeviceID = dispatchTarget.DeviceID
	}
	if err := repository.CreatePendingTask(s.db, task); err != nil {
		return nil, err
	}

	// Pre-query the CustomAgent to avoid a DB query inside the dispatch goroutine.
	var customAgent *model.CustomAgent
	if ai.CustomAgentID != nil && *ai.CustomAgentID != "" {
		ca, err := repository.GetCustomAgentByID(s.db, *ai.CustomAgentID)
		if err == nil {
			customAgent = ca
		}
	}

	// #100: Use context.WithoutCancel so the dispatch goroutine is not
	// cancelled when the HTTP handler's request context is cancelled.
	go s.dispatchTask(context.WithoutCancel(ctx), task, ai, promptFromMessage(msg), modelParams, targetType, customAgent)

	return task, nil
}

func (s *DispatchService) validateDispatchTarget(ctx context.Context, userID, targetID string) (*dispatchTargetSnapshot, error) {
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return nil, nil
	}
	target, err := repository.GetExecutionTargetByID(s.db.WithContext(ctx), targetID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.TargetNotFound
		}
		return nil, err
	}
	// Pure ownership / type / health / binding checks (#768) — order matches prior
	// behavior so error precedence stays stable.
	if err := dispatch.ValidateTargetOwner(target.OwnerID, userID); err != nil {
		return nil, err
	}
	if err := dispatch.ValidateTargetType(target.TargetType); err != nil {
		return nil, err
	}
	healthState := resolveExecutionTargetHealthState(target, time.Now())
	if err := dispatch.ValidateTargetHealth(healthState); err != nil {
		return nil, err
	}
	deviceID, err := dispatch.BoundDeviceID(target.DeviceID)
	if err != nil {
		return nil, err
	}
	device, err := repository.GetDeviceByID(s.db.WithContext(ctx), deviceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.TargetNotRoutable.WithMessage("execution target device is not routable")
		}
		return nil, err
	}
	if err := dispatch.ValidateTargetDevice(userID, device.UserID, device.DeviceType); err != nil {
		return nil, err
	}
	return dispatch.NewTargetSnapshot(target.ID, target.TargetType, deviceID), nil
}

func promptFromMessage(msg *model.Message) string {
	return dispatch.PromptFromMessage(msg)
}

func (s *DispatchService) dispatchTask(ctx context.Context, task *model.PendingAgentTask, ai *model.AgentInstance, prompt, modelParams, targetType string, customAgent *model.CustomAgent) {
	dp := dispatchPayload{
		TaskID:           task.ID,
		AgentInstanceID:  ai.ID,
		AgentType:        normalizeRuntimeAgentType(ai.AgentType),
		TargetID:         task.TargetID,
		EdgeDeviceID:     task.EdgeDeviceID,
		SessionID:        ai.SessionID,
		TriggerMessageID: task.TriggerMessageID,
		TriggerUserID:    task.TriggeredByUserID,
		Prompt:           prompt,
		DisplayName:      ai.DisplayName,
	}

	if ai.CustomAgentID != nil && *ai.CustomAgentID != "" {
		dp.CustomAgentID = *ai.CustomAgentID
		if customAgent != nil {
			dp.SystemPrompt = customAgent.SystemPrompt
			dp.ModelParams = customAgent.ModelParams
			dp.ToolWhitelist = customAgent.ToolWhitelist
			dp.OutputSchema = customAgent.OutputSchema
		}
	}
	dp.ModelParams = mergeModelParams(dp.ModelParams, modelParams)
	if teamContext := s.resolveDispatchTeamContext(ai); teamContext.TeamRunID != "" {
		dp.TeamID = teamContext.TeamID
		dp.TeamRunID = teamContext.TeamRunID
		dp.TeamMemberID = teamContext.TeamMemberID
		dp.TeamMemberRole = teamContext.TeamMemberRole
	}

	// Load thread history for context continuity (all agent runtimes).
	dp.Messages = s.loadThreadHistory(ai.SessionID, task.TriggerMessageID)
	dp.PinnedMessages = s.loadPinnedMessages(ai.SessionID)

	// Record delivery in outbox before dispatching (AH-SR-049).
	payload, _ := json.Marshal(dp)
	deliveryID, err := s.recordDelivery(ctx, task.ID, string(payload), task.EdgeDeviceID)
	if err != nil {
		// Still dispatch for availability, but durability is degraded until outbox is healthy.
		slog.Error("AH-SR-049 delivery outbox record failed; dispatch continues without durable tracking",
			"task_id", task.ID, "edge_device_id", task.EdgeDeviceID, "error", err)
	} else {
		dp.DeliveryID = deliveryID
		// Re-serialize with delivery_id included.
		payload, _ = json.Marshal(dp)
	}

	// Try HTTP direct dispatch to local Edge server first.
	// Only attempt when there is no explicit target binding (unbound tasks
	// that would otherwise go through WebSocket push or offline queue).
	if task.TargetID == "" {
		if edgeRunID := s.dispatchToEdgeHTTP(ctx, task, &dp); edgeRunID != "" {
			// Mark as dispatched with a synthetic device ID indicating HTTP dispatch.
			if err := repository.UpdatePendingTaskDispatched(s.db, task.ID, dispatch.SyntheticHTTPEdgeDeviceID); err != nil {
				slog.Error("failed to mark http-dispatched task", "task_id", task.ID, "error", err)
			}
			// Mark delivery as sent.
			if deliveryID != "" {
				_ = s.markDeliverySent(ctx, deliveryID)
			}
			return
		}
	}

	cacheClient := s.cachePort()
	if task.TargetID != "" {
		if task.EdgeDeviceID == "" {
			slog.Error("target-bound agent task missing edge device id", "task_id", task.ID, "user_id", ai.InviterUserID, "target_id", task.TargetID)
			return
		}
		// Route by target type: hub_relay uses the relay service; all others
		// (local_edge, remote_ssh, cloud_edge, tailscale) go through the
		// device-bound WebSocket path.
		if targetType == "hub_relay" && s.relay != nil {
			_, err := s.relay.CreateCommand(ctx, ai.InviterUserID, "agent_dispatch", json.RawMessage(payload), ai.InviterUserID)
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
			if deliveryID != "" {
				_ = s.markDeliverySent(ctx, deliveryID)
			}
			return
		}
		s.dispatchTargetBoundTask(ctx, cacheClient, task, ai.InviterUserID, task.EdgeDeviceID, payload)
		if deliveryID != "" {
			_ = s.markDeliverySent(ctx, deliveryID)
		}
		return
	}

	// try to push to inviter's edge (desktop) via WebSocket
	connID, err := cacheClient.GetRoute(ctx, ai.InviterUserID, "desktop")
	if err == nil && connID != "" && s.mgr != nil {
		conn := s.mgr.FindByConnID(connID)
		if conn == nil {
			if err := cacheClient.PushPendingTask(ctx, ai.InviterUserID, string(payload)); err != nil {
				slog.Error("failed to push agent task to offline queue (conn nil)", "task_id", task.ID, "user_id", ai.InviterUserID, "error", err)
			}
			if deliveryID != "" {
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
		if deliveryID != "" {
			_ = s.markDeliverySent(ctx, deliveryID)
		}
		return
	}

	// offline: push to Redis pending queue
	if err := cacheClient.PushPendingTask(ctx, ai.InviterUserID, string(payload)); err != nil {
		slog.Error("failed to push agent task to offline queue", "task_id", task.ID, "user_id", ai.InviterUserID, "error", err)
	}
	if deliveryID != "" {
		_ = s.markDeliverySent(ctx, deliveryID)
	}
}

func (s *DispatchService) resolveDispatchTeamContext(ai *model.AgentInstance) dispatchTeamContext {
	if s == nil || s.db == nil || ai == nil || ai.CustomAgentID == nil || strings.TrimSpace(*ai.CustomAgentID) == "" {
		return dispatchTeamContext{}
	}
	run, err := repository.GetTeamRunBySessionID(s.db, ai.SessionID)
	if err != nil || run == nil || run.ID == "" {
		return dispatchTeamContext{}
	}
	members, err := repository.ListTeamMembers(s.db, run.TeamID)
	if err != nil {
		return dispatchTeamContext{}
	}
	refs := make([]dispatch.TeamMemberRef, len(members))
	for i := range members {
		refs[i] = dispatch.TeamMemberRef{
			ID:             members[i].ID,
			Role:           members[i].Role,
			AgentProfileID: members[i].AgentProfileID,
		}
	}
	return dispatch.MatchTeamContext(run.TeamID, run.ID, *ai.CustomAgentID, refs)
}

// loadThreadHistory loads recent thread messages (before the trigger message) for context continuity.
// Limits to dispatch.MaxThreadHistory messages to avoid oversized dispatch payloads.
func (s *DispatchService) loadThreadHistory(sessionID, triggerMessageID string) []dispatchMessage {
	if sessionID == "" || triggerMessageID == "" {
		return nil
	}
	triggerMsg, err := repository.GetMessageByID(s.db, triggerMessageID)
	if err != nil || triggerMsg == nil {
		return nil
	}
	msgs, err := repository.GetMessagesBySession(s.db, sessionID, triggerMsg.SeqID, dispatch.MaxThreadHistory)
	if err != nil || len(msgs) == 0 {
		return nil
	}
	// Reverse to chronological order (GetMessagesBySession returns DESC) via pure mapper (#756).
	return dispatch.MapMessagesChronological(msgs, true)
}

// loadPinnedMessages loads pinned messages for a session for context continuity.
func (s *DispatchService) loadPinnedMessages(sessionID string) []dispatchMessage {
	if sessionID == "" {
		return nil
	}
	pins, err := repository.ListPinsBySession(s.db, sessionID)
	if err != nil || len(pins) == 0 {
		return nil
	}
	messageIDs := make([]string, len(pins))
	for i, p := range pins {
		messageIDs[i] = p.MessageID
	}
	msgs, err := repository.GetMessagesByIDs(s.db, messageIDs)
	if err != nil {
		return nil
	}
	return dispatch.MapPinnedMessages(msgs)
}

// Thin aliases to service/dispatch pure helpers (#732/#756).
func extractMessageText(msg *model.Message) string {
	return dispatch.ExtractMessageText(msg)
}

func mapSenderType(t string) string {
	return dispatch.MapSenderType(t)
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

	connID, err := cacheClient.GetRouteForDevice(ctx, userID, "desktop", deviceID)
	if err != nil || connID == "" || s.mgr == nil {
		queueTargetTask("route unavailable", err)
		return
	}
	conn := s.mgr.FindByConnID(connID)
	if conn == nil || conn.UserID != userID || conn.DeviceType != "desktop" || conn.DeviceID != deviceID {
		queueTargetTask("connection mismatch", nil)
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
		queueTargetTask("websocket delivery not queued", result.Err)
	}
}

// CancelTask cancels a pending task by its ID.
func (s *DispatchService) CancelTask(ctx context.Context, userID, taskID string) error {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentTaskNotFound
		}
		return err
	}
	if task.TriggeredByUserID != userID {
		return errcode.AgentTaskNotFound
	}
	if isTerminalTaskStatus(task.Status) {
		if dispatch.IsCancelledTaskStatus(task.Status) {
			return errcode.AgentTaskCancelled
		}
		return errcode.AgentTaskTimeout
	}

	ai, err := repository.GetAgentInstanceByID(s.db, task.AgentInstanceID)
	if err != nil {
		return err
	}

	rowsAffected, err := repository.UpdatePendingTaskStatusAtomic(s.db, taskID, task.Status, model.TaskStatusCancelled, "")
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errcode.ErrBadRequest
	}

	s.publish(ctx, Event{Type: "agent.cancel", Payload: map[string]string{
		"task_id":           taskID,
		"agent_instance_id": task.AgentInstanceID,
		"session_id":        ai.SessionID,
		"triggered_by":      task.TriggeredByUserID,
	}})

	return nil
}

// RegenerateAgentTask creates a new task using the same prompt as an existing task.
// It looks up the original task, verifies ownership, and triggers a new task with
// the same trigger message, agent instance, and target.
func (s *DispatchService) RegenerateAgentTask(ctx context.Context, userID, taskID string) (*model.PendingAgentTask, error) {
	original, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentTaskNotFound
		}
		return nil, err
	}
	if original.TriggeredByUserID != userID {
		return nil, errcode.AgentTaskNotFound
	}

	// Only allow regenerating from terminal tasks (done/failed/cancelled/timeout).
	if !canRegenerateTaskStatus(original.Status) {
		return nil, errcode.ErrBadRequest.WithMessage("can only regenerate completed or failed tasks")
	}

	ai, err := repository.GetAgentInstanceByID(s.db, original.AgentInstanceID)
	if err != nil {
		return nil, err
	}

	newTask, err := s.TriggerAgentTask(ctx, userID, original.TriggerMessageID, ai.ID, ai.AgentType, "", "", original.TargetID)
	if err != nil {
		return nil, err
	}

	s.publish(ctx, Event{Type: "agent.regenerate", Payload: map[string]string{
		"original_task_id":   taskID,
		"new_task_id":        newTask.ID,
		"agent_instance_id":  ai.ID,
		"session_id":         ai.SessionID,
		"trigger_message_id": original.TriggerMessageID,
	}})

	return newTask, nil
}

// issueRunStartCapability mints a short-lived capability token for Edge dual-token auth.
// Returns empty string when secret/device are unavailable so local/dev dispatch still works.
func (s *DispatchService) issueRunStartCapability(dp *dispatchPayload) string {
	secret := strings.TrimSpace(os.Getenv("AGENTHUB_JWT_SECRET"))
	if secret == "" {
		return ""
	}
	deviceID := dispatch.ResolveCapabilityDeviceID(dp.EdgeDeviceID, os.Getenv("AGENTHUB_EDGE_DEVICE_ID"))
	if deviceID == "" {
		return ""
	}
	userID := dispatch.ResolveCapabilityUserID(dp.TriggerUserID)
	// Edge HTTP dispatch currently uses LocalProjectID / LocalThreadID; keep capability bindings aligned.
	projectID := dispatch.LocalProjectID
	token, err := jwtutil.IssueCapabilityToken([]byte(secret), userID, deviceID, projectID, dispatch.DefaultCapabilityAction, 5*time.Minute, jwtutil.CapabilityIssueOptions{
		Action:   dispatch.DefaultCapabilityAction,
		TargetID: strings.TrimSpace(dp.TargetID),
		ThreadID: dispatch.LocalThreadID,
	})
	if err != nil {
		slog.Warn("AH-SR-046 failed to issue capability token", "error", err, "device_id", deviceID)
		return ""
	}
	return token
}

// ── Redispatch residual (moved from AgentService in #573) ────────────────────

// redispatchDelivery re-dispatches a delivery by parsing the stored payload
// and routing it to the target Edge device. Owns dispatchPayload unmarshal.
// Accepts redispatchTarget only — never the private GORM row type.
func (s *DispatchService) redispatchDelivery(ctx context.Context, rec redispatchTarget) {
	// Parse the payload to get dispatch info.
	var dp dispatchPayload
	if err := json.Unmarshal([]byte(rec.Payload), &dp); err != nil {
		slog.Error("failed to unmarshal delivery payload for redispatch",
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
			"error", err,
		)
		s.moveDeliveryToDeadLetter(ctx, rec.DeliveryID, fmt.Sprintf("payload unmarshal: %v", err))
		return
	}

	// Update the delivery_id in the payload so the Edge can ack the new attempt.
	dp.DeliveryID = rec.DeliveryID

	newPayload, err := json.Marshal(dp)
	if err != nil {
		slog.Error("failed to marshal redispatch payload",
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
			"error", err,
		)
		s.moveDeliveryToDeadLetter(ctx, rec.DeliveryID, fmt.Sprintf("payload marshal: %v", err))
		return
	}

	// Look up the task for dispatch routing.
	task, err := s.getPendingTaskForRedelivery(ctx, rec.TaskID)
	if err != nil {
		slog.Warn("redispatch: task lookup failed, marking dead-letter",
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
			"error", err,
		)
		s.moveDeliveryToDeadLetter(ctx, rec.DeliveryID, fmt.Sprintf("task lookup: %v", err))
		return
	}

	// Only retry if task is still in a retryable state.
	if !isRetryableTaskStatus(task.Status) {
		slog.Info("redispatch: task in terminal state, moving delivery to dead-letter",
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
			"task_status", task.Status,
		)
		s.moveDeliveryToDeadLetter(ctx, rec.DeliveryID, fmt.Sprintf("task status is %s", task.Status))
		return
	}

	// Re-dispatch via HTTP (if local Edge) or WebSocket.
	s.retryDispatchToTarget(ctx, task, dp, newPayload, rec)
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
		Select("id, agent_instance_id, triggered_by_user_id, status, edge_device_id, edge_run_id, target_id").
		Where("id = ?", taskID).
		First(&task).Error
	if err != nil {
		return nil, err
	}
	return &pendingTaskSnapshot{
		ID:                task.ID,
		AgentInstanceID:   task.AgentInstanceID,
		TriggeredByUserID: task.TriggeredByUserID,
		Status:            task.Status,
		EdgeDeviceID:      task.EdgeDeviceID,
		EdgeRunID:         task.EdgeRunID,
		TargetID:          task.TargetID,
	}, nil
}

// retryDispatchToTarget re-dispatches a delivery to the target Edge device.
// rec is a redispatchTarget (opaque payload fields only), not the GORM model.
func (s *DispatchService) retryDispatchToTarget(ctx context.Context, task *pendingTaskSnapshot, dp dispatchPayload, newPayload []byte, rec redispatchTarget) {
	// Build a minimal PendingAgentTask for dispatchToEdgeHTTP which needs task.ID.
	minimalTask := dispatch.MinimalPendingTaskForHTTP(*task)

	// Try HTTP dispatch first for unbound tasks.
	if dispatch.ShouldTryHTTPRedelivery(task.TargetID, task.EdgeDeviceID) {
		if edgeRunID := s.dispatchToEdgeHTTP(ctx, minimalTask, &dp); edgeRunID != "" {
			slog.Info("redispatch: HTTP dispatch succeeded",
				"delivery_id", rec.DeliveryID,
				"task_id", rec.TaskID,
				"edge_run_id", edgeRunID,
			)
			return
		}
	}

	// Route by device: push to WebSocket or offline queue.
	cacheClient := s.cachePort()
	if task.EdgeDeviceID != "" {
		connID, err := cacheClient.GetRouteForDevice(ctx, task.TriggeredByUserID, "desktop", task.EdgeDeviceID)
		if err == nil && connID != "" && s.mgr != nil {
			conn := s.mgr.FindByConnID(connID)
			if conn != nil && conn.UserID == task.TriggeredByUserID {
				frame := ws.NewFrame(ws.TypeAgentDispatch, json.RawMessage(newPayload))
				result := s.mgr.PushToConn(connID, frame)
				if result.Queued {
					slog.Info("redispatch: WS dispatch succeeded",
						"delivery_id", rec.DeliveryID,
						"task_id", rec.TaskID,
						"device_id", task.EdgeDeviceID,
					)
					return
				}
				slog.Warn("redispatch: WS push not queued",
					"delivery_id", rec.DeliveryID,
					"task_id", rec.TaskID,
					"delivery_status", result.Status,
					"error", result.Err,
				)
			}
		}
		// Offline: push to Redis queue.
		if err := cacheClient.PushPendingTask(ctx, task.TriggeredByUserID, string(newPayload)); err != nil {
			slog.Error("redispatch: failed to push to offline queue",
				"delivery_id", rec.DeliveryID,
				"task_id", rec.TaskID,
				"error", err,
			)
		} else {
			slog.Info("redispatch: queued to offline queue",
				"delivery_id", rec.DeliveryID,
				"task_id", rec.TaskID,
				"user_id", task.TriggeredByUserID,
			)
		}
		return
	}

	// Fallback: push to inviter's desktop queue.
	connID, err := cacheClient.GetRoute(ctx, task.TriggeredByUserID, "desktop")
	if err == nil && connID != "" && s.mgr != nil {
		conn := s.mgr.FindByConnID(connID)
		if conn != nil {
			frame := ws.NewFrame(ws.TypeAgentDispatch, json.RawMessage(newPayload))
			result := s.mgr.PushToConn(connID, frame)
			if result.Queued {
				slog.Info("redispatch: WS fallback dispatch succeeded",
					"delivery_id", rec.DeliveryID,
					"task_id", rec.TaskID,
				)
				return
			}
		}
	}

	if err := cacheClient.PushPendingTask(ctx, task.TriggeredByUserID, string(newPayload)); err != nil {
		slog.Error("redispatch: failed to push to fallback queue",
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
			"error", err,
		)
	} else {
		slog.Info("redispatch: queued to fallback queue",
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
		)
	}
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
