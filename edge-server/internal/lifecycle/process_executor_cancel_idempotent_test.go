package lifecycle

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
	"github.com/agenthub/edge-server/internal/testkit"
)

// Regression tests for #2154 (Wegener 并发探索): a repeat Cancel while the
// first grace path is armed must not re-arm. Re-arming overwrites
// cancelDone[runID], so finish() closes only the newest channel and the
// earlier cancelGrace goroutines are orphaned (they live out both timers,
// signal a dead process, and re-Wait it).

// newCancelGraceTestExecutor builds a sleep-helper executor with explicit
// shutdown grace/force timeouts for #2154 regression tests.
func newCancelGraceTestExecutor(t *testing.T, bus *events.Bus, s store.RunLifecycleStore, grace, force time.Duration) *ProcessExecutor {
	t.Helper()
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command:              os.Args[0],
		Args:                 []string{processExecutorHelperRunFlag, "--", "sleep"},
		Env:                  append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
		ShutdownGracePeriod:  grace,
		ShutdownForceTimeout: force,
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor: %v", err)
	}
	executor.faultEscalationCfg = FaultEscalationConfig{Enabled: false}
	return executor
}

// waitProcessTracked blocks until the executor tracks the started process so
// Cancel arms the grace path (same gate as #988 tests).
func waitProcessTracked(t *testing.T, executor *ProcessExecutor, runID string) {
	t.Helper()
	testkit.Eventually(t, processTrackedWaitTimeout, func() bool {
		executor.mu.Lock()
		defer executor.mu.Unlock()
		return executor.processes[runID] != nil
	}, "started process should be tracked", func() string {
		executor.mu.Lock()
		defer executor.mu.Unlock()
		return fmt.Sprintf("tracked processes=%d", len(executor.processes))
	})
}

// waitRunCancelled drains bus events until run.cancelled arrives.
func waitRunCancelled(t *testing.T, ch <-chan events.EventEnvelope) {
	t.Helper()
	for {
		evt := nextEventWithin(t, ch, 10*time.Second)
		switch evt.Type {
		case "run.cancelled":
			return
		case "run.started", "run.output.batch":
		case "run.failed":
			t.Fatal("run failed instead of cancelling")
		default:
			// ignore other bus noise
		}
	}
}

// TestProcessExecutorSecondCancelKeepsSingleGracePath verifies that a second
// Cancel neither replaces the tracked cancelDone channel nor orphans the
// first grace goroutine: the single armed channel must be closed by finish().
func TestProcessExecutorSecondCancelKeepsSingleGracePath(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	const grace = 400 * time.Millisecond
	const force = 100 * time.Millisecond
	executor := newCancelGraceTestExecutor(t, bus, s, grace, force)

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	waitProcessTracked(t, executor, run.ID)

	first := executor.Cancel(run.ID)
	if !first.Found || first.Status != "cancelling" {
		t.Fatalf("first Cancel result = %#v, want found cancelling", first)
	}
	executor.mu.Lock()
	doneFirst := executor.cancelDone[run.ID]
	executor.mu.Unlock()
	if doneFirst == nil {
		t.Fatal("first Cancel did not arm the grace path")
	}

	second := executor.Cancel(run.ID)
	if !second.Found || second.Status != "cancelling" {
		t.Fatalf("second Cancel result = %#v, want found cancelling (observable result must not change)", second)
	}
	executor.mu.Lock()
	doneSecond := executor.cancelDone[run.ID]
	executor.mu.Unlock()
	if doneSecond != doneFirst {
		t.Fatalf("second Cancel re-armed the grace path: cancelDone replaced (%p -> %p), orphaning the first grace goroutine", doneFirst, doneSecond)
	}

	waitRunCancelled(t, ch)

	// finish() must close the single armed channel; if a duplicate arm had
	// overwritten it, doneFirst would never close and its goroutine would be
	// orphaned until both timers elapsed.
	select {
	case <-doneFirst:
	case <-time.After(2 * time.Second):
		t.Fatal("cancelDone from first Cancel never closed; grace goroutine orphaned")
	}
}

// TestProcessExecutorConcurrentCancelArmsGraceOnce fires racing Cancel calls
// and asserts exactly one cancelGrace goroutine survives. The long grace
// period keeps any orphaned duplicate alive so the stack count is
// deterministic at sampling time.
func TestProcessExecutorConcurrentCancelArmsGraceOnce(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	const grace = 2 * time.Second
	const force = 500 * time.Millisecond
	executor := newCancelGraceTestExecutor(t, bus, s, grace, force)

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	waitProcessTracked(t, executor, run.ID)

	const cancelCalls = 6
	results := make([]CancelResult, cancelCalls)
	var wg sync.WaitGroup
	barrier := make(chan struct{})
	for i := 0; i < cancelCalls; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-barrier
			results[i] = executor.Cancel(run.ID)
		}(i)
	}
	close(barrier)
	wg.Wait()

	for i, result := range results {
		if !result.Found {
			t.Fatalf("concurrent Cancel[%d] result = %#v, want found", i, result)
		}
	}

	// Let any armed grace goroutines park on their grace timer, then count.
	time.Sleep(100 * time.Millisecond)
	if n := countCancelGraceGoroutines(t); n != 1 {
		t.Fatalf("live cancelGrace goroutines = %d, want exactly 1 (repeat Cancel armed %d extra)", n, n-1)
	}

	// Teardown: the single armed path must still escalate and cancel the run.
	waitRunCancelled(t, ch)
}

// countCancelGraceGoroutines counts live goroutines parked in the Cancel
// grace closure. The closure frame name is stable while the goroutine waits
// on its grace/force timer (#2154).
func countCancelGraceGoroutines(t *testing.T) int {
	t.Helper()
	buf := make([]byte, 1<<20)
	for {
		n := runtime.Stack(buf, true)
		if n < len(buf) {
			stack := string(buf[:n])
			count := 0
			for _, block := range strings.Split(stack, "\n\n") {
				if strings.Contains(block, "(*ProcessExecutor).Cancel.func") {
					count++
				}
			}
			return count
		}
		buf = make([]byte, 2*len(buf))
	}
}
