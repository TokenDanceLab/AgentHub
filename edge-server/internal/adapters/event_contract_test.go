package adapters

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
		BusEventCLIInvocationPlan,
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
