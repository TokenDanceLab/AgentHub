package lifecycle

import (
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

// uuidLike reports whether s looks like a UUID string (8-4-4-4-12 hex).
func uuidLike(s string) bool {
	parts := strings.Split(s, "-")
	return len(parts) == 5 && len(parts[0]) == 8 && len(parts[1]) == 4 && len(parts[2]) == 4 && len(parts[3]) == 4 && len(parts[4]) == 12
}

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
		ID: "child-active", Name: "claude-code", AdapterID: "claude-code", ParentID: run.ID,
		RunID: "run_child_active", Status: agents.StatusBusy,
	}); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if !executor.hasActiveChildren(run.ID) {
		t.Fatal("busy child must report active children")
	}

	if err := reg.Register(&agents.AgentInstance{
		ID: "child-done", Name: "codex-acp", AdapterID: "codex-acp", ParentID: run.ID,
		RunID: "run_child_done", Status: agents.StatusCompleted,
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

// TestNewSubAgentRunContextUsesFreshSessionUUID verifies the sub-agent's CC
// session is a fresh UUID — the claude-code CLI rejects hierarchical thread
// paths ("parent/sub/run_x") as session IDs.
func TestNewSubAgentRunContextUsesFreshSessionUUID(t *testing.T) {
	run := store.Run{ID: "run-sub", ProjectID: "proj", ThreadID: "thread/sub/run-sub"}
	ctx := newSubAgentRunContext(run, adapters.SubAgentTask{AgentID: "claude-code", Prompt: "task"})
	if ctx.SessionID == run.ThreadID || ctx.SessionID == "thread/sub/run-sub" {
		t.Fatalf("SessionID must not be the thread path: %q", ctx.SessionID)
	}
	if !uuidLike(ctx.SessionID) {
		t.Fatalf("SessionID = %q, want a UUID v4 form", ctx.SessionID)
	}
}

// TestUniqueChildRunsAllCompleteDedupesDualInstances verifies that two
// registry instances sharing a RunID (orchestrator placeholder + executor
// run-backed) count as ONE child run, complete when ANY instance is terminal.
func TestUniqueChildRunsAllCompleteDedupesDualInstances(t *testing.T) {
	instances := func(aStatus, bStatus agents.Status) []agents.AgentInstance {
		return []agents.AgentInstance{
			{ID: "ph", Name: "claude-code", ParentID: "parent", RunID: "run_task_1", Status: aStatus},
			{ID: "rb", Name: "claude-code", ParentID: "parent", RunID: "run_task_1", Status: bStatus},
		}
	}

	// Both busy → 1 unique run, not complete.
	count, all := uniqueChildRunsAllComplete(instances(agents.StatusBusy, agents.StatusBusy))
	if count != 1 || all {
		t.Fatalf("both busy: count=%d all=%v, want 1/false", count, all)
	}
	// Split status (one terminal) → the run is complete.
	count, all = uniqueChildRunsAllComplete(instances(agents.StatusCompleted, agents.StatusBusy))
	if count != 1 || !all {
		t.Fatalf("split status: count=%d all=%v, want 1/true", count, all)
	}
	// Two distinct runs, one complete one busy → 2, not complete.
	mixed := append(instances(agents.StatusCompleted, agents.StatusBusy),
		agents.AgentInstance{ID: "rb2", Name: "codex-acp", ParentID: "parent", RunID: "run_task_2", Status: agents.StatusBusy})
	count, all = uniqueChildRunsAllComplete(mixed)
	if count != 2 || all {
		t.Fatalf("mixed: count=%d all=%v, want 2/false", count, all)
	}
	// Placeholder without RunID is ignored.
	noRun := append(instances(agents.StatusCompleted, agents.StatusBusy),
		agents.AgentInstance{ID: "ph2", Name: "claude-code", ParentID: "parent", Status: agents.StatusIdle})
	count, all = uniqueChildRunsAllComplete(noRun)
	if count != 1 || !all {
		t.Fatalf("placeholder ignored: count=%d all=%v, want 1/true", count, all)
	}
}

// TestCheckAllChildrenCompleteIgnoresPlaceholderInstances verifies the
// aggregator only counts run-backed children (RunID set): the orchestrator's
// dispatch-time placeholder instance must not block parent finalization.
func TestCheckAllChildrenCompleteIgnoresPlaceholderInstances(t *testing.T) {
	bus := events.NewBus(10)
	reg := agents.NewRegistry()
	ra := NewResultAggregator(bus, reg)

	// Orchestrator placeholder (no RunID) — never reaches a terminal status.
	if err := reg.Register(&agents.AgentInstance{
		ID: "placeholder", Name: "claude-code", AdapterID: "claude-code", ParentID: "parent-run", Status: agents.StatusIdle,
	}); err != nil {
		t.Fatalf("Register placeholder: %v", err)
	}
	// Run-backed child — completed.
	if err := reg.Register(&agents.AgentInstance{
		ID: "run-backed", Name: "claude-code", AdapterID: "claude-code", ParentID: "parent-run",
		RunID: "run-task-1", Status: agents.StatusCompleted,
	}); err != nil {
		t.Fatalf("Register run-backed: %v", err)
	}

	finalized := make(chan string, 1)
	ra.WithParentFinalizer(func(parentRunID string) { finalized <- parentRunID })
	ra.checkAllChildrenComplete("parent-run")

	select {
	case parentID := <-finalized:
		if parentID != "parent-run" {
			t.Fatalf("finalized parent = %q, want parent-run", parentID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("finalizeParent not invoked despite run-backed children being complete")
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
