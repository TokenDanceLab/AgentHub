package lifecycle

import (
	"os"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

func TestSendSubAgentResult_Completed(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	_, _ = s.CreateProject("proj-agg", "agg-project", "")
	_, _ = s.CreateThread("thread-agg", "proj-agg", "agg-thread", "", "", "")
	_, _ = s.CreateRun("parent-run", "proj-agg", "thread-agg")
	_, _ = s.CreateRun("child-run", "proj-agg", "thread-agg")

	reg := agents.NewRegistry()
	queue := agents.NewQueue()

	_ = reg.Register(&agents.AgentInstance{
		ID:        "parent-agent",
		AdapterID: "orchestrator",
		Status:    agents.StatusBusy,
	})
	_ = reg.Register(&agents.AgentInstance{
		ID:        "child-agent",
		AdapterID: "claude-code",
		ParentID:  "parent-agent",
		Status:    agents.StatusBusy,
	})

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor: %v", err)
	}
	executor.WithAgentRegistry(reg).WithMessageQueue(queue)

	// Populate the runToAgent mapping (normally done by SpawnSubAgent).
	executor.mu.Lock()
	executor.runToAgent["child-run"] = "child-agent"
	executor.mu.Unlock()

	queue.EnsureAgent("parent-agent", 64)

	executor.sendSubAgentResult("child-run", "finished", map[string]any{
		"output": "sub-agent completed successfully",
	})

	select {
	case msg := <-queue.Receive("parent-agent"):
		if msg.Type != agents.MsgTypeResult {
			t.Fatalf("message type = %q, want %q", msg.Type, agents.MsgTypeResult)
		}
		if msg.FromAgentID != "child-agent" {
			t.Fatalf("FromAgentID = %q, want child-agent", msg.FromAgentID)
		}
		if msg.ToAgentID != "parent-agent" {
			t.Fatalf("ToAgentID = %q, want parent-agent", msg.ToAgentID)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for result message on parent queue")
	}
}

func TestSendSubAgentResult_Error(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	_, _ = s.CreateProject("proj-err", "err-project", "")
	_, _ = s.CreateThread("thread-err", "proj-err", "err-thread", "", "", "")
	_, _ = s.CreateRun("parent-err", "proj-err", "thread-err")
	_, _ = s.CreateRun("child-err", "proj-err", "thread-err")

	reg := agents.NewRegistry()
	queue := agents.NewQueue()

	_ = reg.Register(&agents.AgentInstance{
		ID:        "parent-agent-err",
		AdapterID: "orchestrator",
		Status:    agents.StatusBusy,
	})
	_ = reg.Register(&agents.AgentInstance{
		ID:        "child-agent-err",
		AdapterID: "claude-code",
		ParentID:  "parent-agent-err",
		Status:    agents.StatusBusy,
	})

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor: %v", err)
	}
	executor.WithAgentRegistry(reg).WithMessageQueue(queue)

	executor.mu.Lock()
	executor.runToAgent["child-err"] = "child-agent-err"
	executor.mu.Unlock()

	queue.EnsureAgent("parent-agent-err", 64)

	executor.sendSubAgentResult("child-err", "failed", map[string]any{
		"error": "something went wrong",
	})

	select {
	case msg := <-queue.Receive("parent-agent-err"):
		if msg.Type != agents.MsgTypeError {
			t.Fatalf("message type = %q, want %q", msg.Type, agents.MsgTypeError)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for error message on parent queue")
	}
}

func TestSendSubAgentResult_NoRegistryNoCrash(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	_, _ = s.CreateProject("proj-noreg", "no-reg-project", "")
	_, _ = s.CreateThread("thread-noreg", "proj-noreg", "no-reg-thread", "", "", "")
	_, _ = s.CreateRun("run-noreg", "proj-noreg", "thread-noreg")

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor: %v", err)
	}

	// Should not panic with nil registry and nil message queue.
	executor.sendSubAgentResult("run-noreg", "finished", nil)
}

func TestSendSubAgentResult_NonSubAgentNoAction(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	_, _ = s.CreateProject("proj-nosub", "nosub-project", "")
	_, _ = s.CreateThread("thread-nosub", "proj-nosub", "nosub-thread", "", "", "")
	_, _ = s.CreateRun("run-nosub", "proj-nosub", "thread-nosub")

	reg := agents.NewRegistry()
	queue := agents.NewQueue()

	// Register agent with no parent (top-level run, not a sub-agent).
	_ = reg.Register(&agents.AgentInstance{
		ID:        "top-level-agent",
		AdapterID: "claude-code",
		ParentID:  "",
		Status:    agents.StatusBusy,
	})

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor: %v", err)
	}
	executor.WithAgentRegistry(reg).WithMessageQueue(queue)

	// Map run to the top-level agent (which has no parent).
	executor.mu.Lock()
	executor.runToAgent["run-nosub"] = "top-level-agent"
	executor.mu.Unlock()

	// Should not panic or send a message because parentID is empty.
	executor.sendSubAgentResult("run-nosub", "finished", nil)
}

// TestSendSubAgentResultFinalizesParentDirectly verifies the #1880 reliable
// lifecycle hook: when a child run reaches a terminal state, sendSubAgentResult
// finalizes a parked orchestrator parent directly (no lossy event-bus subscriber
// involvement), so a dropped run.finished/failed/cancelled cannot strand the parent.
func TestSendSubAgentResultFinalizesParentDirectly(t *testing.T) {
	bus := events.NewBus(10)
	s := store.New()
	_, _ = s.CreateProject("proj-direct", "direct-project", "")
	_, _ = s.CreateThread("thread-direct", "proj-direct", "direct-thread", "", "", "")
	_, _ = s.CreateRun("parent-direct", "proj-direct", "thread-direct")
	_, _ = s.CreateRun("child-direct", "proj-direct", "thread-direct")

	reg := agents.NewRegistry()
	queue := agents.NewQueue()
	_ = reg.Register(&agents.AgentInstance{ID: "parent-agent", AdapterID: "orchestrator", Status: agents.StatusBusy})
	_ = reg.Register(&agents.AgentInstance{
		ID: "child-agent", AdapterID: "claude-code", ParentID: "parent-agent",
		RunID: "child-direct", Status: agents.StatusBusy,
	})

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor: %v", err)
	}
	executor.WithAgentRegistry(reg).WithMessageQueue(queue)

	ra := NewResultAggregator(bus, reg)
	finalized := make(chan string, 1)
	ra.WithParentFinalizer(func(parentID string) { finalized <- parentID })
	executor.WithResultAggregator(ra)

	executor.mu.Lock()
	executor.runToAgent["child-direct"] = "child-agent"
	executor.mu.Unlock()
	queue.EnsureAgent("parent-agent", 64)

	// Direct terminal delivery; no run.finished is published to the bus.
	executor.sendSubAgentResult("child-direct", "finished", map[string]any{"output": "ok"})

	select {
	case parentID := <-finalized:
		if parentID != "parent-agent" {
			t.Fatalf("finalized parent = %q, want parent-agent", parentID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("sendSubAgentResult did not finalize the parent via the direct lifecycle hook")
	}
}
