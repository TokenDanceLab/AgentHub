package service

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"

	"github.com/panjf2000/ants/v2"
)

type Event struct {
	Type    string
	Payload interface{}
}

type EventHandler func(ctx context.Context, event Event)

type Bus struct {
	mu       sync.RWMutex
	handlers map[string][]EventHandler
	pending  atomic.Int64
	pool     *ants.Pool
}

func NewBus() *Bus {
	pool, err := ants.NewPool(1024,
		ants.WithNonblocking(false),
		ants.WithPanicHandler(func(p interface{}) {
			slog.Error("eventbus panic", "panic", p)
		}),
	)
	if err != nil {
		panic(err)
	}
	return &Bus{handlers: make(map[string][]EventHandler), pool: pool}
}

func (b *Bus) Pending() int64  { return b.pending.Load() }
func (b *Bus) Running() int    { return b.pool.Running() }

func (b *Bus) Subscribe(eventType string, handler EventHandler) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.handlers[eventType] = append(b.handlers[eventType], handler)
}

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
				recover()
				b.pending.Add(-1)
			}()
			h(ctx, event)
		})
		if err != nil {
			b.pending.Add(-1)
			slog.Error("eventbus submit failed", "error", err)
		}
	}
}

func (b *Bus) Close() {
	b.pool.Release()
}
