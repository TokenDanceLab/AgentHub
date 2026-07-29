// Package bus provides a generic in-process event bus with async handler dispatch.
//
// Bus is a standalone leaf package: it has no dependency on service-layer
// types. The service package re-exports these types via aliases for backward
// compatibility.
package bus

import (
	"context"
	"log/slog"
	"runtime/debug"
	"sync"
	"sync/atomic"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/panjf2000/ants/v2"
)

// Event is a named payload dispatched through the Bus.
type Event struct {
	Type    string
	Payload interface{}
}

// EventHandler is a function that processes an Event.
type EventHandler func(ctx context.Context, event Event)

// Bus is an in-process event bus that dispatches events to registered
// handlers on a shared goroutine pool. Handlers are matched by event
// type string; the wildcard "*" matches every event.
type Bus struct {
	mu       sync.RWMutex
	handlers map[string][]EventHandler
	pending  atomic.Int64
	pool     *ants.Pool
}

// New creates a Bus backed by a fixed-size goroutine pool.
func New() (*Bus, error) {
	pool, err := ants.NewPool(config.EventBusPoolSize,
		ants.WithNonblocking(false),
		ants.WithPanicHandler(func(p interface{}) {
			if metrics.EventBusPanics != nil {
				metrics.EventBusPanics.Inc()
			}
			slog.Error("eventbus panic recovered", "error", p, "stack", string(debug.Stack()))
		}),
	)
	if err != nil {
		return nil, err
	}
	return &Bus{handlers: make(map[string][]EventHandler), pool: pool}, nil
}

// Pending returns the number of events currently queued or executing.
func (b *Bus) Pending() int64 { return b.pending.Load() }

// Running returns the number of goroutines currently executing handlers.
func (b *Bus) Running() int { return b.pool.Running() }

// Subscribe registers a handler for the given event type.
func (b *Bus) Subscribe(eventType string, handler EventHandler) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.handlers[eventType] = append(b.handlers[eventType], handler)
}

// Publish dispatches an event to every handler registered for its type
// and for the "*" wildcard. Handlers run asynchronously on the pool.
func (b *Bus) Publish(ctx context.Context, event Event) {
	b.mu.RLock()
	handlers := make([]EventHandler, 0)
	handlers = append(handlers, b.handlers[event.Type]...)
	handlers = append(handlers, b.handlers["*"]...)
	b.mu.RUnlock()

	for _, h := range handlers {
		h := h
		b.pending.Add(1)
		err := b.pool.Submit(func() {
			defer func() {
				if r := recover(); r != nil {
					if metrics.EventBusPanics != nil {
						metrics.EventBusPanics.Inc()
					}
					slog.Error("eventbus panic recovered", "error", r, "stack", string(debug.Stack()))
				}
				b.pending.Add(-1)
			}()
			h(ctx, event)
		})
		if err != nil {
			b.pending.Add(-1)
			if metrics.EventBusSubmitFailures != nil {
				metrics.EventBusSubmitFailures.Inc()
			}
			slog.Error("eventbus submit failed", "error", err)
		}
	}
}

// Close releases the underlying goroutine pool. The Bus must not be used
// after Close is called.
func (b *Bus) Close() {
	b.pool.Release()
}

// IsClosed reports whether Close has been called.
func (b *Bus) IsClosed() bool {
	return b.pool.IsClosed()
}
