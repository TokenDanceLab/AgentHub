package lifecycle

import (
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

func newExecutorTestRun(t *testing.T, s *store.Store) store.Run {
	t.Helper()
	project := s.CreateProject("proj_test", "Test Project")
	thread, err := s.CreateThread("thread_test", project.ID, "Test Thread")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := s.CreateRun("run_test", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	return run
}

func TestMockExecutorPublishesLifecycleEvents(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor := NewMockExecutor(bus, s,
		WithStepDelay(0),
		WithOutputBatches([]OutputBatch{{Stream: "stdout", Offset: 0, Text: "hello\n"}}),
	)

	if err := executor.Start(run); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	for _, wantType := range []string{"run.started", "run.output.batch", "run.finished"} {
		evt := nextEvent(t, ch)
		if evt.Type != wantType {
			t.Fatalf("event type = %q, want %q", evt.Type, wantType)
		}
		if evt.Scope["runId"] != run.ID {
			t.Fatalf("event scope runId = %#v, want %q", evt.Scope["runId"], run.ID)
		}
	}

	stored, ok := s.GetRun(run.ID)
	if !ok {
		t.Fatalf("run %q was not stored", run.ID)
	}
	if stored.Status != "finished" || stored.StartedAt == "" || stored.FinishedAt == "" {
		t.Fatalf("stored run = %#v, want finished with timestamps", stored)
	}
}

func TestMockExecutorPublishesFailedEvent(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor := NewMockExecutor(bus, s, WithStepDelay(0), WithFailedRun(run.ID, nil))

	if err := executor.Start(run); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	if evt := nextEvent(t, ch); evt.Type != "run.started" {
		t.Fatalf("first event type = %q, want run.started", evt.Type)
	}
	evt := nextEvent(t, ch)
	if evt.Type != "run.failed" {
		t.Fatalf("second event type = %q, want run.failed", evt.Type)
	}
	payload, ok := evt.Payload.(map[string]any)
	if !ok {
		t.Fatalf("failed payload = %T, want map", evt.Payload)
	}
	if payload["status"] != "failed" || payload["error"] == "" {
		t.Fatalf("failed payload = %#v, want failed status and error", payload)
	}
}

func TestMockExecutorCancelPublishesCancelledEvent(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor := NewMockExecutor(bus, s, WithStepDelay(50*time.Millisecond))

	if err := executor.Start(run); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	result := executor.Cancel(run.ID)
	if !result.Found || result.Status != "cancelling" {
		t.Fatalf("Cancel result = %#v, want found cancelling", result)
	}

	evt := nextEvent(t, ch)
	if evt.Type != "run.cancelled" {
		t.Fatalf("event type = %q, want run.cancelled", evt.Type)
	}

	stored, ok := s.GetRun(run.ID)
	if !ok {
		t.Fatalf("run %q was not stored", run.ID)
	}
	if stored.Status != "cancelled" {
		t.Fatalf("stored run status = %q, want cancelled", stored.Status)
	}
}

func TestMockExecutorCancelMissingRun(t *testing.T) {
	executor := NewMockExecutor(events.NewBus(10), store.New(), WithStepDelay(0))

	result := executor.Cancel("run_missing")
	if result.Found || result.Status != "not_found" {
		t.Fatalf("Cancel missing result = %#v, want not_found", result)
	}
}

func nextEvent(t *testing.T, ch <-chan events.EventEnvelope) events.EventEnvelope {
	t.Helper()
	select {
	case evt := <-ch:
		return evt
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for event")
		return events.EventEnvelope{}
	}
}
