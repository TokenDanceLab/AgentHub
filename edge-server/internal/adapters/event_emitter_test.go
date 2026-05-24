package adapters

import (
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/runnerctx"
)

func TestNewBusEventEmitter(t *testing.T) {
	bus := events.NewBus(100)
	emitter := NewBusEventEmitter(bus)
	if emitter == nil {
		t.Fatal("NewBusEventEmitter should not return nil")
	}
	if emitter.bus != bus {
		t.Fatal("emitter.bus should be the bus passed to constructor")
	}
}

func TestBusEventEmitter_Emit(t *testing.T) {
	bus := events.NewBus(100)
	emitter := NewBusEventEmitter(bus)

	// Subscribe to capture emitted events.
	subID, ch, _ := bus.Subscribe(0)
	defer bus.Unsubscribe(subID)

	// Emit a test event.
	scope := map[string]any{"projectId": "p1", "threadId": "t1"}
	payload := map[string]any{"text": "hello"}
	emitter.Emit("run.agent.text_delta", scope, payload)

	// Wait briefly for the event to propagate.
	select {
	case evt := <-ch:
		if evt.Type != "run.agent.text_delta" {
			t.Fatalf("event type = %q, want run.agent.text_delta", evt.Type)
		}
		pid, _ := evt.Scope["projectId"].(string)
		if pid != "p1" {
			t.Fatalf("scope projectId = %q, want p1", pid)
		}
		tid, _ := evt.Scope["threadId"].(string)
		if tid != "t1" {
			t.Fatalf("scope threadId = %q, want t1", tid)
		}
		text, _ := evt.Payload.(map[string]any)["text"].(string)
		if text != "hello" {
			t.Fatalf("payload text = %q, want hello", text)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("timed out waiting for emitted event")
	}
}

func TestBusEventEmitter_EmitMultipleEvents(t *testing.T) {
	bus := events.NewBus(100)
	emitter := NewBusEventEmitter(bus)

	subID, ch, _ := bus.Subscribe(0)
	defer bus.Unsubscribe(subID)

	for i := 0; i < 3; i++ {
		emitter.Emit("run.agent.text_delta", nil, map[string]any{"n": i})
	}

	for i := 0; i < 3; i++ {
		select {
		case evt := <-ch:
			n, _ := evt.Payload.(map[string]any)["n"].(int)
			if n != i {
				t.Fatalf("event %d payload = %d, want %d", i, n, i)
			}
		case <-time.After(1 * time.Second):
			t.Fatalf("timed out waiting for event %d", i)
		}
	}
}

func TestBusEventEmitter_NilScope(t *testing.T) {
	bus := events.NewBus(100)
	emitter := NewBusEventEmitter(bus)

	subID, ch, _ := bus.Subscribe(0)
	defer bus.Unsubscribe(subID)

	// Emit with nil scope (bus should normalize to empty map).
	emitter.Emit("run.agent.result", nil, "done")

	select {
	case evt := <-ch:
		if evt.Type != "run.agent.result" {
			t.Fatalf("event type = %q, want run.agent.result", evt.Type)
		}
		// Bus normalizes nil scope to empty map.
		if evt.Scope == nil {
			t.Fatal("scope should not be nil after bus normalization")
		}
	case <-time.After(1 * time.Second):
		t.Fatal("timed out waiting for emitted event")
	}
}

func TestScopedEventEmitterAppliesDefaultScope(t *testing.T) {
	inner := &recordingEmitter{}
	scope := map[string]any{
		"projectId": "proj_1",
		"threadId":  "thread_1",
		"runId":     "run_1",
	}
	emitter := NewScopedEventEmitter(inner, scope)

	emitter.Emit(BusEventPermissionRequested, nil, map[string]any{
		"requestId": "req_1",
		"toolName":  "Bash",
	})

	events := inner.eventsByType(BusEventPermissionRequested)
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	if events[0].scope["runId"] != "run_1" || events[0].scope["projectId"] != "proj_1" || events[0].scope["threadId"] != "thread_1" {
		t.Fatalf("scope = %#v, want default run scope", events[0].scope)
	}
	payload := events[0].payload.(map[string]any)
	if payload["runId"] != "run_1" || payload["projectId"] != "proj_1" || payload["threadId"] != "thread_1" {
		t.Fatalf("payload = %#v, want default scope fields", payload)
	}
}

func TestScopedEventEmitterPreservesExplicitScopeAndPayload(t *testing.T) {
	inner := &recordingEmitter{}
	emitter := NewScopedEventEmitter(inner, map[string]any{"runId": "run_default"})

	emitter.Emit(BusEventPermissionRequested, map[string]any{"runId": "run_explicit"}, map[string]any{
		"runId":     "run_payload",
		"requestId": "req_1",
	})

	events := inner.eventsByType(BusEventPermissionRequested)
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	if events[0].scope["runId"] != "run_explicit" {
		t.Fatalf("scope = %#v, want explicit scope", events[0].scope)
	}
	payload := events[0].payload.(map[string]any)
	if payload["runId"] != "run_payload" {
		t.Fatalf("payload = %#v, want explicit payload preserved", payload)
	}
}

// --- BudgetAwareEmitter tests ---

// recordingEmitter is a mock EventEmitter that records all emitted events.
type recordingEmitter struct {
	mu     sync.Mutex
	events []recordedEvent
}

type recordedEvent struct {
	eventType string
	scope     map[string]any
	payload   any
}

func (r *recordingEmitter) Emit(eventType string, scope map[string]any, payload any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, recordedEvent{eventType, scope, payload})
}

func (r *recordingEmitter) eventsByType(eventType string) []recordedEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	var result []recordedEvent
	for _, e := range r.events {
		if e.eventType == eventType {
			result = append(result, e)
		}
	}
	return result
}

func TestNewBudgetAwareEmitter(t *testing.T) {
	inner := &recordingEmitter{}
	budget := runnerctx.NewContextBudget(200_000)
	scope := map[string]any{"runId": "r1"}
	emitter := NewBudgetAwareEmitter(inner, budget, scope)
	if emitter == nil {
		t.Fatal("NewBudgetAwareEmitter should not return nil")
	}
}

func TestBudgetAwareEmitter_PassThrough(t *testing.T) {
	inner := &recordingEmitter{}
	budget := runnerctx.NewContextBudget(200_000)
	emitter := NewBudgetAwareEmitter(inner, budget, nil)
	emitter.Emit("run.agent.text_delta", nil, "hello")
	events := inner.eventsByType("run.agent.text_delta")
	if len(events) != 1 {
		t.Fatalf("expected 1 text_delta event, got %d", len(events))
	}
}

func TestBudgetAwareEmitter_NoWarningBelowThreshold(t *testing.T) {
	inner := &recordingEmitter{}
	budget := runnerctx.NewContextBudget(200_000)
	emitter := NewBudgetAwareEmitter(inner, budget, nil)
	budget.Track(95_000) // 190k usable, 95k used = 50%
	emitter.Emit("run.agent.text_delta", nil, "test")
	warnings := inner.eventsByType(BusEventContextWarning)
	if len(warnings) > 0 {
		t.Fatalf("expected 0 warnings below threshold, got %d", len(warnings))
	}
}

func TestBudgetAwareEmitter_EmitsWarningAboveThreshold(t *testing.T) {
	inner := &recordingEmitter{}
	budget := runnerctx.NewContextBudget(200_000)
	scope := map[string]any{"runId": "r1"}
	emitter := NewBudgetAwareEmitter(inner, budget, scope)
	budget.Track(171_000) // 190k usable, 171k used = 90%
	emitter.Emit("run.agent.text_delta", nil, "test")
	warnings := inner.eventsByType(BusEventContextWarning)
	if len(warnings) != 1 {
		t.Fatalf("expected 1 warning above threshold, got %d", len(warnings))
	}
	w := warnings[0]
	if w.payload.(map[string]any)["threshold"] != 85.0 {
		t.Fatalf("expected threshold 85.0, got %v", w.payload.(map[string]any)["threshold"])
	}
}

func TestBudgetAwareEmitter_SuppressesDuplicates(t *testing.T) {
	inner := &recordingEmitter{}
	budget := runnerctx.NewContextBudget(200_000)
	emitter := NewBudgetAwareEmitter(inner, budget, nil)
	budget.Track(171_000) // 90%
	emitter.Emit("run.agent.text_delta", nil, "first")
	emitter.Emit("run.agent.text_delta", nil, "second")
	emitter.Emit("run.agent.text_delta", nil, "third")
	warnings := inner.eventsByType(BusEventContextWarning)
	if len(warnings) != 1 {
		t.Fatalf("expected exactly 1 warning (suppressed duplicates), got %d", len(warnings))
	}
}

func TestBudgetAwareEmitter_NoRecursiveWarning(t *testing.T) {
	inner := &recordingEmitter{}
	budget := runnerctx.NewContextBudget(200_000)
	emitter := NewBudgetAwareEmitter(inner, budget, nil)
	budget.Track(171_000) // 90%
	// Emit a context warning manually — the auto-warning already fired on the
	// first real event, so BudgetAwareEmitter should just pass this through.
	emitter.Emit(BusEventContextWarning, nil, map[string]any{"manual": true})
	warnings := inner.eventsByType(BusEventContextWarning)
	if len(warnings) == 0 {
		t.Fatal("expected at least a manual warning to pass through")
	}
}

func TestBudgetAwareEmitter_NoWarningWhenNotShouldCompact(t *testing.T) {
	inner := &recordingEmitter{}
	budget := runnerctx.NewContextBudget(200_000) // 0 used, ShouldCompact returns false
	emitter := NewBudgetAwareEmitter(inner, budget, nil)
	emitter.Emit("run.agent.result", nil, "done")
	warnings := inner.eventsByType(BusEventContextWarning)
	if len(warnings) != 0 {
		t.Fatalf("expected 0 warnings, got %d", len(warnings))
	}
	texts := inner.eventsByType("run.agent.result")
	if len(texts) != 1 {
		t.Fatal("pass-through event should be recorded")
	}
}
