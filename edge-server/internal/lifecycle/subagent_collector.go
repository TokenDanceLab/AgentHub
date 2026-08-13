// SubAgentResultCollector aggregates structured results from orchestrator
// sub-agent runs. This file is the pure in-memory state machine half of the
// result-aggregation domain; ResultAggregator in result_aggregator.go wires it
// to the event bus and the agent registry.
package lifecycle

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
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
	Pending       int              `json:"pending"` // children that never completed (timeout)
	Results       []SubAgentResult `json:"results"`
	Partial       bool             `json:"partial"`           // true if timeout fallback triggered
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
	now        func() time.Time // injectable clock for deterministic tests
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
		now:        time.Now,
	}
}

// RecordSpawn records that a child was spawned for the given parent.
// This enables timeout tracking.
func (c *SubAgentResultCollector) RecordSpawn(parentID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.firstSpawn[parentID]; !ok {
		c.firstSpawn[parentID] = c.now()
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
	return c.now().Sub(spawnTime) > c.timeout
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
		if c.now().Sub(spawnTime) > c.timeout {
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
