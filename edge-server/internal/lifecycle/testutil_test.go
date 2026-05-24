package lifecycle

import (
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

// newExecutorTestRun creates a project, thread, and run in the given store.
func newExecutorTestRun(t *testing.T, s store.Repository) store.Run {
	t.Helper()
	project, _ := s.CreateProject("proj_test", "Test Project")
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

// nextEvent reads the next event from a channel with a 500ms timeout.
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

// nextEventWithin reads the next event from a channel with a configurable timeout.
func nextEventWithin(t *testing.T, ch <-chan events.EventEnvelope, timeout time.Duration) events.EventEnvelope {
	t.Helper()
	select {
	case evt := <-ch:
		return evt
	case <-time.After(timeout):
		t.Fatalf("timed out after %s waiting for event", timeout)
		return events.EventEnvelope{}
	}
}

// collectStdoutUntilFinished collects all stdout text from run.output.batch events
// until a run.finished event is received.
func collectStdoutUntilFinished(t *testing.T, ch <-chan events.EventEnvelope) string {
	t.Helper()

	var stdoutText string
	for {
		evt := nextEvent(t, ch)
		switch evt.Type {
		case "run.started":
		case "run.output.batch":
			payload, ok := evt.Payload.(map[string]any)
			if !ok {
				t.Fatalf("output payload = %T, want map", evt.Payload)
			}
			if payload["stream"] != "stdout" {
				continue
			}
			chunks, ok := payload["chunks"].([]map[string]any)
			if !ok || len(chunks) == 0 {
				t.Fatalf("output chunks = %#v, want non-empty []map[string]any", payload["chunks"])
			}
			text, _ := chunks[0]["text"].(string)
			stdoutText += text
		case "run.finished":
			return stdoutText
		default:
			t.Fatalf("unexpected event type %q", evt.Type)
		}
	}
}
