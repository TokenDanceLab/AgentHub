// Package runnerctx provides tests for RunProcessContext and SessionMetrics.
package runnerctx

import (
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

// --- RunProcessContext construction tests ---

func TestRunProcessContextDefaults(t *testing.T) {
	ctx := RunProcessContext{
		Run: store.Run{
			ID:        "run-1",
			ProjectID: "proj-1",
			ThreadID:  "thread-1",
			Status:    "running",
		},
		Prompt:  "Hello, world",
		AgentID: "claude-code",
		Model:   "claude-sonnet-4-6",
		WorkDir: "/tmp/work",
	}
	if ctx.Run.ID != "run-1" {
		t.Fatalf("Run.ID = %q, want run-1", ctx.Run.ID)
	}
	if ctx.Prompt != "Hello, world" {
		t.Fatalf("Prompt = %q, want Hello, world", ctx.Prompt)
	}
	if ctx.AgentID != "claude-code" {
		t.Fatalf("AgentID = %q, want claude-code", ctx.AgentID)
	}
	if ctx.Model != "claude-sonnet-4-6" {
		t.Fatalf("Model = %q, want claude-sonnet-4-6", ctx.Model)
	}
	if ctx.WorkDir != "/tmp/work" {
		t.Fatalf("WorkDir = %q, want /tmp/work", ctx.WorkDir)
	}
}

func TestRunProcessContextSessionFields(t *testing.T) {
	ctx := RunProcessContext{
		SessionID:    "sess-abc",
		ContinueLast: true,
		ForkSession:  true,
	}
	if ctx.SessionID != "sess-abc" {
		t.Fatalf("SessionID = %q, want sess-abc", ctx.SessionID)
	}
	if !ctx.ContinueLast {
		t.Fatal("ContinueLast should be true")
	}
	if !ctx.ForkSession {
		t.Fatal("ForkSession should be true")
	}
}

func TestRunProcessContextReasoningFields(t *testing.T) {
	ctx := RunProcessContext{
		ReasoningEffort:   "high",
		MaxThinkingTokens: 16000,
	}
	if ctx.ReasoningEffort != "high" {
		t.Fatalf("ReasoningEffort = %q, want high", ctx.ReasoningEffort)
	}
	if ctx.MaxThinkingTokens != 16000 {
		t.Fatalf("MaxThinkingTokens = %d, want 16000", ctx.MaxThinkingTokens)
	}
}

func TestRunProcessContextPermissionFields(t *testing.T) {
	ctx := RunProcessContext{
		PermissionMode: "acceptEdits",
		IncludePartial: true,
		FastMode:       true,
	}
	if ctx.PermissionMode != "acceptEdits" {
		t.Fatalf("PermissionMode = %q, want acceptEdits", ctx.PermissionMode)
	}
	if !ctx.IncludePartial {
		t.Fatal("IncludePartial should be true")
	}
	if !ctx.FastMode {
		t.Fatal("FastMode should be true")
	}
}

func TestRunProcessContextOpenCodeFields(t *testing.T) {
	ctx := RunProcessContext{
		AgentName: "build",
	}
	if ctx.AgentName != "build" {
		t.Fatalf("AgentName = %q, want build", ctx.AgentName)
	}
}

func TestRunProcessContextWithBudget(t *testing.T) {
	budget := NewContextBudget(100_000)
	ctx := RunProcessContext{
		Run: store.Run{
			ID:     "run-budget",
			Status: "running",
		},
		Budget: budget,
	}
	if ctx.Budget == nil {
		t.Fatal("Budget should not be nil")
	}
	if ctx.Budget.MaxTokens != 100_000 {
		t.Fatalf("Budget.MaxTokens = %d, want 100000", ctx.Budget.MaxTokens)
	}

	// Track enough tokens to exceed 85% threshold (76500 out of 90000 usable)
	ctx.Budget.Track(80000)
	if !ctx.Budget.ShouldCompact() {
		t.Fatal("ShouldCompact should be true after tracking 80k/90k usable (88.9%)")
	}
}

func TestRunProcessContextZeroValue(t *testing.T) {
	// Zero-value RunProcessContext should be usable
	var ctx RunProcessContext
	if ctx.Budget != nil {
		t.Fatal("Budget should be nil in zero-value context")
	}
	if ctx.Prompt != "" {
		t.Fatalf("Prompt should be empty in zero-value context, got %q", ctx.Prompt)
	}
}

// --- SessionMetrics tests ---

func TestSessionMetricsDefaults(t *testing.T) {
	sm := SessionMetrics{}
	if sm.Context.Total != 0 {
		t.Fatalf("Context.Total = %d, want 0", sm.Context.Total)
	}
	if sm.Cost.TotalCostUSD != 0 {
		t.Fatalf("Cost.TotalCostUSD = %f, want 0", sm.Cost.TotalCostUSD)
	}
}

func TestSessionMetricsContextFields(t *testing.T) {
	sm := SessionMetrics{
		Context: ContextMetrics{
			Total:      10000,
			Input:      7000,
			Output:     2500,
			Reasoning:  500,
			CacheRead:  3000,
			CacheWrite: 1000,
			Limit:      200000,
			Usage:      50.0,
		},
		Cost: CostMetrics{
			TotalCostUSD:  0.15,
			ModelLabel:    "claude-sonnet-4-6",
			ProviderLabel: "Anthropic",
		},
	}
	if sm.Context.Total != 10000 {
		t.Fatalf("Context.Total = %d, want 10000", sm.Context.Total)
	}
	if sm.Context.Input != 7000 {
		t.Fatalf("Context.Input = %d, want 7000", sm.Context.Input)
	}
	if sm.Context.Output != 2500 {
		t.Fatalf("Context.Output = %d, want 2500", sm.Context.Output)
	}
	if sm.Context.Reasoning != 500 {
		t.Fatalf("Context.Reasoning = %d, want 500", sm.Context.Reasoning)
	}
	if sm.Context.CacheRead != 3000 {
		t.Fatalf("Context.CacheRead = %d, want 3000", sm.Context.CacheRead)
	}
	if sm.Context.CacheWrite != 1000 {
		t.Fatalf("Context.CacheWrite = %d, want 1000", sm.Context.CacheWrite)
	}
	if sm.Context.Limit != 200000 {
		t.Fatalf("Context.Limit = %d, want 200000", sm.Context.Limit)
	}
	if sm.Context.Usage != 50.0 {
		t.Fatalf("Context.Usage = %f, want 50.0", sm.Context.Usage)
	}
	if sm.Cost.TotalCostUSD != 0.15 {
		t.Fatalf("Cost.TotalCostUSD = %f, want 0.15", sm.Cost.TotalCostUSD)
	}
	if sm.Cost.ModelLabel != "claude-sonnet-4-6" {
		t.Fatalf("Cost.ModelLabel = %q, want claude-sonnet-4-6", sm.Cost.ModelLabel)
	}
	if sm.Cost.ProviderLabel != "Anthropic" {
		t.Fatalf("Cost.ProviderLabel = %q, want Anthropic", sm.Cost.ProviderLabel)
	}
}

func TestSessionMetricsMessageFields(t *testing.T) {
	sm := SessionMetrics{}
	sm.Context.Message.ID = "msg-123"
	sm.Context.Message.Time = 1716566400
	if sm.Context.Message.ID != "msg-123" {
		t.Fatalf("Message.ID = %q, want msg-123", sm.Context.Message.ID)
	}
	if sm.Context.Message.Time != 1716566400 {
		t.Fatalf("Message.Time = %d, want 1716566400", sm.Context.Message.Time)
	}
}

// --- Budget edge cases ---

func TestUsagePercentUnusualUsable(t *testing.T) {
	// Custom budget with unusual numbers
	b := &ContextBudget{
		MaxTokens:      1000,
		ReservedTokens: 0,
	}
	if b.UsagePercent() != 0 {
		t.Fatalf("UsagePercent = %f, want 0 with no usage", b.UsagePercent())
	}
	b.Track(500)
	if b.UsagePercent() != 50.0 {
		t.Fatalf("UsagePercent = %f, want 50.0", b.UsagePercent())
	}
}

func TestShouldCompactVariousThresholds(t *testing.T) {
	tests := []struct {
		name       string
		maxTokens  int
		reserved   int64
		useTokens  int
		wantCompact bool
	}{
		{"below threshold", 100_000, 10_000, 70000, false},   // ~78%
		{"at threshold", 100_000, 10_000, 76500, true},       // 85%
		{"above threshold", 100_000, 10_000, 80000, true},    // ~89%
		{"exhausted", 100_000, 10_000, 90000, true},          // 100%
		{"zero used", 100_000, 10_000, 0, false},              // 0%
		{"barely below", 100_000, 10_000, 76499, false},      // ~84.998%
		{"small budget exhausted", 5000, 10_000, 0, true},    // usable <= 0
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := NewContextBudget(tt.maxTokens)
			b.ReservedTokens = tt.reserved
			b.Track(tt.useTokens)
			if got := b.ShouldCompact(); got != tt.wantCompact {
				t.Fatalf("ShouldCompact() = %v, want %v", got, tt.wantCompact)
			}
		})
	}
}

func TestUsagePercentVarious(t *testing.T) {
	tests := []struct {
		name      string
		maxTokens int
		reserved  int64
		useTokens int
		wantPct   float64
	}{
		{"zero", 100_000, 10_000, 0, 0.0},
		{"quarter", 100_000, 10_000, 22500, 25.0},
		{"half", 100_000, 10_000, 45000, 50.0},
		{"three quarters", 100_000, 10_000, 67500, 75.0},
		{"full", 100_000, 10_000, 90000, 100.0},
		{"over", 100_000, 10_000, 200000, 100.0},
		{"no reserved", 100_000, 0, 50000, 50.0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := NewContextBudget(tt.maxTokens)
			b.ReservedTokens = tt.reserved
			b.Track(tt.useTokens)
			if got := b.UsagePercent(); got != tt.wantPct {
				t.Fatalf("UsagePercent() = %f, want %f", got, tt.wantPct)
			}
		})
	}
}

func TestRemainingVarious(t *testing.T) {
	tests := []struct {
		name      string
		maxTokens int
		reserved  int64
		useTokens int
		wantRem   int64
	}{
		{"full left", 100_000, 10_000, 0, 90000},
		{"half used", 100_000, 10_000, 45000, 45000},
		{"exhausted", 100_000, 10_000, 90000, 0},
		{"over", 100_000, 10_000, 95000, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := NewContextBudget(tt.maxTokens)
			b.ReservedTokens = tt.reserved
			b.Track(tt.useTokens)
			if got := b.Remaining(); got != tt.wantRem {
				t.Fatalf("Remaining() = %d, want %d", got, tt.wantRem)
			}
		})
	}
}

func TestIsExhaustedVarious(t *testing.T) {
	tests := []struct {
		name         string
		maxTokens    int
		reserved     int64
		useTokens    int
		wantExhausted bool
	}{
		{"below", 100_000, 10_000, 89999, false},
		{"at limit", 100_000, 10_000, 90000, true},
		{"above", 100_000, 10_000, 90001, true},
		{"zero used", 100_000, 10_000, 0, false},
		{"small budget", 5000, 10_000, 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := NewContextBudget(tt.maxTokens)
			b.ReservedTokens = tt.reserved
			b.Track(tt.useTokens)
			if got := b.IsExhausted(); got != tt.wantExhausted {
				t.Fatalf("IsExhausted() = %v, want %v", got, tt.wantExhausted)
			}
		})
	}
}
