package lifecycle

import (
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

// TestProcessExecutorFaultEscalationRetryKeepsRunRegistered verifies #867:
// on fault-escalation auto-retry the concurrency slot remains registered for the
// successor attempt (deferred finish must not tear it down between attempts).
func TestProcessExecutorFaultEscalationRetryKeepsRunRegistered(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor := newTestProcessExecutor(t, bus, s, "fail")
	executor.faultEscalationCfg = FaultEscalationConfig{
		Enabled:    true,
		MaxRetries: 1,
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	var sawRetry bool
	var sawFailed bool
	deadline := time.After(15 * time.Second)
	for !sawFailed {
		select {
		case evt := <-ch:
			switch evt.Type {
			case "run.started", "run.output.batch", "message.created", "item.created":
			case "run.fault_escalation.retry":
				sawRetry = true
				// Immediately after the handoff event the run must still occupy
				// the concurrency slot so Cancel / max-concurrent accounting work.
				executor.mu.Lock()
				_, registered := executor.running[run.ID]
				executor.mu.Unlock()
				if !registered {
					t.Fatal("run not registered in executor.running after fault-escalation retry handoff")
				}
				stored, ok := s.GetRun(run.ID)
				if !ok {
					t.Fatal("run missing from store after retry handoff")
				}
				if stored.RetryCount != 1 {
					t.Fatalf("RetryCount = %d, want 1 after first escalation retry", stored.RetryCount)
				}
				if stored.Status != "queued" && stored.Status != "started" {
					t.Fatalf("status after retry handoff = %q, want queued or started", stored.Status)
				}
			case "run.fault_escalation.exhausted":
			case "run.failed":
				sawFailed = true
			default:
				t.Fatalf("unexpected event type %q", evt.Type)
			}
		case <-deadline:
			t.Fatal("timed out waiting for terminal run.failed after fault escalation")
		}
	}
	if !sawRetry {
		t.Fatal("expected run.fault_escalation.retry before terminal failure")
	}

	// Terminal finish must clear the slot exactly once.
	deadline2 := time.After(2 * time.Second)
	for {
		executor.mu.Lock()
		_, registered := executor.running[run.ID]
		executor.mu.Unlock()
		if !registered {
			break
		}
		select {
		case <-deadline2:
			t.Fatal("run still registered after terminal failure finish")
		case <-time.After(10 * time.Millisecond):
		}
	}

	// finish is idempotent: a second call must not panic or re-introduce state.
	executor.finish(run.ID)
	executor.mu.Lock()
	_, registered := executor.running[run.ID]
	executor.mu.Unlock()
	if registered {
		t.Fatal("run reappeared in running map after idempotent finish")
	}
}

// TestProcessExecutorFaultEscalationExhaustedSingleFinish verifies that when
// retries are exhausted (or disabled), terminal finish runs once and the slot
// is released.
func TestProcessExecutorFaultEscalationExhaustedSingleFinish(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor := newTestProcessExecutor(t, bus, s, "fail")
	// MaxRetries=0: escalation enabled but no auto-retry budget → single finish.
	executor.faultEscalationCfg = FaultEscalationConfig{
		Enabled:    true,
		MaxRetries: 0,
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	var sawRetry bool
	var sawFailed bool
	deadline := time.After(10 * time.Second)
	for !sawFailed {
		select {
		case evt := <-ch:
			switch evt.Type {
			case "run.started", "run.output.batch", "message.created", "item.created":
			case "run.fault_escalation.retry":
				sawRetry = true
			case "run.fault_escalation.exhausted":
			case "run.failed":
				sawFailed = true
			default:
				t.Fatalf("unexpected event type %q", evt.Type)
			}
		case <-deadline:
			t.Fatal("timed out waiting for run.failed")
		}
	}
	if sawRetry {
		t.Fatal("did not expect fault-escalation retry when MaxRetries=0")
	}

	deadline2 := time.After(2 * time.Second)
	for {
		executor.mu.Lock()
		_, registered := executor.running[run.ID]
		n := len(executor.running)
		executor.mu.Unlock()
		if !registered {
			if n != 0 {
				t.Fatalf("running map size = %d after terminal finish, want 0", n)
			}
			break
		}
		select {
		case <-deadline2:
			t.Fatal("run still registered after exhausted terminal finish")
		case <-time.After(10 * time.Millisecond):
		}
	}

	// Second finish is a no-op (idempotent teardown).
	executor.finish(run.ID)
	executor.mu.Lock()
	n := len(executor.running)
	executor.mu.Unlock()
	if n != 0 {
		t.Fatalf("running map size = %d after second finish, want 0", n)
	}
}
