// Package message owns IM message orchestration for Hub.
//
// It is the sixth IM typed-service package (agentteam-style; #720), extracting
// the message domain from the flat service package. Bus+Cache ports were
// hardened in #585; package move only. Pure helpers remain in service/im.
// Residual pure projection/builders live in same-package files (#813).
// Residual domain method peel continues in companion files (#1153).
package message

import (
	"context"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/service"
)

// Residual pure-helper peel #1153: Service struct, ports, and constructor glue.
// Domain send/query methods and orchestration helpers live in companion files.

// Bus publishes domain events from message write/lifecycle paths.
// *service.Bus satisfies this port via Publish(ctx, service.Event).
type Bus interface {
	Publish(ctx context.Context, event service.Event)
}

// Cache is the subset of *cache.Client methods used by Message Service.
// Implemented by *cache.Client and cache.NoOpCache.
type Cache interface {
	AllocateSeq(ctx context.Context, sessionID string) (int64, error)
	SetSeq(ctx context.Context, sessionID string, seq int64) error
}

// Service owns IM message orchestration: send/edit/recall, pin/unpin/list-pins,
// forward, mark-read, search, and history projection. Seq allocation uses
// injected Cache with DB fallback; domain events go through Bus. This package
// is the sixth IM typed-service extract (#720) after messagereaction (#662),
// workspace (#673), contact (#685), attachment (#697), and session (#708).
// Ports were hardened in #585; package move only. Pure content helpers remain
// in service/im and are not re-embedded. Pure residual projection/builders
// were split package-locally in #813. Domain methods live in companions (#1153).
type Service struct {
	db          *gorm.DB
	bus         Bus
	cacheClient Cache
}

// NewService constructs a message service.
// bus may be nil for read-only/partial tests; write paths that publish no-op.
// cacheClient may be nil and falls back to cache.NoOpCache (DB seq path).
func NewService(db *gorm.DB, bus Bus, cacheClient Cache) *Service {
	return &Service{db: db, bus: bus, cacheClient: resolveCache(cacheClient)}
}

// SetBus injects (or replaces) the event bus port.
func (s *Service) SetBus(bus Bus) {
	if s == nil {
		return
	}
	s.bus = bus
}

// SetCache injects (or replaces) the sequence cache port.
func (s *Service) SetCache(cacheClient Cache) {
	if s == nil {
		return
	}
	s.cacheClient = resolveCache(cacheClient)
}
