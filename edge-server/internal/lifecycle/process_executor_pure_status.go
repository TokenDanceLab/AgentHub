package lifecycle

import (
	"time"

	"github.com/agenthub/edge-server/internal/store"
)

// Residual pure-helper peel #1121: domain pure helpers extracted from
// process_executor_pure.go. Same package lifecycle; zero behavior change.

// isQueuedRunStatus reports whether a run may still be transitioned to started.
func isQueuedRunStatus(status string) bool {
	return status == "queued"
}

// canStartRun reports whether Start may launch another concurrent run.
// maxConcurrent is resolved with the package default when non-positive.
func canStartRun(runningCount, maxConcurrent int, alreadyRunning bool) error {
	max := resolveMaxConcurrentRuns(maxConcurrent)
	if runningCount >= max {
		return ErrTooManyConcurrentRuns
	}
	if alreadyRunning {
		return ErrRunAlreadyStarted
	}
	return nil
}

// shouldSurfaceRunArtifacts reports whether auto-surface may run for a finished run.
func shouldSurfaceRunArtifacts(found bool, status string) bool {
	return found && status == "finished"
}

// resolveEvidenceFinalStatus returns the terminal status for a successful wait
// path. When the evidence gate is disabled, the run finishes cleanly.
func resolveEvidenceFinalStatus(gateEnabled, passed bool) string {
	if !gateEnabled {
		return "finished"
	}
	return evidenceGateFinalStatus(passed)
}

// shouldRecordRunFinishMetrics reports whether a run actually started far enough
// to record finish latency (start timestamp is non-zero).
func shouldRecordRunFinishMetrics(runStartTime time.Time) bool {
	return !runStartTime.IsZero()
}

// shouldLogEvidenceGateFailure reports whether a completed evidence-gate result
// should be logged as a verification failure.
func shouldLogEvidenceGateFailure(passed bool) bool {
	return !passed
}

// shouldPublishStatusTransition reports whether a conditional store status
// transition succeeded and may publish bus/Hub side effects.
func shouldPublishStatusTransition(ok bool) bool {
	return ok
}

// runStatusFromLookup maps a store.GetRun result to the status string used by
// cancel/finish predicates (empty when the run is missing).
func runStatusFromLookup(run store.Run, found bool) string {
	if !found {
		return ""
	}
	return run.Status
}

// shouldResetSessionRetryStatus reports whether a session-conflict retry should
// attempt to re-queue the run before relaunching.
func shouldResetSessionRetryStatus(retrying bool) bool {
	return retrying
}

// validateStartRunState reports whether Start may proceed for a looked-up run.
// Missing runs yield store.ErrNotFound; non-queued statuses yield ErrRunAlreadyStarted.
func validateStartRunState(found bool, status string) error {
	if !found {
		return store.ErrNotFound
	}
	if !isQueuedRunStatus(status) {
		return ErrRunAlreadyStarted
	}
	return nil
}

// shouldRecordFinishMetricsForRun reports whether finish metrics may be recorded
// for a successfully looked-up run.
func shouldRecordFinishMetricsForRun(found bool) bool {
	return found
}

// shouldRunEvidenceGate reports whether post-completion evidence verification
// should execute for the current run.
func shouldRunEvidenceGate(gateEnabled bool) bool {
	return gateEnabled
}

// evidenceGateOutcome is the pure publish plan after evidence verification.
type evidenceGateOutcome struct {
	FinalStatus string
	LogFailure  bool
}

// planEvidenceGateOutcome resolves the terminal status and whether verification
// failure should be warned. When the gate is disabled, status is finished.
func planEvidenceGateOutcome(gateEnabled, passed bool) evidenceGateOutcome {
	return evidenceGateOutcome{
		FinalStatus: resolveEvidenceFinalStatus(gateEnabled, passed),
		LogFailure:  gateEnabled && shouldLogEvidenceGateFailure(passed),
	}
}

// evidenceRunPlan is the pure evidence-gate execution plan for a successful wait.
type evidenceRunPlan struct {
	RunGate bool
}

// planEvidenceRun reports whether runEvidenceGate should execute for this attempt.
func planEvidenceRun(gateEnabled bool) evidenceRunPlan {
	return evidenceRunPlan{RunGate: shouldRunEvidenceGate(gateEnabled)}
}

// sessionRetryStatusPlan is the pure log gate after resetting status for session retry.
type sessionRetryStatusPlan struct {
	LogReset bool
}

// planSessionRetryStatus maps SetRunStatusIf success into the debug-log flag.
func planSessionRetryStatus(resetOK bool) sessionRetryStatusPlan {
	return sessionRetryStatusPlan{LogReset: shouldResetSessionRetryStatus(resetOK)}
}

// publishStatusPlan is the pure status-transition publish gate.
type publishStatusPlan struct {
	Publish bool
}

// planPublishStatus reports whether a conditional SetRunStatusIf transition may
// publish bus/Hub side effects.
func planPublishStatus(ok bool) publishStatusPlan {
	return publishStatusPlan{Publish: shouldPublishStatusTransition(ok)}
}

// planStartAdmission composes Start admission gates (lookup/status + concurrency)
// into a single pure error. Side-effects (context/map insert/goroutine) stay in Start.
func planStartAdmission(found bool, status string, runningCount, maxConcurrent int, alreadyRunning bool) error {
	if err := validateStartRunState(found, status); err != nil {
		return err
	}
	return canStartRun(runningCount, maxConcurrent, alreadyRunning)
}

// bindRunProcessContext returns a copy of runCtx with Run bound for the lifecycle.
// Pure value transform; map/context ownership stays in Start.
func bindRunProcessContext(runCtx RunProcessContext, run store.Run) RunProcessContext {
	runCtx.Run = run
	return runCtx
}

// evidenceGateAttemptPlan is the pure pre-gate attempt plan (run gate + default status).
type evidenceGateAttemptPlan struct {
	RunGate     bool
	FinalStatus string
}

// planEvidenceGateAttempt maps gate enablement into RunGate + default FinalStatus
// (passed=true until runEvidenceGate reports otherwise). I/O stays in run().
func planEvidenceGateAttempt(gateEnabled bool) evidenceGateAttemptPlan {
	outcome := planEvidenceGateOutcome(gateEnabled, true)
	return evidenceGateAttemptPlan{
		RunGate:     shouldRunEvidenceGate(gateEnabled),
		FinalStatus: outcome.FinalStatus,
	}
}

// planEvidenceGateResult maps a completed gate pass/fail into terminal status + log.
// Call only after runEvidenceGate (gate path taken).
func planEvidenceGateResult(passed bool) evidenceGateOutcome {
	return planEvidenceGateOutcome(true, passed)
}
