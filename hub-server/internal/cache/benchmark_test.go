package cache

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// benchClient mirrors testClient but accepts *testing.B. miniredis is the
// in-process fake Redis used by cache tests; absolute ns/op does not reflect
// real Redis latency but relative regressions are meaningful.
func benchClient(b *testing.B) (*Client, *miniredis.Miniredis) {
	b.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		b.Fatalf("miniredis.Run: %v", err)
	}
	b.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return NewClient(rdb), mr
}

// BenchmarkGetOrLoad_CacheHit measures the hot path when the key already
// exists in Redis: GET + json.Unmarshal, no loader invocation. The loader
// panics if called so a regression that bypasses the cache is immediately
// visible.
func BenchmarkGetOrLoad_CacheHit(b *testing.B) {
	c, _ := benchClient(b)
	ctx := context.Background()
	const key = "bench:hit"
	// Pre-warm outside timed region.
	if _, err := GetOrLoad[string](c, ctx, key, time.Minute, func(_ context.Context) (string, error) {
		return "warm", nil
	}); err != nil {
		b.Fatalf("warm: %v", err)
	}

	var got string
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		v, err := GetOrLoad[string](c, ctx, key, time.Minute, func(_ context.Context) (string, error) {
			b.Fatal("loader must not run on cache hit")
			return "", nil
		})
		if err != nil {
			b.Fatalf("GetOrLoad: %v", err)
		}
		got = v
	}
	b.StopTimer()
	if got != "warm" {
		b.Fatalf("got=%q, want warm", got)
	}
}

// BenchmarkGetOrLoad_CacheMiss_Loader measures the miss path: loader runs,
// value is marshaled and SET into Redis. singleflight collapses concurrent
// calls for the same key, so this benchmark runs serially to measure the
// per-call cost rather than the dedup behavior.
func BenchmarkGetOrLoad_CacheMiss_Loader(b *testing.B) {
	c, mr := benchClient(b)
	ctx := context.Background()
	var loads int

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := "bench:miss:" + itoa(i)
		v, err := GetOrLoad[string](c, ctx, key, time.Minute, func(_ context.Context) (string, error) {
			loads++
			return "v", nil
		})
		if err != nil {
			b.Fatalf("GetOrLoad: %v", err)
		}
		if v != "v" {
			b.Fatalf("got=%q, want v", v)
		}
	}
	b.StopTimer()
	if loads != b.N {
		b.Fatalf("loads=%d, want %d", loads, b.N)
	}
	_ = mr
}

// BenchmarkSetRoute_GetRoute measures the write+read pair for device routing,
// a WS-dispatch hot path. Each iteration uses a unique userID so HSET/HGET
// don't benefit from cross-iteration locality.
func BenchmarkSetRoute_GetRoute(b *testing.B) {
	c, _ := benchClient(b)
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		user := "u" + itoa(i)
		if err := c.SetRoute(ctx, user, "desktop", "conn-"+itoa(i)); err != nil {
			b.Fatalf("SetRoute: %v", err)
		}
		connID, err := c.GetRoute(ctx, user, "desktop")
		if err != nil {
			b.Fatalf("GetRoute: %v", err)
		}
		if connID != "conn-"+itoa(i) {
			b.Fatalf("connID=%q", connID)
		}
	}
}

// itoa avoids fmt.Sprintf allocation inside benchmarks.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}
