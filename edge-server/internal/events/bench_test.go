package events

import "testing"

func BenchmarkBusPublish(b *testing.B) {
	bus := NewBus(10000)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		bus.Publish("test.event", nil, "payload")
	}
}

func BenchmarkBusSubscribe(b *testing.B) {
	bus := NewBus(10000)
	subID, ch, _ := bus.Subscribe(0)

	// Drain subscriber channel in background to avoid blocking publish.
	go func() {
		for range ch {
		}
	}()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		bus.Publish("test.event", nil, "payload")
	}
	b.StopTimer()
	bus.Unsubscribe(subID)
}
