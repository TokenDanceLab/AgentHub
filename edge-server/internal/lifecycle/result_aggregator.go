// Package lifecycle provides result aggregation for orchestrator sub-agent runs.
package lifecycle

import (
	"log/slog"
	"sync"

	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
)

// ResultAggregator listens for sub-agent run completion events on the event bus,
// tracks which children of each parent have completed, and emits
// run.agent.sub_agents_complete when all children of a parent are done.
//
// Individual result messages are delivered by ProcessExecutor.sendSubAgentResult;
// the aggregator only handles the all-children-complete check to avoid duplication.
type ResultAggregator struct {
	bus      *events.Bus
	registry *agents.Registry

	mu            sync.Mutex
	subID         int64
	completedRuns map[string]bool // runID → true once processed
}

// NewResultAggregator creates a result aggregator that subscribes to the event
// bus and checks sub-agent completion status.
func NewResultAggregator(bus *events.Bus, registry *agents.Registry) *ResultAggregator {
	return &ResultAggregator{
		bus:           bus,
		registry:      registry,
		completedRuns: make(map[string]bool),
	}
}

// Start begins listening on the event bus for run completion events.
// Returns a cleanup function that unsubscribes from the bus.
func (ra *ResultAggregator) Start() (stop func()) {
	subID, ch, _ := ra.bus.Subscribe(0)
	ra.subID = subID

	done := make(chan struct{})
	go func() {
		defer close(done)
		for evt := range ch {
			ra.handleEvent(evt)
		}
	}()

	return func() {
		ra.bus.Unsubscribe(ra.subID)
		<-done
	}
}

func (ra *ResultAggregator) handleEvent(evt events.EventEnvelope) {
	switch evt.Type {
	case "run.finished":
		ra.handleRunComplete(evt, agents.StatusCompleted)
	case "run.failed":
		ra.handleRunComplete(evt, agents.StatusError)
	case "run.cancelled":
		ra.handleRunComplete(evt, agents.StatusDisconnected)
	}
}

func (ra *ResultAggregator) handleRunComplete(evt events.EventEnvelope, status agents.Status) {
	runID := extractRunID(evt)
	if runID == "" {
		return
	}

	inst := ra.registry.FindByRunID(runID)
	if inst == nil || inst.ParentID == "" {
		return
	}

	ra.mu.Lock()
	if ra.completedRuns[runID] {
		ra.mu.Unlock()
		return
	}
	ra.completedRuns[runID] = true
	ra.mu.Unlock()

	ra.registry.SetStatus(inst.ID, status, "")
	ra.checkAllChildrenComplete(inst.ParentID)
}

// checkAllChildrenComplete checks if all children of a parent agent have
// completed. If so, emits a run.agent.sub_agents_complete event.
func (ra *ResultAggregator) checkAllChildrenComplete(parentID string) {
	children := ra.registry.ListByParent(parentID)
	allComplete := true
	for _, child := range children {
		if !isTerminalStatus(child.Status) {
			allComplete = false
			break
		}
	}
	if allComplete && len(children) > 0 {
		slog.Info("all sub-agents complete", "parentId", parentID, "childCount", len(children))
		ra.bus.Publish("run.agent.sub_agents_complete", map[string]any{
			"parentId": parentID,
		}, map[string]any{
			"parentId":    parentID,
			"childCount":  len(children),
			"allComplete": true,
		})
	}
}

func isTerminalStatus(status agents.Status) bool {
	switch status {
	case agents.StatusCompleted, agents.StatusError, agents.StatusDisconnected:
		return true
	}
	return false
}

func extractRunID(evt events.EventEnvelope) string {
	if evt.Scope != nil {
		if runID, ok := evt.Scope["runId"].(string); ok {
			return runID
		}
	}
	if payload, ok := evt.Payload.(map[string]any); ok {
		if runID, ok := payload["runId"].(string); ok {
			return runID
		}
	}
	return ""
}
