package adapters

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestEventDocsCoverRuntimeAdapterEvents(t *testing.T) {
	docsPath := filepath.Join("..", "..", "..", "api", "events.md")
	raw, err := os.ReadFile(docsPath)
	if err != nil {
		t.Fatalf("read %s: %v", docsPath, err)
	}
	docs := string(raw)

	events := []string{
		BusEventTextDelta,
		BusEventTextBlock,
		BusEventThinking,
		BusEventToolCall,
		BusEventToolResult,
		BusEventFileChange,
		BusEventRouteDecision,
		BusEventSessionInit,
		BusEventResult,
		BusEventCompactBoundary,
		BusEventStatusChange,
		BusEventAPIRetry,
		BusEventTaskStarted,
		BusEventTaskDispatched,
		"run.agent.task_dispatch_failed",
		BusEventTaskProgress,
		BusEventTaskNotification,
		BusEventSubAgentStatus,
		"run.agent.sub_agents_complete",
		BusEventSessionStateChanged,
		BusEventHookStarted,
		BusEventHookProgress,
		BusEventHookResponse,
		BusEventToolUseSummary,
		BusEventAuthStatus,
		BusEventRateLimit,
		BusEventPermissionRequested,
		BusEventPermissionDecided,
		BusEventSessionMetrics,
		BusEventContextUsage,
		BusEventContextWarning,
		BusEventContextCompaction,
	}

	for _, eventType := range events {
		if !strings.Contains(docs, "`"+eventType+"`") {
			t.Fatalf("api/events.md does not document %s", eventType)
		}
	}
}

func TestDispatchEmitterSpawnerErrorEmitsTaskDispatchFailed(t *testing.T) {
	bus := newTestBus(t)
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")

	subID, ch, _ := bus.Subscribe(0)
	defer bus.Unsubscribe(subID)

	emitter := &dispatchEmitter{
		inner:    NewBusEventEmitter(bus),
		spawner:  &failingSpawner{err: fmt.Errorf("capacity exhausted")},
		run:      run,
		depth:    0,
		threadID: run.ThreadID,
	}

	emitter.Emit(BusEventTaskDispatched, nil, map[string]any{
		"taskId":      "task-1",
		"description": "Heavy task",
		"taskType":    "codex",
	})

	timeout := time.After(500 * time.Millisecond)
	for {
		select {
		case evt := <-ch:
			if evt.Type != "run.agent.task_dispatch_failed" {
				continue
			}
			payload, ok := evt.Payload.(map[string]any)
			if !ok {
				t.Fatalf("payload type = %T, want map[string]any", evt.Payload)
			}
			if payload["taskId"] != "task-1" {
				t.Fatalf("taskId = %v, want task-1", payload["taskId"])
			}
			if payload["error"] != "capacity exhausted" {
				t.Fatalf("error = %v, want capacity exhausted", payload["error"])
			}
			return
		case <-timeout:
			t.Fatal("timed out waiting for task_dispatch_failed event")
		}
	}
}
