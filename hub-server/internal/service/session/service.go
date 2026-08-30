// Package session owns IM session lifecycle orchestration for Hub.
//
// It is the fifth IM typed-service package (agentteam-style; #708), extracting
// the session domain from the flat service package. Bus+Cache ports were
// hardened in #593; package move only. Pure residual mappers/DTO/builders
// live alongside this file (#825).
package session

import (
	"context"
	"log/slog"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/cache"
)

// Bus publishes domain events from session lifecycle paths.
// *bus.Bus satisfies this port via Publish(ctx, bus.Event).
type Bus interface {
	Publish(ctx context.Context, event bus.Event) error
}

// Cache is the subset of *cache.Client methods used by Session Service.
// Implemented by *cache.Client and cache.NoOpCache.
type Cache interface {
	Invalidate(ctx context.Context, keys ...string) error
	InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error
}

// PrivilegedActionAuditor is the subset of *audit.Service used by session
// Service to record per-action audit trails (#2067). Defined as a local port
// so this package stays decoupled from service/audit and tests can inject a
// spy without importing the concrete type.
type PrivilegedActionAuditor interface {
	RecordPrivilegedAction(ctx context.Context, in PrivilegedActionAuditInput)
}

// PrivilegedActionAuditInput mirrors audit.PrivilegedActionInput. Kept as a
// local struct so callers don't need to import service/audit just to spell
// the input; the wiring layer adapts between the two.
type PrivilegedActionAuditInput struct {
	ActorUserID  string
	Action       string
	ResourceType string
	ResourceID   string
	Outcome      string
	AuthBasis    string
	Reason       string
}

// Service owns IM session lifecycle orchestration: private/group create,
// list/search, member join/leave/remove, ownership transfer, dissolve, group
// info, per-member settings, delete-for-me, and invited-agent cleanup.
// Member/meta cache invalidation uses injected Cache; domain events go through
// Bus. This package is the fifth IM typed-service extract (#708) after
// messagereaction (#662), workspace (#673), contact (#685), and attachment
// (#697). Ports were hardened in #593; package move only. Pure residual
// mappers/DTO/builders extracted in #825.
type Service struct {
	db          *gorm.DB
	cacheClient Cache
	bus         Bus
	audit       PrivilegedActionAuditor
}

// NewService constructs a session service.
// cacheClient may be nil and falls back to cache.NoOpCache.
// bus may be omitted/nil for read-only/partial tests; write paths that publish no-op.
func NewService(db *gorm.DB, cacheClient Cache, bus ...Bus) *Service {
	var eventBus Bus
	if len(bus) > 0 {
		eventBus = bus[0]
	}
	return &Service{db: db, cacheClient: resolveCache(cacheClient), bus: eventBus}
}

// SetBus injects (or replaces) the event bus port.
func (s *Service) SetBus(bus Bus) {
	if s == nil {
		return
	}
	s.bus = bus
}

// SetCache injects (or replaces) the session cache port.
func (s *Service) SetCache(cacheClient Cache) {
	if s == nil {
		return
	}
	s.cacheClient = resolveCache(cacheClient)
}

// SetAuditService injects (or replaces) the privileged-action auditor (#2067).
// nil disables audit recording; existing call sites stay no-op safe.
func (s *Service) SetAuditService(a PrivilegedActionAuditor) {
	if s == nil {
		return
	}
	s.audit = a
}

// resolveCache returns c, falling back to cache.NoOpCache when c is nil or a
// typed-nil cache port. Thin type-bridge over cache.ResolveCache so call sites
// stay on the package-local Cache interface; the nil-detection logic lives in
// the shared internal/cache helper (Audit-D §4 cluster 2).
func resolveCache(c Cache) Cache {
	return cache.ResolveCache[Cache](c, cache.NoOpCache{})
}

// publishEvent is a nil-safe wrapper over the bus port.
func (s *Service) publishEvent(ctx context.Context, eventType string, payload map[string]interface{}) {
	if s == nil || s.bus == nil {
		return
	}
	if err := s.bus.Publish(ctx, bus.Event{Type: eventType, Payload: payload}); err != nil {
		slog.Warn("failed to publish session event", "event_type", eventType, "error", err)
	}
}
