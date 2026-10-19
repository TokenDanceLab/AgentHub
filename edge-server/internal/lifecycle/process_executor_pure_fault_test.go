package lifecycle

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
)

func TestShouldRetrySessionConflict(t *testing.T) {
	conflict := errors.New("session is already in use")

	cases := []struct {
		name     string
		err      error
		stderr   string
		attempt  int
		elapsed  time.Duration
		expected bool
	}{
		{"nil error", nil, "", 0, 0, false},
		{"first attempt within window", conflict, "", 0, time.Second, true},
		{"stderr conflict", errors.New("exit status 1"), "session is already in use", 0, time.Second, true},
		{"second attempt", conflict, "", 1, time.Second, false},
		{"window elapsed", conflict, "", 0, sessionRetryWindow, false},
		{"non-conflict error", errors.New("connection refused"), "", 0, time.Second, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := shouldRetrySessionConflict(tc.err, tc.stderr, tc.attempt, tc.elapsed); got != tc.expected {
				t.Fatalf("shouldRetrySessionConflict() = %v, want %v", got, tc.expected)
			}
		})
	}
}

func TestRecoverableParseStreamError(t *testing.T) {
	recoverable := adapters.NewRecoverableParseError(errors.New("bad event"))
	nonRecoverable := adapters.NewNonRecoverableParseError(errors.New("broken pipe"))

	if err, ok := recoverableParseStreamError(nil); err != nil || ok {
		t.Fatalf("nil error = (%v, %v), want (nil, false)", err, ok)
	}
	if err, ok := recoverableParseStreamError(recoverable); err != recoverable || !ok {
		t.Fatalf("recoverable error = (%v, %v), want the original error and true", err, ok)
	}
	if _, ok := recoverableParseStreamError(nonRecoverable); ok {
		t.Fatal("non-recoverable parse error must not be accepted")
	}
	wrapped := fmt.Errorf("stream: %w", recoverable)
	if err, ok := recoverableParseStreamError(wrapped); err != recoverable || !ok {
		t.Fatalf("wrapped recoverable error = (%v, %v), want the inner error and true", err, ok)
	}
}

func TestClassifyStructuredParseOutcome(t *testing.T) {
	recoverable := adapters.NewRecoverableParseError(errors.New("bad event"))

	cases := []struct {
		name     string
		err      error
		outcome  structuredParseOutcome
		hasError bool
	}{
		{"nil", nil, structuredParseNone, false},
		{"recoverable", recoverable, structuredParseRecoverable, true},
		{"fatal", errors.New("broken pipe"), structuredParseFatal, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			outcome, parseErr := classifyStructuredParseOutcome(tc.err)
			if outcome != tc.outcome {
				t.Fatalf("outcome = %v, want %v", outcome, tc.outcome)
			}
			if (parseErr != nil) != tc.hasError {
				t.Fatalf("parseErr = %v, want hasError=%v", parseErr, tc.hasError)
			}
		})
	}
}

func TestResolvePositiveDuration(t *testing.T) {
	fallback := 5 * time.Second
	if got := resolvePositiveDuration(2*time.Second, fallback); got != 2*time.Second {
		t.Fatalf("positive duration = %v, want 2s", got)
	}
	if got := resolvePositiveDuration(0, fallback); got != fallback {
		t.Fatalf("zero duration = %v, want fallback %v", got, fallback)
	}
	if got := resolvePositiveDuration(-time.Second, fallback); got != fallback {
		t.Fatalf("negative duration = %v, want fallback %v", got, fallback)
	}
}

func TestResolveMaxConcurrentRuns(t *testing.T) {
	if got := resolveMaxConcurrentRuns(3); got != 3 {
		t.Fatalf("positive max = %d, want 3", got)
	}
	if got := resolveMaxConcurrentRuns(0); got != defaultMaxConcurrentRuns {
		t.Fatalf("zero max = %d, want %d", got, defaultMaxConcurrentRuns)
	}
	if got := resolveMaxConcurrentRuns(-1); got != defaultMaxConcurrentRuns {
		t.Fatalf("negative max = %d, want %d", got, defaultMaxConcurrentRuns)
	}
}
