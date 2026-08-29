package orchestrator

import (
	"context"
	"testing"
	"time"
)

func TestPlanApprovalBroker_SubmitAndApprove(t *testing.T) {
	broker := NewPlanApprovalBroker(PlanApprovalConfig{
		Enabled:            true,
		AutoApproveTimeout: 60 * time.Second,
	})

	plan := PendingPlan{
		RunID:     "run_test123",
		ProjectID: "proj_test",
		ThreadID:  "thread_test",
		Tasks: []PlanTask{
			{ID: "task-1", Agent: "codex", Description: "Refactor Button.tsx", DependsOn: []string{}},
			{ID: "task-2", Agent: "codex", Description: "Update tests", DependsOn: []string{"task-1"}},
		},
		Mode:      "parallel",
		CreatedAt: time.Now().UTC(),
		Status:    "pending",
	}

	wait, ok := broker.SubmitPlan(context.Background(), plan)
	if !ok {
		t.Fatal("expected SubmitPlan to return ok=true")
	}

	// Approve in a goroutine
	go func() {
		time.Sleep(50 * time.Millisecond)
		_, found := broker.Decide("run_test123", PlanDecision{Approved: true, Reason: "looks good"})
		if !found {
			t.Error("expected Decide to find the pending plan")
		}
	}()

	decision := wait(context.Background())
	if !decision.Approved {
		t.Error("expected plan to be approved")
	}
	if decision.Reason != "looks good" {
		t.Errorf("expected reason 'looks good', got %q", decision.Reason)
	}

	// Verify plan is removed after decision
	_, found := broker.GetPending("run_test123")
	if found {
		t.Error("expected plan to be removed after decision")
	}
}

func TestPlanApprovalBroker_Reject(t *testing.T) {
	broker := NewPlanApprovalBroker(PlanApprovalConfig{
		Enabled:            true,
		AutoApproveTimeout: 60 * time.Second,
	})

	plan := PendingPlan{
		RunID:  "run_reject_test",
		Tasks:  []PlanTask{{ID: "task-1", Agent: "codex", Description: "do stuff"}},
		Mode:   "single",
		Status: "pending",
	}

	wait, ok := broker.SubmitPlan(context.Background(), plan)
	if !ok {
		t.Fatal("expected SubmitPlan to return ok=true")
	}

	go func() {
		time.Sleep(50 * time.Millisecond)
		broker.Decide("run_reject_test", PlanDecision{Approved: false, Reason: "too risky"})
	}()

	decision := wait(context.Background())
	if decision.Approved {
		t.Error("expected plan to be rejected")
	}
	if decision.Reason != "too risky" {
		t.Errorf("expected reason 'too risky', got %q", decision.Reason)
	}
}

func TestPlanApprovalBroker_TimeoutDenies(t *testing.T) {
	broker := NewPlanApprovalBroker(PlanApprovalConfig{
		Enabled:            true,
		AutoApproveTimeout: 100 * time.Millisecond,
	})

	plan := PendingPlan{
		RunID:  "run_timeout_test",
		Tasks:  []PlanTask{{ID: "task-1", Agent: "codex", Description: "do stuff"}},
		Mode:   "single",
		Status: "pending",
	}

	wait, ok := broker.SubmitPlan(context.Background(), plan)
	if !ok {
		t.Fatal("expected SubmitPlan to return ok=true")
	}

	start := time.Now()
	decision := wait(context.Background())
	elapsed := time.Since(start)

	if decision.Approved {
		t.Error("expected timeout to deny, not approve")
	}
	if decision.Reason != "timeout" {
		t.Errorf("expected reason 'timeout', got %q", decision.Reason)
	}
	if elapsed < 80*time.Millisecond {
		t.Errorf("timeout fired too quickly: %v", elapsed)
	}
	if elapsed > 500*time.Millisecond {
		t.Errorf("timeout took too long: %v", elapsed)
	}

	// Verify plan is removed after timeout denial
	_, found := broker.GetPending("run_timeout_test")
	if found {
		t.Error("expected plan to be removed after timeout denial")
	}
}

func TestPlanApprovalBroker_ContextCancelled(t *testing.T) {
	broker := NewPlanApprovalBroker(PlanApprovalConfig{
		Enabled:            true,
		AutoApproveTimeout: 60 * time.Second, // long timeout
	})

	plan := PendingPlan{
		RunID:  "run_cancel_test",
		Tasks:  []PlanTask{{ID: "task-1", Agent: "codex", Description: "do stuff"}},
		Mode:   "single",
		Status: "pending",
	}

	ctx, cancel := context.WithCancel(context.Background())
	wait, ok := broker.SubmitPlan(ctx, plan)
	if !ok {
		t.Fatal("expected SubmitPlan to return ok=true")
	}

	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	decision := wait(ctx)
	if decision.Approved {
		t.Error("expected rejection when context is cancelled")
	}
}

func TestPlanApprovalBroker_EmptyRunID(t *testing.T) {
	broker := NewPlanApprovalBroker(DefaultPlanApprovalConfig())

	_, ok := broker.SubmitPlan(context.Background(), PendingPlan{RunID: ""})
	if ok {
		t.Error("expected SubmitPlan to reject empty runID")
	}

	_, ok = broker.SubmitPlan(context.Background(), PendingPlan{RunID: "   "})
	if ok {
		t.Error("expected SubmitPlan to reject whitespace-only runID")
	}
}

func TestPlanApprovalBroker_NilBroker(t *testing.T) {
	var broker *PlanApprovalBroker

	_, ok := broker.SubmitPlan(context.Background(), PendingPlan{RunID: "run_x"})
	if ok {
		t.Error("expected nil broker to return false")
	}

	_, ok = broker.Decide("run_x", PlanDecision{Approved: true})
	if ok {
		t.Error("expected nil broker Decide to return false")
	}

	_, ok = broker.GetPending("run_x")
	if ok {
		t.Error("expected nil broker GetPending to return false")
	}

	plans := broker.ListPending()
	if plans != nil {
		t.Error("expected nil broker ListPending to return nil")
	}
}

func TestPlanApprovalBroker_ListPending(t *testing.T) {
	broker := NewPlanApprovalBroker(PlanApprovalConfig{
		Enabled:            true,
		AutoApproveTimeout: 60 * time.Second,
	})

	plan1 := PendingPlan{RunID: "run_1", Tasks: []PlanTask{{ID: "t1", Agent: "codex", Description: "a"}}, Mode: "single"}
	plan2 := PendingPlan{RunID: "run_2", Tasks: []PlanTask{{ID: "t2", Agent: "codex", Description: "b"}}, Mode: "single"}

	_, ok1 := broker.SubmitPlan(context.Background(), plan1)
	_, ok2 := broker.SubmitPlan(context.Background(), plan2)
	if !ok1 || !ok2 {
		t.Fatal("expected both plans to be submitted")
	}

	pending := broker.ListPending()
	if len(pending) != 2 {
		t.Fatalf("expected 2 pending plans, got %d", len(pending))
	}

	// Approve one
	broker.Decide("run_1", PlanDecision{Approved: true})

	pending = broker.ListPending()
	if len(pending) != 1 {
		t.Fatalf("expected 1 pending plan after approve, got %d", len(pending))
	}
	if pending[0].RunID != "run_2" {
		t.Errorf("expected remaining plan to be run_2, got %s", pending[0].RunID)
	}
}

func TestPlanApprovalBroker_GetPending(t *testing.T) {
	broker := NewPlanApprovalBroker(PlanApprovalConfig{
		Enabled:            true,
		AutoApproveTimeout: 60 * time.Second,
	})

	plan := PendingPlan{
		RunID: "run_get_test",
		Tasks: []PlanTask{
			{ID: "t1", Agent: "codex", Description: "do stuff", DependsOn: []string{}},
		},
		Mode: "single",
	}

	broker.SubmitPlan(context.Background(), plan)

	found, ok := broker.GetPending("run_get_test")
	if !ok {
		t.Fatal("expected to find pending plan")
	}
	if found.RunID != "run_get_test" {
		t.Errorf("expected runID run_get_test, got %s", found.RunID)
	}
	if len(found.Tasks) != 1 {
		t.Errorf("expected 1 task, got %d", len(found.Tasks))
	}
}
