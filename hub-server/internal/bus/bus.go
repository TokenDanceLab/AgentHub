// Package bus provides a generic in-process event bus with async handler dispatch.
//
// Contract (#1548):
//
//   - Context ownership: handlers never inherit the caller's cancellable
//     context. Each handler receives the publish context's values with
//     cancellation stripped (context.WithoutCancel) plus a bounded
//     per-handler timeout, so an HTTP request context being cancelled after
//     the response is sent cannot randomly kill queued handlers.
//   - Delivery: best-effort, at-most-once, in-process only. No cross-process
//     durability is implied by the name.
//   - Publish returns an error when the bus is closed or the pool is
//     saturated — producers can see rejected events instead of silent logs.
//   - Close(ctx) stops accepting new events, drains queued/running handlers,
//     and abandons the rest at ctx's deadline (counted via
//     eventbus_dropped_on_close_total).
//
// Bus is a standalone leaf package: it has no dependency on service-layer
// types.
package bus

import (
	"context"
	"errors"
	"log/slog"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/pkg/safego"
	"github.com/panjf2000/ants/v2"
)

// ErrBusClosed is returned by Publish after Close has been called.
var ErrBusClosed = errors.New("eventbus: closed")

// ErrBusQueueFull is returned by Publish when the worker pool is saturated.
var ErrBusQueueFull = errors.New("eventbus: queue full")

// Event is a named payload dispatched through the Bus.
type Event struct {
	Type    string
	Payload interface{}
}

// EventHandler is a function that processes an Event. The ctx is the
// publish context's values with cancellation stripped plus a bounded
// timeout (see package doc); handlers must respect ctx.Done().
type EventHandler func(ctx context.Context, event Event)

// Bus is an in-process event bus that dispatches events to registered
// handlers on a shared goroutine pool. Handlers are matched by event
// type string; the wildcard "*" matches every event.
type Bus struct {
	mu       sync.RWMutex
	handlers map[string][]EventHandler
	pending  atomic.Int64
	closed   atomic.Bool
	pool     *ants.Pool

	// handlerTimeout bounds each handler invocation; a handler that exceeds
	// it sees ctx.Done() (bus itself cannot preempt a stuck handler).
	handlerTimeout time.Duration
}

// New creates a Bus backed by a fixed-size goroutine pool.
func New() (*Bus, error) {
	pool, err := ants.NewPool(config.EventBusPoolSize,
		ants.WithNonblocking(false),
		// Pool-level backstop, and one of exactly two producers of
		// eventbus_panics_total (#2246). The other is the Hub safego
		// PanicObserver (internal/metrics.InstallPanicObserver), which adds the
		// same counter for every panic recovered under a safego name with the
		// "eventbus." prefix.
		//
		// The two never double count one panic, because they sit on opposite
		// sides of the closure's own defer: handler-body panics are consumed by
		// safego.Recover inside the submitted closure (Publish below) and so
		// never reach ants; only a panic raised *outside* that defer's reach —
		// before it is registered (context.WithTimeout in Publish) or inside the
		// ants worker machinery itself — lands here. This handler therefore stays
		// a genuine last resort rather than a duplicate of the safego path.
		ants.WithPanicHandler(func(p interface{}) {
			if metrics.EventBusPanics != nil {
				metrics.EventBusPanics.Inc()
			}
			slog.Error("eventbus panic recovered (ants pool handler)", "error", p, "stack", string(debug.Stack()))
		}),
	)
	if err != nil {
		return nil, err
	}
	return &Bus{
		handlers:       make(map[string][]EventHandler),
		pool:           pool,
		handlerTimeout: config.EventBusHandlerTimeout,
	}, nil
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
// and for the "*" wildcard. Handlers run asynchronously on the pool with
// a context that carries the caller's values but not its cancellation,
// bounded by the per-handler timeout (#1548).
//
// Returns ErrBusClosed after Close, ErrBusQueueFull when the pool is
// saturated, or nil when every handler was accepted. When no handler is
// registered for the type, the event is a no-op (nil).
func (b *Bus) Publish(ctx context.Context, event Event) error {
	if b.closed.Load() {
		return ErrBusClosed
	}
	b.mu.RLock()
	handlers := make([]EventHandler, 0, len(b.handlers[event.Type])+len(b.handlers["*"]))
	handlers = append(handlers, b.handlers[event.Type]...)
	handlers = append(handlers, b.handlers["*"]...)
	b.mu.RUnlock()

	if len(handlers) == 0 {
		return nil
	}

	// Handler ctx: keep the caller's values (correlation etc.), drop its
	// cancellation, bound the execution time (#1548). A request context
	// cancelled after the HTTP response is sent must not kill queued
	// handlers mid-flight. The timeout/cancel pair is created inside the
	// submitted closure so the cancel func lives exactly as long as the
	// handler invocation — a cancel() at Publish return would cancel the
	// ctx before the async handler ever ran.
	var firstErr error
	for _, h := range handlers {
		h := h
		b.pending.Add(1)
		err := b.pool.Submit(func() {
			handlerCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), b.handlerTimeout)
			defer cancel()
			// Two defers, and their relative order is load-bearing (#2246).
			// Go unwinds deferred calls LIFO, so registering the pending
			// decrement *first* makes it run *last* — after safego.Recover has
			// already consumed the panic. The invariant this buys is not "does
			// the decrement run" (a defer registered during unwinding runs to
			// completion either way) but "is the panic accounted for before the
			// bus reports itself drained": with this order the observer has
			// already logged and counted the panic by the time Pending() drops,
			// so a Close()/drain that observes Pending()==0 cannot race ahead of
			// the metric. The reversed order makes the panic observable only
			// after the bus looks idle, and a drain-then-read caller then sees
			// eventbus_panics_total not yet incremented. Two tests pin it:
			// TestPublish_HandlerPanic_RecoverRunsBeforePendingDecrement (the
			// observer still sees Pending()==1) and
			// TestPublish_HandlerPanic_CountedByHubObserverNotByBus (the counter
			// has already moved by the time the drain returns). Both go red when
			// the defers are swapped; TestPublish_HandlerPanic_PendingReturnsToZero
			// stays green either way, because a defer registered during unwinding
			// still runs to completion — the count never leaks, only its ordering
			// against the metric does.
			defer func() { b.pending.Add(-1) }()
			// pkg/safego is the single recovery path: it logs the goroutine name
			// plus a full stack and dispatches to the process-wide PanicObserver.
			// The Hub observer increments goroutine_panic_recoveries_total for
			// every panic and, for "eventbus." names, also eventbus_panics_total
			// — so the bus-specific counter survives without this package
			// reaching into metrics on the handler path.
			defer safego.Recover("eventbus.handler")
			h(handlerCtx, event)
		})
		if err != nil {
			b.pending.Add(-1)
			if metrics.EventBusSubmitFailures != nil {
				metrics.EventBusSubmitFailures.Inc()
			}
			slog.Error("eventbus submit failed", "event_type", event.Type, "error", err)
			if firstErr == nil {
				firstErr = ErrBusQueueFull
			}
		}
	}
	return firstErr
}

// Close stops accepting new events, waits for queued and running handlers
// to finish (bounded by ctx), then releases the pool. Idempotent: subsequent
// calls no-op. When the deadline expires before handlers finish, the
// remaining count is logged and counted in eventbus_dropped_on_close_total —
// the goroutines themselves still finish (they cannot be preempted), but
// the bus no longer waits for them.
func (b *Bus) Close(ctx context.Context) {
	if !b.closed.CompareAndSwap(false, true) {
		return
	}
	for b.pending.Load() > 0 {
		select {
		case <-ctx.Done():
			abandoned := b.pending.Load()
			if metrics.EventBusDroppedOnClose != nil && abandoned > 0 {
				metrics.EventBusDroppedOnClose.Add(float64(abandoned))
			}
			slog.Warn("eventbus close deadline reached, abandoning pending handlers", "abandoned", abandoned)
			b.pool.Release()
			return
		case <-time.After(10 * time.Millisecond):
		}
	}
	b.pool.Release()
}

// IsClosed reports whether Close has been called.
func (b *Bus) IsClosed() bool {
	return b.closed.Load()
}
