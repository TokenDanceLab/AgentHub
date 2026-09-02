package lifecycle

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
)

// The Load fast path in loadOrInitHubCallbackQueue / nextHubStreamChunkIdx must
// be observably identical to the plain sync.Map.LoadOrStore form: one state per
// run, monotonic chunk indices, and no reallocation once the run exists
// (#2154 perf lane P2-16).

func TestLoadOrInitHubCallbackQueueReusesOneStatePerRun(t *testing.T) {
	runID := "run-fastpath-reuse"
	otherID := "run-fastpath-other"
	defer hubCallbackQueues.Delete(runID)
	defer hubCallbackQueues.Delete(otherID)

	first := loadOrInitHubCallbackQueue(runID)
	require.NotNil(t, first)
	for i := 0; i < 16; i++ {
		require.Same(t, first, loadOrInitHubCallbackQueue(runID), "fast path must return the stored state")
	}
	require.NotSame(t, first, loadOrInitHubCallbackQueue(otherID), "distinct runs get distinct states")
	require.Equal(t, hubCallbackQueueCapacity, cap(first.ch))
}

func TestLoadOrInitHubCallbackQueueConcurrentCallersShareOneState(t *testing.T) {
	runID := "run-fastpath-concurrent"
	defer hubCallbackQueues.Delete(runID)

	const goroutines = 32
	states := make([]*hubCallbackQueueState, goroutines)
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			states[idx] = loadOrInitHubCallbackQueue(runID)
		}(i)
	}
	wg.Wait()

	for i := 1; i < goroutines; i++ {
		require.Same(t, states[0], states[i], "the LoadOrStore fallback must still store exactly one state per run")
	}
}

func TestNextHubStreamChunkIdxFastPathStaysMonotonic(t *testing.T) {
	runID := "run-fastpath-chunkidx"
	defer hubStreamChunkSeq.Delete(runID)

	require.Equal(t, int64(1), nextHubStreamChunkIdx(runID), "first index is allocated lazily")
	for want := int64(2); want <= 200; want++ {
		require.Equal(t, want, nextHubStreamChunkIdx(runID), "fast path must not reset or skip indices")
	}
}

func TestNextHubStreamChunkIdxIsPerRun(t *testing.T) {
	runA, runB := "run-fastpath-idx-a", "run-fastpath-idx-b"
	defer hubStreamChunkSeq.Delete(runA)
	defer hubStreamChunkSeq.Delete(runB)

	require.Equal(t, int64(1), nextHubStreamChunkIdx(runA))
	require.Equal(t, int64(2), nextHubStreamChunkIdx(runA))
	require.Equal(t, int64(1), nextHubStreamChunkIdx(runB), "counters are keyed by runID")
	require.Equal(t, int64(3), nextHubStreamChunkIdx(runA))
}

var (
	benchQueueStateSink *hubCallbackQueueState
	benchChunkIdxSink   int64
)

// BenchmarkLoadOrInitHubCallbackQueueHot measures the per-chunk cost once the
// run's queue exists. Before the fast path every call built a
// hubCallbackQueueState with a 128-slot buffered channel (~13 KiB) that
// LoadOrStore immediately discarded.
func BenchmarkLoadOrInitHubCallbackQueueHot(b *testing.B) {
	runID := "run-bench-fastpath"
	defer hubCallbackQueues.Delete(runID)
	loadOrInitHubCallbackQueue(runID)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchQueueStateSink = loadOrInitHubCallbackQueue(runID)
	}
}

func BenchmarkNextHubStreamChunkIdxHot(b *testing.B) {
	runID := "run-bench-chunkidx"
	defer hubStreamChunkSeq.Delete(runID)
	nextHubStreamChunkIdx(runID)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchChunkIdxSink = nextHubStreamChunkIdx(runID)
	}
}
