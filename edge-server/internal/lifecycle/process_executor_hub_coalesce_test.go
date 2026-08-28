package lifecycle

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
	"github.com/agenthub/edge-server/internal/testkit"
)

// newCoalesceTestEmitter builds a hubCallbackEmitter wired to a recording
// callback with a bound hub task, mirroring the run-time wiring in
// publishStructuredOutput + the bind path in ProcessExecutor.run. base seeds
// a per-invocation unique runID (#2038) so -count=N iterations never share
// the package-scoped hub callback queue; the resolved runID is returned for
// tests that address executor maps directly.
func newCoalesceTestEmitter(t *testing.T, base string) (*hubCallbackEmitter, *recordingHubCallback, string) {
	t.Helper()
	runID := uniqueHubTestRunID(base)
	bus := events.NewBus(10)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "success")
	cb := newRecordingHubCallback()
	executor.WithHubCallback(cb)

	executor.mu.Lock()
	executor.hubTasks[runID] = "task-coalesce"
	executor.hubOutputs[runID] = newHubOutputCollector(hubCallbackFinalMaxBytes)
	executor.mu.Unlock()

	emitter := newHubCallbackEmitter(executor, runID, adapters.NewBusEventEmitter(bus))
	typed, ok := emitter.(*hubCallbackEmitter)
	if !ok {
		t.Fatal("newHubCallbackEmitter did not produce a *hubCallbackEmitter")
	}
	return typed, cb, runID
}

func waitForStreams(t *testing.T, cb *recordingHubCallback, want int) {
	t.Helper()
	testkit.Eventually(t, 3*time.Second, func() bool {
		cb.mu.Lock()
		got := len(cb.streams)
		cb.mu.Unlock()
		return got >= want
	}, fmt.Sprintf("stream callbacks >= %d", want), func() string {
		return fmt.Sprintf("streams=%d", len(cb.streams))
	})
}

func deltaEvent(text string) (string, map[string]any) {
	return adapters.BusEventTextDelta, map[string]any{"content": text}
}

func blockEvent(text string) (string, map[string]any) {
	return adapters.BusEventTextBlock, map[string]any{"content": text}
}

// TestHubCallbackEmitterCoalescesDeltas verifies #1407: token-level deltas
// accumulate into one stream callback instead of one callback per delta.
func TestHubCallbackEmitterCoalescesDeltas(t *testing.T) {
	emitter, cb, _ := newCoalesceTestEmitter(t, "run-coalesce-basic")

	for _, delta := range []string{"Hel", "lo ", "wor", "ld"} {
		eventType, payload := deltaEvent(delta)
		emitter.Emit(eventType, map[string]any{}, payload)
	}

	cb.mu.Lock()
	if got := len(cb.streams); got != 0 {
		cb.mu.Unlock()
		t.Fatalf("streams before flush = %d, want 0 (deltas must coalesce)", got)
	}
	cb.mu.Unlock()

	emitter.FlushHubStream()
	waitForStreams(t, cb, 1)

	cb.mu.Lock()
	defer cb.mu.Unlock()
	if len(cb.streams) != 1 || cb.streams[0] != "Hello world" {
		t.Fatalf("streams = %v, want [Hello world]", cb.streams)
	}
}

// TestHubCallbackEmitterFlushesOnNewline verifies line breaks chunk deltas at
// natural chat boundaries instead of the byte cap.
func TestHubCallbackEmitterFlushesOnNewline(t *testing.T) {
	emitter, cb, _ := newCoalesceTestEmitter(t, "run-coalesce-newline")

	eventType, payload := deltaEvent("first line\n")
	emitter.Emit(eventType, map[string]any{}, payload)
	waitForStreams(t, cb, 1)

	eventType, payload = deltaEvent("second line")
	emitter.Emit(eventType, map[string]any{}, payload)
	emitter.FlushHubStream()
	waitForStreams(t, cb, 2)

	cb.mu.Lock()
	defer cb.mu.Unlock()
	if len(cb.streams) != 2 || cb.streams[0] != "first line\n" || cb.streams[1] != "second line" {
		t.Fatalf("streams = %v, want [first line\\n second line]", cb.streams)
	}
}

// TestHubCallbackEmitterFlushesOnSizeThreshold verifies the soft byte cap
// chunks a long delta run without line breaks: the pending buffer flushes
// as one chunk once it crosses the cap.
func TestHubCallbackEmitterFlushesOnSizeThreshold(t *testing.T) {
	emitter, cb, _ := newCoalesceTestEmitter(t, "run-coalesce-size")

	part1 := strings.Repeat("x", 200)
	part2 := strings.Repeat("y", 100)
	eventType, payload := deltaEvent(part1)
	emitter.Emit(eventType, map[string]any{}, payload)

	cb.mu.Lock()
	if got := len(cb.streams); got != 0 {
		cb.mu.Unlock()
		t.Fatalf("streams after sub-cap delta = %d, want 0", got)
	}
	cb.mu.Unlock()

	eventType, payload = deltaEvent(part2)
	emitter.Emit(eventType, map[string]any{}, payload)
	waitForStreams(t, cb, 1)

	emitter.FlushHubStream()

	cb.mu.Lock()
	defer cb.mu.Unlock()
	wantCombined := part1 + part2
	if len(cb.streams) != 1 || cb.streams[0] != wantCombined {
		t.Fatalf("streams = [%q], want [%q]", joinStreams(cb.streams), wantCombined)
	}
}

// TestHubCallbackEmitterTextBlockBoundary verifies a text block flushes the
// pending delta buffer before forwarding the block itself.
func TestHubCallbackEmitterTextBlockBoundary(t *testing.T) {
	emitter, cb, _ := newCoalesceTestEmitter(t, "run-coalesce-block")

	eventType, payload := deltaEvent("pending")
	emitter.Emit(eventType, map[string]any{}, payload)
	eventType, payload = blockEvent("FULL BLOCK")
	emitter.Emit(eventType, map[string]any{}, payload)
	waitForStreams(t, cb, 2)

	cb.mu.Lock()
	defer cb.mu.Unlock()
	if len(cb.streams) != 2 || cb.streams[0] != "pending" || cb.streams[1] != "FULL BLOCK" {
		t.Fatalf("streams = %v, want [pending FULL BLOCK]", cb.streams)
	}
}

// TestHubCallbackEmitterResultFlushesPending verifies the fallback (result)
// boundary drains pending deltas so nothing strands after the run finishes.
func TestHubCallbackEmitterResultFlushesPending(t *testing.T) {
	emitter, cb, _ := newCoalesceTestEmitter(t, "run-coalesce-result")

	eventType, payload := deltaEvent("tail")
	emitter.Emit(eventType, map[string]any{}, payload)
	emitter.Emit(adapters.BusEventResult, map[string]any{}, map[string]any{"content": "final answer"})
	waitForStreams(t, cb, 1)

	cb.mu.Lock()
	defer cb.mu.Unlock()
	if len(cb.streams) != 1 || cb.streams[0] != "tail" {
		t.Fatalf("streams = %v, want [tail]", cb.streams)
	}
}

// TestHubCallbackEmitterCollectorUnaffected verifies the done-final collector
// still receives every delta even when stream callbacks are coalesced.
func TestHubCallbackEmitterCollectorUnaffected(t *testing.T) {
	executor, cb, runID := newCoalesceTestEmitter(t, "run-coalesce-collector")

	for _, delta := range []string{"a", "b", "c", "\n", "d"} {
		eventType, payload := deltaEvent(delta)
		executor.Emit(eventType, map[string]any{}, payload)
	}
	executor.FlushHubStream()

	got := executor.executor.hubFinalContent(runID)
	if got != "abc\nd" {
		t.Fatalf("hubFinalContent = %q, want %q (collector must not be coalesced)", got, "abc\nd")
	}
	_ = cb
}

func joinStreams(streams []string) string {
	return strings.Join(streams, "|")
}
