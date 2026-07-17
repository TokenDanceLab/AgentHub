package lifecycle

import "github.com/agenthub/edge-server/internal/runnerctx"

// childBudget creates an isolated context budget for a sub-agent from the parent
// budget via ContextBudget.AllocateChild. Deeper delegation levels get a smaller
// fraction of remaining tokens to prevent budget exhaustion at the root. The child
// budget is fully independent — it does NOT reference the parent's UsedTokens
// counter, so the child's token consumption cannot pollute the parent's tracking.
func childBudget(parent *runnerctx.ContextBudget, depth int) *runnerctx.ContextBudget {
	if parent == nil {
		return runnerctx.NewContextBudget(0)
	}
	// Fraction reduces with depth: depth 1 gets 1/2, depth 2 gets 1/4, etc.
	// AllocateChild clamps to min 10K tokens and properly scales ReservedTokens.
	fraction := int64(1 << depth) // 2, 4, 8, ...
	ratio := 1.0 / float64(fraction)
	return parent.AllocateChild(ratio)
}
