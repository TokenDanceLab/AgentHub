package lifecycle

import (
	"errors"
	"fmt"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

// Residual pure-helper peel #1121: domain pure helpers extracted from
// process_executor_pure.go. Same package lifecycle; zero behavior change.

// shouldRetrySessionConflict reports whether a wait error should trigger a
// single fresh-session retry inside the session-retry window.
func shouldRetrySessionConflict(err error, stderrCapture string, attempt int, elapsed time.Duration) bool {
	return err != nil &&
		attempt == 0 &&
		isSessionConflictError(err, stderrCapture) &&
		elapsed < sessionRetryWindow
}

// recoverableParseStreamError returns the recoverable ParseStreamError when err
// is a recoverable structured-output parse failure.
func recoverableParseStreamError(err error) (*adapters.ParseStreamError, bool) {
	if err == nil {
		return nil, false
	}
	var psErr *adapters.ParseStreamError
	if errors.As(err, &psErr) && psErr.Recoverable() {
		return psErr, true
	}
	return nil, false
}

// faultEscalationActive reports whether fault-escalation is configured to run
// at least one auto-retry. Exhausted events are only emitted when this is true.
func faultEscalationActive(cfg FaultEscalationConfig) bool {
	return cfg.Enabled && cfg.MaxRetries > 0
}

// shouldFaultEscalateRetry reports whether fault-escalation should re-launch
// the run for the given retry count.
func shouldFaultEscalateRetry(cfg FaultEscalationConfig, retryCount int) bool {
	return faultEscalationActive(cfg) && retryCount < cfg.MaxRetries
}

// recoverableParseWarningMessage formats the human-readable recoverable parse warning.
func recoverableParseWarningMessage(err error) string {
	return fmt.Sprintf("Recoverable stream parse error: %v", err)
}

// shouldAttemptFaultEscalation reports whether a non-nil wait error may enter
// the fault-escalation path. Retry/handoff control flow stays in the executor.
func shouldAttemptFaultEscalation(lastWaitErr error, cfg FaultEscalationConfig) bool {
	return lastWaitErr != nil && faultEscalationActive(cfg)
}

// shouldPublishTerminalWaitFailure reports whether the terminal wait-error path
// should publish a failed run after session retries / escalation settle.
func shouldPublishTerminalWaitFailure(lastWaitErr error) bool {
	return lastWaitErr != nil
}

// structuredOutputParseFailed wraps a non-recoverable ParseStream failure.
func structuredOutputParseFailed(err error) error {
	return fmt.Errorf("structured output parse error: %w", err)
}

// shouldPerformTerminalFinish reports whether the deferred finish path owns
// concurrency-slot teardown for this attempt (see #867 handoff).
func shouldPerformTerminalFinish(terminalFinish bool) bool {
	return terminalFinish
}

// shouldReadOutputStoreCapture reports whether stderr/stdout capture text is
// available from a run output store (e.g. for session-conflict detection).
func shouldReadOutputStoreCapture(hasOutStore bool) bool {
	return hasOutStore
}

// shouldBreakSessionRetryOnWaitError reports whether a non-retryable wait error
// should leave the session-retry loop for terminal handling/escalation.
func shouldBreakSessionRetryOnWaitError(waitErr error) bool {
	return waitErr != nil
}

// shouldHandleStructuredParseError reports whether ParseStream produced an error
// that needs recoverability classification.
func shouldHandleStructuredParseError(parseErr error) bool {
	return parseErr != nil
}

// nextFaultEscalationRetryCount returns the retry counter after one escalation
// attempt is accepted. Control flow / #867 handoff stays in the executor.
func nextFaultEscalationRetryCount(retryCount int) int {
	return retryCount + 1
}

// shouldAcceptFaultEscalationRetry reports whether a looked-up run may accept
// one more fault-escalation auto-retry. Control-flow handoff stays in run().
func shouldAcceptFaultEscalationRetry(found bool, cfg FaultEscalationConfig, retryCount int) bool {
	return found && shouldFaultEscalateRetry(cfg, retryCount)
}

// applyFaultEscalationQueuedStatus marks the in-memory run as queued when the
// store re-queue transition succeeded. Pure status mutation only.
func applyFaultEscalationQueuedStatus(run store.Run, requeued bool) store.Run {
	if requeued {
		run.Status = "queued"
	}
	return run
}

// shouldRecordStructuredParseError reports whether adapter.ParseStream failed
// and the error should be recorded for the session-retry loop.
func shouldRecordStructuredParseError(err error) bool {
	return err != nil
}

// classifyPublishedFailure builds the classified RunError used by publishFailed
// event payloads and Hub fail callbacks.
func classifyPublishedFailure(err error) *RunError {
	return ClassifyError(err, ExitCodeFromErr(err))
}

// structuredParseOutcome classifies ParseStream errors for the session-retry loop.
type structuredParseOutcome int

const (
	structuredParseNone structuredParseOutcome = iota
	structuredParseRecoverable
	structuredParseFatal
)

// classifyStructuredParseOutcome distinguishes none / recoverable warning /
// fatal publishFailed paths without reworking #179 recovery semantics.
func classifyStructuredParseOutcome(parseErr error) (structuredParseOutcome, *adapters.ParseStreamError) {
	if !shouldHandleStructuredParseError(parseErr) {
		return structuredParseNone, nil
	}
	if psErr, ok := recoverableParseStreamError(parseErr); ok {
		return structuredParseRecoverable, psErr
	}
	return structuredParseFatal, nil
}

// shouldPublishRecoverableParseWarning reports whether a recoverable parse path
// should emit a context-warning bus event (always true for that branch).
func shouldPublishRecoverableParseWarning(outcome structuredParseOutcome) bool {
	return outcome == structuredParseRecoverable
}

// shouldFailOnStructuredParse reports whether a fatal parse path should publishFailed.
func shouldFailOnStructuredParse(outcome structuredParseOutcome) bool {
	return outcome == structuredParseFatal
}

// sessionConflictRetryPlan is the pure attempt-local cleanup plan for a
// session-conflict retry. Map mutations stay in the executor.
type sessionConflictRetryPlan struct {
	Retry       bool
	CloseOutput bool
}

// planSessionConflictRetry decides whether to retry with a fresh session and
// whether a tracked run-output store should be closed for the failed attempt.
func planSessionConflictRetry(waitErr error, stderrCapture string, attempt int, elapsed time.Duration, hasOutStore bool) sessionConflictRetryPlan {
	if !shouldRetrySessionConflict(waitErr, stderrCapture, attempt, elapsed) {
		return sessionConflictRetryPlan{}
	}
	return sessionConflictRetryPlan{
		Retry:       true,
		CloseOutput: shouldCloseTrackedRunOutput(hasOutStore),
	}
}

// structuredParsePostPlan is the pure post-ParseStream plan for publishStructuredOutput.
type structuredParsePostPlan struct {
	RecordError bool
	Flush       bool
}

// planStructuredParsePost decides whether to record a ParseStream error and
// whether the transcript emitter should flush after parsing completes.
func planStructuredParsePost(parseErr error, hasTranscript bool) structuredParsePostPlan {
	return structuredParsePostPlan{
		RecordError: shouldRecordStructuredParseError(parseErr),
		Flush:       shouldFlushTranscriptEmitter(hasTranscript),
	}
}

// faultEscalationHandoffPlan is the pure retry decision for the #867 handoff path.
// Map mutations, cancel re-registration, and successor go run() stay in the executor.
type faultEscalationHandoffPlan struct {
	Retry bool
}

// planFaultEscalationHandoff decides whether a looked-up run may hand off to a
// successor attempt. Does not rework terminalFinish ownership (#867).
func planFaultEscalationHandoff(found bool, cfg FaultEscalationConfig, retryCount int) faultEscalationHandoffPlan {
	return faultEscalationHandoffPlan{
		Retry: shouldAcceptFaultEscalationRetry(found, cfg, retryCount),
	}
}

// structuredParseHandlePlan is the pure post-classify handle for ParseStream outcomes.
type structuredParseHandlePlan struct {
	WarnRecoverable bool
	FailFatal       bool
	WarningPayload  map[string]any
}

// planStructuredParseHandle maps a classified parse outcome into warn/fail flags
// and the recoverable warning payload. publishFailed/sendSubAgentResult stay in the executor.
func planStructuredParseHandle(
	outcome structuredParseOutcome,
	psErr *adapters.ParseStreamError,
	runID string,
	parseErr error,
) structuredParseHandlePlan {
	if shouldPublishRecoverableParseWarning(outcome) {
		msg := ""
		errText := ""
		if psErr != nil {
			msg = recoverableParseWarningMessage(psErr.Unwrap())
			errText = psErr.Error()
		} else if parseErr != nil {
			errText = parseErr.Error()
		}
		return structuredParseHandlePlan{
			WarnRecoverable: true,
			WarningPayload:  recoverableParseWarningPayload(runID, msg, errText),
		}
	}
	if shouldFailOnStructuredParse(outcome) {
		return structuredParseHandlePlan{FailFatal: true}
	}
	return structuredParseHandlePlan{}
}

// planStructuredParseHandleFromErr classifies parseErr then builds the handle plan.
func planStructuredParseHandleFromErr(parseErr error, runID string) structuredParseHandlePlan {
	outcome, psErr := classifyStructuredParseOutcome(parseErr)
	return planStructuredParseHandle(outcome, psErr, runID, parseErr)
}

// terminalFinishPlan is the pure deferred finish gate for a run attempt (#867).
type terminalFinishPlan struct {
	Finish bool
}

// planTerminalFinish reports whether this attempt owns terminal finish cleanup.
// Fault-escalation successors clear the flag so attempt-local cleanup does not
// tear down the concurrency slot the successor re-registered.
func planTerminalFinish(terminalFinish bool) terminalFinishPlan {
	return terminalFinishPlan{Finish: shouldPerformTerminalFinish(terminalFinish)}
}

// outputStoreCapturePlan is the pure session-conflict stderr capture gate.
type outputStoreCapturePlan struct {
	Read bool
}

// planOutputStoreCapture reports whether outStore.ReadAll should feed session-conflict detection.
func planOutputStoreCapture(hasOutStore bool) outputStoreCapturePlan {
	return outputStoreCapturePlan{Read: shouldReadOutputStoreCapture(hasOutStore)}
}

// sessionRetryBreakPlan is the pure wait-error break gate for the session-retry loop.
type sessionRetryBreakPlan struct {
	Break bool
}

// planSessionRetryBreak reports whether a non-retryable wait error should leave the session loop.
func planSessionRetryBreak(waitErr error) sessionRetryBreakPlan {
	return sessionRetryBreakPlan{Break: shouldBreakSessionRetryOnWaitError(waitErr)}
}

// faultEscalationAttemptPlan is the pure outer gate before fault-escalation handoff (#867).
type faultEscalationAttemptPlan struct {
	Attempt bool
}

// planFaultEscalationAttempt reports whether the wait-error path may consult fault escalation.
func planFaultEscalationAttempt(lastWaitErr error, cfg FaultEscalationConfig) faultEscalationAttemptPlan {
	return faultEscalationAttemptPlan{Attempt: shouldAttemptFaultEscalation(lastWaitErr, cfg)}
}

// faultEscalationCleanupPlan is the pure attempt-local cleanup plan during #867 handoff.
// Map mutations and cancel re-registration stay in the executor.
type faultEscalationCleanupPlan struct {
	CloseOutput     bool
	InvokeOldCancel bool
}

// planFaultEscalationCleanup maps map-lookup presence into handoff cleanup flags.
// Does not rework terminalFinish ownership (#867).
func planFaultEscalationCleanup(hasRunOutput, hasOldCancel bool) faultEscalationCleanupPlan {
	return faultEscalationCleanupPlan{
		CloseOutput:     shouldCloseTrackedRunOutput(hasRunOutput),
		InvokeOldCancel: shouldInvokeOldCancelOnEscalationHandoff(hasOldCancel),
	}
}

// terminalWaitFailurePlan is the pure post-escalation terminal wait-failure publish gate.
type terminalWaitFailurePlan struct {
	Publish bool
}

// planTerminalWaitFailure reports whether the last wait error should publishFailed after retries.
func planTerminalWaitFailure(lastWaitErr error) terminalWaitFailurePlan {
	return terminalWaitFailurePlan{Publish: shouldPublishTerminalWaitFailure(lastWaitErr)}
}

// faultEscalationExhaustedPlan is the pure exhausted-path publish/log gate after
// a failed handoff attempt (#867).
type faultEscalationExhaustedPlan struct {
	Publish bool
	Log     bool
}

// planFaultEscalationExhausted is true when fault escalation was attempted but
// the handoff was not accepted (max retries / missing run). Caller still owns
// bus Publish payload construction.
func planFaultEscalationExhausted() faultEscalationExhaustedPlan {
	// Reached only after Attempt && !Retry; always publish+log.
	return faultEscalationExhaustedPlan{Publish: true, Log: true}
}
