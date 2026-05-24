package service

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/metrics"
)

func init() {
	metrics.Register()
}

func TestBusSubscribe(t *testing.T) {
	b := NewBus()
	defer b.Close()

	var called atomic.Bool
	b.Subscribe("test.event", func(ctx context.Context, e Event) {
		called.Store(true)
	})

	b.Publish(context.Background(), Event{Type: "test.event", Payload: nil})

	// Give ants pool a moment to execute
	time.Sleep(50 * time.Millisecond)
	if !called.Load() {
		t.Fatal("expected handler to be called")
	}
}

func TestBusPublishNoHandlers(t *testing.T) {
	b := NewBus()
	defer b.Close()

	// Should not panic or error when no handlers are registered.
	b.Publish(context.Background(), Event{Type: "no.handler", Payload: nil})

	// Block until pool is idle.
	for b.Running() > 0 {
		time.Sleep(5 * time.Millisecond)
	}
}

func TestBusWildcardHandler(t *testing.T) {
	b := NewBus()
	defer b.Close()

	var called atomic.Bool
	b.Subscribe("*", func(ctx context.Context, e Event) {
		called.Store(true)
	})

	b.Publish(context.Background(), Event{Type: "any.event", Payload: nil})

	time.Sleep(50 * time.Millisecond)
	if !called.Load() {
		t.Fatal("expected wildcard handler to be called")
	}
}

func TestBusBothSpecificAndWildcard(t *testing.T) {
	b := NewBus()
	defer b.Close()

	var specific, wildcard atomic.Bool
	b.Subscribe("specific.event", func(ctx context.Context, e Event) {
		specific.Store(true)
	})
	b.Subscribe("*", func(ctx context.Context, e Event) {
		wildcard.Store(true)
	})

	b.Publish(context.Background(), Event{Type: "specific.event", Payload: nil})

	time.Sleep(50 * time.Millisecond)
	if !specific.Load() {
		t.Fatal("expected specific handler to be called")
	}
	if !wildcard.Load() {
		t.Fatal("expected wildcard handler to be called")
	}
}

func TestBusMultipleHandlersSameType(t *testing.T) {
	b := NewBus()
	defer b.Close()

	var h1, h2 atomic.Bool
	b.Subscribe("shared.event", func(ctx context.Context, e Event) {
		h1.Store(true)
	})
	b.Subscribe("shared.event", func(ctx context.Context, e Event) {
		h2.Store(true)
	})

	b.Publish(context.Background(), Event{Type: "shared.event", Payload: nil})

	time.Sleep(50 * time.Millisecond)
	if !h1.Load() || !h2.Load() {
		t.Fatal("expected both handlers for same type to be called")
	}
}

func TestBusPanicRecovery(t *testing.T) {
	b := NewBus()
	defer b.Close()

	var survived atomic.Bool
	b.Subscribe("panic.event", func(ctx context.Context, e Event) {
		panic("test panic")
	})
	b.Subscribe("panic.event", func(ctx context.Context, e Event) {
		survived.Store(true)
	})

	b.Publish(context.Background(), Event{Type: "panic.event", Payload: nil})

	time.Sleep(50 * time.Millisecond)
	if !survived.Load() {
		t.Fatal("expected second handler to survive after first panicked")
	}
}

func TestBusPendingCounter(t *testing.T) {
	b := NewBus()
	defer b.Close()

	var wg sync.WaitGroup
	b.Subscribe("count.event", func(ctx context.Context, e Event) {
		wg.Done() // Signal completion
	})

	n := 5
	wg.Add(n)
	for range n {
		b.Publish(context.Background(), Event{Type: "count.event", Payload: nil})
	}

	wg.Wait()
	// Wait for pool to finish
	for b.Running() > 0 || b.Pending() > 0 {
		time.Sleep(5 * time.Millisecond)
	}
	if p := b.Pending(); p != 0 {
		t.Fatalf("Pending = %d, want 0 after all events processed", p)
	}
}

func TestBusPayload(t *testing.T) {
	b := NewBus()
	defer b.Close()

	type payload struct{ Msg string }
	var received atomic.Value
	b.Subscribe("payload.event", func(ctx context.Context, e Event) {
		received.Store(e.Payload)
	})

	expected := &payload{Msg: "hello"}
	b.Publish(context.Background(), Event{Type: "payload.event", Payload: expected})

	time.Sleep(50 * time.Millisecond)
	got, ok := received.Load().(*payload)
	if !ok || got == nil || got.Msg != "hello" {
		t.Fatalf("unexpected payload: %v", got)
	}
}

func TestBusClose(t *testing.T) {
	b := NewBus()
	b.Close()
	if !b.pool.IsClosed() {
		t.Fatal("expected pool to be closed after Close()")
	}
}

func TestBusRunningCounter(t *testing.T) {
	b := NewBus()
	defer b.Close()

	running := make(chan struct{})
	done := make(chan struct{})
	b.Subscribe("running.event", func(ctx context.Context, e Event) {
		close(running) // Signal we're running
		<-done         // Block until test releases us
	})

	b.Publish(context.Background(), Event{Type: "running.event", Payload: nil})

	<-running // Wait for handler to start
	if r := b.Running(); r == 0 {
		t.Fatal("expected Running() > 0 while handler is executing")
	}
	close(done)
}
