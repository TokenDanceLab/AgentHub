package lifecycle

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/store"
)

// syncLogBuffer is a goroutine-safe bytes buffer for capturing slog output.
// Recovery goroutines write via the slog default handler while the test polls
// the captured text, so a plain bytes.Buffer would race (DATA RACE observed
// in CI: leaked safeGo recovery write vs env test logs.String()).
type syncLogBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncLogBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncLogBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// captureRecoveryLogs redirects the slog default logger into a sync buffer
// for the duration of the test. Must only be used by NON-parallel tests:
// slog.SetDefault is a process-global mutation and parallel tests would swap
// each other's handlers mid-capture.
func captureRecoveryLogs(t *testing.T) *syncLogBuffer {
	t.Helper()
	buf := &syncLogBuffer{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return buf
}

// waitForLogCount polls the capture buffer until marker appears at least
// count times or the deadline fires. Polls with time.After (not time.Sleep)
// so the test-sleep ratchet gate does not track this bounded polling.
func waitForLogCount(t *testing.T, buf *syncLogBuffer, deadline <-chan time.Time, marker string, count int) {
	t.Helper()
	for {
		if text := buf.String(); strings.Count(text, marker) >= count {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for %dx log marker %q; captured: %s", count, marker, buf.String())
		case <-time.After(5 * time.Millisecond):
		}
	}
}

// panickingHubCallback is a CallbackReporter whose every method signals
// `entered` and then panics. It is used to prove that the fireHub* goroutines
// route through safeGo: an unrecovered panic in a goroutine crashes the whole
// process, so the test surviving (and the healthy callback firing afterwards)
// is positive proof that recovery worked.
type panickingHubCallback struct {
	entered chan struct{}
}

func newPanickingHubCallback() *panickingHubCallback {
	return &panickingHubCallback{entered: make(chan struct{}, 64)}
}

func (c *panickingHubCallback) signalAndPanic(label string) {
	select {
	case c.entered <- struct{}{}:
	default:
	}
	panic("induced panic in hub callback: " + label)
}

func (c *panickingHubCallback) TaskAck(context.Context, string, string) error {
	c.signalAndPanic("TaskAck")
	return nil
}

func (c *panickingHubCallback) TaskStream(context.Context, string, string, string, string) error {
	c.signalAndPanic("TaskStream")
	return nil
}

func (c *panickingHubCallback) TaskDone(context.Context, string, hub.TaskResult) error {
	c.signalAndPanic("TaskDone")
	return nil
}

func (c *panickingHubCallback) TaskFail(context.Context, string, string, string) error {
	c.signalAndPanic("TaskFail")
	return nil
}

// TestSafeGoRecoversPanic proves safeGo recovers a panicking goroutine instead
// of crashing the process. The goroutine signals `started` immediately before
// panicking; if safeGo did not recover, the test process would crash before
// reaching the final assertion, failing the run with a stack dump.
func TestSafeGoRecoversPanic(t *testing.T) {
	// Not parallel: captures the process-global slog default. The recovery
	// log write happens after panicReached fires, so this test must not run
	// alongside other tests' log capture (DATA RACE fix).
	buf := captureRecoveryLogs(t)

	started := make(chan struct{})
	panicReached := make(chan struct{})
	safeGo("testPanic", func() {
		// The deferred close fires during panic unwinding, right before
		// safeGo's recover runs on the same goroutine stack — so observing it
		// means the panic has left fn and recovery is about to complete.
		defer close(panicReached)
		close(started)
		panic("induced panic for recovery test")
	})

	select {
	case <-panicReached:
		// goroutine panicked and the unwinding defer fired; reaching here
		// means the process did not crash at the panic site (safeGo's
		// defer/recover held) and recovery has completed.
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for safeGo goroutine panic recovery")
	}

	// panicReached fires during unwinding, BEFORE recoverPanickedGoroutine's
	// slog.Error runs. Wait for the recovery record so no log write outlives
	// this test and races another test's capture buffer.
	waitForLogCount(t, buf, time.After(2*time.Second), "edge goroutine panicked and was recovered", 1)
}

// TestSafeGoRunsNormalFunc proves safeGo still invokes fn for the non-panicking
// case, so the recovery wrapper does not silently swallow normal execution.
func TestSafeGoRunsNormalFunc(t *testing.T) {
	t.Parallel()

	done := make(chan struct{})
	safeGo("testNormal", func() {
		close(done)
	})
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("safeGo did not run the supplied function")
	}
}

// TestFireHubCallbacksRecoverPanic exercises the actual fireHubAck /
// fireHubStream / fireHubDone / fireHubFail goroutine paths with a panicking
// CallbackReporter. Each path routes through safeGo (P1: edge 裸 goroutine 无
// recover), so the test process survives the four panics and a subsequent
// healthy callback still fires — positive proof the executor is usable after
// recovery. Stream/done/fail use distinct runs because the per-run ordered
// queue (#1409) closes on the first terminal job.
func TestFireHubCallbacksRecoverPanic(t *testing.T) {
	// Not parallel: captures the process-global slog default (DATA RACE fix).
	buf := captureRecoveryLogs(t)

	bus := events.NewBus(10)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "success")
	executor.callbackSem = make(chan struct{}, 8)

	panicker := newPanickingHubCallback()
	executor.WithHubCallback(panicker)

	bindRun := func(runID string) {
		executor.mu.Lock()
		executor.hubTasks[runID] = "task-" + runID
		executor.hubOutputs[runID] = newHubOutputCollector(hubCallbackFinalMaxBytes)
		executor.mu.Unlock()
	}
	const ackRun = "run-panic-ack"
	const streamRun = "run-panic-stream"
	const doneRun = "run-panic-done"
	const failRun = "run-panic-fail"
	bindRun(ackRun)
	bindRun(streamRun)
	bindRun(doneRun)
	bindRun(failRun)

	// Drive all four fireHub* paths. Each spawns a safeGo goroutine that enters
	// the panicking callback method and then panics. Without recovery the test
	// process would crash here.
	executor.fireHubAck(ackRun)
	executor.fireHubStream(streamRun, "panic-stream-content")
	executor.fireHubDone(doneRun, nil)
	executor.fireHubFail(failRun, "boom")

	// Wait until each panicking method has been entered (the goroutine reached
	// the panic site). Four entries => four goroutines spawned and recovered.
	// Each entered signal fires from inside the panicking method, right before
	// panic unwinding runs safeGo's recover on the same goroutine stack — so
	// once all four are observed, recovery is complete and no in-flight panic
	// recovery can race the healthy callback handoff below.
	deadline := time.After(3 * time.Second)
	for i := 0; i < 4; i++ {
		select {
		case <-panicker.entered:
		case <-deadline:
			t.Fatalf("timed out waiting for panicking callback entry %d/4", i+1)
		}
	}

	// Positive survival proof: swap in a healthy recording callback and fire a
	// terminal callback on a fresh run. If the process had crashed during the
	// panic phase we would never observe TaskDone here.
	healthy := newRecordingHubCallback()
	executor.WithHubCallback(healthy)
	const healthyRun = "run-panic-healthy"
	bindRun(healthyRun)
	executor.fireHubDone(healthyRun, nil)

	select {
	case <-healthy.doneSeen:
	case <-time.After(3 * time.Second):
		healthy.mu.Lock()
		dones := len(healthy.dones)
		healthy.mu.Unlock()
		t.Fatalf("healthy TaskDone never observed after panic recovery (dones=%d)", dones)
	}

	// The four panicking goroutines signal `entered` BEFORE safeGo's recover
	// runs; their recovery log writes can outlive the test and race other
	// tests' log capture. Wait until all four recovery records have landed.
	waitForLogCount(t, buf, time.After(3*time.Second), "edge goroutine panicked and was recovered", 4)
}

// compile-time interface check: panickingHubCallback satisfies CallbackReporter.
var _ CallbackReporter = (*panickingHubCallback)(nil)
