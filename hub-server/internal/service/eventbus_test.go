package service

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/stretchr/testify/assert"
)

func init() {
	metrics.Register()
}

func newTestBus(t *testing.T) *Bus {
	t.Helper()
	b, err := NewBus()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(b.Close)
	return b
}

func TestBusSubscribe(t *testing.T) {
	b := newTestBus(t)

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
	b := newTestBus(t)

	// Should not panic or error when no handlers are registered.
	b.Publish(context.Background(), Event{Type: "no.handler", Payload: nil})

	// Block until pool is idle.
	for b.Running() > 0 {
		time.Sleep(5 * time.Millisecond)
	}
}

func TestBusWildcardHandler(t *testing.T) {
	b := newTestBus(t)

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
	b := newTestBus(t)

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
	b := newTestBus(t)

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
	b := newTestBus(t)

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
	b := newTestBus(t)

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
	b := newTestBus(t)

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
	b, err := NewBus()
	if err != nil {
		t.Fatal(err)
	}
	b.Close()
	if !b.IsClosed() {
		t.Fatal("expected pool to be closed after Close()")
	}
}

func TestBusRunningCounter(t *testing.T) {
	b := newTestBus(t)

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

// ── Concurrent Access Tests ──

// TestBusConcurrentSubscribePublish verifies that concurrent Subscribe and
// Publish operations do not race.
func TestBusConcurrentSubscribePublish(t *testing.T) {
	b := newTestBus(t)

	var total atomic.Int64
	var wg sync.WaitGroup

	// Subscribe 20 handlers for the same event type
	for i := 0; i < 20; i++ {
		b.Subscribe("concurrent.event", func(ctx context.Context, e Event) {
			total.Add(1)
			wg.Done()
		})
	}

	// Publish 10 events concurrently
	const numEvents = 10
	wg.Add(20 * numEvents) // 20 handlers × 10 events
	for i := 0; i < numEvents; i++ {
		go func(idx int) {
			b.Publish(context.Background(), Event{Type: "concurrent.event", Payload: idx})
		}(i)
	}

	wg.Wait()

	// Drain pool
	for b.Running() > 0 || b.Pending() > 0 {
		time.Sleep(5 * time.Millisecond)
	}

	assert.Equal(t, int64(20*numEvents), total.Load(), "all handlers should be called")
}

// TestBusConcurrentSubscribeWhilePublishing verifies that subscribing while
// events are being published does not race.
func TestBusConcurrentSubscribeWhilePublishing(t *testing.T) {
	b := newTestBus(t)

	var total atomic.Int64
	var wg sync.WaitGroup

	// Start publishing continuously
	pubDone := make(chan struct{})
	go func() {
		for i := 0; i < 50; i++ {
			b.Publish(context.Background(), Event{Type: "race.event", Payload: nil})
			time.Sleep(time.Millisecond)
		}
		close(pubDone)
	}()

	// Concurrently subscribe new handlers
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 5; j++ {
				b.Subscribe("race.event", func(ctx context.Context, e Event) {
					total.Add(1)
				})
				time.Sleep(2 * time.Millisecond)
			}
		}()
	}

	wg.Wait()
	<-pubDone

	// Drain pool
	for b.Running() > 0 || b.Pending() > 0 {
		time.Sleep(5 * time.Millisecond)
	}
}

// TestBusConcurrentWildcardSubscribers verifies that concurrent wildcard
// subscribers do not race with specific subscribers.
func TestBusConcurrentWildcardSubscribers(t *testing.T) {
	b := newTestBus(t)

	var wildcard atomic.Int64
	var specific atomic.Int64
	var wg sync.WaitGroup

	// Register a wildcard handler
	b.Subscribe("*", func(ctx context.Context, e Event) {
		wildcard.Add(1)
		wg.Done()
	})

	// Register 5 specific handlers concurrently
	for i := 0; i < 5; i++ {
		b.Subscribe("specific.event", func(ctx context.Context, e Event) {
			specific.Add(1)
			wg.Done()
		})
	}

	// Publish 10 events — each fires: 1 wildcard + 5 specific = 6 handlers per event
	const numEvents = 10
	wg.Add(6 * numEvents)
	for i := 0; i < numEvents; i++ {
		go func() {
			b.Publish(context.Background(), Event{Type: "specific.event", Payload: nil})
		}()
	}

	wg.Wait()
	for b.Running() > 0 || b.Pending() > 0 {
		time.Sleep(5 * time.Millisecond)
	}

	assert.Equal(t, int64(10*1), wildcard.Load(), "wildcard called once per event")
	assert.Equal(t, int64(10*5), specific.Load(), "specific called 5 times per event")
}

// TestBusHighConcurrencyPublish verifies the bus under high publish pressure.
func TestBusHighConcurrencyPublish(t *testing.T) {
	b := newTestBus(t)

	var total atomic.Int64
	var wg sync.WaitGroup

	b.Subscribe("pressure.event", func(ctx context.Context, e Event) {
		total.Add(1)
		wg.Done()
	})

	const numEvents = 200
	wg.Add(numEvents)

	var start sync.WaitGroup
	start.Add(numEvents)

	for i := 0; i < numEvents; i++ {
		go func() {
			start.Done()
			start.Wait() // release all goroutines simultaneously
			b.Publish(context.Background(), Event{Type: "pressure.event", Payload: nil})
		}()
	}

	wg.Wait()
	for b.Running() > 0 || b.Pending() > 0 {
		time.Sleep(5 * time.Millisecond)
	}

	assert.Equal(t, int64(numEvents), total.Load(), "all events must be delivered")
}


func captureServiceEvents(bus *Bus, eventType string) <-chan Event {
	events := make(chan Event, 1)
	bus.Subscribe(eventType, func(ctx context.Context, event Event) {
		events <- event
	})
	return events
}

func waitForServiceEventPayload(t *testing.T, events <-chan Event) map[string]interface{} {
	t.Helper()
	select {
	case event := <-events:
		payload, ok := event.Payload.(map[string]interface{})
		if !ok {
			t.Fatalf("event payload should be a map, got %T", event.Payload)
		}
		return payload
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for service event")
		return nil
	}
}
