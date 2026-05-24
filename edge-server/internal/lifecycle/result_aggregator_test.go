package lifecycle

import (
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
)

func newTestBus(t *testing.T) *events.Bus {
	t.Helper()
	return events.NewBus(128)
}

func TestResultAggregator_AllChildrenComplete(t *testing.T) {
	bus := newTestBus(t)
	reg := agents.NewRegistry()

	// Register parent orchestrator agent.
	_ = reg.Register(&agents.AgentInstance{
		ID:        "parent-1",
		AdapterID: "orchestrator",
		Status:    agents.StatusBusy,
	})

	// Register two child sub-agents.
	_ = reg.Register(&agents.AgentInstance{
		ID:        "child-a",
		AdapterID: "codex",
		ParentID:  "parent-1",
		Status:    agents.StatusBusy,
	})
	reg.SetRunID("child-a", "run-child-a")

	_ = reg.Register(&agents.AgentInstance{
		ID:        "child-b",
		AdapterID: "claude-code",
		ParentID:  "parent-1",
		Status:    agents.StatusBusy,
	})
	reg.SetRunID("child-b", "run-child-b")

	ra := NewResultAggregator(bus, reg)
	stop := ra.Start()
	defer stop()

	// Subscribe to capture emitted events.
	subID, ch, _ := bus.Subscribe(0)
	defer bus.Unsubscribe(subID)

	// Drain replay events.
drainReplay:
	for {
		select {
		case <-ch:
		case <-time.After(10 * time.Millisecond):
			break drainReplay
		}
	}

	// First child completes — not all children done yet.
	bus.Publish("run.finished", map[string]any{"runId": "run-child-a"}, nil)

	// Second child completes — now all children are done.
	bus.Publish("run.finished", map[string]any{"runId": "run-child-b"}, nil)

	// Wait for sub_agents_complete event, skipping intermediate events.
	timeout := time.After(500 * time.Millisecond)
	for {
		select {
		case evt := <-ch:
			if evt.Type == "run.agent.sub_agents_complete" {
				payload, ok := evt.Payload.(map[string]any)
				if !ok {
					t.Fatal("payload is not a map")
				}
				if payload["parentId"] != "parent-1" {
					t.Fatalf("parentId = %q, want parent-1", payload["parentId"])
				}
				if payload["allComplete"] != true {
					t.Fatal("allComplete should be true")
				}
				return // success
			}
		case <-timeout:
			t.Fatal("timed out waiting for sub_agents_complete")
		}
	}
}

func TestResultAggregator_FailedChildCompletes(t *testing.T) {
	bus := newTestBus(t)
	reg := agents.NewRegistry()

	_ = reg.Register(&agents.AgentInstance{
		ID:        "parent-2",
		AdapterID: "orchestrator",
		Status:    agents.StatusBusy,
	})
	_ = reg.Register(&agents.AgentInstance{
		ID:        "child-x",
		AdapterID: "codex",
		ParentID:  "parent-2",
		Status:    agents.StatusBusy,
	})
	reg.SetRunID("child-x", "run-child-x")

	ra := NewResultAggregator(bus, reg)
	stop := ra.Start()
	defer stop()

	subID, ch, _ := bus.Subscribe(0)
	defer bus.Unsubscribe(subID)

	// Drain replay.
drainReplay2:
	for {
		select {
		case <-ch:
		case <-time.After(10 * time.Millisecond):
			break drainReplay2
		}
	}

	// Child fails — only child, so all should be complete.
	bus.Publish("run.failed", map[string]any{"runId": "run-child-x"}, nil)

	timeout := time.After(500 * time.Millisecond)
	for {
		select {
		case evt := <-ch:
			if evt.Type == "run.agent.sub_agents_complete" {
				return
			}
		case <-timeout:
			t.Fatal("timed out waiting for sub_agents_complete after failed child")
		}
	}
}

func TestResultAggregator_CancelledChildCompletes(t *testing.T) {
	bus := newTestBus(t)
	reg := agents.NewRegistry()

	_ = reg.Register(&agents.AgentInstance{
		ID:        "parent-3",
		AdapterID: "orchestrator",
		Status:    agents.StatusBusy,
	})
	_ = reg.Register(&agents.AgentInstance{
		ID:        "child-c",
		AdapterID: "opencode",
		ParentID:  "parent-3",
		Status:    agents.StatusBusy,
	})
	reg.SetRunID("child-c", "run-child-c")

	ra := NewResultAggregator(bus, reg)
	stop := ra.Start()
	defer stop()

	subID, ch, _ := bus.Subscribe(0)
	defer bus.Unsubscribe(subID)

drainReplay3:
	for {
		select {
		case <-ch:
		case <-time.After(10 * time.Millisecond):
			break drainReplay3
		}
	}

	bus.Publish("run.cancelled", map[string]any{"runId": "run-child-c"}, nil)

	timeout := time.After(500 * time.Millisecond)
	for {
		select {
		case evt := <-ch:
			if evt.Type == "run.agent.sub_agents_complete" {
				return
			}
		case <-timeout:
			t.Fatal("timed out waiting for sub_agents_complete")
		}
	}
}

func TestResultAggregator_IgnoresNonSubAgent(t *testing.T) {
	bus := newTestBus(t)
	reg := agents.NewRegistry()

	// Register a top-level agent (no parent).
	_ = reg.Register(&agents.AgentInstance{
		ID:        "top-level",
		AdapterID: "claude-code",
		ParentID:  "",
		Status:    agents.StatusBusy,
	})
	reg.SetRunID("top-level", "run-top-level")

	ra := NewResultAggregator(bus, reg)
	stop := ra.Start()
	defer stop()

	subID, ch, _ := bus.Subscribe(0)
	defer bus.Unsubscribe(subID)

drainReplay4:
	for {
		select {
		case <-ch:
		case <-time.After(10 * time.Millisecond):
			break drainReplay4
		}
	}

	bus.Publish("run.finished", map[string]any{"runId": "run-top-level"}, nil)

	// No sub_agents_complete should be emitted for non-sub-agent.
	select {
	case evt := <-ch:
		if evt.Type == "run.agent.sub_agents_complete" {
			t.Fatal("sub_agents_complete emitted for non-sub-agent run")
		}
	case <-time.After(100 * time.Millisecond):
	}
}

func TestResultAggregator_DuplicateEventIgnored(t *testing.T) {
	bus := newTestBus(t)
	reg := agents.NewRegistry()

	_ = reg.Register(&agents.AgentInstance{
		ID:        "parent-5",
		AdapterID: "orchestrator",
		Status:    agents.StatusBusy,
	})
	_ = reg.Register(&agents.AgentInstance{
		ID:        "child-dup",
		AdapterID: "codex",
		ParentID:  "parent-5",
		Status:    agents.StatusBusy,
	})
	reg.SetRunID("child-dup", "run-dup")

	ra := NewResultAggregator(bus, reg)
	stop := ra.Start()
	defer stop()

	subID, ch, _ := bus.Subscribe(0)
	defer bus.Unsubscribe(subID)

drainReplay5:
	for {
		select {
		case <-ch:
		case <-time.After(10 * time.Millisecond):
			break drainReplay5
		}
	}

	// First completion.
	bus.Publish("run.finished", map[string]any{"runId": "run-dup"}, nil)

	// Should receive one sub_agents_complete.
	timeout1 := time.After(500 * time.Millisecond)
waitFirst:
	for {
		select {
		case evt := <-ch:
			if evt.Type == "run.agent.sub_agents_complete" {
				break waitFirst
			}
		case <-timeout1:
			t.Fatal("timed out waiting for first sub_agents_complete")
		}
	}

	// Duplicate completion for same run — should be ignored.
	bus.Publish("run.finished", map[string]any{"runId": "run-dup"}, nil)

	// No second sub_agents_complete should be emitted.
	select {
	case evt := <-ch:
		if evt.Type == "run.agent.sub_agents_complete" {
			t.Fatal("duplicate sub_agents_complete emitted for already-processed run")
		}
	case <-time.After(100 * time.Millisecond):
	}
}

func TestResultAggregator_ExtractRunID(t *testing.T) {
	// Scope takes priority.
	evt := events.EventEnvelope{
		Scope:   map[string]any{"runId": "from-scope"},
		Payload: map[string]any{"runId": "from-payload"},
	}
	if got := extractRunID(evt); got != "from-scope" {
		t.Fatalf("extractRunID = %q, want from-scope", got)
	}

	// Falls back to payload.
	evt2 := events.EventEnvelope{
		Payload: map[string]any{"runId": "from-payload"},
	}
	if got := extractRunID(evt2); got != "from-payload" {
		t.Fatalf("extractRunID = %q, want from-payload", got)
	}

	// Empty event.
	if got := extractRunID(events.EventEnvelope{}); got != "" {
		t.Fatalf("extractRunID = %q, want empty", got)
	}
}

func TestResultAggregator_IsTerminalStatus(t *testing.T) {
	if !isTerminalStatus(agents.StatusCompleted) {
		t.Fatal("completed should be terminal")
	}
	if !isTerminalStatus(agents.StatusError) {
		t.Fatal("error should be terminal")
	}
	if !isTerminalStatus(agents.StatusDisconnected) {
		t.Fatal("disconnected should be terminal")
	}
	if isTerminalStatus(agents.StatusBusy) {
		t.Fatal("busy should not be terminal")
	}
	if isTerminalStatus(agents.StatusIdle) {
		t.Fatal("idle should not be terminal")
	}
}

func TestResultAggregator_NoChildrenNoEvent(t *testing.T) {
	bus := newTestBus(t)
	reg := agents.NewRegistry()

	_ = reg.Register(&agents.AgentInstance{
		ID:        "parent-empty",
		AdapterID: "orchestrator",
		Status:    agents.StatusBusy,
	})

	ra := NewResultAggregator(bus, reg)
	stop := ra.Start()
	defer stop()

	subID, ch, _ := bus.Subscribe(0)
	defer bus.Unsubscribe(subID)

	// Publish an event for a run that maps to a parent with no children.
	// The parent agent exists but has no run ID mapping, so FindByRunID returns nil.
	bus.Publish("run.finished", map[string]any{"runId": "nonexistent-run"}, nil)

	select {
	case evt := <-ch:
		if evt.Type == "run.agent.sub_agents_complete" {
			t.Fatal("sub_agents_complete emitted for unmapped run")
		}
	case <-time.After(100 * time.Millisecond):
	}
}
