package dispatchsvc

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"reflect"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

// dispatchPayload is a same-package alias for the pure dispatch.Payload DTO so
// edge JSON tags and redispatch unmarshaling stay stable (#789).
type dispatchPayload = dispatch.Payload

// dispatchMessage is a same-package alias for the pure dispatch.Message DTO so
// payload JSON tags and redispatch unmarshaling stay stable (#756).
type dispatchMessage = dispatch.Message

// Same-package aliases for pure dispatch DTOs; kept for signatures and
// redispatch unmarshal stability.
type dispatchTeamContext = dispatch.TeamContext
type dispatchTargetSnapshot = dispatch.TargetSnapshot
type pendingTaskSnapshot = dispatch.PendingTaskSnapshot

// ── DispatchService ports + type ─────────────────────────────────────────────
//
// Call dispatch.* directly; DTO aliases keep JSON/redispatch stable.
// Orchestration and ports stay in this package. Outbox redispatch keeps its
// soft-fail, running-not-retryable, atomic-claim, and offline-vs-outbox
// ownership semantics.
//
// Ports and nil-safe wrappers live in this file, mirroring the
// ports-vs-orchestration split used by deliveryoutbox.

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

// ConnPort is the connection snapshot the dispatch flow needs: identity and
// device binding only. The service-layer adapter maps *ws.Conn onto it so the
// business layer never imports the transport package.
type ConnPort struct {
	ID         string
	UserID     string
	DeviceType string
	DeviceID   string
}

// FramePort is the wire frame the dispatch flow pushes. The service-layer
// adapter maps it onto ws.Frame; Type uses the same wire strings
// (frameTypeAgentDispatch mirrors ws.TypeAgentDispatch).
type FramePort struct {
	Type    string
	Payload json.RawMessage
}

// DeliveryResultPort reports the outcome of a PushToConn attempt. The adapter
// maps ws.DeliveryResult onto it (Queued/Status/Err only; ConnDrops is
// transport detail the dispatch flow does not consume).
type DeliveryResultPort struct {
	Queued bool
	Status string
	Err    error
}

// ManagerPort is the WebSocket connection lookup/push port used for
// device-bound and inviter desktop dispatch. Implemented by the
// wsManagerAdapter in the service package over *ws.Manager.
type ManagerPort interface {
	FindByConnID(connID string) *ConnPort
	PushToConn(connID string, frame FramePort) DeliveryResultPort
}

// frameTypeAgentDispatch mirrors ws.TypeAgentDispatch; the adapter translates
// between FramePort and the wire frame, so the string must stay in sync.
const frameTypeAgentDispatch = "agent.dispatch"

// RelayPort is the hub_relay command dispatch port.
type RelayPort interface {
	// CreateCommand persists a relay command and attempts WS push.
	// Returns pushReached=true when the frame was queued on ≥1 active conn.
	CreateCommand(ctx context.Context, targetEdgeID, commandType string, payload json.RawMessage, createdBy string) (pushReached bool, err error)
}

// DispatchService owns agent task dispatch orchestration: trigger, payload build,
// edge HTTP/WS/offline routing, capability minting, history/pins loading, and
// redispatch. DeliveryOutbox retries enter via Redispatcher; the Payload DTO
// lives in service/dispatch with a same-package alias.
type DispatchService struct {
	db          *gorm.DB
	bus         dispatchBus
	mgr         ManagerPort
	cacheClient dispatchCache
	relay       RelayPort
	outbox      dispatchOutbox
	// edgeCfg is the Hub→Edge dispatch client config (#1549). Read once at
	// construction by the composition root; the request path never calls
	// os.Getenv. edgeClient is the shared outbound client built at the
	// composition root with outboundhttp.NewClient (connection reuse, single
	// configured timeout, redirects refused); the service layer never
	// constructs transport clients (#1594). nil is only legal for partial
	// tests that never reach the edge HTTP path.
	edgeCfg    config.EdgeDispatchConfig
	edgeClient *http.Client
	// jwtSecret signs run-start capability tokens; sourced from config.JWT.
	jwtSecret string
	// edgeBreaker guards dispatchToEdgeHTTP against a down Edge server. The zero
	// value is closed; after threshold consecutive failures it fails fast instead
	// of blocking dispatch for the HTTP timeout.
	edgeBreaker edgeCircuitBreaker
	// dispatchSem bounds concurrent dispatchTask goroutines launched from
	// TriggerAgentTask. Without it every trigger spawns an unbounded goroutine
	// that performs DB/HTTP/WS work; a dispatch storm could exhaust goroutines
	// and connections. Capacity 64 matches a generous per-instance ceiling;
	// when full the task stays persisted as queued and is picked up by the
	// TTL/redispatch path instead of launching another goroutine. Direct
	// test calls to dispatchTask bypass the semaphore (they already run on
	// the test goroutine) so the pure dispatch path stays unchanged.
	dispatchSem chan struct{}
	audit       PrivilegedActionAuditor
}

// SetAuditService injects the privileged-action auditor (#2067). nil disables recording.
func (s *DispatchService) SetAuditService(a PrivilegedActionAuditor) {
	if s == nil {
		return
	}
	s.audit = a
}

// NewDispatchService constructs a DispatchService. bus/outbox/relay/mgr may be
// nil for partial tests; write paths that need them fail, degrade, or no-op.
// edgeCfg/jwtSecret are explicit configuration (zero value = defaults); the
// service layer never reads process env (#1549). edgeClient must come from
// the composition root (outboundhttp.NewClient); nil is tolerated for tests
// that never hit the edge HTTP path (#1594).
func NewDispatchService(db *gorm.DB, bus dispatchBus, mgr ManagerPort, cacheClient dispatchCache, relay RelayPort, outbox dispatchOutbox, edgeCfg config.EdgeDispatchConfig, edgeClient *http.Client, jwtSecret string) *DispatchService {
	return &DispatchService{
		db:          db,
		bus:         bus,
		mgr:         mgr,
		cacheClient: resolveDispatchCache(cacheClient),
		relay:       relay,
		outbox:      outbox,
		edgeCfg:     edgeCfg,
		edgeClient:  edgeClient,
		jwtSecret:   jwtSecret,
		dispatchSem: make(chan struct{}, dispatchSemaphoreCapacity),
	}
}

// resolveDispatchCache degrades nil and typed-nil cache ports to the
// fail-closed NoOpCache so dispatch paths return ErrCacheUnavailable instead
// of panicking on partial test constructions.
func resolveDispatchCache(c dispatchCache) dispatchCache {
	if c == nil {
		return cache.NoOpCache{}
	}
	if value := reflect.ValueOf(c); value.Kind() == reflect.Pointer && value.IsNil() {
		return cache.NoOpCache{}
	}
	return c
}

// publish is a nil-safe wrapper over the bus port (cancel/regenerate events).
func (s *DispatchService) publish(ctx context.Context, event bus.Event) {
	if s == nil || s.bus == nil {
		return
	}
	if err := s.bus.Publish(ctx, event); err != nil {
		slog.Warn("failed to publish dispatch event", "event_type", event.Type, "error", err)
	}
}

// recordDelivery is a nil-safe wrapper over the outbox port.
func (s *DispatchService) recordDelivery(ctx context.Context, taskID, payload, edgeDeviceID string) (string, error) {
	if s == nil || s.outbox == nil {
		return "", dispatch.ErrOutboxUnavailable()
	}
	return s.outbox.RecordDelivery(ctx, taskID, payload, edgeDeviceID)
}

// markDeliverySent is a nil-safe wrapper over the outbox port.
func (s *DispatchService) markDeliverySent(ctx context.Context, deliveryID string) error {
	if s == nil || s.outbox == nil {
		return dispatch.ErrOutboxUnavailable()
	}
	return s.outbox.MarkDeliverySent(ctx, deliveryID)
}

// moveDeliveryToDeadLetter is a nil-safe wrapper over the outbox port used by redispatch.
func (s *DispatchService) moveDeliveryToDeadLetter(ctx context.Context, deliveryID, lastError string) {
	if s == nil || s.outbox == nil {
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
