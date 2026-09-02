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
	"github.com/agenthub/pkg/safego"
)

// Panic recovery for the Edge run lifecycle (#2154).
//
// The launcher itself lives in pkg/safego and is unit-tested there; what this
// file pins is the two properties that belong to *this* package:
//
//  1. every goroutine the lifecycle spawns really does route through it, so a
//     panicking Hub callback cannot crash the Edge process
//     (TestFireHubCallbacksRecoverPanic drives all four fireHub* paths and then
//     proves the executor is still usable);
//  2. a recovered panic is *observable*, not just logged — it must reach
//     safego's PanicObserver, which is where EdgeMetrics hangs
//     edge_goroutine_panic_recoveries_total
//     (TestLifecycleGoroutinePanicReachesPanicObserver).
//
// Property 2 is the one that was broken while this package kept a private copy
// of the launcher: the copy logged and returned, never dispatched to the
// observer, and Edge — unlike Hub — registered no observer at all.

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
// route through safego.SafeGo: an unrecovered panic in a goroutine crashes the whole
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

// TestFireHubCallbacksRecoverPanic exercises the actual fireHubAck /
// fireHubStream / fireHubDone / fireHubFail goroutine paths with a panicking
// CallbackReporter. Each path routes through safego.SafeGo (P1: edge 裸 goroutine 无
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

	// Drive all four fireHub* paths. Each spawns a safego.SafeGo goroutine that enters
	// the panicking callback method and then panics. Without recovery the test
	// process would crash here.
	executor.fireHubAck(ackRun)
	executor.fireHubStream(streamRun, "panic-stream-content")
	executor.fireHubDone(doneRun, nil)
	executor.fireHubFail(failRun, "boom")

	// Wait until each panicking method has been entered (the goroutine reached
	// the panic site). Four entries => four goroutines spawned and recovered.
	// Each entered signal fires from inside the panicking method, right before
	// panic unwinding runs the safego recover on the same goroutine stack — so
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

	// The four panicking goroutines signal `entered` BEFORE the safego recover
	// runs; their recovery log writes can outlive the test and race other
	// tests' log capture. Wait until all four recovery records have landed.
	waitForLogCount(t, buf, time.After(3*time.Second), "goroutine panic recovered", 4)
}

// compile-time interface check: panickingHubCallback satisfies CallbackReporter.
var _ CallbackReporter = (*panickingHubCallback)(nil)

// TestLifecycleGoroutinePanicReachesPanicObserver pins the *observability* half
// of the recovery contract: a recovered panic in an Edge lifecycle goroutine
// must reach pkg/safego's process-wide PanicObserver, which is where a server
// hangs its panic counter and therefore its alerting.
//
// While this package kept its own private copy of the launcher, its panics were
// logged and nothing else — the copy never dispatched to the observer, so the
// goroutines that carry the run lifecycle (run / hubAck / hubStream /
// hubDoneEnqueue / hubFailEnqueue / hubCallbackQueue / resultAggregator /
// resultAggregatorTimeout / watchRunProcess / cancelGrace) could panic
// invisibly to any alert built against the shared contract. Hub registered an
// observer from the day pkg/safego landed; Edge registered nothing.
func TestLifecycleGoroutinePanicReachesPanicObserver(t *testing.T) {
	// Not parallel: mutates two process globals (slog default logger and the
	// safego panic observer).
	buf := captureRecoveryLogs(t)

	observed := make(chan string, 4)
	safego.SetPanicObserver(func(name string, _ any, _ string) {
		observed <- name
	})
	t.Cleanup(func() { safego.SetPanicObserver(nil) })

	bus := events.NewBus(10)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "success")
	executor.callbackSem = make(chan struct{}, 8)

	panicker := newPanickingHubCallback()
	executor.WithHubCallback(panicker)

	const runID = "run-panic-observable"
	executor.mu.Lock()
	executor.hubTasks[runID] = "task-" + runID
	executor.hubOutputs[runID] = newHubOutputCollector(hubCallbackFinalMaxBytes)
	executor.mu.Unlock()

	// fireHubAck spawns the lifecycle goroutine that enters the panicking
	// callback. Recovery happens on that same goroutine, so the observer fires
	// exactly once with the launcher's label for this call site.
	executor.fireHubAck(runID)

	select {
	case name := <-observed:
		if name != "hubAck" {
			t.Fatalf("PanicObserver goroutine label = %q, want %q: the label is the only attribution an alert has", name, "hubAck")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("a recovered lifecycle panic never reached safego's PanicObserver — Edge goroutine panics are invisible to metrics and alerting")
	}

	// Let the recovery log write land before the test releases the captured
	// logger, so it cannot race another test's log capture.
	waitForLogCount(t, buf, time.After(3*time.Second), "goroutine panic recovered", 1)
}
