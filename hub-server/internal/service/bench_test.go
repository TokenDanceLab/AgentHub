//nolint:gosec // 测试 fixture：凭据模式字符串用于构造测试用例，非真实凭据
package service

import (
	"context"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/bus"
)

func BenchmarkEventBusPublish(b *testing.B) {
	bbus, err := bus.New()
	if err != nil {
		b.Fatal(err)
	}
	defer bbus.Close(context.Background())

	// Subscribe a no-op handler to make the benchmark realistic.
	bbus.Subscribe("test.event", func(ctx context.Context, e bus.Event) {})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		bbus.Publish(context.Background(), bus.Event{Type: "test.event", Payload: nil})
	}
}

func BenchmarkJWTParse(b *testing.B) {
	// #nosec G101 -- 测试专用固定 JWT secret（非真实凭据）
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

func BenchmarkJWTSign(b *testing.B) {
	// #nosec G101 -- 测试专用固定 JWT secret（非真实凭据）
	const secret = "bench-test-secret"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = jwtutil.GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	}
}

func BenchmarkJWTSignVerifyRoundTrip(b *testing.B) {
	// #nosec G101 -- 测试专用固定 JWT secret（非真实凭据）
	const secret = "bench-test-secret"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		token, _ := jwtutil.GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
		_, _ = jwtutil.ParseToken(token, secret)
	}
}
