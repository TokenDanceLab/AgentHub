package lifecycle

import (
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

// TestProcessExecutorSpawnSubAgentRecordsParentSpawn verifies that a successful
// SpawnSubAgent starts the parent's sub-agent timeout clock in the collector,
// keyed by the parent RUN ID (the same key domain used by result storage and
// aggregation), not the parent agent instance ID.
func TestProcessExecutorSpawnSubAgentRecordsParentSpawn(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	parent := newExecutorTestRun(t, s)

	// SpawnSubAgent creates the child run under a child thread; pre-create it
	// so the in-memory store's reference check passes.
	childThread, err := s.CreateThread("thread_child_"+testID(t), parent.ProjectID, "Child Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread child: %v", err)
	}

	reg := agents.NewRegistry()
	collector := NewSubAgentResultCollector(time.Minute)
	ra := NewResultAggregator(bus, reg).WithCollector(collector)

	executor := newTestProcessExecutor(t, bus, s, "success")
	executor.WithAgentRegistry(reg)
	executor.WithResultAggregator(ra)

	subID, ch, _ := bus.Subscribe(0)
	defer bus.Unsubscribe(subID)

	_, runID, err := executor.SpawnSubAgent(parent, adapters.SubAgentTask{
		TaskID:   "task_" + testID(t),
		AgentID:  "worker",
		Depth:    1,
		ThreadID: childThread.ID,
	})
	if err != nil {
		t.Fatalf("SpawnSubAgent: %v", err)
	}
	if runID == "" {
		t.Fatal("SpawnSubAgent returned empty runID")
	}

	// The collector must track the parent run ID (the same domain used by
	// StoreSubAgentResult / checkAllChildrenComplete), not the parent agent
	// instance ID.
	if _, ok := collector.firstSpawn[parent.ID]; !ok {
		t.Fatalf("collector did not record spawn under parent run ID %q", parent.ID)
	}

	// Wait for the child helper subprocess to reach a terminal state so it is
	// reaped before the test binary is unlinked (Windows go-test handle safety).
	for {
		evt := nextEventWithin(t, ch, 5*time.Second)
		switch evt.Type {
		case "run.finished", "run.failed", "run.cancelled":
			return
		}
	}
}
