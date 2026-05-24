package api

import (
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/events"
)

func TestPermissionRegistryRegisterAndConsume(t *testing.T) {
	registry := NewPermissionRegistry(time.Minute)
	ok := registry.Register(PendingPermission{
		ProjectID: "proj_1",
		ThreadID:  "thread_1",
		RunID:     "run_1",
		RequestID: "req_1",
		ToolName:  "Bash",
		ToolUseID: "tool_1",
	})
	if !ok {
		t.Fatal("Register returned false")
	}

	permission, ok := registry.Consume("run_1", "req_1")
	if !ok {
		t.Fatal("Consume returned false")
	}
	if permission.ProjectID != "proj_1" || permission.ThreadID != "thread_1" || permission.ToolName != "Bash" || permission.ToolUseID != "tool_1" {
		t.Fatalf("permission = %#v, want stored metadata", permission)
	}
	if _, ok := registry.Consume("run_1", "req_1"); ok {
		t.Fatal("second Consume returned true, want one-shot consumption")
	}
}

func TestPermissionRegistryRejectsMissingBinding(t *testing.T) {
	registry := NewPermissionRegistry(time.Minute)
	for _, permission := range []PendingPermission{
		{RunID: "", RequestID: "req_1"},
		{RunID: "run_1", RequestID: ""},
	} {
		if registry.Register(permission) {
			t.Fatalf("Register(%#v) returned true, want false", permission)
		}
	}
	if _, ok := registry.Consume("", "req_1"); ok {
		t.Fatal("Consume with empty runID returned true")
	}
	if _, ok := registry.Consume("run_1", ""); ok {
		t.Fatal("Consume with empty requestID returned true")
	}
}

func TestPermissionRegistryObserveEventRegistersAndClears(t *testing.T) {
	registry := NewPermissionRegistry(time.Minute)

	registry.ObserveEvent(events.EventEnvelope{
		Type: adapters.BusEventPermissionRequested,
		Scope: map[string]any{
			"projectId": "proj_1",
			"threadId":  "thread_1",
			"runId":     "run_1",
		},
		Payload: map[string]any{
			"requestId": "req_1",
			"toolName":  "Write",
			"toolUseId": "tool_1",
		},
	})

	if _, ok := registry.Consume("wrong_run", "req_1"); ok {
		t.Fatal("Consume with wrong run returned true")
	}

	registry.ObserveEvent(events.EventEnvelope{
		Type: adapters.BusEventPermissionDecided,
		Scope: map[string]any{
			"runId": "run_1",
		},
		Payload: map[string]any{
			"requestId": "req_1",
		},
	})
	if _, ok := registry.Consume("run_1", "req_1"); ok {
		t.Fatal("Consume after decided event returned true")
	}
}

func TestPermissionRegistryExpiresPendingRequests(t *testing.T) {
	registry := NewPermissionRegistry(time.Minute)
	now := time.Date(2026, 5, 25, 3, 30, 0, 0, time.UTC)
	registry.now = func() time.Time { return now }
	registry.Register(PendingPermission{
		RunID:     "run_1",
		RequestID: "req_1",
	})

	now = now.Add(2 * time.Minute)
	if _, ok := registry.Consume("run_1", "req_1"); ok {
		t.Fatal("expired permission request was consumed")
	}
}
