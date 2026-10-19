package cache

import (
	"testing"
)

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
