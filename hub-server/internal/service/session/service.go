// Package session owns IM session lifecycle orchestration for Hub.
package session

import (
	"context"
	"log/slog"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
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
// Bus. Mapper and DTO helpers live in companion files.
type Service struct {
	db          *gorm.DB
	cacheClient Cache
	bus         Bus
	audit       PrivilegedActionAuditor
}

// NewService constructs a session service.
// cacheClient must be non-nil; tests may pass cache.NoOpCache{}.
// bus may be nil for read-only/partial tests; write paths that publish no-op.
func NewService(db *gorm.DB, cacheClient Cache, bus Bus) *Service {
	return &Service{db: db, cacheClient: cacheClient, bus: bus}
}

// SetAuditService injects (or replaces) the privileged-action auditor (#2067).
// nil disables audit recording; existing call sites stay no-op safe.
func (s *Service) SetAuditService(a PrivilegedActionAuditor) {
	if s == nil {
		return
	}
	s.audit = a
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
