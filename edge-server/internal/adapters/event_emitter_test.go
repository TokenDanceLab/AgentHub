package adapters

import (
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
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
