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

func BenchmarkBusPublishWithObserver(b *testing.B) {
	bus := NewBus(10000)
	cancel := bus.AddObserver(func(evt EventEnvelope) {})
	defer cancel()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		bus.Publish("test.event", nil, "payload")
	}
}

func BenchmarkBusPublishWithSubscriberDraining(b *testing.B) {
	bus := NewBus(10000)
	subID, ch, _ := bus.Subscribe(0)

	go func() {
		for range ch {
		}
	}()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		bus.Publish("test.event", map[string]any{"runId": "run_1"}, map[string]any{"status": "ok"})
	}
	b.StopTimer()
	bus.Unsubscribe(subID)
}

func BenchmarkBusPublishMultiSubscriber(b *testing.B) {
	const numSubs = 10
	bus := NewBus(10000)

	type sub struct {
		id int64
		ch <-chan EventEnvelope
	}
	subs := make([]sub, numSubs)
	for i := 0; i < numSubs; i++ {
		id, ch, _ := bus.Subscribe(0)
		subs[i] = sub{id, ch}
		go func(c <-chan EventEnvelope) {
			for range c {
			}
		}(ch)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		bus.Publish("test.event", nil, "payload")
	}
	b.StopTimer()
	for _, s := range subs {
		bus.Unsubscribe(s.id)
	}
}

func BenchmarkBusPublishLargePayload(b *testing.B) {
	bus := NewBus(10000)
	payload := map[string]any{
		"id":   "run-12345",
		"text": "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
		"metadata": map[string]any{
			"source":  "adapter",
			"version": 2,
			"tags":    []string{"agent", "team", "production"},
		},
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		bus.Publish("run.output.batch", nil, payload)
	}
}
