package lifecycle

import (
	"os"

	"github.com/agenthub/edge-server/internal/store"
)

// Residual pure-helper peel #1121: domain pure helpers extracted from
// process_executor_pure.go. Same package lifecycle; zero behavior change.

// isCancellableRunStatus reports whether Cancel may act on the given run status.
func isCancellableRunStatus(status string) bool {
	switch status {
	case "queued", "started", "cancelling":
		return true
	default:
		return false
	}
}

// shouldTreatAsCancelled reports whether a wait exit should be published as
// cancelled (context cancelled or run already transitioning to cancelling).
func shouldTreatAsCancelled(ctxErr error, status string) bool {
	return ctxErr != nil || status == "cancelling"
}

// cancelResultNotFound is returned when Cancel cannot find the run in the store.
func cancelResultNotFound() CancelResult {
	return CancelResult{Found: false, Status: "not_found"}
}

// cancelResultNotRunning is returned when Cancel finds no live cancel func for the run.
func cancelResultNotRunning() CancelResult {
	return CancelResult{Found: false, Status: "not_running"}
}

// cancelResultWithRun reports a found run at its current (possibly terminal) status.
func cancelResultWithRun(run store.Run) CancelResult {
	return CancelResult{Run: run, Found: true, Status: run.Status}
}

// interruptRequestID builds the adapter stdin interrupt request id for a run.
func interruptRequestID(runID string) string {
	return "interrupt-" + runID
}

// shouldTreatStartFailureAsCancelled reports whether a cmd.Start failure should
// be published as cancelled because the run context is already done.
func shouldTreatStartFailureAsCancelled(ctxErr error) bool {
	return ctxErr != nil
}

// shouldKillStartedProcessOnCancel reports whether a just-started process must
// be killed because the run context cancelled between Start and tracking.
func shouldKillStartedProcessOnCancel(ctxErr error) bool {
	return ctxErr != nil
}

// lookupCancelResult maps a post-cancel store lookup into a CancelResult.
func lookupCancelResult(run store.Run, found bool) CancelResult {
	if found {
		return cancelResultWithRun(run)
	}
	return cancelResultNotFound()
}

// cancelledFailReason is the Hub TaskFail reason used for cancelled runs.
func cancelledFailReason() string {
	return "run cancelled"
}

// shouldWriteInterruptStdin reports whether Cancel should write an adapter
// interrupt frame before cancelling the run context.
func shouldWriteInterruptStdin(hasStdin bool) bool {
	return hasStdin
}

// shouldStartGracefulProcessShutdown reports whether Cancel should schedule the
// interrupt→kill escalation goroutine for a tracked process.
func shouldStartGracefulProcessShutdown(proc *os.Process) bool {
	return proc != nil
}

// shouldCloseCancelDoneChannel reports whether finish should close the graceful
// shutdown abort channel for a run.
func shouldCloseCancelDoneChannel(found bool) bool {
	return found
}

// shouldKillProcessAfterCancel reports whether a non-nil process handle should
// be killed when the start path observes a cancelled context.
func shouldKillProcessAfterCancel(proc *os.Process) bool {
	return proc != nil
}

// shouldWaitProcessAfterCancel reports whether Wait should be called after a
// cancelled start/kill path observes a non-nil process.
func shouldWaitProcessAfterCancel(proc *os.Process) bool {
	return proc != nil
}

// shouldLogInterruptWriteFailure reports whether a stdin interrupt write error
// should be debug-logged (errors are non-fatal).
func shouldLogInterruptWriteFailure(err error) bool {
	return err != nil
}

// shouldLogProcessWaitAfterKill reports whether a post-kill Wait error should
// be warned.
func shouldLogProcessWaitAfterKill(err error) bool {
	return err != nil
}

// cancelPrecheck returns an early CancelResult when the store lookup fails or the
// run is no longer cancellable. proceed is true only when Cancel should continue.
func cancelPrecheck(run store.Run, found bool) (result CancelResult, proceed bool) {
	if !found {
		return cancelResultNotFound(), false
	}
	if !isCancellableRunStatus(run.Status) {
		return cancelResultWithRun(run), false
	}
	return CancelResult{}, true
}

// cancelRunningLookup returns an early CancelResult when the run has no live
// cancel func. proceed is true only when Cancel should continue shutdown.
func cancelRunningLookup(found bool) (result CancelResult, proceed bool) {
	if !found {
		return cancelResultNotRunning(), false
	}
	return CancelResult{}, true
}

// shouldInvokeOldCancelOnEscalationHandoff reports whether the previous attempt's
// cancel func should be invoked before re-registering the successor cancel.
func shouldInvokeOldCancelOnEscalationHandoff(found bool) bool {
	return found
}

// cancelTransitionResult maps a successful "cancelling" status transition to a
// CancelResult. needLookup is true when the transition lost a race and the
// caller must re-read the current run status.
func cancelTransitionResult(transitioned store.Run, transitionOK bool) (result CancelResult, needLookup bool) {
	if transitionOK {
		return cancelResultWithRun(transitioned), false
	}
	return CancelResult{}, true
}

// cmdStartOutcome classifies cmd.Start results for the run() launch path.
type cmdStartOutcome int

const (
	cmdStartOK cmdStartOutcome = iota
	cmdStartCancelled
	cmdStartFailed
)

// classifyCmdStartOutcome maps a cmd.Start error + run-context error into a pure
// launch outcome. Control-flow (wait/kill/publish) stays in the executor.
func classifyCmdStartOutcome(startErr, ctxErr error) cmdStartOutcome {
	if startErr == nil {
		return cmdStartOK
	}
	if shouldTreatStartFailureAsCancelled(ctxErr) {
		return cmdStartCancelled
	}
	return cmdStartFailed
}

// subprocessStartingLogArgs builds redacted slog attributes for the
// executor.subprocess.starting debug event.
func subprocessStartingLogArgs(runID, cmdPath string, args []string, attempt int) []any {
	argSummary := summarizeProcessArgsForLog(args)
	return []any{
		"runId", runID,
		"commandName", processCommandNameForLog(cmdPath),
		"commandRedacted", true,
		"argCount", len(args),
		"argFlags", argSummary.ArgFlags,
		"configKeys", argSummary.ConfigKeys,
		"positionalArgCount", argSummary.PositionalArgCount,
		"unknownFlagCount", argSummary.UnknownFlagCount,
		"redactedConfigKeyCount", argSummary.RedactedConfigKeyCount,
		"argsRedacted", true,
		"attempt", attempt,
	}
}

// subprocessStartedLogArgs builds slog attributes for executor.subprocess.started.
func subprocessStartedLogArgs(runID string, proc *os.Process) []any {
	return []any{
		"runId", runID,
		"pid", processPIDForLog(proc),
	}
}

// processPIDForLog returns the process PID, or 0 when the handle is nil.
func processPIDForLog(proc *os.Process) int {
	if proc == nil {
		return 0
	}
	return proc.Pid
}

// shouldTrackStartedProcess reports whether a just-started process handle should
// be retained for graceful shutdown signals.
func shouldTrackStartedProcess(proc *os.Process) bool {
	return proc != nil
}

// postStartCancelPlan is the pure kill/wait plan when context is cancelled
// after a successful cmd.Start but before the process is fully tracked.
type postStartCancelPlan struct {
	Cancel bool
	Kill   bool
	Wait   bool
}

// planPostStartCancel maps a post-start context error + process handle into the
// cancel cleanup actions. Does not rework Cancel grace / CommandContext (#988).
func planPostStartCancel(ctxErr error, proc *os.Process) postStartCancelPlan {
	if !shouldKillStartedProcessOnCancel(ctxErr) {
		return postStartCancelPlan{}
	}
	return postStartCancelPlan{
		Cancel: true,
		Kill:   shouldKillProcessAfterCancel(proc),
		Wait:   shouldWaitProcessAfterCancel(proc),
	}
}

// cmdStartCancelWaitPlan is the pure wait decision for a cancelled cmd.Start.
type cmdStartCancelWaitPlan struct {
	Wait bool
}

// planCmdStartCancelWait reports whether to Wait a process handle after a
// cancelled Start failure (before publishCancelled).
func planCmdStartCancelWait(proc *os.Process) cmdStartCancelWaitPlan {
	return cmdStartCancelWaitPlan{Wait: shouldWaitProcessAfterCancel(proc)}
}

// watchProcessEntryPlan is the pure nil-process gate for watchRunProcess.
type watchProcessEntryPlan struct {
	Watch bool
}

// planWatchProcessEntry reports whether the context watcher should arm for proc.
// Preserves #988: nil process handles are never watched.
func planWatchProcessEntry(proc *os.Process) watchProcessEntryPlan {
	return watchProcessEntryPlan{Watch: proc != nil}
}

// watchProcessKillPlan is the pure kill decision after ctx.Done in watchRunProcess.
type watchProcessKillPlan struct {
	Kill bool
}

// planWatchProcessKill decides whether the timeout watcher may force-kill.
// When Cancel already armed a grace path (graceActive), kill is deferred to that
// path so CommandContext removal does not defeat grace escalation (#988).
func planWatchProcessKill(graceActive bool) watchProcessKillPlan {
	return watchProcessKillPlan{Kill: !graceActive}
}

// shouldCancelCascadeChild reports whether a ShutdownCascade child runID should
// receive Cancel. Skips empty IDs and the parent itself (#1001).
func shouldCancelCascadeChild(parentRunID, childRunID string) bool {
	return childRunID != "" && childRunID != parentRunID
}

// trackStartedProcessPlan is the pure post-Start process tracking plan.
type trackStartedProcessPlan struct {
	Track bool
	Watch bool
}

// planTrackStartedProcess decides whether to store the process handle and arm
// the context watcher. Track and Watch stay coupled (same gate as before).
func planTrackStartedProcess(proc *os.Process) trackStartedProcessPlan {
	track := shouldTrackStartedProcess(proc)
	return trackStartedProcessPlan{Track: track, Watch: track}
}

// cancelGraceArmPlan is the pure Cancel grace-path arm decision (#988).
type cancelGraceArmPlan struct {
	Arm bool
}

// planCancelGraceArm reports whether Cancel should register cancelDone and start
// the interrupt→SIGTERM→kill escalation goroutine for a tracked process.
// alreadyArmed is true when a previous Cancel already registered cancelDone;
// re-arming would overwrite the tracked done channel and orphan the previous
// grace goroutine, so repeat Cancel stays idempotent (#2154).
func planCancelGraceArm(proc *os.Process, alreadyArmed bool) cancelGraceArmPlan {
	return cancelGraceArmPlan{Arm: shouldStartGracefulProcessShutdown(proc) && !alreadyArmed}
}

// processWaitLogPlan is the pure log gate for post-kill Wait errors in Cancel grace.
type processWaitLogPlan struct {
	Log bool
}

// planProcessWaitAfterKill maps a post-kill Wait error into the warn-log flag.
func planProcessWaitAfterKill(err error) processWaitLogPlan {
	return processWaitLogPlan{Log: shouldLogProcessWaitAfterKill(err)}
}

// interruptWriteLogPlan is the pure log gate for Cancel stdin interrupt failures.
type interruptWriteLogPlan struct {
	Log bool
}

// planInterruptWriteLog maps a WriteInterrupt error into the debug-log flag.
func planInterruptWriteLog(err error) interruptWriteLogPlan {
	return interruptWriteLogPlan{Log: shouldLogInterruptWriteFailure(err)}
}

// writeInterruptStdinPlan is the pure Cancel stdin-interrupt gate.
type writeInterruptStdinPlan struct {
	Write bool
}

// planWriteInterruptStdin reports whether Cancel should WriteInterrupt on a tracked stdin.
func planWriteInterruptStdin(hasStdin bool) writeInterruptStdinPlan {
	return writeInterruptStdinPlan{Write: shouldWriteInterruptStdin(hasStdin)}
}

// cancelledRunPlan is the pure post-wait cancellation detection plan.
type cancelledRunPlan struct {
	Cancelled bool
}

// planCancelledRun maps context/status into the publishCancelled branch.
func planCancelledRun(ctxErr error, status string) cancelledRunPlan {
	return cancelledRunPlan{Cancelled: shouldTreatAsCancelled(ctxErr, status)}
}

// processSignalLogPlan is the pure log gate for process signal/kill errors.
type processSignalLogPlan struct {
	Log bool
}

// planProcessSignalLog maps a signal/kill error into the debug-log flag used by
// Cancel grace escalation and watchRunProcess timeout kill (#988).
func planProcessSignalLog(err error) processSignalLogPlan {
	return processSignalLogPlan{Log: err != nil}
}

// filterCascadeCancelChildren returns child run IDs that should receive Cancel
// after ShutdownCascade (#1001). Empty/self IDs are dropped via shouldCancelCascadeChild.
func filterCascadeCancelChildren(parentRunID string, childRunIDs []string) []string {
	if len(childRunIDs) == 0 {
		return nil
	}
	out := make([]string, 0, len(childRunIDs))
	for _, childRunID := range childRunIDs {
		if shouldCancelCascadeChild(parentRunID, childRunID) {
			out = append(out, childRunID)
		}
	}
	return out
}
