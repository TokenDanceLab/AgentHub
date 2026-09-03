package lifecycle

import (
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
	"github.com/agenthub/pkg/testkit"
)

const (
	// processTrackedWaitTimeout is the Eventually budget for waiting until the
	// executor tracks a started process; Cancel needs the tracked handle to
	// arm the grace path (#2038).
	processTrackedWaitTimeout = 5 * time.Second

	// childCancelSettleWaitTimeout is the Eventually budget for a cascaded
	// child run's store status to settle on cancelled (#2038).
	childCancelSettleWaitTimeout = 3 * time.Second
)

func TestProcessExecutorCancelPublishesCancelledEvent(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor := newTestProcessExecutor(t, bus, s, "sleep")

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	result := executor.Cancel(run.ID)
	if !result.Found || result.Status != "cancelling" {
		t.Fatalf("Cancel result = %#v, want found cancelling", result)
	}

	for {
		evt := nextEvent(t, ch)
		if evt.Type == "run.cancelled" {
			stored, ok := s.GetRun(run.ID)
			if !ok {
				t.Fatalf("run %q was not stored", run.ID)
			}
			if stored.Status != "cancelled" {
				t.Fatalf("stored run status = %q, want cancelled", stored.Status)
			}
			return
		}
	}
}

// TestProcessExecutorCancelGraceNotImmediateKill verifies #988: Cancel must
// not immediately kill the child via CommandContext. With a positive grace
// period the process should survive until escalation, so the wall time from
// Cancel() to run.cancelled is at least the configured grace period.
func TestProcessExecutorCancelGraceNotImmediateKill(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	const grace = 400 * time.Millisecond
	const force = 100 * time.Millisecond

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

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// Wait until the child is tracked so Cancel arms the grace path (not just
	// context cancel before Start).
	testkit.Eventually(t, processTrackedWaitTimeout, func() bool {
		executor.mu.Lock()
		defer executor.mu.Unlock()
		return executor.processes[run.ID] != nil
	}, "started process should be tracked", func() string {
		executor.mu.Lock()
		defer executor.mu.Unlock()
		return fmt.Sprintf("tracked processes=%d", len(executor.processes))
	})

	// Confirm grace path is armed and cancelDone is registered before the
	// run context is cancelled (unit-level proof for #988).
	cancelAt := time.Now()
	result := executor.Cancel(run.ID)
	if !result.Found || result.Status != "cancelling" {
		t.Fatalf("Cancel result = %#v, want found cancelling", result)
	}

	executor.mu.Lock()
	_, graceArmed := executor.cancelDone[run.ID]
	procAfter := executor.processes[run.ID]
	executor.mu.Unlock()
	if !graceArmed {
		t.Fatal("cancelDone not registered; grace path was not armed")
	}
	if procAfter == nil {
		t.Fatal("process handle cleared immediately on Cancel")
	}

	// Immediately after Cancel the child must still be alive. If CommandContext
	// were wired to the same ctx, Go would already have SIGKILLed it.
	time.Sleep(80 * time.Millisecond)
	if !processLikelyAlive(procAfter) {
		t.Fatal("process died immediately after Cancel; grace period was defeated")
	}

	for {
		evt := nextEventWithin(t, ch, 10*time.Second)
		switch evt.Type {
		case "run.cancelled":
			elapsed := time.Since(cancelAt)
			// Allow a little scheduling slack under the grace floor, but require
			// that cancellation was not an immediate CommandContext kill.
			if elapsed < grace-50*time.Millisecond {
				t.Fatalf("run.cancelled after %v, want at least ~%v grace (CommandContext may still be killing immediately)", elapsed, grace)
			}
			return
		case "run.started", "run.output.batch":
		case "run.failed":
			t.Fatal("run failed instead of cancelling")
		default:
			// ignore other bus noise
		}
	}
}

func TestProcessExecutorCancelMissingRun(t *testing.T) {
	executor := newTestProcessExecutor(t, events.NewBus(10), store.New(), "success")

	result := executor.Cancel("run_missing")
	if result.Found || result.Status != "not_found" {
		t.Fatalf("Cancel missing result = %#v, want not_found", result)
	}
}

// TestProcessExecutorStartCancelRace verifies that concurrent Start and Cancel
// calls do not suffer from a TOCTOU race where Start reads the store as "queued"
// but Cancel modifies it before Start enters the running map. Run with -race.
func TestProcessExecutorStartCancelRace(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	executor := newTestProcessExecutor(t, bus, s, "sleep")

	// Start one run to consume a slot, then set max to 1 so any additional Start
	// is blocked by concurrency limit (ensures Start must wait without panicking).
	executor.mu.Lock()
	executor.maxConcurrentRuns = 1
	executor.mu.Unlock()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		// Cancel immediately after Start so the two races are maximized.
		time.Sleep(10 * time.Millisecond)
		executor.Cancel(run.ID)
	}()

	err := executor.Start(run, RunProcessContext{})
	// Either Start succeeds (run was "queued") or it fails (already started/cancelling).
	// Both outcomes are valid given the Cancel may have changed state. We just assert
	// no panic and no data race under the lock-ordering fix.
	_ = err
	wg.Wait()
}

// TestProcessExecutorCancelAlreadyTerminalReturnsStatus verifies that
// cancelling a run that is already in a terminal state returns the
// current status without modifying it.
func TestProcessExecutorCancelAlreadyTerminalReturnsStatus(t *testing.T) {
	for _, terminalStatus := range []string{"finished", "failed", "cancelled"} {
		t.Run(terminalStatus, func(t *testing.T) {
			bus := events.NewBus(100)
			s := store.New()
			run := newExecutorTestRun(t, s)
			_, ok := s.SetRunStatus(run.ID, terminalStatus)
			if !ok {
				t.Fatalf("SetRunStatus(%q) returned false", terminalStatus)
			}

			executor := newTestProcessExecutor(t, bus, s, "success")
			result := executor.Cancel(run.ID)
			if !result.Found || result.Status != terminalStatus {
				t.Fatalf("Cancel result = %#v, want found with status %q", result, terminalStatus)
			}

			stored, ok := s.GetRun(run.ID)
			if !ok || stored.Status != terminalStatus {
				t.Fatalf("stored status = %q, want unchanged %q", stored.Status, terminalStatus)
			}
		})
	}
}

// TestProcessExecutorParentFinishCascadesCancelToChildRunIDs verifies #1001:
// parent terminal finish must cascade Cancel to sub-agent process runIDs.
// Children are registered under agentInstanceID with ParentID=parentRunID, so
// ShutdownCascade must discover them by ParentID and Cancel those runIDs.
func TestProcessExecutorParentFinishCascadesCancelToChildRunIDs(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	parent := newExecutorTestRun(t, s)
	child, err := s.CreateRun("run_child_"+testID(t), parent.ProjectID, parent.ThreadID)
	if err != nil {
		t.Fatalf("CreateRun child: %v", err)
	}

	reg := agents.NewRegistry()
	// Mirror SpawnSubAgent: child agentInstanceID != parentRunID; ParentID is
	// the parent run ID. Parent itself is not necessarily registered.
	_ = reg.Register(&agents.AgentInstance{
		ID:        "agent_" + child.ID,
		AdapterID: "worker",
		ParentID:  parent.ID,
		RunID:     child.ID,
		Status:    agents.StatusBusy,
	})

	executor := newTestProcessExecutor(t, bus, s, "sleep")
	executor.WithAgentRegistry(reg)
	// Short grace so the cancelled child settles quickly under CI.
	executor.mu.Lock()
	executor.shutdownGracePeriod = 50 * time.Millisecond
	executor.shutdownForceTimeout = 50 * time.Millisecond
	executor.mu.Unlock()

	_, ch, _ := bus.Subscribe(0)

	if err := executor.Start(parent, RunProcessContext{}); err != nil {
		t.Fatalf("Start parent: %v", err)
	}
	if err := executor.Start(child, RunProcessContext{}); err != nil {
		t.Fatalf("Start child: %v", err)
	}

	// Wait until both processes are tracked so Cancel has a grace path.
	testkit.Eventually(t, processTrackedWaitTimeout, func() bool {
		executor.mu.Lock()
		defer executor.mu.Unlock()
		return executor.processes[parent.ID] != nil && executor.processes[child.ID] != nil
	}, "parent and child processes should be tracked", func() string {
		executor.mu.Lock()
		defer executor.mu.Unlock()
		return fmt.Sprintf("tracked processes=%d parentTracked=%v childTracked=%v",
			len(executor.processes), executor.processes[parent.ID] != nil, executor.processes[child.ID] != nil)
	})

	// Parent process finishes (success helper would exit immediately; here we
	// Cancel the parent so finish() runs with a registry cascade). Using Cancel
	// exercises the same finish() path as natural completion (#867 terminalFinish).
	if result := executor.Cancel(parent.ID); !result.Found {
		t.Fatalf("Cancel parent result = %#v, want found", result)
	}

	var parentDone, childCancelled bool
	timeout := time.After(10 * time.Second)
	for !parentDone || !childCancelled {
		select {
		case evt := <-ch:
			switch evt.Type {
			case "run.cancelled", "run.finished", "run.failed":
				runID, _ := evt.Scope["runId"].(string)
				if runID == parent.ID && (evt.Type == "run.cancelled" || evt.Type == "run.finished" || evt.Type == "run.failed") {
					parentDone = true
				}
				if runID == child.ID && evt.Type == "run.cancelled" {
					childCancelled = true
				}
			}
		case <-timeout:
			t.Fatalf("timeout waiting cascade: parentDone=%v childCancelled=%v", parentDone, childCancelled)
		}
	}

	// Child registry node must be disconnected by ShutdownCascade.
	inst, ok := reg.Get("agent_" + child.ID)
	if !ok {
		t.Fatal("child agent missing from registry after cascade")
	}
	if inst.Status != agents.StatusDisconnected {
		t.Fatalf("child agent status = %s, want disconnected", inst.Status)
	}

	// Child run should land in cancelled (Cancel path) rather than remain running.
	stored, ok := s.GetRun(child.ID)
	if !ok {
		t.Fatal("child run missing from store")
	}
	if stored.Status != "cancelled" && stored.Status != "cancelling" {
		// Allow brief race before store settles to cancelled.
		testkit.Eventually(t, childCancelSettleWaitTimeout, func() bool {
			current, _ := s.GetRun(child.ID)
			return current.Status == "cancelled"
		}, "child run status should settle to cancelled", func() string {
			current, ok := s.GetRun(child.ID)
			if !ok {
				return "child run missing from store"
			}
			return fmt.Sprintf("childStatus=%q", current.Status)
		})
	}
}
