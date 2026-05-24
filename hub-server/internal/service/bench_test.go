package service

import (
	"context"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/jwtutil"
)

func BenchmarkEventBusPublish(b *testing.B) {
	bus := NewBus()
	defer bus.Close()

	// Subscribe a no-op handler to make the benchmark realistic.
	bus.Subscribe("test.event", func(ctx context.Context, e Event) {})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		bus.Publish(context.Background(), Event{Type: "test.event", Payload: nil})
	}
}

func BenchmarkJWTParse(b *testing.B) {
	const secret = "bench-test-secret"

	token, err := jwtutil.GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = jwtutil.ParseToken(token, secret)
	}
}
