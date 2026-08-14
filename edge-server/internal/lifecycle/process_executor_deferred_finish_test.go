package lifecycle

import (
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

// TestPlanParentWaitChildren covers the pure orchestration-deferral gate:
// only a parent with a registry AND at least one active child defers.
func TestPlanParentWaitChildren(t *testing.T) {
	if got := planParentWaitChildren(true, true).Defer; !got {
		t.Error("registry + active children must defer")
	}
	if got := planParentWaitChildren(true, false).Defer; got {
		t.Error("no active children must not defer")
	}
	if got := planParentWaitChildren(false, true).Defer; got {
		t.Error("no registry must not defer")
	}
}

// TestHasActiveChildren verifies the registry-driven child liveness check.
func TestHasActiveChildren(t *testing.T) {
	bus := events.NewBus(10)
	s := store.New()
	run := newExecutorTestRun(t, s)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{Command: "agenthub-adapter-sentinel"}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}
	if executor.hasActiveChildren(run.ID) {
		t.Fatal("no registry must report no active children")
	}

	reg := agents.NewRegistry()
	executor.WithAgentRegistry(reg)
	if executor.hasActiveChildren(run.ID) {
		t.Fatal("empty registry must report no active children")
	}

	if err := reg.Register(&agents.AgentInstance{
		ID: "child-active", Name: "claude-code", AdapterID: "claude-code", ParentID: run.ID, Status: agents.StatusBusy,
	}); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if !executor.hasActiveChildren(run.ID) {
		t.Fatal("busy child must report active children")
	}

	if err := reg.Register(&agents.AgentInstance{
		ID: "child-done", Name: "codex-acp", AdapterID: "codex-acp", ParentID: run.ID, Status: agents.StatusCompleted,
	}); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if !executor.hasActiveChildren(run.ID) {
		t.Fatal("mixed busy+completed children must still report active")
	}

	reg.SetStatus("child-active", agents.StatusCompleted, "")
	if executor.hasActiveChildren(run.ID) {
		t.Fatal("all-terminal children must report no active children")
	}
}

// TestFinishSkipsCascadeForDeferredParent verifies the Codex AgentTree
// cascade-cancel does NOT fire while the parent's finish is parked waiting
// for its sub-agents.
func TestFinishSkipsCascadeForDeferredParent(t *testing.T) {
	bus := events.NewBus(10)
	s := store.New()
	run := newExecutorTestRun(t, s)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{Command: "agenthub-adapter-sentinel"}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}
	reg := agents.NewRegistry()
	executor.WithAgentRegistry(reg)
	if err := reg.Register(&agents.AgentInstance{
		ID: "child-busy", Name: "claude-code", AdapterID: "claude-code", ParentID: run.ID, Status: agents.StatusBusy,
	}); err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Park the parent finish (as completeRunAttempt outcomeDeferred does).
	executor.mu.Lock()
	executor.pendingParentFinish = map[string]deferredParentFinish{
		run.ID: {run: run, finalStatus: "finished"},
	}
	executor.mu.Unlock()

	executor.finish(run.ID)
	if inst, _ := reg.Get("child-busy"); inst.Status != agents.StatusBusy {
		t.Fatalf("deferred finish must not cascade-cancel children: status = %s", inst.Status)
	}

	// After the park is consumed (normal finalize), finish() cascades again.
	executor.mu.Lock()
	delete(executor.pendingParentFinish, run.ID)
	executor.mu.Unlock()
	executor.finish(run.ID)
	if inst, _ := reg.Get("child-busy"); inst.Status != agents.StatusDisconnected {
		t.Fatalf("non-deferred finish must cascade-disconnect children: status = %s", inst.Status)
	}
}

// TestFinalizeParentRunPublishesTerminalFinish verifies the ResultAggregator
// finalize callback: the parked parent transitions started → finished and
// run.finished is published exactly once.
func TestFinalizeParentRunPublishesTerminalFinish(t *testing.T) {
	bus := events.NewBus(10)
	s := store.New()
	run := newExecutorTestRun(t, s)
	if _, ok := s.SetRunStatusIf(run.ID, "started", "queued"); !ok {
		t.Fatal("failed to move run to started")
	}
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{Command: "agenthub-adapter-sentinel"}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	executor.mu.Lock()
	executor.pendingParentFinish = map[string]deferredParentFinish{
		run.ID: {run: run, finalStatus: "finished"},
	}
	executor.mu.Unlock()

	_, ch, _ := bus.Subscribe(0)
	executor.FinalizeParentRun(run.ID)

	// Terminal event + status transition.
	var gotFinished bool
	deadline := time.After(3 * time.Second)
waitLoop:
	for !gotFinished {
		select {
		case evt := <-ch:
			if evt.Type == "run.finished" {
				gotFinished = true
			}
		case <-deadline:
			break waitLoop
		}
	}
	if !gotFinished {
		t.Fatal("run.finished was not published by FinalizeParentRun")
	}
	if st, _ := s.GetRun(run.ID); st.Status != "finished" {
		t.Fatalf("run status = %s, want finished", st.Status)
	}

	// Idempotent: a second call must not publish another run.finished.
	executor.FinalizeParentRun(run.ID)
	select {
	case evt := <-ch:
		if evt.Type == "run.finished" {
			t.Fatalf("duplicate run.finished published: %+v", evt)
		}
	case <-time.After(300 * time.Millisecond):
	}

	// Unknown parent no-ops.
	executor.FinalizeParentRun("run-unknown")
}
