package bus

import (
	"context"
	"sync/atomic"
	"testing"
)

// BenchmarkPublish_SingleSubscriber measures dispatch throughput when one
// handler is registered for the event type. Handler body is an atomic add to
// keep work constant and avoid sleep.
func BenchmarkPublish_SingleSubscriber(b *testing.B) {
	bus, err := New()
	if err != nil {
		b.Skipf("bus.New failed: %v", err)
	}
	defer bus.Close(context.Background())

	var counter int64
	bus.Subscribe("bench.single", func(ctx context.Context, e Event) {
		atomic.AddInt64(&counter, 1)
	})

	ctx := context.Background()
	ev := Event{Type: "bench.single", Payload: "x"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = bus.Publish(ctx, ev)
	}
	b.StopTimer()

	// Drain handlers so pending returns to zero before next iteration.
	for bus.Pending() > 0 {
		// busy spin; no sleep per lane rules.
	}
}

// BenchmarkPublish_FanOut measures dispatch with N subscribers on the same
// event type, representing a hot domain event fanned out to multiple sinks.
func BenchmarkPublish_FanOut(b *testing.B) {
	const subscribers = 8
	bus, err := New()
	if err != nil {
		b.Skipf("bus.New failed: %v", err)
	}
	defer bus.Close(context.Background())

	var counter int64
	for k := 0; k < subscribers; k++ {
		bus.Subscribe("bench.fanout", func(ctx context.Context, e Event) {
			atomic.AddInt64(&counter, 1)
		})
	}

	ctx := context.Background()
	ev := Event{Type: "bench.fanout", Payload: "x"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = bus.Publish(ctx, ev)
	}
	b.StopTimer()
	for bus.Pending() > 0 {
	}
}

// BenchmarkPublish_Wildcard measures dispatch when both a specific handler
// and a "*" wildcard handler are registered, covering the dual-match path in
// Publish's handler assembly.
func BenchmarkPublish_Wildcard(b *testing.B) {
	bus, err := New()
	if err != nil {
		b.Skipf("bus.New failed: %v", err)
	}
	defer bus.Close(context.Background())

	var counter int64
	bus.Subscribe("bench.wild", func(ctx context.Context, e Event) {
		atomic.AddInt64(&counter, 1)
	})
	bus.Subscribe("*", func(ctx context.Context, e Event) {
		atomic.AddInt64(&counter, 1)
	})

	ctx := context.Background()
	ev := Event{Type: "bench.wild", Payload: "x"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = bus.Publish(ctx, ev)
	}
	b.StopTimer()
	for bus.Pending() > 0 {
	}
}

// BenchmarkPublish_NoHandlers covers the early-return path when no handler
// matches the event type — common for diagnostic events with no listener.
func BenchmarkPublish_NoHandlers(b *testing.B) {
	bus, err := New()
	if err != nil {
		b.Skipf("bus.New failed: %v", err)
	}
	defer bus.Close(context.Background())

	ctx := context.Background()
	ev := Event{Type: "bench.none", Payload: "x"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = bus.Publish(ctx, ev)
	}
}
