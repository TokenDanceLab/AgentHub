package lifecycle

import (
	"sync/atomic"
	"testing"
)

// The two legacy* helpers reproduce the pre-#2154 call shape so the allocation
// regression can be measured in-repo instead of only being asserted in prose.
// sync.Map.LoadOrStore always evaluates its second argument, so the legacy form
// builds a whole queue state (struct + 128-slot buffered channel) on every
// stream chunk and discards it whenever the run already has one.

func legacyLoadOrInitHubCallbackQueue(runID string) *hubCallbackQueueState {
	stateAny, _ := hubCallbackQueues.LoadOrStore(runID, newHubCallbackQueueState(runID))
	return stateAny.(*hubCallbackQueueState)
}

func legacyNextHubStreamChunkIdx(runID string) int64 {
	actual, _ := hubStreamChunkSeq.LoadOrStore(runID, new(atomic.Int64))
	return actual.(*atomic.Int64).Add(1)
}

func BenchmarkLegacyLoadOrStoreQueueStatePerChunk(b *testing.B) {
	runID := "run-bench-legacy-queue"
	defer hubCallbackQueues.Delete(runID)
	legacyLoadOrInitHubCallbackQueue(runID)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchQueueStateSink = legacyLoadOrInitHubCallbackQueue(runID)
	}
}

func BenchmarkFastPathQueueStatePerChunk(b *testing.B) {
	runID := "run-bench-fastpath-queue"
	defer hubCallbackQueues.Delete(runID)
	loadOrInitHubCallbackQueue(runID)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchQueueStateSink = loadOrInitHubCallbackQueue(runID)
	}
}

func BenchmarkLegacyLoadOrStoreChunkIdxPerChunk(b *testing.B) {
	runID := "run-bench-legacy-idx"
	defer hubStreamChunkSeq.Delete(runID)
	legacyNextHubStreamChunkIdx(runID)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchChunkIdxSink = legacyNextHubStreamChunkIdx(runID)
	}
}
