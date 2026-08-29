package bus

import (
	"context"
	"sync/atomic"
	"testing"
)

// newBenchBus mirrors newTestBus but accepts *testing.B. Pool is released on
// cleanup so benchmarks don't leak ants workers across iterations.
func newBenchBus(b *testing.B) *Bus {
	b.Helper()
	bus, err := New()
	if err != nil {
		b.Fatalf("New(): %v", err)
	}
	b.Cleanup(func() { bus.Close(context.Background()) })
	return bus
}

// drainBusB waits until Pending()==0 (true completion signal per P1 note in
// bus_test.go). No time.Sleep to satisfy verify-test-sleep-ratchet.
func drainBusB(b *testing.B, bus *Bus) {
	b.Helper()
	for bus.Pending() > 0 {
	}
}

// BenchmarkPublish_NoHandlers measures the Publish fast-path when no handler
// is registered for the event type. This is the per-call overhead floor
// (RLock + empty slice build + return).
func BenchmarkPublish_NoHandlers(b *testing.B) {
	bus := newBenchBus(b)
	ctx := context.Background()
	ev := Event{Type: "bench.noop", Payload: "x"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := bus.Publish(ctx, ev); err != nil {
			b.Fatalf("Publish: %v", err)
		}
	}
}

// BenchmarkPublish_SingleHandler measures end-to-end dispatch of one event
// to one synchronous handler. The handler atomically increments a counter
// so the benchmark cannot be optimized away and we can assert delivery.
// Drain runs outside the timed region so handler tail latency doesn't
// inflate ns/op variance while still counting toward throughput.
func BenchmarkPublish_SingleHandler(b *testing.B) {
	bus := newBenchBus(b)
	var got atomic.Int64
	bus.Subscribe("bench.one", func(_ context.Context, _ Event) {
		got.Add(1)
	})
	ctx := context.Background()
	ev := Event{Type: "bench.one", Payload: "x"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := bus.Publish(ctx, ev); err != nil {
			b.Fatalf("Publish: %v", err)
		}
		drainBusB(b, bus)
	}
	b.StopTimer()
	if want := int64(b.N); got.Load() != want {
		b.Fatalf("handler invocations=%d, want %d", got.Load(), want)
	}
}

// BenchmarkSubscribeDispatch_FanOut measures publishing one event to N
// handlers registered on the same type. Each handler does an atomic inc;
// drain ensures all N ran before the next iteration.
func BenchmarkSubscribeDispatch_FanOut(b *testing.B) {
	const fans = 8
	bus := newBenchBus(b)
	var got atomic.Int64
	for i := 0; i < fans; i++ {
		bus.Subscribe("bench.fan", func(_ context.Context, _ Event) {
			got.Add(1)
		})
	}
	ctx := context.Background()
	ev := Event{Type: "bench.fan", Payload: "x"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := bus.Publish(ctx, ev); err != nil {
			b.Fatalf("Publish: %v", err)
		}
		drainBusB(b, bus)
	}
	b.StopTimer()
	want := int64(b.N) * int64(fans)
	if got.Load() != want {
		b.Fatalf("handler invocations=%d, want %d", got.Load(), want)
	}
}
