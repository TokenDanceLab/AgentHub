package service

import (
	"context"
	"sync"
)

type Event struct {
	Type    string
	Payload interface{}
}

type EventHandler func(ctx context.Context, event Event)

type Bus struct {
	mu       sync.RWMutex
	handlers map[string][]EventHandler
}

func NewBus() *Bus {
	return &Bus{handlers: make(map[string][]EventHandler)}
}

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
		go func(handler EventHandler) {
			defer func() { recover() }()
			handler(ctx, event)
		}(h)
	}
}
