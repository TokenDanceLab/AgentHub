package lifecycle

import (
	"context"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/store"
)

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
	t.Parallel()

	started := make(chan struct{})
	safeGo("testPanic", func() {
		close(started)
		panic("induced panic for recovery test")
	})

	select {
	case <-started:
		// goroutine ran and panicked; reaching here means the process did not
		// crash at the panic site (safeGo's defer/recover held).
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for safeGo goroutine to start")
	}

	// Give the recovering defer a beat to run after the panic. The fact that
	// this line executes at all is the survival assertion: an unrecovered
	// goroutine panic would have terminated the test process already.
	time.Sleep(50 * time.Millisecond)
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
// recovery.
func TestFireHubCallbacksRecoverPanic(t *testing.T) {
	t.Parallel()

	bus := events.NewBus(10)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "success")
	executor.callbackSem = make(chan struct{}, 8)

	panicker := newPanickingHubCallback()
	executor.WithHubCallback(panicker)

	const runID = "run-panic-recovery"
	const taskID = "task-panic"
	executor.mu.Lock()
	executor.hubTasks[runID] = taskID
	executor.hubOutputs[runID] = newHubOutputCollector(hubCallbackFinalMaxBytes)
	executor.mu.Unlock()

	// Drive all four fireHub* paths. Each spawns a safeGo goroutine that enters
	// the panicking callback method and then panics. Without recovery the test
	// process would crash here.
	executor.fireHubAck(runID)
	executor.fireHubStream(runID, "panic-stream-content")
	executor.fireHubDone(runID, nil)
	executor.fireHubFail(runID, "boom")

	// Wait until each panicking method has been entered (the goroutine reached
	// the panic site). Four entries => four goroutines spawned and recovered.
	deadline := time.After(3 * time.Second)
	for i := 0; i < 4; i++ {
		select {
		case <-panicker.entered:
		case <-deadline:
			t.Fatalf("timed out waiting for panicking callback entry %d/4", i+1)
		}
	}

	// Let the four recover defer calls finish so there is no in-flight panic
	// recovery racing the healthy callback handoff.
	time.Sleep(50 * time.Millisecond)

	// Positive survival proof: swap in a healthy recording callback and fire a
	// terminal callback. If the process had crashed during the panic phase we
	// would never observe TaskDone here.
	healthy := newRecordingHubCallback()
	executor.WithHubCallback(healthy)
	executor.fireHubDone(runID, nil)

	select {
	case <-healthy.doneSeen:
	case <-time.After(3 * time.Second):
		healthy.mu.Lock()
		dones := len(healthy.dones)
		healthy.mu.Unlock()
		t.Fatalf("healthy TaskDone never observed after panic recovery (dones=%d)", dones)
	}
}

// compile-time interface check: panickingHubCallback satisfies CallbackReporter.
var _ CallbackReporter = (*panickingHubCallback)(nil)
