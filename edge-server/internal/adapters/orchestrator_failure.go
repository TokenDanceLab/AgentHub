package adapters

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/agenthub/edge-server/internal/store"
)

// ── Failure Classification ──────────────────────────────────────────────────

// FailureCategory classifies why a sub-agent failed so the orchestrator can
// choose the right recovery strategy.
//
// Reference: doloveplayer error taxonomy + Queena graceful degradation design.
//   - Transient: network timeout, API rate limit → auto-retry with backoff
//   - Capability: tool not found, permission denied, adapter unavailable → switch agent
//   - Cancel: task impossible, invalid input, depth exceeded → skip + notify
type FailureCategory string

const (
	// FailureTransient covers recoverable infrastructure errors: timeouts,
	// rate limits, temporary network failures. The same agent may succeed on retry.
	FailureTransient FailureCategory = "transient"

	// FailureCapability covers errors where the current agent cannot handle the
	// task: missing tools, permission denied, adapter unavailable, binary not
	// found. A different agent with matching capabilities should be tried.
	FailureCapability FailureCategory = "capability"

	// FailureCancel covers unrecoverable errors: invalid input, task impossible,
	// depth limit exceeded, or context cancelled. The task should be skipped and
	// the parent orchestrator notified.
	FailureCancel FailureCategory = "cancel"
)

// FailureDecision is the recovery action chosen after classifying a failure.
type FailureDecision string

const (
	DecisionRetry       FailureDecision = "retry"       // retry same agent with backoff
	DecisionSwitchAgent FailureDecision = "switch_agent" // re-dispatch to alternate agent
	DecisionSkip        FailureDecision = "skip"         // skip task, notify parent
	DecisionFail        FailureDecision = "fail"         // give up, propagate error
)

// FailurePolicy defines recovery parameters for each failure category.
type FailurePolicy struct {
	Category    FailureCategory
	MaxRetries  int           // max retry attempts (transient: 3, others: 0)
	BackoffBase time.Duration // initial backoff (transient: 1s, exponential)
}

// DefaultFailurePolicies returns the standard 3-tier policy set.
func DefaultFailurePolicies() map[FailureCategory]FailurePolicy {
	return map[FailureCategory]FailurePolicy{
		FailureTransient: {
			Category:    FailureTransient,
			MaxRetries:  3,
			BackoffBase: 1 * time.Second,
		},
		FailureCapability: {
			Category:   FailureCapability,
			MaxRetries: 0, // no retry, switch agent instead
		},
		FailureCancel: {
			Category:   FailureCancel,
			MaxRetries: 0, // no retry, skip
		},
	}
}

// ── Failure Event ───────────────────────────────────────────────────────────

// FailureClassifiedEvent is emitted when a sub-agent failure is classified.
// It carries the category, decision, and retry state for observability.
type FailureClassifiedEvent struct {
	RunID       string           `json:"runId"`
	AgentID     string           `json:"agentId"`
	AgentName   string           `json:"agentName"`
	TaskID      string           `json:"taskId"`
	Category    FailureCategory  `json:"category"`
	Decision    FailureDecision  `json:"decision"`
	RetryCount  int              `json:"retryCount"`
	MaxRetries  int              `json:"maxRetries"`
	Error       string           `json:"error"`
	AlternateID string           `json:"alternateAgentId,omitempty"`
	Timestamp   time.Time        `json:"timestamp"`
}

// BusEventFailureClassified is the typed event name for failure classification.
const BusEventFailureClassified = "orchestrator.failure_classified"

// ── Classification Logic ────────────────────────────────────────────────────

// transientPatterns match error messages indicating recoverable failures.
var transientPatterns = []string{
	"timeout",
	"timed out",
	"deadline exceeded",
	"rate limit",
	"rate_limit",
	"too many requests",
	"429",
	"503",
	"502",
	"connection refused",
	"connection reset",
	"i/o timeout",
	"temporary",
	"ECONNRESET",
	"ECONNREFUSED",
	"ETIMEDOUT",
	"context deadline",
}

// capabilityPatterns match error messages indicating the agent cannot handle
// the task with its current capabilities.
var capabilityPatterns = []string{
	"permission denied",
	"access denied",
	"access is denied",
	"not found",
	"executable file not found",
	"binary not found",
	"adapter unavailable",
	"tool not available",
	"command not found",
	"no such file",
	"not installed",
	"unavailable",
}

// cancelPatterns match error messages indicating the task is impossible
// or should be abandoned.
var cancelPatterns = []string{
	"invalid input",
	"invalid argument",
	"bad request",
	"depth exceeded",
	"slot full",
	"agent depth exceeded",
	"agent slot full",
	"cancelled",
	"canceled",
}

// ClassifyFailure inspects an error and optional RunError code to determine
// the failure category. Classification priority:
//  1. Context cancellation → Cancel
//  2. Deadline/timeout → Transient
//  3. Error code mapping (BINARY_NOT_FOUND, PERMISSION_DENIED → Capability)
//  4. Pattern matching on error message strings
//  5. Default → Transient (optimistic: assume recoverable)
func ClassifyFailure(err error, runErr *RunError) (FailureCategory, string) {
	if err == nil && runErr == nil {
		return FailureCancel, "no error to classify"
	}

	// Build a unified message for pattern matching.
	msg := ""
	if err != nil {
		msg = err.Error()
	}
	if runErr != nil && runErr.Message != "" {
		if msg != "" {
			msg = msg + ": " + runErr.Message
		} else {
			msg = runErr.Message
		}
	}
	msgLower := strings.ToLower(msg)

	// Priority 1: Context cancellation is always cancel.
	if strings.Contains(msgLower, "context canceled") ||
		strings.Contains(msgLower, "context cancelled") {
		return FailureCancel, "context cancelled"
	}

	// Priority 2: Deadline/timeout is always transient.
	if strings.Contains(msgLower, "deadline exceeded") ||
		strings.Contains(msgLower, "timeout") ||
		strings.Contains(msgLower, "timed out") {
		return FailureTransient, "deadline or timeout detected"
	}

	// Priority 3: RunError code mapping.
	if runErr != nil && runErr.Code != "" {
		switch runErr.Code {
		case "TIMEOUT":
			return FailureTransient, "run error code: TIMEOUT"
		case "BINARY_NOT_FOUND":
			return FailureCapability, "run error code: BINARY_NOT_FOUND"
		case "PERMISSION_DENIED":
			return FailureCapability, "run error code: PERMISSION_DENIED"
		case "CANCELLED":
			return FailureCancel, "run error code: CANCELLED"
		}
	}

	// Priority 4: Cancel patterns (check first as they are terminal).
	for _, pattern := range cancelPatterns {
		if strings.Contains(msgLower, strings.ToLower(pattern)) {
			return FailureCancel, fmt.Sprintf("cancel pattern matched: %s", pattern)
		}
	}

	// Priority 5: Capability patterns.
	for _, pattern := range capabilityPatterns {
		if strings.Contains(msgLower, strings.ToLower(pattern)) {
			return FailureCapability, fmt.Sprintf("capability pattern matched: %s", pattern)
		}
	}

	// Priority 6: Transient patterns.
	for _, pattern := range transientPatterns {
		if strings.Contains(msgLower, strings.ToLower(pattern)) {
			return FailureTransient, fmt.Sprintf("transient pattern matched: %s", pattern)
		}
	}

	// Default: transient — optimistic assumption that retry may succeed.
	return FailureTransient, "default: assuming transient"
}

// RunError is a mirror of lifecycle.RunError for use in the adapters package
// without creating a circular dependency. It carries a classified error code.
type RunError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ── Recovery Decision ────────────────────────────────────────────────────────

// RecoveryState tracks retry attempts for a specific sub-agent run.
type RecoveryState struct {
	AgentID    string
	TaskID     string
	RetryCount int
	LastRetry  time.Time
}

// DecideRecovery determines the recovery action based on the failure category,
// retry state, and available policies. It returns a FailureDecision and the
// updated recovery state.
func DecideRecovery(
	category FailureCategory,
	state *RecoveryState,
	policies map[FailureCategory]FailurePolicy,
	alternateAvailable bool,
) (FailureDecision, *RecoveryState) {
	if policies == nil {
		policies = DefaultFailurePolicies()
	}

	policy, ok := policies[category]
	if !ok {
		// Unknown category: fail.
		return DecisionFail, state
	}

	updated := *state

	switch category {
	case FailureTransient:
		if state.RetryCount < policy.MaxRetries {
			updated.RetryCount++
			updated.LastRetry = time.Now()
			return DecisionRetry, &updated
		}
		// Exhausted retries.
		return DecisionFail, &updated

	case FailureCapability:
		if alternateAvailable {
			return DecisionSwitchAgent, &updated
		}
		return DecisionFail, &updated

	case FailureCancel:
		return DecisionSkip, &updated

	default:
		return DecisionFail, &updated
	}
}

// BackoffDuration calculates the exponential backoff wait time for a retry.
// Uses the formula: base * 2^(retryCount-1), capped at 30 seconds.
func BackoffDuration(base time.Duration, retryCount int) time.Duration {
	if base <= 0 {
		base = 1 * time.Second
	}
	multiplier := math.Pow(2, float64(retryCount-1))
	d := time.Duration(float64(base) * multiplier)
	if d > 30*time.Second {
		return 30 * time.Second
	}
	return d
}

// ── FailureRecoveryManager ──────────────────────────────────────────────────

// FailureRecoveryManager coordinates failure classification and recovery for
// sub-agent runs within an orchestrator. It is embedded in the dispatch
// interceptor and invoked when sub-agent error messages arrive.
type FailureRecoveryManager struct {
	policies        map[FailureCategory]FailurePolicy
	adapterRegistry *Registry
	spawner         SubAgentSpawner

	mu      map[string]*RecoveryState // agentID -> recovery state
	stateMu sync.Mutex
}

// NewFailureRecoveryManager creates a recovery manager with default policies.
func NewFailureRecoveryManager(adapterRegistry *Registry, spawner SubAgentSpawner) *FailureRecoveryManager {
	return &FailureRecoveryManager{
		policies:        DefaultFailurePolicies(),
		adapterRegistry: adapterRegistry,
		spawner:         spawner,
		mu:              make(map[string]*RecoveryState),
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
	// Step 1: Classify.
	category, reason := ClassifyFailure(err, runErr)

	// Step 2: Get or create recovery state.
	m.stateMu.Lock()
	state, ok := m.mu[agentID]
	if !ok {
		state = &RecoveryState{
			AgentID: agentID,
			TaskID:  taskID,
		}
		m.mu[agentID] = state
	}
	m.stateMu.Unlock()

	// Step 3: Check for alternate agent availability.
	alternateAvailable := m.findAlternateAgent(agentName)

	// Step 4: Decide.
	decision, updatedState := DecideRecovery(category, state, m.policies, alternateAvailable)
	m.stateMu.Lock()
	m.mu[agentID] = updatedState
	m.stateMu.Unlock()

	slog.Info("orchestrator: sub-agent failure classified",
		"runId", parentRun.ID,
		"agentId", agentID,
		"agentName", agentName,
		"category", string(category),
		"decision", string(decision),
		"reason", reason,
		"retryCount", updatedState.RetryCount,
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
		altID := m.findAlternateAgentID(agentName)
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
		slog.Warn("orchestrator: sub-agent failure unrecoverable",
			"agentId", agentID,
			"category", string(category),
			"retryCount", updatedState.RetryCount,
		)
	}

	if emitter != nil {
		emitter.Emit(BusEventFailureClassified, scope, evt)
	}

	return decision, nil
}

// ResetRecoveryState clears the recovery state for an agent (e.g. after
// successful retry or when the agent is unregistered).
func (m *FailureRecoveryManager) ResetRecoveryState(agentID string) {
	m.stateMu.Lock()
	defer m.stateMu.Unlock()
	delete(m.mu, agentID)
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

// findAlternateAgentID returns the first available alternate agent adapter ID
// that differs from the failed agent.
func (m *FailureRecoveryManager) findAlternateAgentID(failedAgentName string) string {
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
