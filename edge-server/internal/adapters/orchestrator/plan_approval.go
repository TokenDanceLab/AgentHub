package orchestrator

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// PlanApprovalConfig / PendingPlan / PlanDecision 的唯一权威定义在
// internal/orchestration（A-V1 Step 1, #1526）；本文件通过 contract_aliases.go
// 的 type alias 使用它们，broker 行为实现仍在本包。

// DefaultPlanApprovalConfig returns the default plan approval configuration.
func DefaultPlanApprovalConfig() PlanApprovalConfig {
	return PlanApprovalConfig{
		Enabled:            false,
		AutoApproveTimeout: 60 * time.Second,
	}
}

// planKey is the map key for pending plans, keyed by runID.
type planKey struct {
	runID string
}

// brokeredPlan holds a pending plan and its decision channel.
type brokeredPlan struct {
	plan     PendingPlan
	decision chan PlanDecision
}

// PlanApprovalBroker manages pending orchestrator plans and connects them
// to user approval/rejection decisions. It mirrors the PermissionDecisionBroker
// pattern: the orchestrator registers a plan and blocks until a decision arrives
// or the approval timeout fires (default: deny).
type PlanApprovalBroker struct {
	mu      sync.Mutex
	pending map[planKey]brokeredPlan
	config  PlanApprovalConfig
}

// NewPlanApprovalBroker creates a new broker with the given configuration.
func NewPlanApprovalBroker(config PlanApprovalConfig) *PlanApprovalBroker {
	return &PlanApprovalBroker{
		pending: make(map[planKey]brokeredPlan),
		config:  config,
	}
}

// SubmitPlan registers a proposed plan and returns a waiter function that blocks
// until the user approves/rejects or the approval timeout fires (default: deny).
// Returns nil,false if the broker is nil or the plan has no runID.
func (b *PlanApprovalBroker) SubmitPlan(ctx context.Context, plan PendingPlan) (func(context.Context) PlanDecision, bool) {
	if b == nil {
		return nil, false
	}
	plan.RunID = strings.TrimSpace(plan.RunID)
	if plan.RunID == "" {
		return nil, false
	}

	key := planKey{runID: plan.RunID}
	bp := brokeredPlan{
		plan:     plan,
		decision: make(chan PlanDecision, 1),
	}

	b.mu.Lock()
	if _, exists := b.pending[key]; exists {
		b.mu.Unlock()
		// Replace the existing pending plan — the orchestrator may emit
		// multiple plan proposals as it refines.
		slog.Warn("plan approval: replacing existing pending plan", "runId", plan.RunID)
	}
	b.pending[key] = bp
	b.mu.Unlock()

	return func(ctx context.Context) PlanDecision {
		timeout := b.config.AutoApproveTimeout
		if timeout <= 0 {
			timeout = 60 * time.Second
		}
		timer := time.NewTimer(timeout)
		defer timer.Stop()

		select {
		case decision := <-bp.decision:
			return decision
		case <-timer.C:
			slog.Info("plan approval: denying after timeout",
				"runId", plan.RunID,
				"timeout", timeout,
			)
			b.mu.Lock()
			delete(b.pending, key)
			b.mu.Unlock()
			return PlanDecision{Approved: false, Reason: "timeout"}
		case <-ctx.Done():
			b.mu.Lock()
			delete(b.pending, key)
			b.mu.Unlock()
			return PlanDecision{
				Approved: false,
				Reason:   "plan approval cancelled: run context ended",
			}
		}
	}, true
}

// Decide resolves a pending plan with the user's decision.
// Returns the pending plan info and true if a matching plan was found.
func (b *PlanApprovalBroker) Decide(runID string, decision PlanDecision) (PendingPlan, bool) {
	if b == nil {
		return PendingPlan{}, false
	}
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return PendingPlan{}, false
	}
	key := planKey{runID: runID}
	b.mu.Lock()
	bp, ok := b.pending[key]
	if ok {
		delete(b.pending, key)
	}
	b.mu.Unlock()
	if !ok {
		return PendingPlan{}, false
	}
	bp.decision <- decision
	return bp.plan, true
}

// GetPending returns the pending plan for a run, if any.
func (b *PlanApprovalBroker) GetPending(runID string) (PendingPlan, bool) {
	if b == nil {
		return PendingPlan{}, false
	}
	key := planKey{runID: strings.TrimSpace(runID)}
	b.mu.Lock()
	bp, ok := b.pending[key]
	b.mu.Unlock()
	if !ok {
		return PendingPlan{}, false
	}
	return bp.plan, true
}

// ListPending returns all currently pending plans.
func (b *PlanApprovalBroker) ListPending() []PendingPlan {
	if b == nil {
		return nil
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	plans := make([]PendingPlan, 0, len(b.pending))
	for _, bp := range b.pending {
		plans = append(plans, bp.plan)
	}
	return plans
}
