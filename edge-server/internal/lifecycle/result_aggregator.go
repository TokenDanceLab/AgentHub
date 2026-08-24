package lifecycle

import (
	"log/slog"
	"sync"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
)

// ── ResultAggregator ──────────────────────────────────────────────────────

// ResultAggregator listens for sub-agent run completion events on the event bus,
// tracks which children of each parent have completed, and emits
// run.agent.sub_agents_complete when all children of a parent are done.
//
// Individual result messages are delivered by ProcessExecutor.sendSubAgentResult;
// the aggregator only handles the all-children-complete check to avoid duplication.
//
// When a SubAgentResultCollector is configured, the aggregator also stores
// per-child structured results and includes them in the completion event,
// enabling the orchestrator LLM to synthesize a coherent final response.
type ResultAggregator struct {
	bus      *events.Bus
	registry *agents.Registry

	mu            sync.Mutex
	subID         int64
	completedRuns map[string]bool // runID → true once processed

	// Sub-agent result collection and synthesis.
	// When non-nil, individual sub-agent results are persisted and included
	// in the sub_agents_complete event. The timeout-based fallback goroutine
	// periodically checks for parents whose children have exceeded the
	// configured timeout and emits partial results.
	collector *SubAgentResultCollector

	// emitter is a function that publishes events. It defaults to
	// ra.bus.Publish but can be overridden in tests.
	emitter func(evtType string, scope map[string]any, payload any)

	// finalizeParent is invoked after all children of a parent complete, so
	// an orchestrator parent whose terminal finish was parked
	// (completeRunAttempt outcomeDeferred) can finalize. May be nil.
	finalizeParent func(parentRunID string)
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

// WithCollector attaches a SubAgentResultCollector for structured result
// storage and synthesis. When set, the aggregator will:
//   - Store per-child results as they complete
//   - Include the full result set in sub_agents_complete events
//   - Run a timeout fallback goroutine to emit partial results when
//     children exceed the configured timeout
func (ra *ResultAggregator) WithCollector(c *SubAgentResultCollector) *ResultAggregator {
	ra.collector = c
	return ra
}

// WithParentFinalizer attaches the callback that finalizes an orchestrator
// parent run whose terminal finish was parked while its sub-agents were
// running. The callback fires when all children complete (and on the
// collector timeout path that emits partial results).
func (ra *ResultAggregator) WithParentFinalizer(f func(parentRunID string)) *ResultAggregator {
	ra.finalizeParent = f
	return ra
}

// RecordSubAgentSpawn records that a child was spawned for the given parent
// run ID. This enables timeout tracking in the collector.
func (ra *ResultAggregator) RecordSubAgentSpawn(parentRunID string) {
	if ra.collector == nil {
		return
	}
	// The collector keys are parent run IDs: StoreSubAgentResult and
	// checkAllChildrenComplete both key by the child's ParentID, which equals
	// the parent run ID. RecordSpawn must use the same key domain so timeout
	// tracking starts for the same parent the results are later aggregated
	// under — not the parent's agent instance ID (which differs from its run ID).
	ra.collector.RecordSpawn(parentRunID)
}

// StoreSubAgentResult persists a completed sub-agent's structured result
// in the collector for later aggregation.
func (ra *ResultAggregator) StoreSubAgentResult(parentID string, result SubAgentResult) {
	if ra.collector != nil {
		ra.collector.Store(parentID, result)
	}
}

// OnSubAgentTerminal is the reliable lifecycle hook for a child run reaching a
// terminal state. It is invoked directly by ProcessExecutor.sendSubAgentResult so
// an orchestrator parent whose finish was parked (outcomeDeferred) can finalize
// without depending on the lossy event-bus subscriber — under backpressure the bus
// can drop run.finished/failed/cancelled and leave the parent parked indefinitely.
//
// Idempotent: the collector's exhaustion guard suppresses duplicate
// sub_agents_complete emission, and FinalizeParentRun itself no-ops on repeat.
func (ra *ResultAggregator) OnSubAgentTerminal(parentID string) {
	if parentID == "" {
		return
	}
	ra.checkAllChildrenComplete(parentID)
}

// Start begins listening on the event bus for run completion events.
// Returns a cleanup function that unsubscribes from the bus and stops
// the timeout fallback goroutine (if a collector is configured).
func (ra *ResultAggregator) Start() (stop func()) {
	subID, ch, _ := ra.bus.Subscribe(0)
	ra.subID = subID

	done := make(chan struct{})
	safeGo("resultAggregator", func() {
		defer close(done)
		for evt := range ch {
			ra.handleEvent(evt)
		}
	})

	// Timeout fallback goroutine: periodically checks for parents whose
	// children have exceeded the configured timeout. When found, emits
	// partial aggregated results so the orchestrator can still synthesize
	// a response even if some children hang.
	var timeoutDone chan struct{}
	if ra.collector != nil {
		timeoutDone = make(chan struct{})
		safeGo("resultAggregatorTimeout", func() { ra.runTimeoutCheck(timeoutDone) })
	}

	return func() {
		ra.bus.Unsubscribe(ra.subID)
		<-done
		if timeoutDone != nil {
			close(timeoutDone)
		}
	}
}

func (ra *ResultAggregator) publish(evtType string, scope map[string]any, payload any) {
	if ra.emitter != nil {
		ra.emitter(evtType, scope, payload)
	} else {
		ra.bus.Publish(evtType, scope, payload)
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
	case events.GapEventType:
		ra.handleGap()
	}
}

// handleGap reconciles tracked parents after the subscriber dropped terminal
// run events (channel-full data loss). Because the gap payload only carries
// dropped sequence numbers — not which runs were affected — it sweeps every
// parent with registered children and re-checks completion from the registry's
// current state. Child terminal status is set by sendSubAgentResult (a direct
// call, not the lossy event path), so this rebuilds the parent's terminal
// outcome even when a run.finished/failed/cancelled event was dropped.
func (ra *ResultAggregator) handleGap() {
	for _, parentID := range ra.parentsWithChildren() {
		ra.checkAllChildrenComplete(parentID)
	}
}

// parentsWithChildren returns the de-duplicated set of parent IDs that have at
// least one registered child instance, derived from the registry's current
// state.
func (ra *ResultAggregator) parentsWithChildren() []string {
	seen := make(map[string]struct{})
	var parents []string
	for _, inst := range ra.registry.List() {
		if inst.ParentID == "" {
			continue
		}
		if _, ok := seen[inst.ParentID]; ok {
			continue
		}
		seen[inst.ParentID] = struct{}{}
		parents = append(parents, inst.ParentID)
	}
	return parents
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

	// P1: Emit sub-agent status event on completion/error/cancellation.
	ra.publish(adapters.BusEventSubAgentStatus, map[string]any{
		"runId":    runID,
		"parentId": inst.ParentID,
	}, map[string]any{
		"agentId":   inst.ID,
		"agentName": inst.Name,
		"status":    string(status),
		"progress":  string(status),
	})

	ra.checkAllChildrenComplete(inst.ParentID)
}

// checkAllChildrenComplete checks if all children of a parent agent have
// completed. If so, emits a run.agent.sub_agents_complete event with
// aggregated results when a collector is configured.
func (ra *ResultAggregator) checkAllChildrenComplete(parentID string) {
	// Only run-backed child runs count, deduped by RunID: the same run is
	// registered twice (orchestrator dispatch placeholder + executor
	// run-backed instance), and counting either the placeholder alone or
	// both would block the parent forever / double-count.
	runBackedCount, allComplete := uniqueChildRunsAllComplete(ra.registry.ListByParent(parentID))
	if allComplete && runBackedCount > 0 {
		slog.Info("all sub-agents complete", "parentId", parentID, "childCount", runBackedCount)
		ra.emitAggregatedResult(parentID, false)
		// Finalize an orchestrator parent whose terminal finish was parked
		// while its sub-agents were running (see completeRunAttempt
		// outcomeDeferred). No-op for parents that finished normally.
		if ra.finalizeParent != nil {
			ra.finalizeParent(parentID)
		}
	}
}

// emitAggregatedResult builds and publishes the sub_agents_complete event.
// When a collector is configured, it includes the full structured result set.
// partial=true indicates a timeout-induced partial result emission.
func (ra *ResultAggregator) emitAggregatedResult(parentID string, partial bool) {
	if ra.collector != nil {
		// Prevent double-emission from the timeout fallback.
		if ra.collector.IsExhausted(parentID) {
			return
		}
		ra.collector.Exhaust(parentID)

		agg := ra.collector.Aggregate(parentID, partial)
		if partial {
			slog.Warn("sub-agent timeout fallback: emitting partial results",
				"parentId", parentID,
				"succeeded", agg.Succeeded,
				"failed", agg.Failed,
				"cancelled", agg.Cancelled,
				"pending", agg.Pending,
			)
		}
		ra.publish("run.agent.sub_agents_complete", map[string]any{
			"parentId": parentID,
		}, agg)
	} else {
		// Legacy path: no collector configured, emit minimal event.
		ra.publish("run.agent.sub_agents_complete", map[string]any{
			"parentId": parentID,
		}, map[string]any{
			"parentId":    parentID,
			"childCount":  len(ra.registry.ListByParent(parentID)),
			"allComplete": true,
		})
	}
}

// runTimeoutCheck periodically checks for parents whose children have
// exceeded the timeout. When found, it emits partial aggregated results.
func (ra *ResultAggregator) runTimeoutCheck(done <-chan struct{}) {
	ticker := time.NewTicker(SubAgentResultCollectorTimeoutCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			ra.checkTimeouts()
		}
	}
}

// checkTimeouts iterates over parents tracked by the collector and emits
// partial results for any whose timeout has elapsed.
func (ra *ResultAggregator) checkTimeouts() {
	if ra.collector == nil {
		return
	}
	for _, parentID := range ra.collector.ExpiredParents() {
		// Only emit if there are actual results to report.
		results := ra.collector.Aggregate(parentID, true)
		if results.TotalChildren == 0 {
			continue
		}
		ra.emitAggregatedResult(parentID, true)
		// A timed-out parent must still finalize: emit the partial result,
		// then park-finish the parent so its cascade cancels the stragglers.
		if ra.finalizeParent != nil {
			ra.finalizeParent(parentID)
		}
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────

func isTerminalStatus(status agents.Status) bool {
	switch status {
	case agents.StatusCompleted, agents.StatusError, agents.StatusDisconnected:
		return true
	case agents.StatusOnline, agents.StatusBusy, agents.StatusIdle, agents.StatusWaitingInput, agents.StatusDraining:
		return false
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
