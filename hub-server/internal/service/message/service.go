// Package message owns IM message orchestration for Hub: send, edit, recall,
// forward, mark-read, search, and history projection. Sequence allocation uses
// an injected Cache with DB fallback; domain events go through Bus. Pure content
// helpers live in service/im; projection and builder helpers live in companion
// files.
package message

import (
	"context"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/seqalloc"
)

// Domain send/query methods and orchestration helpers live in companion files.

// Bus publishes domain events from message write/lifecycle paths.
// *bus.Bus satisfies this port via Publish(ctx, bus.Event).
type Bus interface {
	Publish(ctx context.Context, event bus.Event) error
}

// Cache is the subset of *cache.Client methods used by Message Service.
// Implemented by *cache.Client and cache.NoOpCache.
type Cache interface {
	AllocateSeq(ctx context.Context, sessionID string) (int64, error)
	SetSeq(ctx context.Context, sessionID string, seq int64) error
}

// Service owns IM message orchestration: send/edit/recall, pin/unpin/list-pins,
// Service owns message orchestration and its Bus/Cache ports.
type Service struct {
	db          *gorm.DB
	bus         Bus
	cacheClient Cache
	seqAlloc    *seqalloc.Allocator
}

// NewService constructs a message service.
// bus may be nil for read-only/partial tests; write paths that publish no-op.
// cacheClient must be non-nil; tests may pass cache.NoOpCache{}.
func NewService(db *gorm.DB, bus Bus, cacheClient Cache) *Service {
	return &Service{
		db:          db,
		bus:         bus,
		cacheClient: cacheClient,
		seqAlloc:    seqalloc.New(cacheClient, db),
	}
}
