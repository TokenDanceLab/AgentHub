package lifecycle

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// isQueuedRunStatus reports whether a run may still be transitioned to started.
func isQueuedRunStatus(status string) bool {
	return status == "queued"
}

// isCancellableRunStatus reports whether Cancel may act on the given run status.
func isCancellableRunStatus(status string) bool {
	switch status {
	case "queued", "started", "cancelling":
		return true
	default:
		return false
	}
}

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

// withParserContextValues injects budget / workdir / SDK run context into the
// parser context used by structured output adapters.
func withParserContextValues(ctx context.Context, runCtx RunProcessContext) context.Context {
	parserCtx := ctx
	if runCtx.Budget != nil {
		parserCtx = context.WithValue(parserCtx, adapters.CtxBudgetKey, runCtx.Budget)
	}
	if runCtx.WorkDir != "" {
		parserCtx = context.WithValue(parserCtx, adapters.CtxWorkDir, runCtx.WorkDir)
	}
	return adapters.SDKAdapterContext(parserCtx, adapters.RunProcessContext(runCtx))
}

// newSubAgentRunContext builds the isolated RunProcessContext for a dispatched
// sub-agent. SessionID is always the child thread so context stays isolated.
func newSubAgentRunContext(run store.Run, task adapters.SubAgentTask, threadID string) RunProcessContext {
	return RunProcessContext{
		Run:       run,
		Prompt:    task.Prompt,
		AgentID:   task.AgentID,
		Budget:    childBudget(task.Budget, task.Depth),
		Model:     task.Model,
		SessionID: threadID,
	}
}

// withSiblingSystemPrompt prepends a sibling-context prompt when the task lists
// parallel sibling agents.
func withSiblingSystemPrompt(existing string, siblingAgents []adapters.SiblingInfo) string {
	if len(siblingAgents) == 0 {
		return existing
	}
	return appendSystemPromptPrefix(existing, adapters.BuildSiblingContextPrompt(siblingAgents))
}

// hubDoneFinalContent returns the TaskDone final content, substituting the
// default finished message when the collector produced nothing.
func hubDoneFinalContent(content string) string {
	if content == "" {
		return "Run finished"
	}
	return content
}

// hubTaskDoneResult builds the Hub TaskDone payload for a finished run.
func hubTaskDoneResult(runID, content string) hub.TaskResult {
	return hub.TaskResult{
		RunID:        runID,
		FinalContent: hubDoneFinalContent(content),
	}
}

// needsAdapterStdin reports whether the resolved adapter requires a live stdin pipe.
func needsAdapterStdin(adapter adapters.AgentAdapter) bool {
	return adapter != nil && adapter.NeedsStdin()
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
func envForAdapterOrProfile(run store.Run, hasAdapter bool, profileOrAdapterEnv, extraEnv []string) []string {
	if hasAdapter {
		return envForRun(run, nil, append(extraEnv, profileOrAdapterEnv...))
	}
	return envForRun(run, profileOrAdapterEnv, extraEnv)
}

// withFreshSession replaces the session ID and clears continue-last for a
// session-conflict retry attempt.
func withFreshSession(runCtx RunProcessContext, sessionID string) RunProcessContext {
	runCtx.SessionID = sessionID
	runCtx.ContinueLast = false
	return runCtx
}

// shouldTreatAsCancelled reports whether a wait exit should be published as
// cancelled (context cancelled or run already transitioning to cancelling).
func shouldTreatAsCancelled(ctxErr error, status string) bool {
	return ctxErr != nil || status == "cancelling"
}

// shouldSurfaceRunArtifacts reports whether auto-surface may run for a finished run.
func shouldSurfaceRunArtifacts(found bool, status string) bool {
	return found && status == "finished"
}

// trimAgentFailureContent trims and validates content for agent_message persistence.
func trimAgentFailureContent(content string) (string, bool) {
	content = strings.TrimSpace(content)
	if content == "" {
		return "", false
	}
	return content, true
}

// hasAgentMessageForRun reports whether the thread already has an agent_message
// item for the given run (so failure persistence is skipped).
func hasAgentMessageForRun(items []store.Item, runID string) bool {
	for _, item := range items {
		if item.RunID == runID && item.Type == "agent_message" {
			return true
		}
	}
	return false
}

// applyParentWorkDirMemory copies the parent workdir onto the child run context
// and injects AgentHub memory when available.
func applyParentWorkDirMemory(runCtx RunProcessContext, parentWorkDir, threadID, agentID string) RunProcessContext {
	if parentWorkDir == "" {
		return runCtx
	}
	runCtx.WorkDir = parentWorkDir
	if memPrompt := runnerctx.BuildMemoryPrompt(parentWorkDir, threadID, agentID); memPrompt != "" {
		runCtx.SkillsPrompt = memPrompt
	}
	return runCtx
}

// shouldRecordHubTask reports whether a Hub task ID should be tracked for callbacks.
func shouldRecordHubTask(hubTaskID string) bool {
	return hubTaskID != ""
}

// shouldDeliverSubAgentResult reports whether result delivery plumbing is configured.
func shouldDeliverSubAgentResult(hasRegistry, hasQueue bool) bool {
	return hasRegistry && hasQueue
}

// shouldRouteSubAgentToParent reports whether a registry instance has a parent to notify.
func shouldRouteSubAgentToParent(found bool, parentID string) bool {
	return found && parentID != ""
}

// budgetFromParserContext extracts a non-nil context budget from parser context.
func budgetFromParserContext(ctx context.Context) (*runnerctx.ContextBudget, bool) {
	budget, ok := ctx.Value(adapters.CtxBudgetKey).(*runnerctx.ContextBudget)
	return budget, ok && budget != nil
}

// allowedToolsFromParserContext returns AllowedTools when present on the SDK run context.
func allowedToolsFromParserContext(ctx context.Context) ([]string, bool) {
	rc, ok := adapters.RunProcessContextFromContext(ctx)
	if !ok || len(rc.AllowedTools) == 0 {
		return nil, false
	}
	return rc.AllowedTools, true
}

// buildProcessSecurityHooks builds the unified security hook chain. When
// allowedTools is non-empty, the allowlist hook is prepended so it runs first.
func buildProcessSecurityHooks(allowedTools []string, emitter adapters.EventEmitter, scope map[string]any) adapters.HookChain {
	hooks := adapters.HookChain{adapters.NewSecurityHook()}
	if len(allowedTools) > 0 {
		allowlistHook := adapters.NewToolAllowlistHook(allowedTools, emitter, scope)
		hooks = adapters.HookChain{allowlistHook, adapters.NewSecurityHook()}
	}
	return hooks
}

// recoverableParseWarningMessage formats the human-readable recoverable parse warning.
func recoverableParseWarningMessage(err error) string {
	return fmt.Sprintf("Recoverable stream parse error: %v", err)
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

// shouldTrackWorkDir reports whether a workdir snapshot should be retained for
// post-finish auto-surface detection.
func shouldTrackWorkDir(workDir string) bool {
	return workDir != ""
}

// shouldEmitContextCompaction reports whether the run budget crossed the
// auto-compaction threshold and should publish a compaction event.
func shouldEmitContextCompaction(budget *runnerctx.ContextBudget) bool {
	return budget != nil && budget.ShouldCompact()
}

// shouldFireHubCallback reports whether a Hub callback may be sent for the task.
func shouldFireHubCallback(hasCallback bool, taskID string) bool {
	return hasCallback && taskID != ""
}

// prepareHubStreamContent sanitizes outbound Hub stream text. The bool is false
// when the content is empty before or after sanitization.
func prepareHubStreamContent(content string) (string, bool) {
	if content == "" {
		return "", false
	}
	content = sanitizeHubStreamText(content)
	if content == "" {
		return "", false
	}
	return content, true
}

// asPreflightAdapter returns the adapter when it implements PreflightAdapter.
func asPreflightAdapter(adapter adapters.AgentAdapter) (adapters.PreflightAdapter, bool) {
	if adapter == nil {
		return nil, false
	}
	preflight, ok := adapter.(adapters.PreflightAdapter)
	return preflight, ok && preflight != nil
}

// coalesceEmitter prefers next when non-nil; otherwise keeps current.
func coalesceEmitter(current, next adapters.EventEmitter) adapters.EventEmitter {
	if next != nil {
		return next
	}
	return current
}

// shouldReleaseReservedSpawnSlot reports whether a deferred spawn-slot release
// should run (error path while the slot is still reserved).
func shouldReleaseReservedSpawnSlot(err error, slotReserved bool) bool {
	return err != nil && slotReserved
}

// shouldUnregisterOnStartFailure reports whether a successfully registered
// sub-agent instance should be unregistered after Start fails.
func shouldUnregisterOnStartFailure(registered bool) bool {
	return registered
}

// buildSubAgentResult packages a completed child run for the result aggregator.
// completedAt is injected so the helper stays pure.
func buildSubAgentResult(agentID, agentName, runID, status string, output any, completedAt time.Time) SubAgentResult {
	return SubAgentResult{
		AgentID:     agentID,
		AgentName:   agentName,
		RunID:       runID,
		Status:      status,
		Output:      output,
		CompletedAt: completedAt,
	}
}

// resolveEvidenceFinalStatus returns the terminal status for a successful wait
// path. When the evidence gate is disabled, the run finishes cleanly.
func resolveEvidenceFinalStatus(gateEnabled, passed bool) string {
	if !gateEnabled {
		return "finished"
	}
	return evidenceGateFinalStatus(passed)
}
