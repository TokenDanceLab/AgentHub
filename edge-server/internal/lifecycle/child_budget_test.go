package lifecycle

import (
	"testing"

	"github.com/agenthub/edge-server/internal/runnerctx"
)

func TestChildBudgetNilParent(t *testing.T) {
	t.Parallel()

	got := childBudget(nil, 1)
	if got == nil {
		t.Fatal("childBudget(nil) returned nil")
	}
}

func TestChildBudgetDepthFraction(t *testing.T) {
	t.Parallel()

	parent := runnerctx.NewContextBudget(1_000_000)
	child1 := childBudget(parent, 1)
	child2 := childBudget(parent, 2)
	if child1 == nil || child2 == nil {
		t.Fatal("expected non-nil child budgets")
	}
	// Depth 2 should receive a smaller allocation than depth 1.
	if child2.MaxTokens >= child1.MaxTokens {
		t.Fatalf("depth2 MaxTokens=%d, depth1 MaxTokens=%d; want depth2 < depth1", child2.MaxTokens, child1.MaxTokens)
	}
}
