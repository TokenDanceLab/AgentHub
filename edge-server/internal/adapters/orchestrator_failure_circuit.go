package adapters

import (
	"fmt"
	"log/slog"
	"sync"
	"time"
)

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
//	READ PATH (check before dispatch):
//	  HandleSubAgentFailure Step 0 → checkCircuitBreaker → Allow()
//	  Called by dispatchInterceptor.handleSubAgentResult in orchestrator.go:676
//	  when a sub-agent error message arrives via the message queue. Uses
//	  agentName (stable across dispatches) as the circuit breaker key.
//
//	WRITE PATH — FAILURE (trip on definitive failures):
//	  HandleSubAgentFailure DecisionFail branch → recordCircuitFailure → RecordFailure()
//	  Trips the breaker when a sub-agent fails with no recovery possible
//	  (retry budget exhausted, or forced fail).
//
//	WRITE PATH — SUCCESS (reset on completion):
//	  dispatchInterceptor.handleSubAgentResult (non-error branch, orchestrator.go:741)
//	  → FailureRecoveryManager.RecordCircuitSuccess → RecordSuccess()
//	  Resets the breaker when a sub-agent completes without error.
//	  INVARIANT: this path requires a message queue; if FailureRecoveryManager
//	  is created without a message queue, circuit breakers will never reset on
//	  success and agents may become permanently tripped.
//	  (See orchestrator.go:599-614 runResultListener guard.)
//
//	KEYING ASYMMETRY:
//	  Circuit breakers are keyed by agentName (stable across dispatches, e.g.
//	  "code-reviewer"), while recovery state is keyed by agentID (unique per
//	  dispatch, e.g. "agent_abc123"). This means the circuit breaker lumps all
//	  dispatches of the same agent name together — if 5 "code-reviewer" dispatches
//	  fail, the circuit trips for all — while each dispatch gets its own
//	  independent retry budget via RecoveryState.
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
	// now is the injectable clock (#1550). nil is never observed after
	// construction; tests replace it with a fake clock to advance time
	// deterministically instead of sleeping.
	now func() time.Time
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
		now:              time.Now,
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
		if cb.now().After(cb.openUntil) {
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

	now := cb.now()

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
