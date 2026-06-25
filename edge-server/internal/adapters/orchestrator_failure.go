package adapters

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"math/rand"
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
	DecisionRetry       FailureDecision = "retry"        // retry same agent with backoff
	DecisionSwitchAgent FailureDecision = "switch_agent" // re-dispatch to alternate agent
	DecisionSkip        FailureDecision = "skip"         // skip task, notify parent
	DecisionFail        FailureDecision = "fail"         // give up, propagate error
)

// MaxRetryDepth limits the total number of retry decisions across all agents
// within a single recovery context (FailureRecoveryManager). It is the safety cap
// that prevents infinite retry loops regardless of FailurePolicy configuration.
//
// Enforced at two levels:
//  1. Per-agent: DecideRecovery gates on the individual RecoveryState.RetryCount
//     reaching MaxRetryDepth, forcing DecisionFail before any category logic.
//  2. Aggregate: FailureRecoveryManager.totalDepth tracks cumulative retry
//     decisions across all agents; logged as a warning when the cap is hit.
//
// Integration: the depth threshold aligns with process_executor.go's
// SpawnSubAgent depth propagation — each sub-agent dispatch increments
// the delegation depth (dispatchInterceptor.handleDispatch sets depth+1),
// and the agent registry enforces a separate slot/depth limit via TryReserveSlot.
// MaxRetryDepth is the retry-axis counterpart to the dispatch-axis depth cap.
//
// Not configurable — enforced at DecideRecovery level for safety.
const MaxRetryDepth = 3

// ── Agent Circuit Breaker ──────────────────────────────────────────────────

// CircuitState represents the state of a per-agent circuit breaker.
// Standard three-state machine: Closed -> Open -> Half-Open -> Closed.
type CircuitState string

const (
	// CircuitClosed is the normal operating state. Failures are counted
	// and the breaker trips to Open when the threshold is exceeded.
	CircuitClosed CircuitState = "closed"

	// CircuitOpen rejects all requests. After the cooldown period elapses,
	// the breaker transitions to Half-Open to allow a trial probe.
	CircuitOpen CircuitState = "open"

	// CircuitHalfOpen allows exactly one trial request through. If it succeeds,
	// the breaker closes. If it fails, the breaker returns to Open.
	CircuitHalfOpen CircuitState = "half-open"
)

// Default circuit breaker parameters.
const (
	defaultCBFailureThreshold = 5
	defaultCBFailureWindow    = 60 * time.Second
	defaultCBCooldownPeriod   = 30 * time.Second
)

// AgentCircuitBreaker implements a per-agent three-state circuit breaker
// (Closed / Open / Half-Open) with thread-safe state transitions. It prevents
// repeated dispatch attempts to repeatedly-failing sub-agents, enforcing a
// cooldown period before a single trial probe is allowed through.
//
// Configuration:
//   - FailureThreshold: consecutive failures within the window to trip (default 5)
//   - FailureWindow: time window for counting consecutive failures (default 60s)
//   - CooldownPeriod: time to stay in Open before Half-Open probe (default 30s)
//
// Integration points (see orchestrator.go and process_executor.go):
//
//   READ PATH (check before dispatch):
//     HandleSubAgentFailure Step 0 → checkCircuitBreaker → Allow()
//     Called by dispatchInterceptor.handleSubAgentResult in orchestrator.go:676
//     when a sub-agent error message arrives via the message queue. Uses
//     agentName (stable across dispatches) as the circuit breaker key.
//
//   WRITE PATH — FAILURE (trip on definitive failures):
//     HandleSubAgentFailure DecisionFail branch → recordCircuitFailure → RecordFailure()
//     Trips the breaker when a sub-agent fails with no recovery possible
//     (retry budget exhausted, or forced fail).
//
//   WRITE PATH — SUCCESS (reset on completion):
//     dispatchInterceptor.handleSubAgentResult (non-error branch, orchestrator.go:741)
//     → FailureRecoveryManager.RecordCircuitSuccess → RecordSuccess()
//     Resets the breaker when a sub-agent completes without error.
//     INVARIANT: this path requires a message queue; if FailureRecoveryManager
//     is created without a message queue, circuit breakers will never reset on
//     success and agents may become permanently tripped.
//     (See orchestrator.go:599-614 runResultListener guard.)
//
//   KEYING ASYMMETRY:
//     Circuit breakers are keyed by agentName (stable across dispatches, e.g.
//     "code-reviewer"), while recovery state is keyed by agentID (unique per
//     dispatch, e.g. "agent_abc123"). This means the circuit breaker lumps all
//     dispatches of the same agent name together — if 5 "code-reviewer" dispatches
//     fail, the circuit trips for all — while each dispatch gets its own
//     independent retry budget via RecoveryState.
type AgentCircuitBreaker struct {
	mu               sync.Mutex
	state            CircuitState
	failureCount     int
	lastFailure      time.Time
	openUntil        time.Time
	failureThreshold int
	failureWindow    time.Duration
	cooldownPeriod   time.Duration
	halfOpenInFlight bool // true when a half-open probe is in progress
}

// newAgentCircuitBreaker creates a circuit breaker with the given configuration.
// Zero values for threshold, window, or cooldown use sensible defaults.
func newAgentCircuitBreaker(threshold int, window, cooldown time.Duration) *AgentCircuitBreaker {
	if threshold <= 0 {
		threshold = defaultCBFailureThreshold
	}
	if window <= 0 {
		window = defaultCBFailureWindow
	}
	if cooldown <= 0 {
		cooldown = defaultCBCooldownPeriod
	}
	return &AgentCircuitBreaker{
		state:            CircuitClosed,
		failureThreshold: threshold,
		failureWindow:    window,
		cooldownPeriod:   cooldown,
	}
}

// Allow checks whether a request to this agent should be permitted.
// Returns nil if the circuit is closed, or if half-open and no probe is in flight.
// Returns an error if the circuit is open (cooldown not yet elapsed) or if a
// half-open probe is already in progress.
func (cb *AgentCircuitBreaker) Allow() error {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case CircuitClosed:
		return nil
	case CircuitOpen:
		if time.Now().After(cb.openUntil) {
			// Cooldown elapsed: transition to half-open and allow a trial probe.
			prevState := cb.state
			cb.state = CircuitHalfOpen
			cb.halfOpenInFlight = true
			slog.Info("circuit breaker: transitioned to half-open",
				"prevState", string(prevState),
				"newState", string(cb.state),
			)
			return nil
		}
		return fmt.Errorf("circuit breaker open (cooldown remaining: %s)", time.Until(cb.openUntil).Round(time.Second))
	case CircuitHalfOpen:
		if cb.halfOpenInFlight {
			return fmt.Errorf("circuit breaker half-open: probe already in flight")
		}
		cb.halfOpenInFlight = true
		return nil
	default:
		return fmt.Errorf("circuit breaker: unknown state %q", cb.state)
	}
}

// RecordFailure records a failure against this circuit breaker. If the
// consecutive failure count exceeds the threshold within the window, the
// breaker trips from Closed to Open. If already in Half-Open, the trial
// probe failed and the breaker returns to Open. If already Open, extends
// the cooldown period.
func (cb *AgentCircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	now := time.Now()

	// Reset failure count if outside the window (stale failures expire).
	if !cb.lastFailure.IsZero() && now.Sub(cb.lastFailure) > cb.failureWindow {
		cb.failureCount = 0
	}

	cb.failureCount++
	cb.lastFailure = now

	switch cb.state {
	case CircuitClosed:
		if cb.failureCount >= cb.failureThreshold {
			prevState := cb.state
			cb.state = CircuitOpen
			cb.openUntil = now.Add(cb.cooldownPeriod)
			slog.Info("circuit breaker: tripped to open",
				"prevState", string(prevState),
				"newState", string(cb.state),
				"failureCount", cb.failureCount,
				"threshold", cb.failureThreshold,
				"openUntil", cb.openUntil.Format(time.RFC3339),
			)
		}
	case CircuitHalfOpen:
		// Trial probe failed — return to open. Reset failureCount since
		// the probe failure already serves as the signal to extend cooldown.
		prevState := cb.state
		cb.state = CircuitOpen
		cb.failureCount = 0
		cb.openUntil = now.Add(cb.cooldownPeriod)
		cb.halfOpenInFlight = false
		slog.Info("circuit breaker: half-open probe failed, returning to open",
			"prevState", string(prevState),
			"newState", string(cb.state),
			"openUntil", cb.openUntil.Format(time.RFC3339),
		)
	case CircuitOpen:
		// Extend cooldown when failures continue while open.
		cb.openUntil = now.Add(cb.cooldownPeriod)
	}
}

// RecordSuccess records a successful request against this circuit breaker.
// In Half-Open state, the trial probe succeeded and the breaker closes.
// In Closed state, resets the consecutive failure counter.
func (cb *AgentCircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case CircuitHalfOpen:
		prevState := cb.state
		cb.state = CircuitClosed
		cb.failureCount = 0
		cb.halfOpenInFlight = false
		slog.Info("circuit breaker: half-open probe succeeded, closing circuit",
			"prevState", string(prevState),
			"newState", string(cb.state),
		)
	case CircuitClosed:
		// Reset consecutive failure count on success.
		cb.failureCount = 0
	case CircuitOpen:
		// Should not receive success in open state. Reset as safety measure.
		slog.Warn("circuit breaker: unexpected success in open state, force-resetting to closed")
		cb.state = CircuitClosed
		cb.failureCount = 0
		cb.halfOpenInFlight = false
	}
}

// State returns the current circuit state for observability.
func (cb *AgentCircuitBreaker) State() CircuitState {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.state
}

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
		// No error to classify: default to transient per the optimistic
		// assumption that the retry may succeed. FailureCancel would imply
		// the task was cancelled/aborted, which is misleading when there
		// is genuinely no error information available.
		return FailureTransient, "no error to classify — assuming transient"
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

	// Priority 7: Repeated identical action — sub-agent stuck in a deterministic
	// loop, repeating the same tool+args pattern. Classify as cancel to prevent
	// the orchestrator from retrying an agent that will keep failing identically.
	if isRepeatedAction(err) {
		return FailureCancel, "repeated_identical_action"
	}

	// Default: transient — optimistic assumption that retry may succeed.
	return FailureTransient, "default: assuming transient"
}

// RunError is a mirror of lifecycle.RunError for use in the adapters package
// without creating a circular dependency. It carries a classified error code.

// isRepeatedAction checks if the error message contains repeated identical
// lines, indicating a sub-agent stuck in a deterministic loop repeating the
// same tool+args pattern. Returns true when any non-trivial line appears 3+
// times in the error message.
//
// This is used by ClassifyFailure to detect silent failure loops where the
// sub-agent keeps retrying the same failing action identically. Without this
// detection, the orchestrator's retry loop would also retry identically,
// wasting budget on a doomed task.
func isRepeatedAction(err error) bool {
	if err == nil {
		return false
	}
	return hasRepeatedPattern(err.Error(), 3)
}

// hasRepeatedPattern counts identical non-trivial lines in text and returns
// true when any line repeats at least minRepeat times. Lines shorter than 10
// characters are skipped to avoid false positives on punctuation and short
// tokens. Also skips lines that are all whitespace.
func hasRepeatedPattern(text string, minRepeat int) bool {
	lines := strings.Split(text, "\n")
	counts := make(map[string]int, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if len(line) < 10 {
			continue
		}
		counts[line]++
		if counts[line] >= minRepeat {
			return true
		}
	}
	return false
}

type RunError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
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
	// Nil guard: although the only internal caller (HandleSubAgentFailure)
	// always provides a non-nil state, DecideRecovery is exported and could
	// be called from external code with nil, causing a panic at line 509.
	if state == nil {
		return DecisionFail, &RecoveryState{}
	}

	if policies == nil {
		policies = DefaultFailurePolicies()
	}

	policy, ok := policies[category]
	if !ok {
		// Unknown category: fail.
		return DecisionFail, state
	}

	updated := *state

	// Hard retry depth limit: regardless of failure category or policy,
	// cap cumulative retry attempts at MaxRetryDepth to prevent infinite
	// retry loops. This gate is non-configurable and fires before any
	// category-specific logic so it cannot be bypassed by policy changes.
	if state.RetryCount >= MaxRetryDepth {
		return DecisionFail, &updated
	}

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

// BackoffDuration calculates the exponential backoff wait time for a retry
// with true ±25% jitter (0.75d to 1.25d), capped at 30 seconds. Jitter
// spreads retries in both directions to prevent thundering herds when
// multiple sub-agent retries fire simultaneously.
func BackoffDuration(base time.Duration, retryCount int) time.Duration {
	if retryCount <= 0 {
		if base <= 0 {
			return 1 * time.Second
		}
		return base
	}
	if base <= 0 {
		base = 1 * time.Second
	}
	multiplier := math.Pow(2, float64(retryCount-1))
	d := time.Duration(float64(base) * multiplier)
	// Apply true ±25% jitter: randomly shift in [-d/4, +d/4] so the
	// resulting delay ranges from 0.75d to 1.25d, spreading retries
	// symmetrically around the base duration.
	jitter := time.Duration(rand.Int63n(int64(d/2))) - time.Duration(d/4)
	d = d + jitter
	if d > 30*time.Second {
		d = 30 * time.Second
	}
	return d
}

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
//   CREATION: orchestrator.go ParseStream (line ~132)
//     NewFailureRecoveryManager(adapterRegistry, spawner) — created when
//     both adapterRegistry and spawner are non-nil.
//
//   ERROR PATH: orchestrator.go handleSubAgentResult (line ~675)
//     dispatchInterceptor.processResultMessage → handleSubAgentResult calls
//     HandleSubAgentFailure when isError=true, which classifies the failure,
//     checks the circuit breaker, decides recovery, and executes it.
//
//   SUCCESS PATH: orchestrator.go handleSubAgentResult (line ~741)
//     dispatchInterceptor calls RecordCircuitSuccess for non-error completions
//     to reset the circuit breaker on healthy sub-agent results.
//
//   DEPTH TRACKING: process_executor.go SpawnSubAgent (line ~1395)
//     Each sub-agent dispatch increments the delegation depth via
//     dispatchInterceptor.handleDispatch (depth+1). process_executor.go
//     SpawnSubAgent enforces a separate slot/depth limit through the agent
//     registry's TryReserveSlot (atomic check-and-reserve). CanSpawn exists
//     as a read-only diagnostic method but does not reserve slots and has a
//     TOCTOU race if used for enforcement. The retry depth
//     (FailureRecoveryManager.totalDepth + RecoveryState.RetryCount) is
//     orthogonal to dispatch depth — retries keep the same dispatch depth
//     but count toward MaxRetryDepth.
//
//   BUDGET LINK: process_executor.go childBudget (line ~1527)
//     Sub-agent context budget is allocated from the parent budget via
//     AllocateChild, with the fraction decreasing by depth (depth 1 = 1/2,
//     depth 2 = 1/4, etc.). Failure recovery retries reuse the same budget
//     allocation — retry decisions do not further reduce the budget.
type FailureRecoveryManager struct {
	policies        map[FailureCategory]FailurePolicy
	adapterRegistry *Registry
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
func NewFailureRecoveryManager(adapterRegistry *Registry, spawner SubAgentSpawner) *FailureRecoveryManager {
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
