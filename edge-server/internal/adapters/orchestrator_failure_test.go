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
			name:         "both nil defaults to cancel",
			err:          nil,
			runErr:       nil,
			wantCategory: FailureCancel,
			wantReason:   "no error to classify",
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
		name              string
		category          FailureCategory
		state             *RecoveryState
		policies          map[FailureCategory]FailurePolicy
		alternateAvailable bool
		wantDecision      FailureDecision
		wantRetryCount    int
	}{
		// ── Transient ──
		{
			name:              "transient with retries remaining",
			category:          FailureTransient,
			state:             &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			policies:          defaultPolicies,
			alternateAvailable: false,
			wantDecision:      DecisionRetry,
			wantRetryCount:    1,
		},
		{
			name:              "transient mid-retry",
			category:          FailureTransient,
			state:             &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 2},
			policies:          defaultPolicies,
			alternateAvailable: false,
			wantDecision:      DecisionRetry,
			wantRetryCount:    3,
		},
		{
			name:              "transient exhausted retries",
			category:          FailureTransient,
			state:             &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 3},
			policies:          defaultPolicies,
			alternateAvailable: false,
			wantDecision:      DecisionFail,
			wantRetryCount:    3,
		},
		{
			name:              "transient exceeds max retries",
			category:          FailureTransient,
			state:             &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 5},
			policies:          defaultPolicies,
			alternateAvailable: false,
			wantDecision:      DecisionFail,
			wantRetryCount:    5,
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
			name:              "cancel always skips",
			category:          FailureCancel,
			state:             &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			policies:          defaultPolicies,
			alternateAvailable: false,
			wantDecision:      DecisionSkip,
			wantRetryCount:    0,
		},
		{
			name:              "cancel always skips even with alternate",
			category:          FailureCancel,
			state:             &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			policies:          defaultPolicies,
			alternateAvailable: true,
			wantDecision:      DecisionSkip,
			wantRetryCount:    0,
		},
		// ── Unknown category (not in policies) ──
		{
			name:              "unknown category fails",
			category:          FailureCategory("unknown"),
			state:             &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			policies:          defaultPolicies,
			alternateAvailable: false,
			wantDecision:      DecisionFail,
			wantRetryCount:    0,
		},
		// ── Nil policies fallback ──
		{
			name:              "nil policies uses defaults (transient retry)",
			category:          FailureTransient,
			state:             &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			policies:          nil,
			alternateAvailable: false,
			wantDecision:      DecisionRetry,
			wantRetryCount:    1,
		},
		// ── State not mutated on skip/fail without retry ──
		{
			name:              "LastRetry updated on retry decision",
			category:          FailureTransient,
			state:             &RecoveryState{AgentID: "a1", TaskID: "t1", RetryCount: 0},
			policies:          defaultPolicies,
			alternateAvailable: false,
			wantDecision:      DecisionRetry,
			wantRetryCount:    1,
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
			name:       "retryCount=0 gives base/2",
			base:       base,
			retryCount: 0,
			want:       1 * time.Second, // base * 2^-1 = 2s * 0.5 = 1s
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := BackoffDuration(tt.base, tt.retryCount)
			if got != tt.want {
				t.Errorf("BackoffDuration(%v, %d) = %v, want %v",
					tt.base, tt.retryCount, got, tt.want)
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
			err:    errors.New("1234567890!"),
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

func BenchmarkTruncateError(b *testing.B) {
	msg := strings.Repeat("x", 1000)
	err := fmt.Errorf("%s", msg)
	for b.Loop() {
		truncateError(err, 500)
	}
}
