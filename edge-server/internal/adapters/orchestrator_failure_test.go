package adapters

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

// ── ClassifyFailure Tests ──────────────────────────────────────────────────

func TestClassifyFailure(t *testing.T) {
	tests := []struct {
		name         string
		err          error
		runErr       *RunError
		wantCategory FailureCategory
		wantReason   string
	}{
		{
			name:         "both nil defaults to transient",
			err:          nil,
			runErr:       nil,
			wantCategory: FailureTransient,
			wantReason:   "no error to classify — assuming transient",
		},
		{
			name:         "context.Canceled",
			err:          context.Canceled,
			runErr:       nil,
			wantCategory: FailureCancel,
			wantReason:   "context cancelled",
		},
		{
			name:         "context.DeadlineExceeded",
			err:          context.DeadlineExceeded,
			runErr:       nil,
			wantCategory: FailureTransient,
			wantReason:   "deadline or timeout detected",
		},
		{
			name:         "capability: permission denied",
			err:          errors.New("permission denied: cannot access /etc/shadow"),
			runErr:       nil,
			wantCategory: FailureCapability,
			wantReason:   "capability pattern matched: permission denied",
		},
		{
			name:         "capability: adapter unavailable",
			err:          errors.New("adapter unavailable for this task"),
			runErr:       nil,
			wantCategory: FailureCapability,
			wantReason:   "capability pattern matched: adapter unavailable",
		},
		{
			name:         "transient: connection refused",
			err:          errors.New("dial tcp 127.0.0.1:8080: connection refused"),
			runErr:       nil,
			wantCategory: FailureTransient,
			wantReason:   "transient pattern matched: connection refused",
		},
		{
			name:         "transient: rate limit",
			err:          errors.New("rate limit exceeded, try again later"),
			runErr:       nil,
			wantCategory: FailureTransient,
			wantReason:   "transient pattern matched: rate limit",
		},
		{
			name:         "cancel: invalid input",
			err:          errors.New("invalid input: depth exceeded"),
			runErr:       nil,
			wantCategory: FailureCancel,
			wantReason:   "cancel pattern matched: invalid input",
		},
		{
			name:         "cancel: slot full",
			err:          errors.New("agent slot full, cannot dispatch"),
			runErr:       nil,
			wantCategory: FailureCancel,
			wantReason:   "cancel pattern matched: slot full",
		},
		{
			name:         "unknown error defaults to transient",
			err:          errors.New("something completely unexpected happened"),
			runErr:       nil,
			wantCategory: FailureTransient,
			wantReason:   "default: assuming transient",
		},
		{
			name:         "RunError TIMEOUT code",
			err:          nil,
			runErr:       &RunError{Code: "TIMEOUT", Message: "request took too long"},
			wantCategory: FailureTransient,
			wantReason:   "run error code: TIMEOUT",
		},
		{
			name:         "RunError BINARY_NOT_FOUND code",
			err:          nil,
			runErr:       &RunError{Code: "BINARY_NOT_FOUND", Message: "python3 not found"},
			wantCategory: FailureCapability,
			wantReason:   "run error code: BINARY_NOT_FOUND",
		},
		{
			name:         "RunError PERMISSION_DENIED code",
			err:          nil,
			runErr:       &RunError{Code: "PERMISSION_DENIED", Message: "access denied"},
			wantCategory: FailureCapability,
			wantReason:   "run error code: PERMISSION_DENIED",
		},
		{
			name:         "RunError CANCELLED code",
			err:          nil,
			runErr:       &RunError{Code: "CANCELLED", Message: "cancelled by user"},
			wantCategory: FailureCancel,
			wantReason:   "run error code: CANCELLED",
		},
		{
			name:         "context cancel trumps transient patterns",
			err:          errors.New("context canceled after connection refused"),
			runErr:       nil,
			wantCategory: FailureCancel,
			wantReason:   "context cancelled",
		},
		{
			name:         "deadline trumps capability patterns",
			err:          errors.New("deadline exceeded: permission denied"),
			runErr:       nil,
			wantCategory: FailureTransient,
			wantReason:   "deadline or timeout detected",
		},
		{
			name:         "RunError code takes priority over pattern match for capable error",
			err:          errors.New("something went wrong"),
			runErr:       &RunError{Code: "PERMISSION_DENIED", Message: "denied"},
			wantCategory: FailureCapability,
			wantReason:   "run error code: PERMISSION_DENIED",
		},
		{
			name:         "merged error and runErr message",
			err:          errors.New("connection reset"),
			runErr:       &RunError{Code: "UNKNOWN_CODE", Message: "peer disconnected"},
			wantCategory: FailureTransient,
			wantReason:   "transient pattern matched: connection reset",
		},
		{
			name:         "case insensitive matching",
			err:          errors.New("Permission Denied"),
			runErr:       nil,
			wantCategory: FailureCapability,
			wantReason:   "capability pattern matched: permission denied",
		},
		{
			name:         "cancel pattern matched before capability",
			err:          errors.New("invalid input: permission denied"),
			runErr:       nil,
			wantCategory: FailureCancel,
			wantReason:   "cancel pattern matched: invalid input",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotCategory, gotReason := ClassifyFailure(tt.err, tt.runErr)
			if gotCategory != tt.wantCategory {
				t.Errorf("ClassifyFailure() category = %v, want %v", gotCategory, tt.wantCategory)
			}
			if gotReason != tt.wantReason {
				t.Errorf("ClassifyFailure() reason = %q, want %q", gotReason, tt.wantReason)
			}
		})
	}
}

// ── DecideRecovery Tests ──────────────────────────────────────────────────

func TestDecideRecovery(t *testing.T) {
	defaultPolicies := DefaultFailurePolicies()

	tests := []struct {
		name               string
		category           FailureCategory
		state              *RecoveryState
		policies           map[FailureCategory]FailurePolicy
		alternateAvailable bool
		wantDecision       FailureDecision
		wantRetryCount     int
	}{
		// ── Transient ──
		{
			name:               "transient with retries remaining",
			category:           FailureTransient,
			state:              &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			policies:           defaultPolicies,
			alternateAvailable: false,
			wantDecision:       DecisionRetry,
			wantRetryCount:     1,
		},
		{
			name:               "transient mid-retry",
			category:           FailureTransient,
			state:              &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 2},
			policies:           defaultPolicies,
			alternateAvailable: false,
			wantDecision:       DecisionRetry,
			wantRetryCount:     3,
		},
		{
			name:               "transient exhausted retries",
			category:           FailureTransient,
			state:              &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 3},
			policies:           defaultPolicies,
			alternateAvailable: false,
			wantDecision:       DecisionFail,
			wantRetryCount:     3,
		},
		{
			name:               "transient exceeds max retries",
			category:           FailureTransient,
			state:              &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 5},
			policies:           defaultPolicies,
			alternateAvailable: false,
			wantDecision:       DecisionFail,
			wantRetryCount:     5,
		},
		// ── Capability ──
		{
			name:               "capability with alternate available",
			category:           FailureCapability,
			state:              &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			policies:           defaultPolicies,
			alternateAvailable: true,
			wantDecision:       DecisionSwitchAgent,
			wantRetryCount:     0,
		},
		{
			name:               "capability with no alternate",
			category:           FailureCapability,
			state:              &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			policies:           defaultPolicies,
			alternateAvailable: false,
			wantDecision:       DecisionFail,
			wantRetryCount:     0,
		},
		// ── Cancel ──
		{
			name:               "cancel always skips",
			category:           FailureCancel,
			state:              &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			policies:           defaultPolicies,
			alternateAvailable: false,
			wantDecision:       DecisionSkip,
			wantRetryCount:     0,
		},
		{
			name:               "cancel always skips even with alternate",
			category:           FailureCancel,
			state:              &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			policies:           defaultPolicies,
			alternateAvailable: true,
			wantDecision:       DecisionSkip,
			wantRetryCount:     0,
		},
		// ── Unknown category (not in policies) ──
		{
			name:               "unknown category fails",
			category:           FailureCategory("unknown"),
			state:              &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			policies:           defaultPolicies,
			alternateAvailable: false,
			wantDecision:       DecisionFail,
			wantRetryCount:     0,
		},
		// ── Nil policies fallback ──
		{
			name:               "nil policies uses defaults (transient retry)",
			category:           FailureTransient,
			state:              &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			policies:           nil,
			alternateAvailable: false,
			wantDecision:       DecisionRetry,
			wantRetryCount:     1,
		},
		// ── State not mutated on skip/fail without retry ──
		{
			name:               "LastRetry updated on retry decision",
			category:           FailureTransient,
			state:              &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			policies:           defaultPolicies,
			alternateAvailable: false,
			wantDecision:       DecisionRetry,
			wantRetryCount:     1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotDecision, gotState := DecideRecovery(tt.category, tt.state, tt.policies, tt.alternateAvailable)
			if gotDecision != tt.wantDecision {
				t.Errorf("DecideRecovery() decision = %v, want %v", gotDecision, tt.wantDecision)
			}
			if gotState.RetryCount != tt.wantRetryCount {
				t.Errorf("DecideRecovery() retryCount = %d, want %d", gotState.RetryCount, tt.wantRetryCount)
			}
			if gotDecision == DecisionRetry && gotState.LastRetry.IsZero() {
				t.Error("DecideRecovery() LastRetry should be set when decision is Retry")
			}
			// Verify state is a copy, not a mutation of input.
			if gotState == tt.state && gotDecision != DecisionSkip && gotDecision != DecisionFail {
				t.Error("DecideRecovery() should return a new state copy, not the input pointer")
			}
		})
	}
}

// ── BackoffDuration Tests ─────────────────────────────────────────────────

func TestBackoffDuration(t *testing.T) {
	const (
		base    = 2 * time.Second
		maxWait = 30 * time.Second
	)

	tests := []struct {
		name       string
		base       time.Duration
		retryCount int
		want       time.Duration
	}{
		{
			name:       "first retry (retryCount=1) = base",
			base:       base,
			retryCount: 1,
			want:       base, // base * 2^0 = 2s
		},
		{
			name:       "second retry (retryCount=2) = base*2",
			base:       base,
			retryCount: 2,
			want:       4 * time.Second, // 2s * 2^1
		},
		{
			name:       "third retry (retryCount=3) = base*4",
			base:       base,
			retryCount: 3,
			want:       8 * time.Second, // 2s * 2^2
		},
		{
			name:       "retryCount=4 = base*8",
			base:       base,
			retryCount: 4,
			want:       16 * time.Second, // 2s * 2^3
		},
		{
			name:       "retryCount=5 hits cap (2*16=32 > 30)",
			base:       base,
			retryCount: 5,
			want:       maxWait, // 2s * 2^4 = 32s, capped to 30s
		},
		{
			name:       "large retry count capped at 30s",
			base:       base,
			retryCount: 10,
			want:       maxWait, // 2s * 2^9 = 1024s, capped
		},
		{
			name:       "zero base defaults to 1s",
			base:       0,
			retryCount: 1,
			want:       1 * time.Second,
		},
		{
			name:       "negative base defaults to 1s",
			base:       -1 * time.Second,
			retryCount: 1,
			want:       1 * time.Second,
		},
		{
			name:       "retryCount=0 gives base",
			base:       base,
			retryCount: 0,
			want:       2 * time.Second, // guard: retryCount <= 0 returns base unchanged
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := BackoffDuration(tt.base, tt.retryCount)
			// With true ±25% jitter, the result is in [want*0.75, want*1.25],
			// capped at maxWait. Allow ±1ms for floating point rounding.
			minWant := tt.want - tt.want/4 - 1*time.Millisecond
			maxWant := tt.want + tt.want/4 + 1*time.Millisecond
			if maxWant > maxWait {
				maxWant = maxWait
			}
			if got < minWant || got > maxWant {
				t.Errorf("BackoffDuration(%v, %d) = %v, want in [%v, %v]",
					tt.base, tt.retryCount, got, minWant, maxWant)
			}
		})
	}
}

func TestBackoffDurationMonotonic(t *testing.T) {
	// Verify backoff grows monotonically with retry count.
	base := 500 * time.Millisecond
	var prev time.Duration
	for i := 1; i <= 8; i++ {
		got := BackoffDuration(base, i)
		if i > 1 {
			if got < prev {
				t.Errorf("BackoffDuration not monotonic: retryCount=%d gave %v, previous was %v", i, got, prev)
			}
		}
		prev = got
	}
}

// ── DefaultFailurePolicies Tests ──────────────────────────────────────────

func TestDefaultFailurePolicies(t *testing.T) {
	policies := DefaultFailurePolicies()

	// Should have exactly 3 entries.
	if len(policies) != 3 {
		t.Fatalf("DefaultFailurePolicies() returned %d policies, want 3", len(policies))
	}

	// Transient policy.
	transient, ok := policies[FailureTransient]
	if !ok {
		t.Error("DefaultFailurePolicies() missing FailureTransient policy")
	} else {
		if transient.Category != FailureTransient {
			t.Errorf("transient policy category = %v, want %v", transient.Category, FailureTransient)
		}
		if transient.MaxRetries != 3 {
			t.Errorf("transient policy MaxRetries = %d, want 3", transient.MaxRetries)
		}
		if transient.BackoffBase != 1*time.Second {
			t.Errorf("transient policy BackoffBase = %v, want 1s", transient.BackoffBase)
		}
	}

	// Capability policy.
	capability, ok := policies[FailureCapability]
	if !ok {
		t.Error("DefaultFailurePolicies() missing FailureCapability policy")
	} else {
		if capability.Category != FailureCapability {
			t.Errorf("capability policy category = %v, want %v", capability.Category, FailureCapability)
		}
		if capability.MaxRetries != 0 {
			t.Errorf("capability policy MaxRetries = %d, want 0", capability.MaxRetries)
		}
	}

	// Cancel policy.
	cancel, ok := policies[FailureCancel]
	if !ok {
		t.Error("DefaultFailurePolicies() missing FailureCancel policy")
	} else {
		if cancel.Category != FailureCancel {
			t.Errorf("cancel policy category = %v, want %v", cancel.Category, FailureCancel)
		}
		if cancel.MaxRetries != 0 {
			t.Errorf("cancel policy MaxRetries = %d, want 0", cancel.MaxRetries)
		}
	}
}

// ── truncateError Tests ───────────────────────────────────────────────────

func TestTruncateError(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		maxLen int
		want   string
	}{
		{
			name:   "nil error returns empty string",
			err:    nil,
			maxLen: 10,
			want:   "",
		},
		{
			name:   "short message unchanged",
			err:    errors.New("short"),
			maxLen: 10,
			want:   "short",
		},
		{
			name:   "message exactly at limit unchanged",
			err:    errors.New("1234567890"),
			maxLen: 10,
			want:   "1234567890",
		},
		{
			name:   "long message truncated with ellipsis",
			err:    errors.New("this is a very long error message that should be truncated"),
			maxLen: 10,
			want:   "this is a ...",
		},
		{
			name:   "slightly over limit",
			err:    errors.New("1234567890x"),
			maxLen: 10,
			want:   "1234567890...",
		},
		{
			name:   "maxLen zero truncates everything",
			err:    errors.New("hello"),
			maxLen: 0,
			want:   "...",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := truncateError(tt.err, tt.maxLen)
			if got != tt.want {
				t.Errorf("truncateError(%v, %d) = %q, want %q", tt.err, tt.maxLen, got, tt.want)
			}
		})
	}
}

func TestTruncateErrorLength(t *testing.T) {
	// Verify truncateError never exceeds maxLen + 3 (ellipsis) for long messages.
	for maxLen := 0; maxLen <= 50; maxLen++ {
		longMsg := strings.Repeat("x", 200)
		err := errors.New(longMsg)
		got := truncateError(err, maxLen)
		maxExpected := maxLen + len("...")
		if len(got) > maxExpected {
			t.Errorf("truncateError with maxLen=%d returned %d bytes, want at most %d",
				maxLen, len(got), maxExpected)
		}
	}
}

// ── Integration-style: full classification + decision pipeline ────────────

func TestClassifyThenDecidePipeline(t *testing.T) {
	policies := DefaultFailurePolicies()

	tests := []struct {
		name         string
		err          error
		state        *RecoveryState
		wantDecision FailureDecision
	}{
		{
			name:         "context cancelled leads to skip",
			err:          context.Canceled,
			state:        &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			wantDecision: DecisionSkip,
		},
		{
			name:         "deadline exceeded leads to retry",
			err:          context.DeadlineExceeded,
			state:        &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			wantDecision: DecisionRetry,
		},
		{
			name:         "permission denied with alternate leads to switch",
			err:          errors.New("permission denied"),
			state:        &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			wantDecision: DecisionSwitchAgent,
		},
		{
			name:         "permission denied without alternate leads to fail",
			err:          errors.New("permission denied"),
			state:        &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			wantDecision: DecisionFail,
		},
		{
			name:         "connection refused with retries left leads to retry",
			err:          errors.New("connection refused"),
			state:        &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			wantDecision: DecisionRetry,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			category, _ := ClassifyFailure(tt.err, nil)
			// Decide: if test expects switch, pass alternate=true.
			alternate := tt.wantDecision == DecisionSwitchAgent
			gotDecision, _ := DecideRecovery(category, tt.state, policies, alternate)
			if gotDecision != tt.wantDecision {
				t.Errorf("pipeline: err=%v → category=%v → decision=%v, want %v",
					tt.err, category, gotDecision, tt.wantDecision)
			}
		})
	}
}

// ── Benchmark ──────────────────────────────────────────────────────────────

func BenchmarkClassifyFailure(b *testing.B) {
	err := errors.New("dial tcp 127.0.0.1:8080: connection refused")
	for b.Loop() {
		ClassifyFailure(err, nil)
	}
}

func BenchmarkDecideRecovery(b *testing.B) {
	policies := DefaultFailurePolicies()
	state := &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 1}
	for b.Loop() {
		DecideRecovery(FailureTransient, state, policies, false)
	}
}

func BenchmarkBackoffDuration(b *testing.B) {
	for b.Loop() {
		BackoffDuration(1*time.Second, 3)
	}
}

// ── BuildReflexionCritique Tests (T2-A09) ─────────────────────────────────────

func TestBuildReflexionCritique(t *testing.T) {
	tests := []struct {
		name      string
		agentName string
		taskID    string
		category  FailureCategory
		reason    string
		err       error
		wantSubs  []string // substrings that must appear in the critique
	}{
		{
			name:      "normal transient failure",
			agentName: "code-reviewer",
			taskID:    "task_abc123",
			category:  FailureTransient,
			reason:    "deadline or timeout detected",
			err:       errors.New("context deadline exceeded"),
			wantSubs: []string{
				"Previous attempt failed",
				"agent=code-reviewer",
				"category=transient",
				"reason=deadline or timeout detected",
				"error=context deadline exceeded",
				"Analyze why",
				"propose a different strategy",
			},
		},
		{
			name:      "capability failure with permission error",
			agentName: "builder",
			taskID:    "task_def456",
			category:  FailureCapability,
			reason:    "capability pattern matched: permission denied",
			err:       errors.New("permission denied: cannot write to /etc/config"),
			wantSubs: []string{
				"Previous attempt failed",
				"agent=builder",
				"category=capability",
				"reason=capability pattern matched: permission denied",
				"error=permission denied: cannot write to /etc/config",
			},
		},
		{
			name:      "cancel category",
			agentName: "researcher",
			taskID:    "task_ghi789",
			category:  FailureCancel,
			reason:    "context cancelled",
			err:       context.Canceled,
			wantSubs: []string{
				"Previous attempt failed",
				"agent=researcher",
				"category=cancel",
				"reason=context cancelled",
				"error=context canceled",
			},
		},
		{
			name:      "nil error (T2-A09 edge case)",
			agentName: "tester",
			taskID:    "task_nil_err",
			category:  FailureTransient,
			reason:    "no error to classify",
			err:       nil,
			wantSubs: []string{
				"Previous attempt failed",
				"agent=tester",
				"error=", // empty error message, but the field is still present
			},
		},
		{
			name:      "empty agentName (T2-A09 edge case)",
			agentName: "",
			taskID:    "task_empty_agent",
			category:  FailureCancel,
			reason:    "slot full",
			err:       errors.New("agent slot full"),
			wantSubs: []string{
				"Previous attempt failed",
				"agent=",
				"category=cancel",
				"reason=slot full",
				"error=agent slot full",
			},
		},
		{
			name:      "error message with newlines sanitized",
			agentName: "worker",
			taskID:    "task_nl",
			category:  FailureTransient,
			reason:    "transient pattern matched",
			err:       errors.New("connection refused\nretry later\r\n\tbackoff"),
			wantSubs: []string{
				"error=connection refused retry later", // newlines collapsed to spaces
				"backoff",                              // trailing part still present
			},
		},
		{
			name:      "long error message truncated to 200 chars",
			agentName: "agent-long",
			taskID:    "task_long",
			category:  FailureTransient,
			reason:    "transient pattern matched: timeout",
			err:       fmt.Errorf("%s", strings.Repeat("x", 500)),
			wantSubs: []string{
				"Previous attempt failed",
				"agent=agent-long",
				// Error should be truncated to 200 chars + "..."
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := BuildReflexionCritique(tt.agentName, tt.taskID, tt.category, tt.reason, tt.err)
			for _, want := range tt.wantSubs {
				if !strings.Contains(got, want) {
					t.Errorf("BuildReflexionCritique() output missing substring %q\nGot: %s", want, got)
				}
			}
		})
	}
}

func TestBuildReflexionCritique_FormatStructure(t *testing.T) {
	// Verify the critique follows the expected structural pattern:
	// [Previous attempt failed: agent=X category=Y reason=Z error=E].
	// Analyze why... What should be done differently...
	got := BuildReflexionCritique(
		"code-reviewer",
		"task_001",
		FailureTransient,
		"timeout",
		errors.New("connection refused"),
	)

	// Must start with the structured failure recap.
	if !strings.HasPrefix(got, "[Previous attempt failed:") {
		t.Errorf("critique should start with '[Previous attempt failed:', got: %s", got)
	}

	// Must contain the Reflexion pattern elements (Shinn et al., 2023).
	if !strings.Contains(got, "Analyze why") {
		t.Error("critique should contain 'Analyze why' (Reflexion pattern)")
	}
	if !strings.Contains(got, "What should be done differently") {
		t.Error("critique should contain 'What should be done differently' (Reflexion pattern)")
	}

	// Must end with a question mark (it's a prompt asking for analysis).
	if !strings.HasSuffix(got, "?") {
		t.Errorf("critique should end with '?', got: %s", got)
	}
}

// ── Rule Engine: isFinishDispatch Tests (T2-A08) ─────────────────────────────

func TestIsFinishDispatch(t *testing.T) {
	tests := []struct {
		name string
		evt  dispatchEvent
		want bool
	}{
		{
			name: "empty task (T2-A08: no sub-task work)",
			evt: dispatchEvent{
				Action: "dispatch",
				Agent:  "reviewer",
				Task:   "",
			},
			want: true,
		},
		{
			name: "task: done",
			evt: dispatchEvent{
				Action: "dispatch",
				Agent:  "reviewer",
				Task:   "done",
			},
			want: true,
		},
		{
			name: "task: finish",
			evt: dispatchEvent{
				Action: "dispatch",
				Agent:  "reviewer",
				Task:   "finish",
			},
			want: true,
		},
		{
			name: "task: complete",
			evt: dispatchEvent{
				Action: "dispatch",
				Agent:  "reviewer",
				Task:   "complete",
			},
			want: true,
		},
		{
			name: "task: finished",
			evt: dispatchEvent{
				Action: "dispatch",
				Agent:  "reviewer",
				Task:   "finished",
			},
			want: true,
		},
		{
			name: "task: completed",
			evt: dispatchEvent{
				Action: "dispatch",
				Agent:  "reviewer",
				Task:   "completed",
			},
			want: true,
		},
		{
			name: "task: all done",
			evt: dispatchEvent{
				Action: "dispatch",
				Agent:  "reviewer",
				Task:   "all done",
			},
			want: true,
		},
		{
			name: "task: all tasks done",
			evt: dispatchEvent{
				Action: "dispatch",
				Agent:  "reviewer",
				Task:   "all tasks done",
			},
			want: true,
		},
		{
			name: "actual sub-task (not a finish signal)",
			evt: dispatchEvent{
				Action: "dispatch",
				Agent:  "reviewer",
				Task:   "review the codebase for security issues",
			},
			want: false,
		},
		{
			name: "actual sub-task containing word 'finish' in sentence",
			evt: dispatchEvent{
				Action: "dispatch",
				Agent:  "builder",
				Task:   "finish implementing the login module",
			},
			want: false, // only exact match recognized
		},
		{
			name: "whitespace-only task with done keyword",
			evt: dispatchEvent{
				Action: "dispatch",
				Agent:  "reviewer",
				Task:   "  done  ",
			},
			want: true,
		},
		{
			name: "case insensitive: DONE",
			evt: dispatchEvent{
				Action: "dispatch",
				Agent:  "reviewer",
				Task:   "DONE",
			},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isFinishDispatch(tt.evt)
			if got != tt.want {
				t.Errorf("isFinishDispatch(%+v) = %v, want %v", tt.evt, got, tt.want)
			}
		})
	}
}

// ── Rule Engine: matchCompletion Tests (T2-A08) ──────────────────────────────

func TestMatchCompletion(t *testing.T) {
	tests := []struct {
		name string
		text string
		want bool
	}{
		// Multi-word phrases — match at any position in any-length text.
		{
			name: "all tasks done (multi-word)",
			text: "all tasks done",
			want: true,
		},
		{
			name: "all done (multi-word)",
			text: "all done",
			want: true,
		},
		{
			name: "all tasks complete (multi-word)",
			text: "all tasks complete",
			want: true,
		},
		{
			name: "all sub-agent tasks have completed (multi-word long)",
			text: "all sub-agent tasks have completed",
			want: true,
		},
		{
			name: "multi-word embedded in longer text",
			text: "The orchestrator reports: all tasks done, proceeding to summary.",
			want: true,
		},
		// Single-word signals — only match on short text (<= 80 chars).
		{
			name: "done (single word, short)",
			text: "done",
			want: true,
		},
		{
			name: "finish (single word, short)",
			text: "finish",
			want: true,
		},
		{
			name: "complete (single word, short)",
			text: "complete",
			want: true,
		},
		{
			name: "completed (single word, short)",
			text: "completed",
			want: true,
		},
		{
			name: "done. with period (short)",
			text: "done.",
			want: true,
		},
		{
			name: "finish! with exclamation (short)",
			text: "finish!",
			want: true,
		},
		// Single-word signals should NOT match in longer text (> 80 chars).
		{
			name: "done embedded in long text (T2-A08: false positive prevention)",
			text: "done. Now we should also check the edge cases and run additional verification steps on all files.",
			want: false, // "done." prefix but remainder is NOT whitespace-only
		},
		{
			name: "finish in long text",
			text: "finish the main implementation and then review all modules for correctness and performance.",
			want: false,
		},
		// Non-completion text.
		{
			name: "normal dispatch text",
			text: `{"action":"dispatch","agent":"builder","task":"build the module"}`,
			want: false,
		},
		{
			name: "empty string",
			text: "",
			want: false,
		},
		{
			name: "code block with 'done' variable",
			text: "let isDone = false; // check status",
			want: false, // too long (>80 chars? no, it's short) but "isDone" != "done"
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			textLower := strings.ToLower(tt.text)
			got := matchCompletion(textLower)
			if got != tt.want {
				t.Errorf("matchCompletion(%q) = %v, want %v", tt.text, got, tt.want)
			}
		})
	}
}

func BenchmarkTruncateError(b *testing.B) {
	msg := strings.Repeat("x", 1000)
	err := fmt.Errorf("%s", msg)
	for b.Loop() {
		truncateError(err, 500)
	}
}

// ── MaxRetryDepth Hard Cap Tests ──────────────────────────────────────────

// TestDecideRecovery_MaxRetryDepth verifies that the hard MaxRetryAttempts=3 cap
// overrides all category-specific policies. Even if a policy allows more retries
// (e.g. MaxRetries=100 for transient), the cap fires at RetryCount >= 3 and
// forces DecisionFail. This gate is non-configurable and fires before any
// category-specific logic.
func TestDecideRecovery_MaxRetryDepth(t *testing.T) {
	defaultPolicies := DefaultFailurePolicies()

	// Policy with inflated MaxRetries to prove the hard cap overrides it.
	permissivePolicies := map[FailureCategory]FailurePolicy{
		FailureTransient: {
			Category:    FailureTransient,
			MaxRetries:  100,
			BackoffBase: 1 * time.Second,
		},
		FailureCapability: {
			Category:   FailureCapability,
			MaxRetries: 0,
		},
		FailureCancel: {
			Category:   FailureCancel,
			MaxRetries: 0,
		},
	}

	tests := []struct {
		name               string
		category           FailureCategory
		retryCount         int
		policies           map[FailureCategory]FailurePolicy
		alternateAvailable bool
		wantDecision       FailureDecision
		wantRetryCount     int
	}{
		// ── Exact boundary: RetryCount=3 (equals MaxRetryAttempts) ──
		{
			name:               "RetryCount=3 transient with permissive policy → hard cap fail",
			category:           FailureTransient,
			retryCount:         3,
			policies:           permissivePolicies,
			alternateAvailable: false,
			wantDecision:       DecisionFail,
			wantRetryCount:     3, // not incremented; hard cap returns before increment
		},
		{
			name:               "RetryCount=3 transient with default policy → hard cap fail",
			category:           FailureTransient,
			retryCount:         3,
			policies:           defaultPolicies,
			alternateAvailable: false,
			wantDecision:       DecisionFail,
			wantRetryCount:     3,
		},
		{
			name:               "RetryCount=3 capability with alternate → hard cap fail (not switch)",
			category:           FailureCapability,
			retryCount:         3,
			policies:           defaultPolicies,
			alternateAvailable: true,
			wantDecision:       DecisionFail,
			wantRetryCount:     3,
		},
		{
			name:               "RetryCount=3 cancel → hard cap fail (not skip)",
			category:           FailureCancel,
			retryCount:         3,
			policies:           defaultPolicies,
			alternateAvailable: false,
			wantDecision:       DecisionFail,
			wantRetryCount:     3,
		},
		// ── Above boundary: RetryCount > MaxRetryAttempts ──
		{
			name:               "RetryCount=5 transient with permissive policy → hard cap fail",
			category:           FailureTransient,
			retryCount:         5,
			policies:           permissivePolicies,
			alternateAvailable: false,
			wantDecision:       DecisionFail,
			wantRetryCount:     5,
		},
		{
			name:               "RetryCount=100 transient → hard cap fail",
			category:           FailureTransient,
			retryCount:         100,
			policies:           permissivePolicies,
			alternateAvailable: false,
			wantDecision:       DecisionFail,
			wantRetryCount:     100,
		},
		// ── Below boundary: normal logic still works ──
		{
			name:               "RetryCount=2 transient → still retries (boundary-1)",
			category:           FailureTransient,
			retryCount:         2,
			policies:           defaultPolicies,
			alternateAvailable: false,
			wantDecision:       DecisionRetry,
			wantRetryCount:     3, // incremented from 2
		},
		{
			name:               "RetryCount=0 transient → normal retry",
			category:           FailureTransient,
			retryCount:         0,
			policies:           defaultPolicies,
			alternateAvailable: false,
			wantDecision:       DecisionRetry,
			wantRetryCount:     1,
		},
		{
			name:               "RetryCount=2 capability with alternate → switch still works",
			category:           FailureCapability,
			retryCount:         2,
			policies:           defaultPolicies,
			alternateAvailable: true,
			wantDecision:       DecisionSwitchAgent,
			wantRetryCount:     2,
		},
		{
			name:               "RetryCount=2 cancel → skip still works",
			category:           FailureCancel,
			retryCount:         2,
			policies:           defaultPolicies,
			alternateAvailable: false,
			wantDecision:       DecisionSkip,
			wantRetryCount:     2,
		},
		// ── Nil policies: hard cap still applies ──
		{
			name:               "RetryCount=3 nil policies → hard cap fail",
			category:           FailureTransient,
			retryCount:         3,
			policies:           nil,
			alternateAvailable: false,
			wantDecision:       DecisionFail,
			wantRetryCount:     3,
		},
		// ── Unknown category: hard cap fires before category lookup ──
		{
			name:               "RetryCount=3 unknown category → hard cap fail",
			category:           FailureCategory("bogus"),
			retryCount:         3,
			policies:           defaultPolicies,
			alternateAvailable: false,
			wantDecision:       DecisionFail,
			wantRetryCount:     3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			state := &RecoveryState{
				AgentID:    "a1",
				TaskID:     "t1",
				RetryCount: tt.retryCount,
			}
			gotDecision, gotState := DecideRecovery(tt.category, state, tt.policies, tt.alternateAvailable)
			if gotDecision != tt.wantDecision {
				t.Errorf("DecideRecovery() decision = %v, want %v (retryCount=%d, category=%v)",
					gotDecision, tt.wantDecision, tt.retryCount, tt.category)
			}
			if gotState.RetryCount != tt.wantRetryCount {
				t.Errorf("DecideRecovery() retryCount = %d, want %d",
					gotState.RetryCount, tt.wantRetryCount)
			}
			// For hard-cap decisions, LastRetry should NOT be updated.
			if gotDecision == DecisionFail && tt.retryCount >= MaxRetryDepth && !gotState.LastRetry.IsZero() {
				t.Error("DecideRecovery() under hard cap should not update LastRetry")
			}
		})
	}
}

// ── Circuit Breaker Tests ───────────────────────────────────────────────────

// TestCircuitBreaker_OpensAfterThreshold verifies the circuit breaker trips from
// Closed to Open after consecutive failures reach the configured threshold
// within the failure window. It also tests that failures outside the window
// do not accumulate, and that custom thresholds are respected.
func TestCircuitBreaker_OpensAfterThreshold(t *testing.T) {
	t.Run("trips after default threshold (5)", func(t *testing.T) {
		cb := newAgentCircuitBreaker(0, 0, 0) // use defaults: threshold=5, window=60s, cooldown=30s

		// Initial state is Closed.
		if cb.State() != CircuitClosed {
			t.Fatalf("initial state = %v, want %v", cb.State(), CircuitClosed)
		}

		// First 4 failures: still Closed, Allow() returns nil.
		for i := 0; i < 4; i++ {
			if err := cb.Allow(); err != nil {
				t.Fatalf("Allow() before threshold: unexpected error at failure %d: %v", i, err)
			}
			cb.RecordFailure()
			if cb.State() != CircuitClosed {
				t.Fatalf("state after %d failures = %v, want %v (threshold not yet reached)", i+1, cb.State(), CircuitClosed)
			}
		}

		// 5th failure trips to Open.
		if err := cb.Allow(); err != nil {
			t.Fatalf("Allow() at 5th attempt: unexpected error: %v", err)
		}
		cb.RecordFailure()
		if cb.State() != CircuitOpen {
			t.Errorf("state after 5 failures = %v, want %v", cb.State(), CircuitOpen)
		}

		// Allow() in Open state returns error.
		if err := cb.Allow(); err == nil {
			t.Error("Allow() in Open state should return error")
		}

		// RecordFailure in Open state extends cooldown but stays Open.
		cb.RecordFailure()
		if cb.State() != CircuitOpen {
			t.Errorf("state after failure in Open = %v, want %v", cb.State(), CircuitOpen)
		}
	})

	t.Run("trips after custom threshold (2)", func(t *testing.T) {
		cb := newAgentCircuitBreaker(2, 60*time.Second, 30*time.Second)

		// #1550: fake clock — advance time deterministically instead of sleeping.
		fakeNow := time.Now()
		cb.now = func() time.Time { return fakeNow }
		// First failure.
		if err := cb.Allow(); err != nil {
			t.Fatalf("Allow() before threshold: %v", err)
		}
		cb.RecordFailure()
		if cb.State() != CircuitClosed {
			t.Errorf("state after 1 failure = %v, want %v", cb.State(), CircuitClosed)
		}

		// Second failure trips to Open.
		if err := cb.Allow(); err != nil {
			t.Fatalf("Allow() at 2nd attempt: %v", err)
		}
		cb.RecordFailure()
		if cb.State() != CircuitOpen {
			t.Errorf("state after 2 failures = %v, want %v", cb.State(), CircuitOpen)
		}
	})

	t.Run("failure window expiry resets counter", func(t *testing.T) {
		// Short window so we can test expiry without real waits.
		cb := newAgentCircuitBreaker(5, 10*time.Millisecond, 30*time.Second)

		// #1550: fake clock — advance time deterministically instead of sleeping.
		fakeNow := time.Now()
		cb.now = func() time.Time { return fakeNow }
		// Accumulate 3 failures within the window.
		for i := 0; i < 3; i++ {
			_ = cb.Allow()
			cb.RecordFailure()
		}

		// Circuit breaker tests use intentionally short windows/cooldowns
		// (10ms). Sleep durations must exceed the configured interval to
		// observe state transitions. Uses monotonic clock — not flaky.

		// Wait for the window to expire.
		fakeNow = fakeNow.Add(16 * time.Millisecond) // exceed 10ms failure window; 30s cooldown is not active (#1550)

		// Next failure resets window, counter starts fresh at 1.
		_ = cb.Allow()
		cb.RecordFailure()
		if cb.State() != CircuitClosed {
			t.Errorf("state after window expiry + 1 new failure = %v, want %v", cb.State(), CircuitClosed)
		}
	})

	t.Run("zero failure threshold uses default", func(t *testing.T) {
		cb := newAgentCircuitBreaker(0, 0, 0)

		// #1550: fake clock — advance time deterministically instead of sleeping.
		fakeNow := time.Now()
		cb.now = func() time.Time { return fakeNow } // Default threshold is 5.
		for i := 0; i < 4; i++ {
			_ = cb.Allow()
			cb.RecordFailure()
		}
		if cb.State() != CircuitClosed {
			t.Error("state after 4 failures with default threshold should still be Closed")
		}
		_ = cb.Allow()
		cb.RecordFailure()
		if cb.State() != CircuitOpen {
			t.Error("state after 5 failures with default threshold should be Open")
		}
	})

	t.Run("Allow in Open state blocks all requests during cooldown", func(t *testing.T) {
		cb := newAgentCircuitBreaker(1, 60*time.Second, 1*time.Hour) // long cooldown

		// Trip immediately (threshold=1).
		_ = cb.Allow()
		cb.RecordFailure()
		if cb.State() != CircuitOpen {
			t.Fatal("expected Open after tripping")
		}

		// Multiple Allow() calls should all return errors.
		for i := 0; i < 10; i++ {
			if err := cb.Allow(); err == nil {
				t.Errorf("Allow() call %d in Open state should return error", i)
			}
		}
		if cb.State() != CircuitOpen {
			t.Error("state should remain Open after blocked Allow() calls")
		}
	})
}

// TestCircuitBreaker_HalfOpenTransition verifies the Open → HalfOpen → Open
// transition cycle. After the cooldown period elapses, Allow() transitions to
// HalfOpen and permits exactly one trial probe. If the probe fails, the breaker
// returns to Open. While a probe is in flight, additional Allow() calls are
// rejected.
func TestCircuitBreaker_HalfOpenTransition(t *testing.T) {
	t.Run("cooldown elapsed transitions to half-open", func(t *testing.T) {
		cb := newAgentCircuitBreaker(1, 60*time.Second, 10*time.Millisecond)

		// #1550: fake clock — advance time deterministically instead of sleeping.
		fakeNow := time.Now()
		cb.now = func() time.Time { return fakeNow }
		// Trip to Open.
		_ = cb.Allow()
		cb.RecordFailure()
		if cb.State() != CircuitOpen {
			t.Fatal("expected Open after tripping")
		}

		// Wait for cooldown.
		fakeNow = fakeNow.Add(16 * time.Millisecond) // exceed 10ms cooldown while within 60s failure window (#1550)

		// Allow() transitions to HalfOpen and returns nil.
		if err := cb.Allow(); err != nil {
			t.Fatalf("Allow() after cooldown: unexpected error: %v", err)
		}
		if cb.State() != CircuitHalfOpen {
			t.Errorf("state after cooldown Allow() = %v, want %v", cb.State(), CircuitHalfOpen)
		}
	})

	t.Run("half-open probe already in flight rejects additional requests", func(t *testing.T) {
		cb := newAgentCircuitBreaker(1, 60*time.Second, 10*time.Millisecond)

		// #1550: fake clock — advance time deterministically instead of sleeping.
		fakeNow := time.Now()
		cb.now = func() time.Time { return fakeNow }
		// Trip to Open.
		_ = cb.Allow()
		cb.RecordFailure()

		// Wait for cooldown.
		fakeNow = fakeNow.Add(16 * time.Millisecond) // exceed 10ms cooldown while within 60s failure window (#1550)

		// First Allow() enters HalfOpen.
		if err := cb.Allow(); err != nil {
			t.Fatalf("first Allow() after cooldown: %v", err)
		}
		if cb.State() != CircuitHalfOpen {
			t.Fatal("expected HalfOpen after first Allow()")
		}

		// Second Allow() is rejected because probe is in flight.
		if err := cb.Allow(); err == nil {
			t.Error("second Allow() should be rejected (probe already in flight)")
		}
	})

	t.Run("half-open probe failure returns to open", func(t *testing.T) {
		cb := newAgentCircuitBreaker(1, 60*time.Second, 10*time.Millisecond)

		// #1550: fake clock — advance time deterministically instead of sleeping.
		fakeNow := time.Now()
		cb.now = func() time.Time { return fakeNow }
		// Trip to Open.
		_ = cb.Allow()
		cb.RecordFailure()

		// Wait for cooldown.
		fakeNow = fakeNow.Add(16 * time.Millisecond) // exceed 10ms cooldown while within 60s failure window (#1550)

		// Enter HalfOpen.
		_ = cb.Allow()
		if cb.State() != CircuitHalfOpen {
			t.Fatal("expected HalfOpen")
		}

		// Probe fails.
		cb.RecordFailure()
		if cb.State() != CircuitOpen {
			t.Errorf("state after HalfOpen probe failure = %v, want %v", cb.State(), CircuitOpen)
		}

		// Allow() in Open state returns error.
		if err := cb.Allow(); err == nil {
			t.Error("Allow() after returning to Open should return error")
		}
	})

	t.Run("half-open probe failure extends cooldown", func(t *testing.T) {
		cb := newAgentCircuitBreaker(1, 60*time.Second, 10*time.Millisecond)

		// #1550: fake clock — advance time deterministically instead of sleeping.
		fakeNow := time.Now()
		cb.now = func() time.Time { return fakeNow }
		// Trip to Open.
		_ = cb.Allow()
		cb.RecordFailure()

		// Wait for cooldown, enter HalfOpen, fail the probe.
		fakeNow = fakeNow.Add(16 * time.Millisecond) // exceed 10ms cooldown while within 60s failure window (#1550)
		_ = cb.Allow()
		cb.RecordFailure()

		// Should be back in Open.
		if cb.State() != CircuitOpen {
			t.Fatal("expected Open after probe failure")
		}

		// Wait for the original cooldown — should still be in Open
		// because the probe failure sets a new cooldown.
		fakeNow = fakeNow.Add(16 * time.Millisecond) // exceed 10ms cooldown while within 60s failure window (#1550)
		if cb.State() != CircuitOpen {
			t.Error("should still be Open after probe failure (cooldown was extended)")
		}

		// Wait the rest of the new cooldown.
		fakeNow = fakeNow.Add(16 * time.Millisecond) // exceed 10ms cooldown while within 60s failure window (#1550)
		if err := cb.Allow(); err != nil {
			t.Errorf("Allow() after new cooldown should succeed, got: %v", err)
		}
		if cb.State() != CircuitHalfOpen {
			t.Errorf("state after new cooldown = %v, want %v", cb.State(), CircuitHalfOpen)
		}
	})

	t.Run("full cycle: closed → open → half-open → open → half-open", func(t *testing.T) {
		cb := newAgentCircuitBreaker(2, 60*time.Second, 10*time.Millisecond)

		// #1550: fake clock — advance time deterministically instead of sleeping.
		fakeNow := time.Now()
		cb.now = func() time.Time { return fakeNow }
		// Closed: accumulate and trip.
		for i := 0; i < 2; i++ {
			_ = cb.Allow()
			cb.RecordFailure()
		}
		if cb.State() != CircuitOpen {
			t.Fatal("expected Open")
		}

		// Wait cooldown, enter HalfOpen.
		fakeNow = fakeNow.Add(16 * time.Millisecond) // exceed 10ms cooldown while within 60s failure window (#1550)
		_ = cb.Allow()
		if cb.State() != CircuitHalfOpen {
			t.Fatal("expected HalfOpen")
		}

		// Probe fails, back to Open.
		cb.RecordFailure()
		if cb.State() != CircuitOpen {
			t.Fatal("expected Open after probe failure")
		}

		// Wait cooldown again, enter HalfOpen again.
		fakeNow = fakeNow.Add(16 * time.Millisecond) // exceed 10ms cooldown while within 60s failure window (#1550)
		_ = cb.Allow()
		if cb.State() != CircuitHalfOpen {
			t.Fatal("expected HalfOpen on second probe")
		}
	})
}

// TestCircuitBreaker_ResetsOnSuccess verifies that RecordSuccess correctly
// resets the circuit breaker state:
//   - In HalfOpen state, a successful probe closes the circuit.
//   - In Closed state, success resets the consecutive failure counter.
//   - In Open state (unexpected), a force-reset to Closed occurs.
func TestCircuitBreaker_ResetsOnSuccess(t *testing.T) {
	t.Run("half-open probe success closes circuit", func(t *testing.T) {
		cb := newAgentCircuitBreaker(1, 60*time.Second, 10*time.Millisecond)

		// #1550: fake clock — advance time deterministically instead of sleeping.
		fakeNow := time.Now()
		cb.now = func() time.Time { return fakeNow }
		// Trip to Open.
		_ = cb.Allow()
		cb.RecordFailure()

		// Wait cooldown, enter HalfOpen.
		fakeNow = fakeNow.Add(16 * time.Millisecond) // exceed 10ms cooldown while within 60s failure window (#1550)
		_ = cb.Allow()
		if cb.State() != CircuitHalfOpen {
			t.Fatal("expected HalfOpen")
		}

		// Probe succeeds: circuit closes.
		cb.RecordSuccess()
		if cb.State() != CircuitClosed {
			t.Errorf("state after success = %v, want %v", cb.State(), CircuitClosed)
		}

		// After closing, Allow() should work normally.
		if err := cb.Allow(); err != nil {
			t.Errorf("Allow() after successful close: unexpected error: %v", err)
		}
	})

	t.Run("closed state success resets failure counter", func(t *testing.T) {
		cb := newAgentCircuitBreaker(3, 60*time.Second, 30*time.Second)

		// #1550: fake clock — advance time deterministically instead of sleeping.
		fakeNow := time.Now()
		cb.now = func() time.Time { return fakeNow }
		// Accumulate 2 failures (1 below threshold).
		for i := 0; i < 2; i++ {
			_ = cb.Allow()
			cb.RecordFailure()
		}

		// Success resets counter.
		cb.RecordSuccess()
		if cb.State() != CircuitClosed {
			t.Error("state should remain Closed after success")
		}

		// Accumulate 3 failures from scratch — should trip at 3, not at 1.
		for i := 0; i < 2; i++ {
			_ = cb.Allow()
			cb.RecordFailure()
		}
		if cb.State() != CircuitClosed {
			t.Error("should still be Closed after 2 failures (counter was reset)")
		}
		_ = cb.Allow()
		cb.RecordFailure()
		if cb.State() != CircuitOpen {
			t.Error("should trip to Open on 3rd failure after reset")
		}
	})

	t.Run("closed state success after partial failures keeps circuit healthy", func(t *testing.T) {
		cb := newAgentCircuitBreaker(5, 60*time.Second, 30*time.Second)

		// #1550: fake clock — advance time deterministically instead of sleeping.
		fakeNow := time.Now()
		cb.now = func() time.Time { return fakeNow }
		// Interleave failures and successes: failures never accumulate.
		for i := 0; i < 10; i++ {
			_ = cb.Allow()
			cb.RecordFailure()
			cb.RecordSuccess() // reset after each failure
		}
		if cb.State() != CircuitClosed {
			t.Error("interleaved success should prevent tripping")
		}
	})

	t.Run("open state unexpected success force-resets to closed", func(t *testing.T) {
		cb := newAgentCircuitBreaker(1, 60*time.Second, 1*time.Hour) // long cooldown

		// Trip to Open.
		_ = cb.Allow()
		cb.RecordFailure()
		if cb.State() != CircuitOpen {
			t.Fatal("expected Open")
		}

		// RecordSuccess in Open state (unexpected path) should force-reset.
		cb.RecordSuccess()
		if cb.State() != CircuitClosed {
			t.Errorf("state after unexpected success in Open = %v, want %v", cb.State(), CircuitClosed)
		}

		// After force-reset, Allow() should work.
		if err := cb.Allow(); err != nil {
			t.Errorf("Allow() after force-reset: unexpected error: %v", err)
		}
	})

	t.Run("halfOpenInFlight is cleared after successful close", func(t *testing.T) {
		cb := newAgentCircuitBreaker(1, 60*time.Second, 10*time.Millisecond)

		// #1550: fake clock — advance time deterministically instead of sleeping.
		fakeNow := time.Now()
		cb.now = func() time.Time { return fakeNow }
		// Trip to Open, wait cooldown.
		_ = cb.Allow()
		cb.RecordFailure()
		fakeNow = fakeNow.Add(16 * time.Millisecond) // exceed 10ms cooldown while within 60s failure window (#1550)

		// Enter HalfOpen, then succeed.
		_ = cb.Allow()
		cb.RecordSuccess()

		// Trip again and wait cooldown — should be able to enter HalfOpen again.
		_ = cb.Allow()
		cb.RecordFailure()
		fakeNow = fakeNow.Add(16 * time.Millisecond) // exceed 10ms cooldown while within 60s failure window (#1550)

		if err := cb.Allow(); err != nil {
			t.Fatalf("Allow() after second cooldown: %v", err)
		}
		if cb.State() != CircuitHalfOpen {
			t.Errorf("state after second cooldown = %v, want %v", cb.State(), CircuitHalfOpen)
		}
	})
}
