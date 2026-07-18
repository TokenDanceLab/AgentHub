package agents

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestNewRegistry(t *testing.T) {
	r := NewRegistry()
	if r == nil {
		t.Fatal("NewRegistry should not return nil")
	}
	if r.Count() != 0 {
		t.Fatal("new registry should be empty")
	}
}

func TestRegistry_Register(t *testing.T) {
	r := NewRegistry()

	inst := &AgentInstance{
		ID:        "agent-1",
		AdapterID: "claude-code",
		Name:      "Worker Alpha",
		Role:      "worker",
	}

	err := r.Register(inst)
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}

	// Duplicate registration should fail.
	err = r.Register(inst)
	if err == nil {
		t.Fatal("expected error on duplicate registration")
	}

	// Verify auto-set fields.
	got, _ := r.Get("agent-1")
	if got.Status != StatusIdle {
		t.Fatalf("auto-set status should be idle, got %s", got.Status)
	}
	if got.LastSeen.IsZero() {
		t.Fatal("LastSeen should be auto-set")
	}
	if got.CreatedAt.IsZero() {
		t.Fatal("CreatedAt should be auto-set")
	}
}

func TestRegistry_RegisterEmptyID(t *testing.T) {
	r := NewRegistry()
	err := r.Register(&AgentInstance{ID: "", AdapterID: "claude-code"})
	if err == nil {
		t.Fatal("expected error on empty agent ID")
	}
}

func TestRegistry_RegisterEmptyAdapterID(t *testing.T) {
	r := NewRegistry()
	err := r.Register(&AgentInstance{ID: "agent-1", AdapterID: ""})
	if err == nil {
		t.Fatal("expected error on empty adapter ID")
	}
}

func TestRegistry_RegisterPreservesTime(t *testing.T) {
	r := NewRegistry()
	specificTime := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	inst := &AgentInstance{
		ID:        "agent-1",
		AdapterID: "claude-code",
		Name:      "Worker",
		CreatedAt: specificTime,
	}
	_ = r.Register(inst)

	got, _ := r.Get("agent-1")
	if !got.CreatedAt.Equal(specificTime) {
		t.Fatalf("CreatedAt should be preserved, got %v", got.CreatedAt)
	}
}

func TestRegistry_Unregister(t *testing.T) {
	r := NewRegistry()
	_ = r.Register(&AgentInstance{ID: "agent-1", AdapterID: "claude-code"})

	if !r.Unregister("agent-1") {
		t.Fatal("Unregister should return true for registered agent")
	}

	_, ok := r.Get("agent-1")
	if ok {
		t.Fatal("agent should be removed after Unregister")
	}

	// Unregister nonexistent returns false.
	if r.Unregister("nonexistent") {
		t.Fatal("Unregister should return false for nonexistent agent")
	}
}

func TestRegistry_Get(t *testing.T) {
	r := NewRegistry()
	_ = r.Register(&AgentInstance{
		ID:        "agent-1",
		AdapterID: "claude-code",
		Name:      "Worker",
		Role:      "worker",
	})

	got, ok := r.Get("agent-1")
	if !ok {
		t.Fatal("Get should return ok for registered agent")
	}
	if got.ID != "agent-1" || got.Name != "Worker" {
		t.Fatalf("Get returned wrong agent: %+v", got)
	}

	// Get should return a clone, not the original pointer.
	got.Name = "modified"
	got2, _ := r.Get("agent-1")
	if got2.Name != "Worker" {
		t.Fatal("Get should return a clone; mutations should not affect registry")
	}

	_, ok = r.Get("nonexistent")
	if ok {
		t.Fatal("Get should return false for nonexistent agent")
	}
}

func TestRegistry_List(t *testing.T) {
	r := NewRegistry()
	_ = r.Register(&AgentInstance{ID: "agent-1", AdapterID: "cc", Name: "A", Role: "worker"})
	_ = r.Register(&AgentInstance{ID: "agent-2", AdapterID: "cc", Name: "B", Role: "specialist"})

	list := r.List()
	if len(list) != 2 {
		t.Fatalf("List should return 2 agents, got %d", len(list))
	}
}

func TestRegistry_ListByParent(t *testing.T) {
	r := NewRegistry()
	_ = r.Register(&AgentInstance{ID: "a1", AdapterID: "cc", ParentID: "run-1"})
	_ = r.Register(&AgentInstance{ID: "a2", AdapterID: "cc", ParentID: "run-1"})
	_ = r.Register(&AgentInstance{ID: "a3", AdapterID: "cc", ParentID: "run-2"})

	children := r.ListByParent("run-1")
	if len(children) != 2 {
		t.Fatalf("ListByParent(run-1) should return 2 agents, got %d", len(children))
	}

	children2 := r.ListByParent("run-2")
	if len(children2) != 1 {
		t.Fatalf("ListByParent(run-2) should return 1 agent, got %d", len(children2))
	}

	none := r.ListByParent("nonexistent")
	if len(none) != 0 {
		t.Fatalf("ListByParent for nonexistent should return empty, got %d", len(none))
	}
}

func TestRegistry_ListByStatus(t *testing.T) {
	r := NewRegistry()
	_ = r.Register(&AgentInstance{ID: "a1", AdapterID: "cc", Status: StatusIdle})
	_ = r.Register(&AgentInstance{ID: "a2", AdapterID: "cc", Status: StatusBusy})
	_ = r.Register(&AgentInstance{ID: "a3", AdapterID: "cc", Status: StatusIdle})

	idle := r.ListByStatus(StatusIdle)
	if len(idle) != 2 {
		t.Fatalf("ListByStatus(idle) should return 2, got %d", len(idle))
	}

	busy := r.ListByStatus(StatusBusy)
	if len(busy) != 1 {
		t.Fatalf("ListByStatus(busy) should return 1, got %d", len(busy))
	}
}

func TestRegistry_ListByAdapter(t *testing.T) {
	r := NewRegistry()
	_ = r.Register(&AgentInstance{ID: "a1", AdapterID: "claude-code"})
	_ = r.Register(&AgentInstance{ID: "a2", AdapterID: "codex"})
	_ = r.Register(&AgentInstance{ID: "a3", AdapterID: "claude-code"})

	cc := r.ListByAdapter("claude-code")
	if len(cc) != 2 {
		t.Fatalf("ListByAdapter(claude-code) should return 2, got %d", len(cc))
	}

	cx := r.ListByAdapter("codex")
	if len(cx) != 1 {
		t.Fatalf("ListByAdapter(codex) should return 1, got %d", len(cx))
	}
}

func TestRegistry_SetStatus(t *testing.T) {
	r := NewRegistry()
	_ = r.Register(&AgentInstance{ID: "agent-1", AdapterID: "cc", Status: StatusIdle})

	before := time.Now()
	ok := r.SetStatus("agent-1", StatusBusy, "")
	if !ok {
		t.Fatal("SetStatus should return true")
	}

	agent, _ := r.Get("agent-1")
	if agent.Status != StatusBusy {
		t.Fatalf("status should be busy, got %s", agent.Status)
	}
	if agent.LastSeen.Before(before) {
		t.Fatal("LastSeen should be updated on SetStatus")
	}

	// SetStatus on nonexistent returns false.
	ok = r.SetStatus("nonexistent", StatusBusy, "")
	if ok {
		t.Fatal("SetStatus should return false for nonexistent agent")
	}
}

func TestRegistry_SetStatusWithError(t *testing.T) {
	r := NewRegistry()
	_ = r.Register(&AgentInstance{ID: "agent-1", AdapterID: "cc", Status: StatusIdle})

	r.SetStatus("agent-1", StatusError, "something went wrong")
	agent, _ := r.Get("agent-1")
	if agent.Error != "something went wrong" {
		t.Fatalf("Error = %q, want 'something went wrong'", agent.Error)
	}
}

func TestRegistry_SetRunID(t *testing.T) {
	r := NewRegistry()
	_ = r.Register(&AgentInstance{ID: "agent-1", AdapterID: "cc"})

	ok := r.SetRunID("agent-1", "run-123")
	if !ok {
		t.Fatal("SetRunID should return true")
	}

	agent, _ := r.Get("agent-1")
	if agent.RunID != "run-123" {
		t.Fatalf("RunID = %q, want run-123", agent.RunID)
	}

	// SetRunID on nonexistent returns false.
	ok = r.SetRunID("nonexistent", "run-456")
	if ok {
		t.Fatal("SetRunID should return false for nonexistent agent")
	}
}

func TestRegistry_Count(t *testing.T) {
	r := NewRegistry()
	if r.Count() != 0 {
		t.Fatal("new registry count should be 0")
	}

	_ = r.Register(&AgentInstance{ID: "a1", AdapterID: "cc"})
	_ = r.Register(&AgentInstance{ID: "a2", AdapterID: "cc"})

	if r.Count() != 2 {
		t.Fatalf("Count should be 2, got %d", r.Count())
	}
}

func TestRegistry_CountByStatus(t *testing.T) {
	r := NewRegistry()
	_ = r.Register(&AgentInstance{ID: "a1", AdapterID: "cc", Status: StatusIdle})
	_ = r.Register(&AgentInstance{ID: "a2", AdapterID: "cc", Status: StatusBusy})
	_ = r.Register(&AgentInstance{ID: "a3", AdapterID: "cc", Status: StatusBusy})
	_ = r.Register(&AgentInstance{ID: "a4", AdapterID: "cc", Status: StatusError})

	if n := r.CountByStatus(StatusIdle); n != 1 {
		t.Fatalf("idle count = %d, want 1", n)
	}
	if n := r.CountByStatus(StatusBusy); n != 2 {
		t.Fatalf("busy count = %d, want 2", n)
	}
	if n := r.CountByStatus(StatusError); n != 1 {
		t.Fatalf("error count = %d, want 1", n)
	}
}

func TestRegistry_GetChildren(t *testing.T) {
	r := NewRegistry()
	_ = r.Register(&AgentInstance{ID: "orch", AdapterID: "cc", ParentID: ""})
	_ = r.Register(&AgentInstance{ID: "child1", AdapterID: "cc", ParentID: "orch"})
	_ = r.Register(&AgentInstance{ID: "child2", AdapterID: "cc", ParentID: "orch"})
	_ = r.Register(&AgentInstance{ID: "grandchild", AdapterID: "cc", ParentID: "child1"})

	children := r.GetChildren("orch")
	if len(children) != 2 {
		t.Fatalf("orch should have 2 children, got %d", len(children))
	}

	grandchildren := r.GetChildren("child1")
	if len(grandchildren) != 1 {
		t.Fatalf("child1 should have 1 child, got %d", len(grandchildren))
	}

	none := r.GetChildren("nonexistent")
	if len(none) != 0 {
		t.Fatalf("nonexistent should have 0 children, got %d", len(none))
	}
}

func TestRegistry_AncestorChain(t *testing.T) {
	r := NewRegistry()
	_ = r.Register(&AgentInstance{ID: "root", AdapterID: "cc", ParentID: ""})
	_ = r.Register(&AgentInstance{ID: "mid", AdapterID: "cc", ParentID: "root"})
	_ = r.Register(&AgentInstance{ID: "leaf", AdapterID: "cc", ParentID: "mid"})

	chain := r.AncestorChain("leaf")
	if len(chain) != 3 {
		t.Fatalf("ancestor chain should have 3 entries, got %d", len(chain))
	}
	if chain[0] != "leaf" || chain[1] != "mid" || chain[2] != "root" {
		t.Fatalf("ancestor chain order wrong: %v", chain)
	}

	rootChain := r.AncestorChain("root")
	if len(rootChain) != 1 {
		t.Fatalf("root ancestor chain should have 1 entry, got %d", len(rootChain))
	}
}

func TestRegistry_AncestorChainCycleDetection(t *testing.T) {
	r := NewRegistry()
	// Create a cycle: a -> b -> a
	_ = r.Register(&AgentInstance{ID: "a", AdapterID: "cc", ParentID: "b"})
	_ = r.Register(&AgentInstance{ID: "b", AdapterID: "cc", ParentID: "a"})

	chain := r.AncestorChain("a")
	// Should detect cycle and break.
	if len(chain) < 2 {
		t.Fatal("ancestor chain should detect cycle and not loop indefinitely")
	}
}

func TestRegistry_MaxDepth(t *testing.T) {
	r := NewRegistry()
	_ = r.Register(&AgentInstance{ID: "a", AdapterID: "cc", Depth: 0})
	_ = r.Register(&AgentInstance{ID: "b", AdapterID: "cc", Depth: 3})
	_ = r.Register(&AgentInstance{ID: "c", AdapterID: "cc", Depth: 5})

	if max := r.MaxDepth(); max != 5 {
		t.Fatalf("MaxDepth should be 5, got %d", max)
	}
}

func TestRegistry_ConcurrentAccess(t *testing.T) {
	r := NewRegistry()
	var wg sync.WaitGroup
	n := 50

	// Concurrent registration.
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			id := "agent-" + string(rune('0'+idx%10))
			_ = r.Register(&AgentInstance{
				ID:        id,
				AdapterID: "cc",
				Name:      "worker",
				Role:      "worker",
				Status:    StatusIdle,
			})
		}(i)
	}
	wg.Wait()

	// Concurrent reads.
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = r.List()
			_ = r.Count()
			_ = r.CountByStatus(StatusIdle)
			_ = r.MaxDepth()
		}()
	}
	wg.Wait()

	// Should not panic.
	list := r.List()
	if len(list) == 0 {
		t.Fatal("expected some registered agents after concurrent access")
	}
}

func TestAgentInstance_DefaultStatus(t *testing.T) {
	inst := &AgentInstance{ID: "a", AdapterID: "cc"}
	if inst.Status != "" {
		t.Fatalf("new AgentInstance status should be empty before registration, got %s", inst.Status)
	}
	if inst.Depth != 0 {
		t.Fatalf("new AgentInstance depth should be 0, got %d", inst.Depth)
	}
	if inst.AgentPath != "" {
		t.Fatalf("new AgentInstance AgentPath should be empty, got %s", inst.AgentPath)
	}
}

// ── Feature: AgentTree spawn slot enforcement ──

func TestRegistry_CanSpawnSlotFull(t *testing.T) {
	r := NewRegistry().WithMaxConcurrent(2)

	// Register parent and two active children.
	_ = r.Register(&AgentInstance{ID: "parent", AdapterID: "orch", ParentID: "", Status: StatusBusy})
	_ = r.Register(&AgentInstance{ID: "child-1", AdapterID: "worker", ParentID: "parent", Status: StatusBusy})
	_ = r.Register(&AgentInstance{ID: "child-2", AdapterID: "worker", ParentID: "parent", Status: StatusIdle})

	// Third child should be rejected.
	err := r.CanSpawn("parent", 1)
	if err == nil {
		t.Fatal("CanSpawn should return error when slots are full")
	}
	if err != ErrAgentSlotFull {
		t.Fatalf("CanSpawn error = %v, want ErrAgentSlotFull", err)
	}

	// Completed children should not count against the limit.
	r.SetStatus("child-2", StatusCompleted, "")
	err = r.CanSpawn("parent", 1)
	if err != nil {
		t.Fatalf("CanSpawn should succeed after child finishes, got: %v", err)
	}

	// Parent without children should have all slots available.
	err = r.CanSpawn("other-parent", 1)
	if err != nil {
		t.Fatalf("CanSpawn for new parent should succeed, got: %v", err)
	}
}

func TestRegistry_CanSpawnDepthExceeded(t *testing.T) {
	r := NewRegistry()

	// Depth 0, 1, 2 are allowed.
	if err := r.CanSpawn("root", 0); err != nil {
		t.Fatalf("depth 0 should be allowed, got: %v", err)
	}
	if err := r.CanSpawn("root", 1); err != nil {
		t.Fatalf("depth 1 should be allowed, got: %v", err)
	}
	if err := r.CanSpawn("root", 2); err != nil {
		t.Fatalf("depth 2 should be allowed, got: %v", err)
	}

	// Depth >= 3 must be rejected.
	err := r.CanSpawn("root", 3)
	if err == nil {
		t.Fatal("CanSpawn should reject depth >= 3")
	}
	if err != ErrAgentDepthExceeded {
		t.Fatalf("CanSpawn depth error = %v, want ErrAgentDepthExceeded", err)
	}

	// Even deeper should also be rejected.
	err = r.CanSpawn("root", 5)
	if err != ErrAgentDepthExceeded {
		t.Fatalf("CanSpawn depth 5 error = %v, want ErrAgentDepthExceeded", err)
	}
}

func TestRegistry_ShutdownCascade(t *testing.T) {
	r := NewRegistry()

	// Build a 3-level tree: root -> child1 -> grandchild1
	//                              \-> child2
	_ = r.Register(&AgentInstance{ID: "root", AdapterID: "orch", ParentID: "", Status: StatusBusy, RunID: "run_root"})
	_ = r.Register(&AgentInstance{ID: "child1", AdapterID: "worker", ParentID: "root", Status: StatusBusy, RunID: "run_child1"})
	_ = r.Register(&AgentInstance{ID: "child2", AdapterID: "worker", ParentID: "root", Status: StatusIdle, RunID: "run_child2"})
	_ = r.Register(&AgentInstance{ID: "grandchild1", AdapterID: "specialist", ParentID: "child1", Status: StatusBusy, RunID: "run_gc1"})

	// Shutdown the root.
	runIDs := r.ShutdownCascade("root")

	// All descendants must be disconnected.
	for _, id := range []string{"root", "child1", "child2", "grandchild1"} {
		inst, ok := r.Get(id)
		if !ok {
			t.Fatalf("agent %q should still exist in registry after cascade", id)
		}
		if inst.Status != StatusDisconnected {
			t.Fatalf("agent %q status = %s, want %s after cascade", id, inst.Status, StatusDisconnected)
		}
	}
	wantRuns := map[string]bool{"run_child1": true, "run_child2": true, "run_gc1": true}
	if len(runIDs) != len(wantRuns) {
		t.Fatalf("ShutdownCascade runIDs = %v, want %v", runIDs, wantRuns)
	}
	for _, id := range runIDs {
		if !wantRuns[id] {
			t.Fatalf("unexpected cascade runID %q in %v", id, runIDs)
		}
	}

	// ShutdownCascade on a single leaf should only affect that leaf.
	r2 := NewRegistry()
	_ = r2.Register(&AgentInstance{ID: "a", AdapterID: "cc", ParentID: "", Status: StatusIdle, RunID: "run_a"})
	_ = r2.Register(&AgentInstance{ID: "b", AdapterID: "cc", ParentID: "", Status: StatusIdle, RunID: "run_b"})

	runIDs2 := r2.ShutdownCascade("a")
	if len(runIDs2) != 0 {
		t.Fatalf("leaf cascade runIDs = %v, want empty", runIDs2)
	}

	instA, _ := r2.Get("a")
	if instA.Status != StatusDisconnected {
		t.Fatalf("leaf a should be disconnected, got %s", instA.Status)
	}
	instB, _ := r2.Get("b")
	if instB.Status != StatusIdle {
		t.Fatalf("unrelated leaf b should be unaffected, got %s", instB.Status)
	}
}

// TestRegistry_ShutdownCascade_ParentRunIDLookup covers #1001: SpawnSubAgent
// registers children under agentInstanceID with ParentID=parentRunID. Cascade
// by parent run ID must still find those children even when no agent is keyed
// under the parent run ID itself.
func TestRegistry_ShutdownCascade_ParentRunIDLookup(t *testing.T) {
	r := NewRegistry()

	const parentRunID = "run_parent"
	const childRunID = "run_child"
	const grandRunID = "run_grand"

	// No agent registered as ID=parentRunID (mirrors real parent process finish).
	_ = r.Register(&AgentInstance{
		ID:        "agent_child",
		AdapterID: "worker",
		ParentID:  parentRunID,
		RunID:     childRunID,
		Status:    StatusBusy,
	})
	// Nested spawn: ParentID is the intermediate child's run ID.
	_ = r.Register(&AgentInstance{
		ID:        "agent_grand",
		AdapterID: "specialist",
		ParentID:  childRunID,
		RunID:     grandRunID,
		Status:    StatusBusy,
	})
	// Unrelated peer under a different parent must stay online.
	_ = r.Register(&AgentInstance{
		ID:        "agent_other",
		AdapterID: "worker",
		ParentID:  "run_other",
		RunID:     "run_other_child",
		Status:    StatusBusy,
	})

	runIDs := r.ShutdownCascade(parentRunID)

	wantRuns := map[string]bool{childRunID: true, grandRunID: true}
	if len(runIDs) != len(wantRuns) {
		t.Fatalf("cascade runIDs = %v, want %v", runIDs, wantRuns)
	}
	for _, id := range runIDs {
		if !wantRuns[id] {
			t.Fatalf("unexpected cascade runID %q", id)
		}
	}

	for _, id := range []string{"agent_child", "agent_grand"} {
		inst, ok := r.Get(id)
		if !ok {
			t.Fatalf("agent %q missing", id)
		}
		if inst.Status != StatusDisconnected {
			t.Fatalf("agent %q status = %s, want disconnected", id, inst.Status)
		}
	}
	other, ok := r.Get("agent_other")
	if !ok || other.Status != StatusBusy {
		t.Fatalf("unrelated agent should stay busy, got ok=%v status=%v", ok, other)
	}
}

// ── Feature: TryReserveSlot per-parent child limit enforcement ──────────────

// TestRegistry_TryReserveSlot_MaxChildrenPerAgentEnforced verifies that
// TryReserveSlot rejects the (MaxChildrenPerAgent+1)-th reservation for the
// same parent. This is the atomic slot reservation that replaces the
// separate CanSpawn + IncrChildCount call pattern, eliminating the TOCTOU race.
func TestRegistry_TryReserveSlot_MaxChildrenPerAgentEnforced(t *testing.T) {
	r := NewRegistry()
	parentID := "orchestrator-1"

	// Reserve exactly MaxChildrenPerAgent slots — all must succeed.
	for i := 0; i < MaxChildrenPerAgent; i++ {
		err := r.TryReserveSlot(parentID, 1)
		if err != nil {
			t.Fatalf("TryReserveSlot #%d failed: %v (childrenCount=%d)", i+1, err, r.childrenCount[parentID])
		}
	}

	// Verify the count is exactly MaxChildrenPerAgent.
	count := r.childrenCount[parentID]
	if count != MaxChildrenPerAgent {
		t.Fatalf("childrenCount[%s] = %d, want %d", parentID, count, MaxChildrenPerAgent)
	}

	// The (MaxChildrenPerAgent+1)-th reservation must be rejected.
	err := r.TryReserveSlot(parentID, 1)
	if err == nil {
		t.Fatal("TryReserveSlot should reject when MaxChildrenPerAgent is reached")
	}
	if err != ErrMaxChildrenPerAgentReached {
		t.Fatalf("TryReserveSlot error = %v, want ErrMaxChildrenPerAgentReached", err)
	}

	// The count must NOT have been incremented on failure.
	count = r.childrenCount[parentID]
	if count != MaxChildrenPerAgent {
		t.Fatalf("childrenCount[%s] = %d after rejection, want %d (count should not change on failure)", parentID, count, MaxChildrenPerAgent)
	}
}

// TestRegistry_TryReserveSlot_DecrOnCompletion verifies that the active child
// count is correctly decremented when a child completes (via Unregister which
// calls DecrChildCount internally), freeing a slot for a new child.
func TestRegistry_TryReserveSlot_DecrOnCompletion(t *testing.T) {
	r := NewRegistry()

	// Register the parent orchestrator.
	_ = r.Register(&AgentInstance{
		ID:        "parent-orch",
		AdapterID: "orchestrator",
		ParentID:  "",
		Status:    StatusBusy,
	})

	parentID := "parent-orch"

	// Reserve MaxChildrenPerAgent slots.
	for i := 0; i < MaxChildrenPerAgent; i++ {
		childID := fmt.Sprintf("child-%d", i+1)
		err := r.TryReserveSlot(parentID, 1)
		if err != nil {
			t.Fatalf("TryReserveSlot for %s failed: %v", childID, err)
		}
		// Register the child agent (simulating a successful spawn).
		_ = r.Register(&AgentInstance{
			ID:        childID,
			AdapterID: "worker",
			ParentID:  parentID,
			Depth:     1,
			Status:    StatusBusy,
		})
	}

	// At this point, no more spawns should be allowed.
	err := r.TryReserveSlot(parentID, 1)
	if err != ErrMaxChildrenPerAgentReached {
		t.Fatalf("TryReserveSlot should be at capacity, got: %v", err)
	}

	// Complete one child: Unregister decrements childrenCount.
	if !r.Unregister("child-1") {
		t.Fatal("Unregister child-1 should succeed")
	}

	// Now the count should be MaxChildrenPerAgent-1, allowing a new reservation.
	err = r.TryReserveSlot(parentID, 1)
	if err != nil {
		t.Fatalf("TryReserveSlot after child completion should succeed, got: %v", err)
	}

	// The count should be back to MaxChildrenPerAgent.
	count := r.childrenCount[parentID]
	if count != MaxChildrenPerAgent {
		t.Fatalf("childrenCount[%s] = %d after re-reservation, want %d", parentID, count, MaxChildrenPerAgent)
	}
}

// TestRegistry_TryReserveSlot_DecrChildCountExplicit verifies that explicit
// DecrChildCount (without Unregister) also frees a slot. This covers the
// path where the caller must release a reserved slot when registration fails
// after TryReserveSlot succeeds (atomic reservation but registration failure).
func TestRegistry_TryReserveSlot_DecrChildCountExplicit(t *testing.T) {
	r := NewRegistry()
	parentID := "orch-explicit"

	// Reserve all slots.
	for i := 0; i < MaxChildrenPerAgent; i++ {
		err := r.TryReserveSlot(parentID, 1)
		if err != nil {
			t.Fatalf("TryReserveSlot #%d failed: %v", i+1, err)
		}
	}

	// Full — next should fail.
	err := r.TryReserveSlot(parentID, 1)
	if err != ErrMaxChildrenPerAgentReached {
		t.Fatalf("TryReserveSlot should be at capacity, got: %v", err)
	}

	// Explicitly decrement one (simulating a failed registration after slot reservation).
	r.DecrChildCount(parentID)

	// Now a new reservation should succeed.
	err = r.TryReserveSlot(parentID, 1)
	if err != nil {
		t.Fatalf("TryReserveSlot after explicit DecrChildCount should succeed, got: %v", err)
	}
}

// TestRegistry_TryReserveSlot_SlotFullAndMaxChildrenInterplay verifies that
// the two limits (maxConcurrent and MaxChildrenPerAgent) operate independently
// and both are enforced.
func TestRegistry_TryReserveSlot_SlotFullAndMaxChildrenInterplay(t *testing.T) {
	// Set a very low maxConcurrent to test interplay.
	r := NewRegistry().WithMaxConcurrent(2)

	// Register parent and two children to fill the concurrent slots.
	_ = r.Register(&AgentInstance{ID: "parent", AdapterID: "orch", Status: StatusBusy})
	_ = r.Register(&AgentInstance{ID: "c1", AdapterID: "worker", ParentID: "parent", Status: StatusBusy})
	_ = r.Register(&AgentInstance{ID: "c2", AdapterID: "worker", ParentID: "parent", Status: StatusBusy})

	// childrenCount tracks TryReserveSlot results, not registered instances.
	// But TryReserveSlot checks both active agents and childrenCount.
	// The childrenCount is 0 since we haven't called TryReserveSlot yet.
	// With 2 active children (c1, c2) and maxConcurrent=2, the concurrent slot
	// limit should reject before the childrenCount check.

	// TryReserveSlot should fail for concurrent slot limit.
	err := r.TryReserveSlot("parent", 1)
	if err == nil {
		r.DecrChildCount("parent")
		t.Fatal("TryReserveSlot should fail when concurrent slots are full")
	}
	if err != ErrAgentSlotFull {
		t.Fatalf("TryReserveSlot error = %v, want ErrAgentSlotFull", err)
	}

	// Now complete one child to free a concurrent slot.
	r.SetStatus("c1", StatusCompleted, "")

	// Should now be able to reserve via TryReserveSlot.
	err = r.TryReserveSlot("parent", 1)
	if err != nil {
		t.Fatalf("TryReserveSlot after freeing slot: %v", err)
	}
	r.DecrChildCount("parent") // clean up

	// Now test the childrenCount path: reserve MaxChildrenPerAgent slots via TryReserveSlot.
	for i := 0; i < MaxChildrenPerAgent; i++ {
		err := r.TryReserveSlot("parent", 1)
		if err != nil {
			t.Fatalf("TryReserveSlot #%d (childrenCount) failed: %v", i+1, err)
		}
	}

	// childrenCount should now be MaxChildrenPerAgent.
	count := r.childrenCount["parent"]
	if count != MaxChildrenPerAgent {
		t.Fatalf("childrenCount[parent] = %d, want %d", count, MaxChildrenPerAgent)
	}

	// Next reservation must fail with ErrMaxChildrenPerAgentReached.
	err = r.TryReserveSlot("parent", 1)
	if err != ErrMaxChildrenPerAgentReached {
		t.Fatalf("TryReserveSlot error = %v, want ErrMaxChildrenPerAgentReached", err)
	}
}

// TestRegistry_TryReserveSlot_CountActiveByParentExcludesTerminal verifies
// that TryReserveSlot correctly excludes terminal statuses (completed,
// error, disconnected) and only counts non-terminal agents for the
// concurrent slot limit.
func TestRegistry_TryReserveSlot_CountActiveByParentExcludesTerminal(t *testing.T) {
	r := NewRegistry()

	_ = r.Register(&AgentInstance{ID: "parent", AdapterID: "orch", Status: StatusBusy})

	// Register 3 children: two busy, one completed.
	_ = r.Register(&AgentInstance{ID: "c1", AdapterID: "worker", ParentID: "parent", Status: StatusBusy})
	_ = r.Register(&AgentInstance{ID: "c2", AdapterID: "worker", ParentID: "parent", Status: StatusBusy})
	_ = r.Register(&AgentInstance{ID: "c3", AdapterID: "worker", ParentID: "parent", Status: StatusCompleted})

	active := r.CountActiveByParent("parent")
	if active != 2 {
		t.Fatalf("CountActiveByParent = %d, want 2 (completed excluded)", active)
	}

	// Also verify via TryReserveSlot which uses the same active-counting logic.
	// With maxConcurrent=2, the completed child should not block.
	r2 := NewRegistry().WithMaxConcurrent(2)
	_ = r2.Register(&AgentInstance{ID: "p2", AdapterID: "orch", Status: StatusBusy})
	_ = r2.Register(&AgentInstance{ID: "a1", AdapterID: "worker", ParentID: "p2", Status: StatusBusy})
	_ = r2.Register(&AgentInstance{ID: "a2", AdapterID: "worker", ParentID: "p2", Status: StatusCompleted})
	_ = r2.Register(&AgentInstance{ID: "a3", AdapterID: "worker", ParentID: "p2", Status: StatusError})

	// Only 1 active (a1) — should be able to reserve.
	err := r2.TryReserveSlot("p2", 1)
	if err != nil {
		t.Fatalf("TryReserveSlot with terminal children excluded: %v", err)
	}
}
