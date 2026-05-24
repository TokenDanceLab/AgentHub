package agents

import (
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
