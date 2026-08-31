package cache

import (
	"testing"
)

// BenchmarkIsNilCache_NilInterface measures the reflect-based nil check on a
// typed-nil pointer passed through an interface — the common "cache port not
// wired" path in service constructors. Pure stdlib, no Redis.
func BenchmarkIsNilCache_NilInterface(b *testing.B) {
	var c *Client // typed-nil; when passed as any, IsNilCache returns true
	for i := 0; i < b.N; i++ {
		_ = IsNilCache(c)
	}
}

// BenchmarkIsNilCache_NonNil measures the non-nil branch of IsNilCache,
// representing the steady-state where a real Client is injected.
func BenchmarkIsNilCache_NonNil(b *testing.B) {
	c := &Client{} // non-nil pointer; rdb may be nil but interface is non-nil
	for i := 0; i < b.N; i++ {
		_ = IsNilCache(c)
	}
}

// BenchmarkResolveCache_Hit covers the non-nil fast path where the injected
// cache is returned unchanged. Generic instantiation cost included.
func BenchmarkResolveCache_Hit(b *testing.B) {
	real := NoOpCache{}
	fallback := NoOpCache{}
	for i := 0; i < b.N; i++ {
		_ = ResolveCache[NoOpCache](real, fallback)
	}
}

// BenchmarkResolveCache_Fallback covers the nil-cache fallback path that
// returns the NoOpCache substitute. Uses a typed-nil *NoOpCache so
// IsNilCache sees a nil pointer inside the interface.
func BenchmarkResolveCache_Fallback(b *testing.B) {
	var typedNil *NoOpCache
	fallback := NoOpCache{}
	for i := 0; i < b.N; i++ {
		_ = ResolveCache[*NoOpCache](typedNil, &fallback)
	}
}

// BenchmarkRouteKey measures key assembly for device route lookups. This is
// a hot string-concat path called on every WS frame dispatch. Pure local.
func BenchmarkRouteKey(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = routeKey("user-12345")
	}
}

// BenchmarkRouteField_DeviceOnly covers the short branch (deviceID == "")
// used by legacy single-device-per-type callers.
func BenchmarkRouteField_DeviceOnly(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = routeField("desktop", "")
	}
}

// BenchmarkRouteField_WithDeviceID covers the compound-key branch used by
// multi-device routing (the dominant production path post-#1031).
func BenchmarkRouteField_WithDeviceID(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = routeField("desktop", "dev-abcdef")
	}
}

// BenchmarkPendingTaskKey measures per-user offline queue key assembly, hit
// on every PushPendingTask / PopPendingTasks call.
func BenchmarkPendingTaskKey(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = pendingTaskKey("user-12345")
	}
}

// BenchmarkEncodePendingTargetTaskOrderEntry measures JSON serialization of
// the target-task order entry written to Redis lists. Represents the per-push
// marshal cost on the offline replay path.
func BenchmarkEncodePendingTargetTaskOrderEntry(b *testing.B) {
	payload := `{"task_id":"t1","action":"run","args":{"x":1}}`
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = encodePendingTargetTaskOrderEntry("target-xyz", payload)
	}
}

// BenchmarkDecodePendingTargetTaskOrderEntry measures JSON deserialization +
// validation on the pop/replay path. Mirrors the per-entry cost when a
// reconnecting desktop drains its offline queue.
func BenchmarkDecodePendingTargetTaskOrderEntry(b *testing.B) {
	data, _ := encodePendingTargetTaskOrderEntry("target-xyz",
		`{"task_id":"t1","action":"run","args":{"x":1}}`)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = decodePendingTargetTaskOrderEntry(data)
	}
}
