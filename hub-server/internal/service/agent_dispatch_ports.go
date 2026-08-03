package service

import (
	"context"
	"log/slog"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/bus"
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
// Pure residual continue (#1056) after #1033/#1012/#977/#946/#902 and the
// #732→#834 chain. Call dispatch.* directly; DTO aliases kept for JSON/redispatch
// stability. Orchestration + ports stay flat here. Preserve #866/#999/#1000/#1009
// outbox redispatch semantics; #1031 coordinates offline queue vs outbox ownership.
// No OpenAPI/handler/frontend; no typed package move.
//
// Ports and nil-safe wrappers split into this file (#1068) to match
// delivery_outbox.go / delivery_outbox_model.go pattern (#801).

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
	Publish(ctx context.Context, event bus.Event) error
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
// redispatch residual. DeliveryOutbox retries enter via Redispatcher; Payload DTO
// lives in service/dispatch with a thin same-package alias. Same-package extract
// (#563/#573/#617) + pure helpers (#732→#1056) — typed package move still deferred.
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
	if !dispatch.ServiceReceiverAvailable(s != nil) {
		return
	}
	s.outbox = outbox
}

// SetBus injects (or replaces) the event bus port.
func (s *DispatchService) SetBus(bus dispatchBus) {
	if !dispatch.ServiceReceiverAvailable(s != nil) {
		return
	}
	s.bus = bus
}

// SetCache injects (or replaces) the route / offline-queue cache port.
func (s *DispatchService) SetCache(cacheClient dispatchCache) {
	if !dispatch.ServiceReceiverAvailable(s != nil) {
		return
	}
	s.cacheClient = resolveDispatchCache(cacheClient)
}

// SetManager injects (or replaces) the WebSocket manager port.
func (s *DispatchService) SetManager(mgr dispatchWS) {
	if !dispatch.ServiceReceiverAvailable(s != nil) {
		return
	}
	s.mgr = mgr
}

// SetRelay injects (or replaces) the hub_relay command dispatcher port.
func (s *DispatchService) SetRelay(relay relayDispatcher) {
	if !dispatch.ServiceReceiverAvailable(s != nil) {
		return
	}
	s.relay = relay
}

// publish is a nil-safe wrapper over the bus port (cancel/regenerate events).
func (s *DispatchService) publish(ctx context.Context, event bus.Event) {
	if !dispatch.BusPortAvailable(s != nil, s != nil && s.bus != nil) {
		return
	}
	s.bus.Publish(ctx, event)
}

// cachePort is a nil-safe accessor for the route / offline-queue cache port.
func (s *DispatchService) cachePort() dispatchCache {
	if !dispatch.ServiceReceiverAvailable(s != nil) {
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
	if err := s.outbox.MoveDeliveryToDeadLetter(ctx, deliveryID, lastError); err != nil {
		slog.Warn("dispatch: failed to move delivery to dead-letter",
			"delivery_id", deliveryID,
			"last_error", lastError,
			"error", err,
		)
		if metrics.DispatchDeadLetterMoveFailures != nil {
			metrics.DispatchDeadLetterMoveFailures.Inc()
		}
	}
}
