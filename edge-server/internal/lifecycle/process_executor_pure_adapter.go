package lifecycle

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

// Residual pure-helper peel #1121: domain pure helpers extracted from
// process_executor_pure.go. Same package lifecycle; zero behavior change.

// resolveAdapterMetricsLabel returns the Prometheus adapter label for a resolved
// adapter (or "none" when no adapter is bound).
func resolveAdapterMetricsLabel(adapter adapters.AgentAdapter) string {
	if adapter == nil {
		return adapterMetricsLabel("", false)
	}
	return adapterMetricsLabel(adapter.Metadata().ID, true)
}

// shouldCloseStdinEagerly reports whether the executor should close the child
// stdin pipe immediately after Start. Stdin stays open when the adapter needs
// the control protocol or a DecisionLoop may force-finish via interrupt.
func shouldCloseStdinEagerly(needsStdin, hasDecisionLoop bool) bool {
	return !needsStdin && !hasDecisionLoop
}

// needsAdapterStdin reports whether the resolved adapter requires a live stdin pipe.
func needsAdapterStdin(adapter adapters.AgentAdapter) bool {
	return adapter != nil && adapter.NeedsStdin()
}

// shouldResolveAdapter reports whether the registry should be consulted for this run.
func shouldResolveAdapter(hasRegistry bool, agentID string, hasDefaultAdapter bool) bool {
	return hasRegistry && (agentID != "" || hasDefaultAdapter)
}

// sanitizePermissionMode rejects bypassPermissions (SEC-02) and falls back to
// "default". The bool reports whether a fallback was applied (for logging).
func sanitizePermissionMode(mode string) (string, bool) {
	if isForbiddenPermissionMode(mode) {
		return "default", true
	}
	return mode, false
}

// envForAdapterOrProfile builds the child process env for adapter mode (overlay
// auth vars onto a sanitized base) or profile mode (administrator-configured base).
// In adapter mode, extraEnv originates from the adapter's ExtraEnvTemplate expansion
// and is not covered by the profileEnv sensitive-var warning in envForRun; warn here
// so audits see per-key signals without leaking values.
func envForAdapterOrProfile(run store.Run, hasAdapter bool, profileOrAdapterEnv, extraEnv []string) []string {
	if hasAdapter {
		for _, kv := range extraEnv {
			key, _, _ := strings.Cut(kv, "=")
			if IsSensitiveEnvKey(key) {
				slog.Warn("sensitive env var present in adapter extra environment", "runId", run.ID, "key", key)
			}
		}
		return envForRun(run, nil, append(extraEnv, profileOrAdapterEnv...))
	}
	return envForRun(run, profileOrAdapterEnv, extraEnv)
}

// asPreflightAdapter returns the adapter when it implements PreflightAdapter.
func asPreflightAdapter(adapter adapters.AgentAdapter) (adapters.PreflightAdapter, bool) {
	if adapter == nil {
		return nil, false
	}
	preflight, ok := adapter.(adapters.PreflightAdapter)
	return preflight, ok && preflight != nil
}

// resolveMetricsAdapterLabel returns the Prometheus adapter label only when
// metrics instrumentation is attached.
func resolveMetricsAdapterLabel(hasMetrics bool, adapter adapters.AgentAdapter) string {
	if !hasMetrics {
		return ""
	}
	return resolveAdapterMetricsLabel(adapter)
}

// shouldCloseStdinAfterStart reports whether a successfully opened stdin pipe
// should be closed eagerly after process start.
func shouldCloseStdinAfterStart(stdinOpen, needsStdin, hasDecisionLoop bool) bool {
	return stdinOpen && shouldCloseStdinEagerly(needsStdin, hasDecisionLoop)
}

// pipeOpenError formats stdout/stderr/stdin pipe open failures.
func pipeOpenError(pipe string, err error) error {
	return fmt.Errorf("open %s pipe: %w", pipe, err)
}

// adapterPreflightFailed wraps a PreflightAdapter failure for publishFailed.
func adapterPreflightFailed(err error) error {
	return fmt.Errorf("adapter preflight failed: %w", err)
}

// shouldAttachFinishMetricsDefer reports whether run-finish latency metrics
// should be deferred for this attempt.
func shouldAttachFinishMetricsDefer(hasMetrics bool) bool {
	return hasMetrics
}

// shouldRecordRunStartMetrics reports whether a successful cmd.Start should
// record Prometheus start counters.
func shouldRecordRunStartMetrics(hasMetrics bool) bool {
	return hasMetrics
}

// shouldUseAdapterCommand reports whether BuildCommand should drive the child
// process instead of the profile template.
func shouldUseAdapterCommand(hasAdapter bool) bool {
	return hasAdapter
}

// shouldPublishCLIInvocationPlan reports whether a CLI invocation plan event
// should be published for the resolved adapter.
func shouldPublishCLIInvocationPlan(hasAdapter bool) bool {
	return hasAdapter
}

// shouldUseStructuredOutputParser reports whether stdout should be parsed by
// the adapter instead of raw batch capture.
func shouldUseStructuredOutputParser(hasAdapter bool) bool {
	return hasAdapter
}

// shouldCloseStdinPipe reports whether an open stdin WriteCloser should be
// closed (distinct from the eager-close decision).
func shouldCloseStdinPipe(stdinOpen bool) bool {
	return stdinOpen
}

// applyPermissionModeSanitization rejects forbidden permission modes (SEC-02)
// and returns the sanitized run context. logged is true when a fallback was
// applied so the caller can emit a warning.
func applyPermissionModeSanitization(runCtx RunProcessContext) (RunProcessContext, bool) {
	mode, forbidden := sanitizePermissionMode(runCtx.PermissionMode)
	if !forbidden {
		return runCtx, false
	}
	runCtx.PermissionMode = mode
	return runCtx, true
}

// shouldFailNewRunnerProfile reports whether NewGenericRunnerProfile failed.
func shouldFailNewRunnerProfile(err error) bool {
	return err != nil
}

// shouldPublishAdapterResolveFailure reports whether adapter registry Resolve
// failed and the run should be published as failed.
func shouldPublishAdapterResolveFailure(err error) bool {
	return err != nil
}

// shouldPublishPreflightFailure reports whether PreflightCheck failed.
func shouldPublishPreflightFailure(err error) bool {
	return err != nil
}

// shouldPublishCommandBuildFailure reports whether profile/template expansion
// (args, env, extraEnv) failed before the child process could start.
func shouldPublishCommandBuildFailure(err error) bool {
	return err != nil
}

// shouldPublishPipeFailure reports whether opening a child stdio pipe failed.
func shouldPublishPipeFailure(err error) bool {
	return err != nil
}

// shouldLogForbiddenPermissionMode reports whether a forbidden permission mode
// fallback should be warned (SEC-02 defense-in-depth).
func shouldLogForbiddenPermissionMode(forbidden bool) bool {
	return forbidden
}

// shouldClearStdinAfterEagerClose reports whether the run's stdin map entry should
// be dropped after an eager post-start close.
func shouldClearStdinAfterEagerClose(closed bool) bool {
	return closed
}

// eagerStdinClosePlan is the pure post-start stdin close decision.
type eagerStdinClosePlan struct {
	ClosePipe bool
	ClearMap  bool
}

// planEagerStdinClose decides whether to close the child stdin pipe and drop the
// run's stdin map entry after Start. Control-flow (Close/delete) stays in the executor.
func planEagerStdinClose(stdinOpen, needsStdin, hasDecisionLoop bool) eagerStdinClosePlan {
	if !shouldCloseStdinAfterStart(stdinOpen, needsStdin, hasDecisionLoop) {
		return eagerStdinClosePlan{}
	}
	closed := shouldCloseStdinPipe(stdinOpen)
	return eagerStdinClosePlan{
		ClosePipe: closed,
		// Preserve prior behavior: clear the map whenever stdin was open for the
		// eager-close branch (even if Close was skipped by a nil-guard race).
		ClearMap: shouldClearStdinAfterEagerClose(closed || stdinOpen),
	}
}

// commandBuildPlan consolidates adapter-vs-profile command build flags for one run attempt.
type commandBuildPlan struct {
	UseAdapter          bool
	PublishCLIPlan      bool
	UseStructuredParser bool
}

// planCommandBuild maps adapter presence into command-build / CLI-plan / structured-parser flags.
// Side-effects (BuildCommand, Expand, Publish, ParseStream) stay in the executor.
func planCommandBuild(hasAdapter bool) commandBuildPlan {
	return commandBuildPlan{
		UseAdapter:          shouldUseAdapterCommand(hasAdapter),
		PublishCLIPlan:      shouldPublishCLIInvocationPlan(hasAdapter),
		UseStructuredParser: shouldUseStructuredOutputParser(hasAdapter),
	}
}

// runMetricsPlan consolidates metrics attach/start gates for a run attempt.
type runMetricsPlan struct {
	AttachFinishDefer bool
	RecordStart       bool
}

// planRunMetrics maps metrics presence into finish-defer and start-record flags.
func planRunMetrics(hasMetrics bool) runMetricsPlan {
	return runMetricsPlan{
		AttachFinishDefer: shouldAttachFinishMetricsDefer(hasMetrics),
		RecordStart:       shouldRecordRunStartMetrics(hasMetrics),
	}
}

// adapterResolvePlan is the pure adapter-registry resolve gate for run().
type adapterResolvePlan struct {
	Resolve bool
}

// planAdapterResolve reports whether adapterReg.Resolve should run for this attempt.
func planAdapterResolve(hasRegistry bool, agentID string, hasDefaultAdapter bool) adapterResolvePlan {
	return adapterResolvePlan{
		Resolve: shouldResolveAdapter(hasRegistry, agentID, hasDefaultAdapter),
	}
}

// permissionModePlan is the pure SEC-02 permission-mode sanitization result.
type permissionModePlan struct {
	Changed      bool
	LogForbidden bool
	RunCtx       RunProcessContext
}

// planPermissionModeSanitization rejects forbidden permission modes and returns
// the sanitized run context. Control-flow assignment stays in the executor.
func planPermissionModeSanitization(runCtx RunProcessContext) permissionModePlan {
	sanitized, forbidden := applyPermissionModeSanitization(runCtx)
	if !shouldLogForbiddenPermissionMode(forbidden) {
		return permissionModePlan{RunCtx: runCtx}
	}
	return permissionModePlan{
		Changed:      true,
		LogForbidden: true,
		RunCtx:       sanitized,
	}
}

// preflightFailurePlan is the pure PreflightCheck failure gate.
type preflightFailurePlan struct {
	Fail bool
}

// planPreflightFailure reports whether a PreflightCheck error should fail the run.
func planPreflightFailure(err error) preflightFailurePlan {
	return preflightFailurePlan{Fail: shouldPublishPreflightFailure(err)}
}

// adapterResolveFailurePlan is the pure Resolve error publish gate.
type adapterResolveFailurePlan struct {
	Fail bool
}

// planAdapterResolveFailure reports whether adapterReg.Resolve failure should fail the run.
func planAdapterResolveFailure(err error) adapterResolveFailurePlan {
	return adapterResolveFailurePlan{Fail: shouldPublishAdapterResolveFailure(err)}
}

// commandBuildFailurePlan is the pure command/template expand failure gate.
type commandBuildFailurePlan struct {
	Fail bool
}

// planCommandBuildFailure reports whether a command/template expand error should publishFailed.
func planCommandBuildFailure(err error) commandBuildFailurePlan {
	return commandBuildFailurePlan{Fail: shouldPublishCommandBuildFailure(err)}
}

// pipeFailurePlan is the pure stdout/stderr/stdin pipe open failure gate.
type pipeFailurePlan struct {
	Fail bool
}

// planPipeFailure reports whether a Stdout/Stderr/StdinPipe error should publishFailed.
func planPipeFailure(err error) pipeFailurePlan {
	return pipeFailurePlan{Fail: shouldPublishPipeFailure(err)}
}

// stdinPipeOpenPlan is the pure adapter stdin pipe open gate.
type stdinPipeOpenPlan struct {
	Open bool
}

// planStdinPipeOpen reports whether StdinPipe should be opened for the resolved adapter.
func planStdinPipeOpen(adapter adapters.AgentAdapter) stdinPipeOpenPlan {
	return stdinPipeOpenPlan{Open: needsAdapterStdin(adapter)}
}

// preflightAdapterPlan is the pure type-assert gate before PreflightCheck.
type preflightAdapterPlan struct {
	Check bool
}

// planPreflightAdapter reports whether the resolved adapter implements
// PreflightAdapter and should run PreflightCheck.
func planPreflightAdapter(ok bool) preflightAdapterPlan {
	return preflightAdapterPlan{Check: ok}
}
