// Package lifecycle provides result aggregation for orchestrator sub-agent runs.
package lifecycle

import (
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
)

// ── SubAgent Result Types ──────────────────────────────────────────────────

// SubAgentResult holds the structured output of a single sub-agent run.
// It packages status, output, artifacts, and token usage for downstream
// synthesis by the orchestrator LLM.
//
// Reference: AionUi Team Mode Mailbox — persisted sub-agent results queryable by Leader.
// Reference: LibreChat — structured subagent result return with output and metadata.
type SubAgentResult struct {
	AgentID     string        `json:"agentId"`
	AgentName   string        `json:"agentName"`
	RunID       string        `json:"runId"`
	Status      string        `json:"status"` // "finished", "failed", "cancelled"
	Output      any           `json:"output,omitempty"`
	Error       string        `json:"error,omitempty"`
	TokenUsage  *TokenUsage   `json:"tokenUsage,omitempty"`
	Artifacts   []ArtifactRef `json:"artifacts,omitempty"`
	CompletedAt time.Time     `json:"completedAt"`
}

// TokenUsage tracks token consumption for a sub-agent run.
type TokenUsage struct {
	InputTokens  int64 `json:"inputTokens"`
	OutputTokens int64 `json:"outputTokens"`
	TotalTokens  int64 `json:"totalTokens"`
}

// ArtifactRef references a generated artifact from a sub-agent run.
type ArtifactRef struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Filename string `json:"filename,omitempty"`
	URL      string `json:"url,omitempty"`
}

// SubAgentAggregatedResult is the synthesized result payload emitted
// in the run.agent.sub_agents_complete event after all children finish
// (or the timeout fallback triggers).
type SubAgentAggregatedResult struct {
	ParentID      string           `json:"parentId"`
	TotalChildren int              `json:"totalChildren"`
	Succeeded     int              `json:"succeeded"`
	Failed        int              `json:"failed"`
	Cancelled     int              `json:"cancelled"`
	Pending       int              `json:"pending"`  // children that never completed (timeout)
	Results       []SubAgentResult `json:"results"`
	Partial       bool             `json:"partial"`  // true if timeout fallback triggered
	Summary       string           `json:"summary,omitempty"` // human-readable synthesis
}

// ── SubAgentResultCollector ───────────────────────────────────────────────

// DefaultSubAgentTimeout is the default timeout for waiting on all sub-agent
// children to complete before emitting partial results.
const DefaultSubAgentTimeout = 5 * time.Minute

// SubAgentResultCollectorTimeoutCheckInterval is how often the timeout
// goroutine checks for expired parents.
const SubAgentResultCollectorTimeoutCheckInterval = 30 * time.Second

// SubAgentResultCollector stores structured results from sub-agent runs,
// providing aggregation and synthesis capabilities when all children complete.
//
// References:
//   - AionUi Team Mode Mailbox: persisted sub-agent results queryable by Leader
//   - LibreChat: structured subagent result return with output and metadata
type SubAgentResultCollector struct {
	mu         sync.RWMutex
	results    map[string][]SubAgentResult // parentID -> results list (appended as children complete)
	firstSpawn map[string]time.Time        // parentID -> time first child was spawned
	exhausted  map[string]bool             // parentID -> true once results emitted (full or partial)
	timeout    time.Duration
}

// NewSubAgentResultCollector creates a collector with the given timeout.
// A value <= 0 uses DefaultSubAgentTimeout.
func NewSubAgentResultCollector(timeout time.Duration) *SubAgentResultCollector {
	if timeout <= 0 {
		timeout = DefaultSubAgentTimeout
	}
	return &SubAgentResultCollector{
		results:    make(map[string][]SubAgentResult),
		firstSpawn: make(map[string]time.Time),
		exhausted:  make(map[string]bool),
		timeout:    timeout,
	}
}

// RecordSpawn records that a child was spawned for the given parent.
// This enables timeout tracking.
func (c *SubAgentResultCollector) RecordSpawn(parentID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.firstSpawn[parentID]; !ok {
		c.firstSpawn[parentID] = time.Now()
	}
}

// Store adds a sub-agent result to the collector.
func (c *SubAgentResultCollector) Store(parentID string, result SubAgentResult) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.results[parentID] = append(c.results[parentID], result)
}

// Exhaust marks a parent as exhausted (results fully emitted). This prevents
// the timeout fallback from re-emitting for this parent.
func (c *SubAgentResultCollector) Exhaust(parentID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.exhausted[parentID] = true
}

// IsExhausted returns true if the parent's results have already been emitted.
func (c *SubAgentResultCollector) IsExhausted(parentID string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.exhausted[parentID]
}

// HasTimedOut returns true if the parent's first spawn was more than
// the configured timeout ago and results have not already been exhausted.
func (c *SubAgentResultCollector) HasTimedOut(parentID string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.exhausted[parentID] {
		return false
	}
	spawnTime, ok := c.firstSpawn[parentID]
	if !ok {
		return false
	}
	return time.Since(spawnTime) > c.timeout
}

// ExpiredParents returns parent IDs whose timeout has elapsed and results
// have not yet been exhausted. Callers should emit partial results for these.
func (c *SubAgentResultCollector) ExpiredParents() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	var expired []string
	for parentID, spawnTime := range c.firstSpawn {
		if c.exhausted[parentID] {
			continue
		}
		if time.Since(spawnTime) > c.timeout {
			expired = append(expired, parentID)
		}
	}
	return expired
}

// Aggregate builds a SubAgentAggregatedResult for the given parent from
// stored results. The partial flag indicates whether the aggregation includes
// all expected children (false) or is a timeout-induced partial result (true).
func (c *SubAgentResultCollector) Aggregate(parentID string, partial bool) *SubAgentAggregatedResult {
	c.mu.RLock()
	defer c.mu.RUnlock()

	stored := c.results[parentID]
	agg := &SubAgentAggregatedResult{
		ParentID:      parentID,
		TotalChildren: len(stored),
		Results:       make([]SubAgentResult, len(stored)),
		Partial:       partial,
	}
	copy(agg.Results, stored)

	// Sort by completion time for deterministic output.
	sort.Slice(agg.Results, func(i, j int) bool {
		return agg.Results[i].CompletedAt.Before(agg.Results[j].CompletedAt)
	})

	for _, r := range agg.Results {
		switch r.Status {
		case "finished":
			agg.Succeeded++
		case "failed":
			agg.Failed++
		case "cancelled":
			agg.Cancelled++
		default:
			agg.Pending++
		}
	}

	agg.Summary = buildAggregateSummary(agg)
	return agg
}

// buildAggregateSummary produces a human-readable summary of aggregated results.
func buildAggregateSummary(agg *SubAgentAggregatedResult) string {
	var parts []string
	if agg.Succeeded > 0 {
		parts = append(parts, fmt.Sprintf("%d succeeded", agg.Succeeded))
	}
	if agg.Failed > 0 {
		parts = append(parts, fmt.Sprintf("%d failed", agg.Failed))
	}
	if agg.Cancelled > 0 {
		parts = append(parts, fmt.Sprintf("%d cancelled", agg.Cancelled))
	}
	if agg.Pending > 0 {
		parts = append(parts, fmt.Sprintf("%d pending (timed out)", agg.Pending))
	}

	base := fmt.Sprintf("Sub-agents complete: %d total", agg.TotalChildren)
	if len(parts) > 0 {
		base += " (" + strings.Join(parts, ", ") + ")"
	}
	if agg.Partial {
		base += " [partial — timeout fallback]"
	}
	return base
}

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

// RecordSubAgentSpawn records that a child was spawned for the given parent
// run ID. This enables timeout tracking in the collector.
func (ra *ResultAggregator) RecordSubAgentSpawn(parentRunID string) {
	if ra.collector == nil {
		return
	}
	// The parent's agent instance ID may differ from its run ID.
	// Map via registry: find agent by run ID, use its ID as the collector key.
	if inst := ra.registry.FindByRunID(parentRunID); inst != nil {
		ra.collector.RecordSpawn(inst.ID)
	}
}

// StoreSubAgentResult persists a completed sub-agent's structured result
// in the collector for later aggregation.
func (ra *ResultAggregator) StoreSubAgentResult(parentID string, result SubAgentResult) {
	if ra.collector != nil {
		ra.collector.Store(parentID, result)
	}
}

// Start begins listening on the event bus for run completion events.
// Returns a cleanup function that unsubscribes from the bus and stops
// the timeout fallback goroutine (if a collector is configured).
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

	// Timeout fallback goroutine: periodically checks for parents whose
	// children have exceeded the configured timeout. When found, emits
	// partial aggregated results so the orchestrator can still synthesize
	// a response even if some children hang.
	var timeoutDone chan struct{}
	if ra.collector != nil {
		timeoutDone = make(chan struct{})
		go ra.runTimeoutCheck(timeoutDone)
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
		ra.emitAggregatedResult(parentID, false)
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
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────

func isTerminalStatus(status agents.Status) bool {
	switch status {
	case agents.StatusCompleted, agents.StatusError, agents.StatusDisconnected:
		return true
	case agents.StatusOnline, agents.StatusBusy, agents.StatusIdle, agents.StatusWaitingInput:
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
