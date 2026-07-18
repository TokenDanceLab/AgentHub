package adapters

import (
	"fmt"
	"strings"
)

// ── Failure Classification ──────────────────────────────────────────────────

// FailureCategory classifies why a sub-agent failed so the orchestrator can
// choose the right recovery strategy.
//
// Reference: doloveplayer error taxonomy + Queena graceful degradation design.
//   - Transient: network timeout, API rate limit → auto-retry with backoff
//   - Capability: tool not found, permission denied, adapter unavailable → switch agent
//   - Cancel: task impossible, invalid input, depth exceeded → skip + notify
type FailureCategory string

const (
	// FailureTransient covers recoverable infrastructure errors: timeouts,
	// rate limits, temporary network failures. The same agent may succeed on retry.
	FailureTransient FailureCategory = "transient"

	// FailureCapability covers errors where the current agent cannot handle the
	// task: missing tools, permission denied, adapter unavailable, binary not
	// found. A different agent with matching capabilities should be tried.
	FailureCapability FailureCategory = "capability"

	// FailureCancel covers unrecoverable errors: invalid input, task impossible,
	// depth limit exceeded, or context cancelled. The task should be skipped and
	// the parent orchestrator notified.
	FailureCancel FailureCategory = "cancel"
)

// FailureDecision is the recovery action chosen after classifying a failure.
type FailureDecision string

const (
	DecisionRetry       FailureDecision = "retry"        // retry same agent with backoff
	DecisionSwitchAgent FailureDecision = "switch_agent" // re-dispatch to alternate agent
	DecisionSkip        FailureDecision = "skip"         // skip task, notify parent
	DecisionFail        FailureDecision = "fail"         // give up, propagate error
)

// ── Classification Logic ────────────────────────────────────────────────────

// transientPatterns match error messages indicating recoverable failures.
var transientPatterns = []string{
	"timeout",
	"timed out",
	"deadline exceeded",
	"rate limit",
	"rate_limit",
	"too many requests",
	"429",
	"503",
	"502",
	"connection refused",
	"connection reset",
	"i/o timeout",
	"temporary",
	"ECONNRESET",
	"ECONNREFUSED",
	"ETIMEDOUT",
	"context deadline",
}

// capabilityPatterns match error messages indicating the agent cannot handle
// the task with its current capabilities.
var capabilityPatterns = []string{
	"permission denied",
	"access denied",
	"access is denied",
	"not found",
	"executable file not found",
	"binary not found",
	"adapter unavailable",
	"tool not available",
	"command not found",
	"no such file",
	"not installed",
	"unavailable",
}

// cancelPatterns match error messages indicating the task is impossible
// or should be abandoned.
var cancelPatterns = []string{
	"invalid input",
	"invalid argument",
	"bad request",
	"depth exceeded",
	"slot full",
	"agent depth exceeded",
	"agent slot full",
	"cancelled",
	"canceled",
}

// ClassifyFailure inspects an error and optional RunError code to determine
// the failure category. Classification priority:
//  1. Context cancellation → Cancel
//  2. Deadline/timeout → Transient
//  3. Error code mapping (BINARY_NOT_FOUND, PERMISSION_DENIED → Capability)
//  4. Pattern matching on error message strings
//  5. Default → Transient (optimistic: assume recoverable)
func ClassifyFailure(err error, runErr *RunError) (FailureCategory, string) {
	if err == nil && runErr == nil {
		// No error to classify: default to transient per the optimistic
		// assumption that the retry may succeed. FailureCancel would imply
		// the task was cancelled/aborted, which is misleading when there
		// is genuinely no error information available.
		return FailureTransient, "no error to classify — assuming transient"
	}

	// Build a unified message for pattern matching.
	msg := ""
	if err != nil {
		msg = err.Error()
	}
	if runErr != nil && runErr.Message != "" {
		if msg != "" {
			msg = msg + ": " + runErr.Message
		} else {
			msg = runErr.Message
		}
	}
	msgLower := strings.ToLower(msg)

	// Priority 1: Context cancellation is always cancel.
	if strings.Contains(msgLower, "context canceled") ||
		strings.Contains(msgLower, "context cancelled") {
		return FailureCancel, "context cancelled"
	}

	// Priority 2: Deadline/timeout is always transient.
	if strings.Contains(msgLower, "deadline exceeded") ||
		strings.Contains(msgLower, "timeout") ||
		strings.Contains(msgLower, "timed out") {
		return FailureTransient, "deadline or timeout detected"
	}

	// Priority 3: RunError code mapping.
	if runErr != nil && runErr.Code != "" {
		switch runErr.Code {
		case "TIMEOUT":
			return FailureTransient, "run error code: TIMEOUT"
		case "BINARY_NOT_FOUND":
			return FailureCapability, "run error code: BINARY_NOT_FOUND"
		case "PERMISSION_DENIED":
			return FailureCapability, "run error code: PERMISSION_DENIED"
		case "CANCELLED":
			return FailureCancel, "run error code: CANCELLED"
		}
	}

	// Priority 4: Cancel patterns (check first as they are terminal).
	for _, pattern := range cancelPatterns {
		if strings.Contains(msgLower, strings.ToLower(pattern)) {
			return FailureCancel, fmt.Sprintf("cancel pattern matched: %s", pattern)
		}
	}

	// Priority 5: Capability patterns.
	for _, pattern := range capabilityPatterns {
		if strings.Contains(msgLower, strings.ToLower(pattern)) {
			return FailureCapability, fmt.Sprintf("capability pattern matched: %s", pattern)
		}
	}

	// Priority 6: Transient patterns.
	for _, pattern := range transientPatterns {
		if strings.Contains(msgLower, strings.ToLower(pattern)) {
			return FailureTransient, fmt.Sprintf("transient pattern matched: %s", pattern)
		}
	}

	// Priority 7: Repeated identical action — sub-agent stuck in a deterministic
	// loop, repeating the same tool+args pattern. Classify as cancel to prevent
	// the orchestrator from retrying an agent that will keep failing identically.
	if isRepeatedAction(err) {
		return FailureCancel, "repeated_identical_action"
	}

	// Default: transient — optimistic assumption that retry may succeed.
	return FailureTransient, "default: assuming transient"
}

// RunError is a mirror of lifecycle.RunError for use in the adapters package
// without creating a circular dependency. It carries a classified error code.

// isRepeatedAction checks if the error message contains repeated identical
// lines, indicating a sub-agent stuck in a deterministic loop repeating the
// same tool+args pattern. Returns true when any non-trivial line appears 3+
// times in the error message.
//
// This is used by ClassifyFailure to detect silent failure loops where the
// sub-agent keeps retrying the same failing action identically. Without this
// detection, the orchestrator's retry loop would also retry identically,
// wasting budget on a doomed task.
func isRepeatedAction(err error) bool {
	if err == nil {
		return false
	}
	return hasRepeatedPattern(err.Error(), 3)
}

// hasRepeatedPattern counts identical non-trivial lines in text and returns
// true when any line repeats at least minRepeat times. Lines shorter than 10
// characters are skipped to avoid false positives on punctuation and short
// tokens. Also skips lines that are all whitespace.
func hasRepeatedPattern(text string, minRepeat int) bool {
	lines := strings.Split(text, "\n")
	counts := make(map[string]int, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if len(line) < 10 {
			continue
		}
		counts[line]++
		if counts[line] >= minRepeat {
			return true
		}
	}
	return false
}

type RunError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}
