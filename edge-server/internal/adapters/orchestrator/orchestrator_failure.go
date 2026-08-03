package orchestrator

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/agenthub/edge-server/internal/store"
)

// ── Failure Event ───────────────────────────────────────────────────────────

// FailureClassifiedEvent is emitted when a sub-agent failure is classified.
// It carries the category, decision, and retry state for observability.
type FailureClassifiedEvent struct {
	RunID       string          `json:"runId"`
	AgentID     string          `json:"agentId"`
	AgentName   string          `json:"agentName"`
	TaskID      string          `json:"taskId"`
	Category    FailureCategory `json:"category"`
	Decision    FailureDecision `json:"decision"`
	RetryCount  int             `json:"retryCount"`
	MaxRetries  int             `json:"maxRetries"`
	Error       string          `json:"error"`
	Critique    string          `json:"critique,omitempty"`
	AlternateID string          `json:"alternateAgentId,omitempty"`
	Timestamp   time.Time       `json:"timestamp"`
}

// BusEventFailureClassified is the typed event name for failure classification.
const BusEventFailureClassified = "orchestrator.failure_classified"

// ── FailureRecoveryManager ──────────────────────────────────────────────────

// FailureRecoveryManager coordinates failure classification and recovery for
// sub-agent runs within an orchestrator. It is embedded in the dispatch
// interceptor and invoked when sub-agent error messages arrive.
//
// The manager also maintains per-agent circuit breakers to prevent repeated
// dispatch attempts to repeatedly-failing agents. Circuit breakers use
// sync.RWMutex for read-heavy access on the hot Allow() path.
//
// Integration points:
//
//	CREATION: orchestrator.go ParseStream (line ~132)
//	  NewFailureRecoveryManager(adapterRegistry, spawner) — created when
//	  both adapterRegistry and spawner are non-nil.
//
//	ERROR PATH: orchestrator.go handleSubAgentResult (line ~675)
//	  dispatchInterceptor.processResultMessage → handleSubAgentResult calls
//	  HandleSubAgentFailure when isError=true, which classifies the failure,
//	  checks the circuit breaker, decides recovery, and executes it.
//
//	SUCCESS PATH: orchestrator.go handleSubAgentResult (line ~741)
//	  dispatchInterceptor calls RecordCircuitSuccess for non-error completions
//	  to reset the circuit breaker on healthy sub-agent results.
//
//	DEPTH TRACKING: process_executor.go SpawnSubAgent (line ~1395)
//	  Each sub-agent dispatch increments the delegation depth via
//	  dispatchInterceptor.handleDispatch (depth+1). process_executor.go
//	  SpawnSubAgent enforces a separate slot/depth limit through the agent
//	  registry's TryReserveSlot (atomic check-and-reserve). CanSpawn exists
//	  as a read-only diagnostic method but does not reserve slots and has a
//	  TOCTOU race if used for enforcement. The retry depth
//	  (FailureRecoveryManager.totalDepth + RecoveryState.RetryCount) is
//	  orthogonal to dispatch depth — retries keep the same dispatch depth
//	  but count toward MaxRetryDepth.
//
//	BUDGET LINK: process_executor.go childBudget (line ~1527)
//	  Sub-agent context budget is allocated from the parent budget via
//	  AllocateChild, with the fraction decreasing by depth (depth 1 = 1/2,
//	  depth 2 = 1/4, etc.). Failure recovery retries reuse the same budget
//	  allocation — retry decisions do not further reduce the budget.
type FailureRecoveryManager struct {
	policies        map[FailureCategory]FailurePolicy
	adapterRegistry AdapterRegistry
	spawner         SubAgentSpawner

	mu      map[string]*RecoveryState // agentID -> recovery state (per-dispatch unique)
	stateMu sync.Mutex

	// totalDepth tracks the cumulative number of retry decisions made across
	// all agents within this recovery context. It is incremented on every
	// DecisionRetry outcome and serves as an aggregate observability metric.
	// Individual agent retry counts are tracked per RecoveryState.RetryCount.
	totalDepth int

	// Per-agent circuit breakers for failure rate limiting across dispatch attempts.
	//
	// KEYING ASYMMETRY: circuit breakers are keyed by agentName (stable across dispatches,
	// e.g. "code-reviewer"), while recovery state (mu above) is keyed by agentID
	// (unique per dispatch, e.g. "agent_abc123"). This means:
	//   - The circuit breaker lumps all dispatches of the same agent name together.
	//     If 5 "code-reviewer" dispatches fail, the circuit trips for all.
	//   - Each dispatch gets its own independent retry budget via RecoveryState.
	//     One dispatch may exhaust retries while another still has attempts remaining.
	//
	// This asymmetry is intentional: circuit breakers protect the system from
	// repeatedly dispatching to a broken agent type, while recovery state tracks
	// individual run-level retry progress for observability and per-task decisions.
	circuitBreakers map[string]*AgentCircuitBreaker // agentName -> circuit breaker
	cbMu            sync.RWMutex
}

// NewFailureRecoveryManager creates a recovery manager with default policies.
func NewFailureRecoveryManager(adapterRegistry AdapterRegistry, spawner SubAgentSpawner) *FailureRecoveryManager {
	return &FailureRecoveryManager{
		policies:        DefaultFailurePolicies(),
		adapterRegistry: adapterRegistry,
		spawner:         spawner,
		mu:              make(map[string]*RecoveryState),
		circuitBreakers: make(map[string]*AgentCircuitBreaker),
	}
}

// HandleSubAgentFailure is called when a sub-agent reports an error. It:
//  1. Classifies the failure
//  2. Decides recovery action (retry / switch / skip / fail)
//  3. Executes the recovery if possible
//  4. Emits a FailureClassifiedEvent for observability
//
// Returns the decision taken and any error from recovery execution.
func (m *FailureRecoveryManager) HandleSubAgentFailure(
	ctx context.Context,
	parentRun store.Run,
	agentID string,
	agentName string,
	taskID string,
	err error,
	runErr *RunError,
	emitter EventEmitter,
	scope map[string]any,
) (FailureDecision, error) {
	// Step 0: Check per-agent circuit breaker before any recovery attempt.
	// Use agentName (stable across dispatches) as the key, falling back to
	// agentID if agentName is empty. If the circuit is open, skip immediately
	// without classification — repeated dispatch to a broken agent is futile.
	cbKey := agentName
	if cbKey == "" {
		cbKey = agentID
	}
	if cbErr := m.checkCircuitBreaker(cbKey); cbErr != nil {
		slog.Info("orchestrator: circuit breaker blocking sub-agent dispatch",
			"runId", parentRun.ID,
			"agentId", agentID,
			"agentName", agentName,
			"reason", cbErr.Error(),
		)
		if emitter != nil {
			emitter.Emit(BusEventFailureClassified, scope, FailureClassifiedEvent{
				RunID:     parentRun.ID,
				AgentID:   agentID,
				AgentName: agentName,
				TaskID:    taskID,
				Category:  FailureCancel,
				Decision:  DecisionSkip,
				Error:     truncateError(cbErr, 500),
				Timestamp: time.Now().UTC(),
			})
		}
		return DecisionSkip, cbErr
	}

	// Step 1: Classify.
	category, reason := ClassifyFailure(err, runErr)

	// Step 2: Get or create recovery state (hold lock across DecideRecovery
	// to prevent TOCTOU race — a concurrent HandleSubAgentFailure for the same
	// agentID could modify the state between our read and write-back).
	m.stateMu.Lock()
	state, ok := m.mu[agentID]
	if !ok {
		state = &RecoveryState{
			AgentID: agentID,
			TaskID:  taskID,
		}
		m.mu[agentID] = state
	}

	// Step 3: Check for alternate agent availability.
	alternateAvailable := m.findAlternateAgent(agentName)

	// Step 4: Decide (lock still held — read-check-write is atomic).
	decision, updatedState := DecideRecovery(category, state, m.policies, alternateAvailable)
	m.mu[agentID] = updatedState
	if decision == DecisionRetry {
		m.totalDepth++
	}
	m.stateMu.Unlock()

	// T2-A09: Reflexion — build the critique after the depth check so
	// computation is not wasted when MaxRetryDepth rejects the attempt.
	critique := BuildReflexionCritique(agentName, taskID, category, reason, err)

	slog.Info("orchestrator: sub-agent failure classified",
		"runId", parentRun.ID,
		"agentId", agentID,
		"agentName", agentName,
		"category", string(category),
		"decision", string(decision),
		"reason", reason,
		"retryCount", updatedState.RetryCount,
		"critique", critique,
	)

	// Step 5: Emit classified event for observability.
	evt := FailureClassifiedEvent{
		RunID:      parentRun.ID,
		AgentID:    agentID,
		AgentName:  agentName,
		TaskID:     taskID,
		Category:   category,
		Decision:   decision,
		RetryCount: updatedState.RetryCount,
		MaxRetries: m.policies[category].MaxRetries,
		Error:      truncateError(err, 500),
		Critique:   critique,
		Timestamp:  time.Now().UTC(),
	}

	// Step 6: Execute recovery.
	switch decision {
	case DecisionRetry:
		policy := m.policies[category]
		backoff := BackoffDuration(policy.BackoffBase, updatedState.RetryCount)
		slog.Info("orchestrator: retrying sub-agent after backoff",
			"agentId", agentID,
			"retryCount", updatedState.RetryCount,
			"backoff", backoff,
		)
		// Wait for backoff, respecting context cancellation.
		select {
		case <-ctx.Done():
			return DecisionSkip, ctx.Err()
		case <-time.After(backoff):
		}

	case DecisionSwitchAgent:
		altID := m.FindAlternateAgentID(agentName)
		evt.AlternateID = altID
		if altID != "" {
			slog.Info("orchestrator: switching to alternate agent",
				"failedAgent", agentName,
				"alternateAgent", altID,
			)
		}

	case DecisionSkip:
		slog.Info("orchestrator: skipping failed sub-agent task",
			"agentId", agentID,
			"category", string(category),
		)

	case DecisionFail:
		// Record circuit failure so repeated definitive failures trip the breaker.
		// cbKey is computed in Step 0 above (agentName with agentID fallback).
		m.recordCircuitFailure(cbKey)
		if updatedState.RetryCount >= MaxRetryDepth {
			slog.Warn("retry depth limit exceeded, failing task",
				"taskId", taskID,
				"agentId", agentID,
				"agentName", agentName,
				"retryCount", updatedState.RetryCount,
				"totalDepth", m.totalDepth,
			)
		} else {
			slog.Warn("orchestrator: sub-agent failure unrecoverable",
				"agentId", agentID,
				"category", string(category),
				"retryCount", updatedState.RetryCount,
			)
		}
	}

	if emitter != nil {
		emitter.Emit(BusEventFailureClassified, scope, evt)
	}

	return decision, nil
}

// ResetRecoveryState clears the recovery state for an agent (e.g. after
// successful retry or when the agent is unregistered). Also resets the
// associated circuit breaker so a re-registered agent starts fresh.
func (m *FailureRecoveryManager) ResetRecoveryState(agentID string) {
	m.stateMu.Lock()
	defer m.stateMu.Unlock()
	delete(m.mu, agentID)
	// Reset circuit breaker as well — keyed by agentID for compatibility
	// with callers that only have agentID (e.g. agent unregistration).
	m.cbMu.Lock()
	delete(m.circuitBreakers, agentID)
	m.cbMu.Unlock()
}

// ── Circuit Breaker Helpers ───────────────────────────────────────────────

// checkCircuitBreaker returns nil if the agent is allowed to proceed, or an
// error describing why the circuit is blocking. Lazily creates a circuit
// breaker entry for new agents on first check.
//
// Keyed by agentName (stable across dispatches), not agentID (unique per dispatch).
func (m *FailureRecoveryManager) checkCircuitBreaker(cbKey string) error {
	cb := m.getOrCreateCircuitBreaker(cbKey)
	return cb.Allow()
}

// getOrCreateCircuitBreaker returns the existing circuit breaker or creates
// one with default configuration (5 failures / 60s window / 30s cooldown).
// Uses double-checked locking: RLock for the common case, Lock for creation.
func (m *FailureRecoveryManager) getOrCreateCircuitBreaker(cbKey string) *AgentCircuitBreaker {
	m.cbMu.RLock()
	cb, ok := m.circuitBreakers[cbKey]
	m.cbMu.RUnlock()
	if ok {
		return cb
	}
	m.cbMu.Lock()
	defer m.cbMu.Unlock()
	// Double-check after acquiring write lock (another goroutine may have created it).
	if cb, ok = m.circuitBreakers[cbKey]; ok {
		return cb
	}
	cb = newAgentCircuitBreaker(0, 0, 0) // use defaults
	m.circuitBreakers[cbKey] = cb
	return cb
}

// recordCircuitFailure records a definitive failure on the agent's circuit breaker.
// This is called when the recovery manager decides DecisionFail — the agent
// has definitively failed and the circuit should track it for rate limiting.
func (m *FailureRecoveryManager) recordCircuitFailure(cbKey string) {
	cb := m.getOrCreateCircuitBreaker(cbKey)
	cb.RecordFailure()
}

// RecordCircuitSuccess records a successful sub-agent completion on the
// agent's circuit breaker. If the circuit was half-open, this closes it
// (trial probe succeeded). Called externally when a sub-agent completes
// without error.
func (m *FailureRecoveryManager) RecordCircuitSuccess(cbKey string) {
	cb := m.getOrCreateCircuitBreaker(cbKey)
	cb.RecordSuccess()
}

// findAlternateAgent checks whether an alternate agent with a different
// adapter ID is available in the registry. Returns true if one exists.
func (m *FailureRecoveryManager) findAlternateAgent(failedAgentName string) bool {
	if m.adapterRegistry == nil {
		return false
	}
	for _, id := range m.adapterRegistry.ListIDs() {
		if id != failedAgentName {
			if adapter, ok := m.adapterRegistry.Get(id); ok {
				if adapter.Available() {
					return true
				}
			}
		}
	}
	return false
}

// FindAlternateAgentID returns the first available alternate agent adapter ID
// that differs from the failed agent. Exported so the dispatch interceptor can
// construct a re-dispatch to the alternate agent on DecisionSwitchAgent.
func (m *FailureRecoveryManager) FindAlternateAgentID(failedAgentName string) string {
	if m.adapterRegistry == nil {
		return ""
	}
	for _, id := range m.adapterRegistry.ListIDs() {
		if id != failedAgentName {
			if adapter, ok := m.adapterRegistry.Get(id); ok {
				if adapter.Available() {
					return id
				}
			}
		}
	}
	return ""
}

// truncateError limits the error message length for inclusion in events.
func truncateError(err error, maxLen int) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	if len(msg) <= maxLen {
		return msg
	}
	return msg[:maxLen] + "..."
}

// BuildReflexionCritique generates a structured reflection prompt for the
// orchestrator to inject before retrying a failed sub-agent. The critique
// asks the orchestrator to analyze why the failure occurred and propose a
// different strategy, turning a blind retry into a learning opportunity.
//
// The prompt follows the Reflexion pattern (Shinn et al., 2023): verbal
// self-reflection on failure before re-attempt, so the next dispatch can
// incorporate lessons from the previous failure.
//
// Exported so the dispatch interceptor can include it in retry injection
// messages when the orchestrator needs to learn from sub-agent failures.
func BuildReflexionCritique(agentName, taskID string, category FailureCategory, reason string, err error) string {
	// Sanitize the error message: truncate to 200 chars and collapse
	// newlines/control characters to prevent them from polluting the
	// formatted critique string and downstream log/UI renderers.
	errMsg := truncateError(err, 200)
	errMsg = strings.ReplaceAll(errMsg, "\n", " ")
	errMsg = strings.ReplaceAll(errMsg, "\r", " ")
	errMsg = strings.ReplaceAll(errMsg, "\t", " ")
	return fmt.Sprintf(
		"[Previous attempt failed: agent=%s category=%s reason=%s error=%s]. "+
			"Analyze why this sub-agent task failed and propose a different strategy before retrying. "+
			"What should be done differently next time to avoid this failure?",
		agentName, string(category), reason, errMsg,
	)
}
