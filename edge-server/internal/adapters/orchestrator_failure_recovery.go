package adapters

import (
	"math"
	"math/rand"
	"time"
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
	jitter := time.Duration(rand.Int63n(int64(d/2))) - d/4
	d += jitter
	if d > 30*time.Second {
		d = 30 * time.Second
	}
	return d
}
