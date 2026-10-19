package lifecycle

import "os"

// isCancellableRunStatus reports whether Cancel may act on the given run status.
func isCancellableRunStatus(status string) bool {
	switch status {
	case "queued", "started", "cancelling":
		return true
	default:
		return false
	}
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
	if ctxErr != nil {
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
		"pid", proc.Pid,
	}
}

// filterCascadeCancelChildren returns child run IDs that should receive Cancel
// after ShutdownCascade (#1001); empty and self IDs are dropped.
func filterCascadeCancelChildren(parentRunID string, childRunIDs []string) []string {
	if len(childRunIDs) == 0 {
		return nil
	}
	out := make([]string, 0, len(childRunIDs))
	for _, childRunID := range childRunIDs {
		if childRunID != "" && childRunID != parentRunID {
			out = append(out, childRunID)
		}
	}
	return out
}
