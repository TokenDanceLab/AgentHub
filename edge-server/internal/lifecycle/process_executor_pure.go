package lifecycle

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
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

// requireProcessExecutorDeps validates the non-optional constructor dependencies.
func requireProcessExecutorDeps(bus *events.Bus, runStore store.RunLifecycleStore) error {
	if bus == nil {
		return ErrProcessBusRequired
	}
	if runStore == nil {
		return ErrProcessStoreRequired
	}
	return nil
}

// validateConfiguredWorkDir checks an optional configured process workdir after
// the caller has performed os.Stat. Empty workDir is always valid.
func validateConfiguredWorkDir(workDir string, info os.FileInfo, statErr error) error {
	if workDir == "" {
		return nil
	}
	if statErr != nil {
		return fmt.Errorf("process workdir %q is not accessible: %w", workDir, statErr)
	}
	if info == nil || !info.IsDir() {
		return fmt.Errorf("process workdir %q is not a directory", workDir)
	}
	return nil
}

// resolveMetricsAdapterLabel returns the Prometheus adapter label only when
// metrics instrumentation is attached.
func resolveMetricsAdapterLabel(hasMetrics bool, adapter adapters.AgentAdapter) string {
	if !hasMetrics {
		return ""
	}
	return resolveAdapterMetricsLabel(adapter)
}

// shouldRecordRunFinishMetrics reports whether a run actually started far enough
// to record finish latency (start timestamp is non-zero).
func shouldRecordRunFinishMetrics(runStartTime time.Time) bool {
	return !runStartTime.IsZero()
}

// shouldCloseStdinAfterStart reports whether a successfully opened stdin pipe
// should be closed eagerly after process start.
func shouldCloseStdinAfterStart(stdinOpen, needsStdin, hasDecisionLoop bool) bool {
	return stdinOpen && shouldCloseStdinEagerly(needsStdin, hasDecisionLoop)
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

// shouldPublishOutputChunk reports whether a read produced bytes and/or a
// truncation marker that must be published on the bus.
func shouldPublishOutputChunk(allowedLen int, truncatedNow bool) bool {
	return allowedLen > 0 || truncatedNow
}

// shouldLogStderrLines reports whether stderr text should be mirrored to slog.
func shouldLogStderrLines(stream, text string) bool {
	return stream == "stderr" && text != ""
}

// shouldForwardStdoutToHub reports whether stdout text should feed Hub stream
// collectors/callbacks.
func shouldForwardStdoutToHub(stream, text string) bool {
	return stream == "stdout" && text != ""
}

// shouldWriteRunOutputStore reports whether accepted output should be persisted
// to the run output temp store.
func shouldWriteRunOutputStore(hasStore bool, allowedLen int) bool {
	return hasStore && allowedLen > 0
}

// shouldPersistClassifiedFailure reports whether a classified failure message
// should be persisted as an agent_message item.
func shouldPersistClassifiedFailure(classified *RunError) bool {
	return classified != nil
}

// asStoreWriter returns the store when it implements store.Writer.
func asStoreWriter(runStore store.RunLifecycleStore) (store.Writer, bool) {
	writer, ok := runStore.(store.Writer)
	return writer, ok
}

// shouldCascadeAgentShutdown reports whether finish should cascade-terminate
// descendant sub-agents via the registry.
func shouldCascadeAgentShutdown(hasRegistry bool) bool {
	return hasRegistry
}

// shouldStoreSubAgentAggregatorResult reports whether a completed child result
// should be written into the result aggregator.
func shouldStoreSubAgentAggregatorResult(hasAggregator bool) bool {
	return hasAggregator
}

// shouldWrapDecisionLoopEmitter reports whether the decision-loop factory should
// wrap the structured-output emitter.
func shouldWrapDecisionLoopEmitter(hasFactory bool) bool {
	return hasFactory
}

// shouldFlushTranscriptEmitter reports whether a transcript emitter should flush
// after ParseStream returns.
func shouldFlushTranscriptEmitter(hasTranscript bool) bool {
	return hasTranscript
}

// shouldReserveSpawnSlot reports whether SpawnSubAgent should consult the
// registry for a TOCTOU-safe child slot reservation.
func shouldReserveSpawnSlot(hasRegistry bool) bool {
	return hasRegistry
}

// shouldRegisterSubAgentInstance reports whether a child agent instance should
// be registered in the agent registry.
func shouldRegisterSubAgentInstance(hasRegistry bool) bool {
	return hasRegistry
}

// lookupCancelResult maps a post-cancel store lookup into a CancelResult.
func lookupCancelResult(run store.Run, found bool) CancelResult {
	if found {
		return cancelResultWithRun(run)
	}
	return cancelResultNotFound()
}

// pipeOpenError formats stdout/stderr/stdin pipe open failures.
func pipeOpenError(pipe string, err error) error {
	return fmt.Errorf("open %s pipe: %w", pipe, err)
}

// adapterPreflightFailed wraps a PreflightAdapter failure for publishFailed.
func adapterPreflightFailed(err error) error {
	return fmt.Errorf("adapter preflight failed: %w", err)
}

// structuredOutputParseFailed wraps a non-recoverable ParseStream failure.
func structuredOutputParseFailed(err error) error {
	return fmt.Errorf("structured output parse error: %w", err)
}

// cancelledFailReason is the Hub TaskFail reason used for cancelled runs.
func cancelledFailReason() string {
	return "run cancelled"
}

// buildSubAgentResultMessage builds the inter-agent result/error message for a
// completed child run. timestamp is injected so the helper stays pure.
func buildSubAgentResultMessage(
	runID, agentID, agentName, parentID, status string,
	sanitizedResult any,
	sanitizeReason string,
	timestamp time.Time,
) agents.Message {
	return agents.Message{
		ID:          subAgentMessageID(runID),
		FromAgentID: agentID,
		ToAgentID:   parentID,
		Type:        subAgentResultMsgType(status),
		TriggerTurn: true, // wake parent orchestrator on sub-agent completion
		Payload: subAgentResultQueuePayload(
			runID, status, agentID, agentName, sanitizedResult, sanitizeReason,
		),
		Timestamp: timestamp,
	}
}

// hubCallbackSideEffect classifies how a structured bus event should feed Hub
// callback collectors (stream vs final fallback).
type hubCallbackSideEffect int

const (
	hubCallbackNone hubCallbackSideEffect = iota
	hubCallbackStream
	hubCallbackFallback
)

// classifyHubCallbackEvent maps adapter bus event types to hub side effects.
func classifyHubCallbackEvent(eventType string) hubCallbackSideEffect {
	switch eventType {
	case adapters.BusEventTextDelta, adapters.BusEventTextBlock:
		return hubCallbackStream
	case adapters.BusEventResult:
		return hubCallbackFallback
	default:
		return hubCallbackNone
	}
}

// hubCallbackTextForEvent extracts text and the hub side-effect for an event.
func hubCallbackTextForEvent(eventType string, payload any) (string, hubCallbackSideEffect) {
	effect := classifyHubCallbackEvent(eventType)
	if effect == hubCallbackNone {
		return "", hubCallbackNone
	}
	return extractHubCallbackText(payload), effect
}

// shouldWrapHubCallbackEmitter reports whether a hub callback emitter wrapper
// can be constructed around the inner emitter.
func shouldWrapHubCallbackEmitter(hasExecutor, hasInner bool) bool {
	return hasExecutor && hasInner
}

// resolveProcessExecutorTimeouts applies package defaults for run and shutdown
// timeouts when the caller leaves them non-positive.
func resolveProcessExecutorTimeouts(cfg ProcessExecutorConfig) (runTimeout, shutdownGrace, shutdownForce time.Duration) {
	return resolvePositiveDuration(cfg.RunTimeout, defaultRunTimeout),
		resolvePositiveDuration(cfg.ShutdownGracePeriod, defaultShutdownGracePeriod),
		resolvePositiveDuration(cfg.ShutdownForceTimeout, defaultShutdownForceTimeout)
}

// shouldStatConfiguredWorkDir reports whether the constructor must validate a
// configured process workdir via os.Stat.
func shouldStatConfiguredWorkDir(workDir string) bool {
	return workDir != ""
}

// buildProcessExecutor constructs the default ProcessExecutor maps/state. Pure
// relative to I/O: callers supply already-resolved deps and timeouts.
func buildProcessExecutor(
	bus *events.Bus,
	runStore store.RunLifecycleStore,
	profile RunnerProfile,
	adapter adapters.AgentAdapter,
	adapterReg *adapters.Registry,
	runTimeout, shutdownGrace, shutdownForce time.Duration,
	evidenceGateCfg EvidenceGateConfig,
	faultEscalationCfg FaultEscalationConfig,
) *ProcessExecutor {
	return &ProcessExecutor{
		bus:                       bus,
		store:                     runStore,
		profile:                   profile,
		adapter:                   adapter,
		adapterReg:                adapterReg,
		maxConcurrentRuns:         defaultMaxConcurrentRuns,
		maxRunOutputBytes:         defaultRunOutputMaxBytes,
		maxStructuredPayloadBytes: adapters.DefaultStructuredPayloadMaxBytes,
		runTimeout:                runTimeout,
		shutdownGracePeriod:       shutdownGrace,
		shutdownForceTimeout:      shutdownForce,
		evidenceGateCfg:           evidenceGateCfg,
		faultEscalationCfg:        faultEscalationCfg,
		running:                   make(map[string]context.CancelFunc),
		stdins:                    make(map[string]io.Writer),
		processes:                 make(map[string]*os.Process),
		runOutputs:                make(map[string]*runnerctx.RunOutputStore),
		runToAgent:                make(map[string]string),
		hubTasks:                  make(map[string]string),
		hubOutputs:                make(map[string]*hubOutputCollector),
		workDirs:                  make(map[string]string),
		surfacers:                 make(map[string]*adapters.WorkdirSnapshot),
		cancelDone:                make(map[string]chan struct{}),
		callbackSem:               make(chan struct{}, 10), // max 10 concurrent hub callbacks
	}
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

// shouldPerformTerminalFinish reports whether the deferred finish path owns
// concurrency-slot teardown for this attempt (see #867 handoff).
func shouldPerformTerminalFinish(terminalFinish bool) bool {
	return terminalFinish
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

// shouldProcessOutputRead reports whether a pipe read produced bytes to process.
func shouldProcessOutputRead(n int) bool {
	return n > 0
}

// shouldLogRunOutputTruncation reports whether a truncation marker should be
// mirrored to the structured logger.
func shouldLogRunOutputTruncation(truncatedNow bool) bool {
	return truncatedNow
}

// shouldStopOutputRead reports whether publishOutput should exit the read loop.
func shouldStopOutputRead(err error) bool {
	return err != nil
}

// runStatusFromLookup maps a store.GetRun result to the status string used by
// cancel/finish predicates (empty when the run is missing).
func runStatusFromLookup(run store.Run, found bool) string {
	if !found {
		return ""
	}
	return run.Status
}

// agentFailureRepository is the dual Reader+Writer surface needed to persist a
// failed agent_message without inventing a new store API.
type agentFailureRepository interface {
	store.Reader
	store.Writer
}

// asAgentFailureRepository returns the store when it can both list thread items
// and create failure messages.
func asAgentFailureRepository(runStore store.RunLifecycleStore) (agentFailureRepository, bool) {
	repository, ok := runStore.(interface {
		store.Reader
		store.Writer
	})
	return repository, ok
}

// persistErrorSource exposes the last FileStore persistence failure.
type persistErrorSource interface {
	LastPersistError() error
}

// asPersistErrorSource returns the store when it tracks persistence errors.
func asPersistErrorSource(runStore store.RunLifecycleStore) (persistErrorSource, bool) {
	source, ok := runStore.(persistErrorSource)
	return source, ok
}

// shouldEmitPersistenceError reports whether a pending persist failure should
// be logged and published on the bus.
func shouldEmitPersistenceError(err error) bool {
	return err != nil
}

// shouldCloseCancelDoneChannel reports whether finish should close the graceful
// shutdown abort channel for a run.
func shouldCloseCancelDoneChannel(found bool) bool {
	return found
}

// shouldCloseTrackedRunOutput reports whether finish should close a tracked
// run output store.
func shouldCloseTrackedRunOutput(found bool) bool {
	return found
}

// shouldSurfaceWithSnapshot reports whether auto-surface has a pre-run workdir
// snapshot to compare against.
func shouldSurfaceWithSnapshot(snapshot *adapters.WorkdirSnapshot) bool {
	return snapshot != nil
}

// shouldApplyBudgetAwareEmitter reports whether the structured-output emitter
// should be wrapped with budget monitoring.
func shouldApplyBudgetAwareEmitter(hasBudget bool) bool {
	return hasBudget
}

// shouldClearRunAgentMappingOnStartFailure reports whether SpawnSubAgent should
// drop the run→agent map entry after Start fails.
func shouldClearRunAgentMappingOnStartFailure(startErr error) bool {
	return startErr != nil
}

// nextFaultEscalationRetryCount returns the retry counter after one escalation
// attempt is accepted. Control flow / #867 handoff stays in the executor.
func nextFaultEscalationRetryCount(retryCount int) int {
	return retryCount + 1
}

// contextCompactionSnapshot reads compaction diagnostics from a budget. Pure
// relative to I/O (atomic load only).
func contextCompactionSnapshot(budget *runnerctx.ContextBudget) (usagePct float64, tokensUsed, remaining int64) {
	if budget == nil {
		return 0, 0, 0
	}
	return budget.UsagePercent(), budget.UsedTokens.Load(), budget.Remaining()
}

// shouldResetSessionRetryStatus reports whether a session-conflict retry should
// attempt to re-queue the run before relaunching.
func shouldResetSessionRetryStatus(retrying bool) bool {
	return retrying
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

// shouldLogRunOutputStoreCreateFailure reports whether NewRunOutputStore failure
// should be warned (run continues without persistence/replay).
func shouldLogRunOutputStoreCreateFailure(err error) bool {
	return err != nil
}

// shouldTrackRunOutputStore reports whether a successfully created output store
// should be retained on the executor.
func shouldTrackRunOutputStore(err error) bool {
	return err == nil
}

// shouldCloseStdinPipe reports whether an open stdin WriteCloser should be
// closed (distinct from the eager-close decision).
func shouldCloseStdinPipe(stdinOpen bool) bool {
	return stdinOpen
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

// shouldInvokeOldCancelOnEscalationHandoff reports whether the previous attempt's
// cancel func should be invoked before re-registering the successor cancel.
func shouldInvokeOldCancelOnEscalationHandoff(found bool) bool {
	return found
}

// shouldLogRunOutputStoreWriteFailure reports whether a run-output store write
// error should be warned (non-fatal).
func shouldLogRunOutputStoreWriteFailure(err error) bool {
	return err != nil
}

// shouldLogAgentFailurePersistError reports whether CreateItem failure for a
// failure agent_message should be warned.
func shouldLogAgentFailurePersistError(err error) bool {
	return err != nil
}

// shouldLogRunOutputStoreCloseFailure reports whether closing a tracked run
// output store failed and should be warned.
func shouldLogRunOutputStoreCloseFailure(err error) bool {
	return err != nil
}

// shouldLogSpawnSlotRejection reports whether TryReserveSlot rejected the spawn.
func shouldLogSpawnSlotRejection(err error) bool {
	return err != nil
}

// shouldLogSubAgentCreateFailure reports whether CreateRun failed for a spawn.
func shouldLogSubAgentCreateFailure(err error) bool {
	return err != nil
}

// shouldLogSubAgentRegisterFailure reports whether registry Register failed for
// a spawned child (non-fatal; spawn continues without registry tracking).
func shouldLogSubAgentRegisterFailure(err error) bool {
	return err != nil
}

// subAgentSpawnIDs builds the stable run and agent-instance IDs for a task.
func subAgentSpawnIDs(taskID string) (runID, agentInstanceID string) {
	return subAgentRunID(taskID), subAgentInstanceID(taskID)
}

// shouldLookupSubAgentMapping reports whether a run→agent map entry was found
// for result delivery.
func shouldLookupSubAgentMapping(found bool) bool {
	return found
}

// shouldHaveHubOutputCollector reports whether a hub output collector exists for
// the run (used by record/final helpers).
func shouldHaveHubOutputCollector(hasCollector bool) bool {
	return hasCollector
}

// shouldLogHubCallbackFailure reports whether a Hub callback transport error
// should be warned (callbacks never block lifecycle).
func shouldLogHubCallbackFailure(err error) bool {
	return err != nil
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

// shouldPersistAgentFailureContent reports whether trimmed failure content may
// be persisted as an agent_message.
func shouldPersistAgentFailureContent(ok bool) bool {
	return ok
}

// shouldUseAgentFailureRepository reports whether the store exposes the dual
// Reader+Writer surface needed for failure message persistence.
func shouldUseAgentFailureRepository(ok bool) bool {
	return ok
}

// shouldSkipExistingAgentFailureMessage reports whether a failure agent_message
// already exists for the run and CreateItem should be skipped.
func shouldSkipExistingAgentFailureMessage(exists bool) bool {
	return exists
}

// shouldCheckPersistErrorSource reports whether the store exposes
// LastPersistError and checkPersistError should continue.
func shouldCheckPersistErrorSource(ok bool) bool {
	return ok
}

// shouldSurfaceWithWriter reports whether auto-surface may persist via a
// store.Writer implementation.
func shouldSurfaceWithWriter(ok bool) bool {
	return ok
}

// shouldRecordStructuredParseError reports whether adapter.ParseStream failed
// and the error should be recorded for the session-retry loop.
func shouldRecordStructuredParseError(err error) bool {
	return err != nil
}

// shouldMarkSubAgentRegistered reports whether registry Register succeeded so
// start-failure cleanup must Unregister the child.
func shouldMarkSubAgentRegistered(err error) bool {
	return err == nil
}

// classifyPublishedFailure builds the classified RunError used by publishFailed
// event payloads and Hub fail callbacks.
func classifyPublishedFailure(err error) *RunError {
	return ClassifyError(err, ExitCodeFromErr(err))
}

// shouldLogForbiddenPermissionMode reports whether a forbidden permission mode
// fallback should be warned (SEC-02 defense-in-depth).
func shouldLogForbiddenPermissionMode(forbidden bool) bool {
	return forbidden
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

// evaluateSpawnSlotReservation maps a TryReserveSlot result to reserved/reject
// without touching registry state. hasRegistry gates the call site.
func evaluateSpawnSlotReservation(hasRegistry bool, reserveErr error) (reserved bool, reject error) {
	if !shouldReserveSpawnSlot(hasRegistry) {
		return false, nil
	}
	if shouldLogSpawnSlotRejection(reserveErr) {
		return false, reserveErr
	}
	return true, nil
}

// evaluateSubAgentRegistration maps a registry Register result to registered /
// logFailure flags. hasRegistry gates the call site.
func evaluateSubAgentRegistration(hasRegistry bool, regErr error) (registered, logFailure bool) {
	if !shouldRegisterSubAgentInstance(hasRegistry) {
		return false, false
	}
	if shouldLogSubAgentRegisterFailure(regErr) {
		return false, true
	}
	return shouldMarkSubAgentRegistered(regErr), false
}

// slotReservedAfterUnregister clears the reserved flag when Unregister will
// already DecrChildCount, preventing the deferred release from double-decrementing.
func slotReservedAfterUnregister(registered, slotReserved bool) bool {
	if shouldUnregisterOnStartFailure(registered) {
		return false
	}
	return slotReserved
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

// shouldApplyHubCallbackSideEffect reports whether hubCallbackEmitter should
// forward extracted text into stream/fallback collectors.
func shouldApplyHubCallbackSideEffect(text string, effect hubCallbackSideEffect) bool {
	return text != "" && effect != hubCallbackNone
}

// isHubCallbackStreamEffect reports whether the side-effect is live stream text.
func isHubCallbackStreamEffect(effect hubCallbackSideEffect) bool {
	return effect == hubCallbackStream
}

// isHubCallbackFallbackEffect reports whether the side-effect is final fallback text.
func isHubCallbackFallbackEffect(effect hubCallbackSideEffect) bool {
	return effect == hubCallbackFallback
}

// shouldClearStdinAfterEagerClose reports whether the run's stdin map entry should
// be dropped after an eager post-start close.
func shouldClearStdinAfterEagerClose(closed bool) bool {
	return closed
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

// finishRunMapKeys lists executor map keys cleaned on terminal finish. Pure
// documentation of the finish() cleanup set (no map mutation).
func finishRunMapKeys() []string {
	return []string{
		"running",
		"stdins",
		"processes",
		"runToAgent",
		"hubTasks",
		"hubOutputs",
		"workDirs",
		"surfacers",
		"cancelDone",
		"runOutputs",
	}
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

// spawnStartFailurePlan is the pure cleanup plan when SpawnSubAgent's Start fails.
type spawnStartFailurePlan struct {
	ClearMapping bool
	Unregister   bool
	SlotReserved bool
}

// planSpawnStartFailureCleanup maps Start failure + registration state into the
// cleanup flags used before returning the error. SlotReserved is the value to
// assign back to the deferred release flag (false when Unregister will Decr).
func planSpawnStartFailureCleanup(startErr error, registered, slotReserved bool) spawnStartFailurePlan {
	if !shouldClearRunAgentMappingOnStartFailure(startErr) {
		return spawnStartFailurePlan{SlotReserved: slotReserved}
	}
	return spawnStartFailurePlan{
		ClearMapping: true,
		Unregister:   shouldUnregisterOnStartFailure(registered),
		SlotReserved: slotReservedAfterUnregister(registered, slotReserved),
	}
}

// subAgentResultDeliveryPlan is the pure delivery plan for sendSubAgentResult.
type subAgentResultDeliveryPlan struct {
	Deliver        bool
	UpdateRegistry bool
	RegistryStatus agents.Status
	StoreAgg       bool
}

// planSubAgentResultDelivery decides whether to deliver a result message, update
// the agent registry terminal status, and store into the result aggregator.
// Sanitization and queue I/O stay in the executor.
func planSubAgentResultDelivery(
	hasRegistry, hasQueue, mappingFound, agentFound bool,
	parentID, status string,
	hasAggregator bool,
) subAgentResultDeliveryPlan {
	if !shouldDeliverSubAgentResult(hasRegistry, hasQueue) {
		return subAgentResultDeliveryPlan{}
	}
	if !shouldLookupSubAgentMapping(mappingFound) {
		return subAgentResultDeliveryPlan{}
	}
	if !shouldRouteSubAgentToParent(agentFound, parentID) {
		return subAgentResultDeliveryPlan{}
	}
	regStatus, update := subAgentRegistryTerminalStatus(status)
	return subAgentResultDeliveryPlan{
		Deliver:        true,
		UpdateRegistry: update,
		RegistryStatus: regStatus,
		StoreAgg:       shouldStoreSubAgentAggregatorResult(hasAggregator),
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

// finishCleanupPlan is the pure terminal-finish side-effect plan (cascade +
// optional channel/store close). Map deletes stay in the executor.
type finishCleanupPlan struct {
	Cascade         bool
	CloseCancelDone bool
	CloseRunOutput  bool
}

// planFinishCleanup decides cascade shutdown and which optional tracked resources
// need close during terminal finish. Does not rework #867 handoff ownership.
func planFinishCleanup(hasRegistry, hasCancelDone, hasRunOutput bool) finishCleanupPlan {
	return finishCleanupPlan{
		Cascade:         shouldCascadeAgentShutdown(hasRegistry),
		CloseCancelDone: shouldCloseCancelDoneChannel(hasCancelDone),
		CloseRunOutput:  shouldCloseTrackedRunOutput(hasRunOutput),
	}
}

// outputChunkPlan is the pure publish plan for one publishOutput read chunk.
type outputChunkPlan struct {
	Publish     bool
	Text        string
	LogStderr   bool
	WriteStore  bool
	ForwardHub  bool
	LogTruncate bool
	Payload     map[string]any
	NextOffset  int
}

// planOutputChunk maps a limiter.allow result into publish/log/store/hub flags
// and the bus payload. Side-effects stay in the executor.
func planOutputChunk(runID, stream string, allowed []byte, offset int, truncatedNow bool, written, maxBytes int64, hasOutStore bool) outputChunkPlan {
	if !shouldPublishOutputChunk(len(allowed), truncatedNow) {
		return outputChunkPlan{NextOffset: offset}
	}
	text := string(allowed)
	return outputChunkPlan{
		Publish:     true,
		Text:        text,
		LogStderr:   shouldLogStderrLines(stream, text),
		WriteStore:  shouldWriteRunOutputStore(hasOutStore, len(allowed)),
		ForwardHub:  shouldForwardStdoutToHub(stream, text),
		LogTruncate: shouldLogRunOutputTruncation(truncatedNow),
		Payload:     runOutputBatchPayload(runID, stream, text, offset, truncatedNow, written, maxBytes),
		NextOffset:  offset + len(allowed),
	}
}

// surfaceArtifactsPlan is the pure auto-surface gate for surfaceRunArtifacts.
type surfaceArtifactsPlan struct {
	Proceed       bool
	SkipWriterLog bool
}

// planSurfaceArtifacts decides whether auto-surface should run and whether to
// log the "store does not implement Writer" skip path.
func planSurfaceArtifacts(snapshot *adapters.WorkdirSnapshot, runFound bool, status string, hasWriter bool) surfaceArtifactsPlan {
	if !shouldSurfaceWithSnapshot(snapshot) {
		return surfaceArtifactsPlan{}
	}
	if !shouldSurfaceRunArtifacts(runFound, status) {
		return surfaceArtifactsPlan{}
	}
	if !shouldSurfaceWithWriter(hasWriter) {
		return surfaceArtifactsPlan{SkipWriterLog: true}
	}
	return surfaceArtifactsPlan{Proceed: true}
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

// runOutputStoreTrackPlan is the pure create-result plan for NewRunOutputStore.
type runOutputStoreTrackPlan struct {
	LogFailure bool
	Track      bool
}

// planRunOutputStoreTrack maps NewRunOutputStore's error into log/track flags.
func planRunOutputStoreTrack(err error) runOutputStoreTrackPlan {
	return runOutputStoreTrackPlan{
		LogFailure: shouldLogRunOutputStoreCreateFailure(err),
		Track:      shouldTrackRunOutputStore(err),
	}
}

// workdirTrackPlan is the pure pre-run workdir snapshot gate.
type workdirTrackPlan struct {
	Track bool
}

// planWorkdirTrack reports whether a workdir should be snapshotted/tracked.
func planWorkdirTrack(workDir string) workdirTrackPlan {
	return workdirTrackPlan{Track: shouldTrackWorkDir(workDir)}
}

// hubTaskRecordPlan is the pure Hub task-ID recording gate for run().
type hubTaskRecordPlan struct {
	Record bool
}

// planHubTaskRecord reports whether a non-empty Hub task ID should be stored.
// Does not allocate hubOutputs collectors (#987 owns that residual).
func planHubTaskRecord(hubTaskID string) hubTaskRecordPlan {
	return hubTaskRecordPlan{Record: shouldRecordHubTask(hubTaskID)}
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

// finishMetricsRecordPlan is the pure late-finish metrics gate inside the deferred closer.
type finishMetricsRecordPlan struct {
	Record bool
}

// planFinishMetricsRecord decides whether RecordRunFinish should fire after a successful Start.
func planFinishMetricsRecord(runStartTime time.Time, runFound bool) finishMetricsRecordPlan {
	if !shouldRecordRunFinishMetrics(runStartTime) {
		return finishMetricsRecordPlan{}
	}
	if !shouldRecordFinishMetricsForRun(runFound) {
		return finishMetricsRecordPlan{}
	}
	return finishMetricsRecordPlan{Record: true}
}

// publishFailedPlan is the pure publishFailed side-effect plan after a status transition.
type publishFailedPlan struct {
	Publish    bool
	Persist    bool
	Classified *RunError
}

// planPublishFailed maps a SetRunStatusIf result + raw error into publish/persist flags
// and the classified RunError payload. Classify only runs when publishing (same as before).
func planPublishFailed(transitionOK bool, err error) publishFailedPlan {
	if !shouldPublishStatusTransition(transitionOK) {
		return publishFailedPlan{}
	}
	classified := classifyPublishedFailure(err)
	return publishFailedPlan{
		Publish:    true,
		Persist:    shouldPersistClassifiedFailure(classified),
		Classified: classified,
	}
}

// persistAgentFailurePlan is the pure multi-gate plan for persistAgentFailureMessage.
type persistAgentFailurePlan struct {
	Proceed bool
}

// planPersistAgentFailure decides whether CreateItem should run after content trim,
// repository type-assert, and existing-message lookup.
func planPersistAgentFailure(contentOK, repoOK, alreadyExists bool) persistAgentFailurePlan {
	if !shouldPersistAgentFailureContent(contentOK) {
		return persistAgentFailurePlan{}
	}
	if !shouldUseAgentFailureRepository(repoOK) {
		return persistAgentFailurePlan{}
	}
	if shouldSkipExistingAgentFailureMessage(alreadyExists) {
		return persistAgentFailurePlan{}
	}
	return persistAgentFailurePlan{Proceed: true}
}

// persistErrorPlan is the pure checkPersistError emit plan.
type persistErrorPlan struct {
	Emit bool
}

// planPersistError decides whether a LastPersistError should emit run.persistence_error.
// sourceOK gates the store type-assert; persistErr is the looked-up error (nil when absent).
func planPersistError(sourceOK bool, persistErr error) persistErrorPlan {
	if !shouldCheckPersistErrorSource(sourceOK) {
		return persistErrorPlan{}
	}
	return persistErrorPlan{Emit: shouldEmitPersistenceError(persistErr)}
}

// structuredEmitterWrapPlan is the pure emitter-wrapper plan for publishStructuredOutput.
type structuredEmitterWrapPlan struct {
	ApplyBudget      bool
	WrapDecisionLoop bool
}

// planStructuredEmitterWraps maps budget/decision-loop presence into wrap flags.
// Actual Wrap construction stays in the executor.
func planStructuredEmitterWraps(hasBudget, hasDecisionLoop bool) structuredEmitterWrapPlan {
	return structuredEmitterWrapPlan{
		ApplyBudget:      shouldApplyBudgetAwareEmitter(hasBudget),
		WrapDecisionLoop: shouldWrapDecisionLoopEmitter(hasDecisionLoop),
	}
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

// cancelGraceArmPlan is the pure Cancel grace-path arm decision (#988).
type cancelGraceArmPlan struct {
	Arm bool
}

// planCancelGraceArm reports whether Cancel should register cancelDone and start
// the interrupt→SIGTERM→kill escalation goroutine for a tracked process.
func planCancelGraceArm(proc *os.Process) cancelGraceArmPlan {
	return cancelGraceArmPlan{Arm: shouldStartGracefulProcessShutdown(proc)}
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

// contextCompactionPlan is the pure post-stream compaction emit plan.
type contextCompactionPlan struct {
	Emit       bool
	UsagePct   float64
	TokensUsed int64
	Remaining  int64
	Payload    map[string]any
}

// planContextCompaction snapshots budget usage and builds the bus payload when
// the auto-compaction threshold is crossed. Side-effects stay in the executor.
func planContextCompaction(budget *runnerctx.ContextBudget, runID string) contextCompactionPlan {
	if !shouldEmitContextCompaction(budget) {
		return contextCompactionPlan{}
	}
	usagePct, tokensUsed, remaining := contextCompactionSnapshot(budget)
	return contextCompactionPlan{
		Emit:       true,
		UsagePct:   usagePct,
		TokensUsed: tokensUsed,
		Remaining:  remaining,
		Payload:    contextCompactionPayload(runID, usagePct, tokensUsed, remaining),
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

// publishStatusPlan is the pure status-transition publish gate.
type publishStatusPlan struct {
	Publish bool
}

// planPublishStatus reports whether a conditional SetRunStatusIf transition may
// publish bus/Hub side effects.
func planPublishStatus(ok bool) publishStatusPlan {
	return publishStatusPlan{Publish: shouldPublishStatusTransition(ok)}
}

// preflightFailurePlan is the pure PreflightCheck failure gate.
type preflightFailurePlan struct {
	Fail bool
}

// planPreflightFailure reports whether a PreflightCheck error should fail the run.
func planPreflightFailure(err error) preflightFailurePlan {
	return preflightFailurePlan{Fail: shouldPublishPreflightFailure(err)}
}

// newProcessExecutorPlan is the pure constructor gate after profile construction.
type newProcessExecutorPlan struct {
	FailProfile bool
	StatWorkDir bool
}

// planNewProcessExecutor maps profile construction error + configured workDir into
// constructor control flags. Stat/Validate side-effects stay in NewProcessExecutor.
func planNewProcessExecutor(profileErr error, workDir string) newProcessExecutorPlan {
	return newProcessExecutorPlan{
		FailProfile: shouldFailNewRunnerProfile(profileErr),
		StatWorkDir: shouldStatConfiguredWorkDir(workDir),
	}
}

// writeInterruptStdinPlan is the pure Cancel stdin-interrupt gate.
type writeInterruptStdinPlan struct {
	Write bool
}

// planWriteInterruptStdin reports whether Cancel should WriteInterrupt on a tracked stdin.
func planWriteInterruptStdin(hasStdin bool) writeInterruptStdinPlan {
	return writeInterruptStdinPlan{Write: shouldWriteInterruptStdin(hasStdin)}
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

// cancelledRunPlan is the pure post-wait cancellation detection plan.
type cancelledRunPlan struct {
	Cancelled bool
}

// planCancelledRun maps context/status into the publishCancelled branch.
func planCancelledRun(ctxErr error, status string) cancelledRunPlan {
	return cancelledRunPlan{Cancelled: shouldTreatAsCancelled(ctxErr, status)}
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

// outputReadPlan is the pure publishOutput read-loop gate for one Read result.
type outputReadPlan struct {
	Process bool
	Stop    bool
}

// planOutputRead maps Read (n, err) into process-chunk / stop-loop flags.
// Store write / hub forward stay on the chunk plan.
func planOutputRead(n int, err error) outputReadPlan {
	return outputReadPlan{
		Process: shouldProcessOutputRead(n),
		Stop:    shouldStopOutputRead(err),
	}
}

// outputStoreWriteLogPlan is the pure run-output store write failure log gate.
type outputStoreWriteLogPlan struct {
	Log bool
}

// planOutputStoreWriteLog maps an outStore.Write error into the warn-log flag.
func planOutputStoreWriteLog(err error) outputStoreWriteLogPlan {
	return outputStoreWriteLogPlan{Log: shouldLogRunOutputStoreWriteFailure(err)}
}

// agentFailurePersistLogPlan is the pure CreateItem failure log gate.
type agentFailurePersistLogPlan struct {
	Log bool
}

// planAgentFailurePersistLog maps a CreateItem error into the warn-log flag.
func planAgentFailurePersistLog(err error) agentFailurePersistLogPlan {
	return agentFailurePersistLogPlan{Log: shouldLogAgentFailurePersistError(err)}
}

// runOutputCloseLogPlan is the pure finish-path outStore.Close failure log gate.
type runOutputCloseLogPlan struct {
	Log bool
}

// planRunOutputCloseLog maps an outStore.Close error into the warn-log flag.
func planRunOutputCloseLog(err error) runOutputCloseLogPlan {
	return runOutputCloseLogPlan{Log: shouldLogRunOutputStoreCloseFailure(err)}
}

// spawnSlotReservePlan is the pure registry presence gate before TryReserveSlot.
type spawnSlotReservePlan struct {
	Try bool
}

// planSpawnSlotReserve reports whether SpawnSubAgent should call TryReserveSlot.
func planSpawnSlotReserve(hasRegistry bool) spawnSlotReservePlan {
	return spawnSlotReservePlan{Try: shouldReserveSpawnSlot(hasRegistry)}
}

// spawnSlotRejectLogPlan is the pure spawn-slot rejection log gate.
type spawnSlotRejectLogPlan struct {
	Log bool
}

// planSpawnSlotRejectLog reports whether a rejected spawn slot should be warned.
func planSpawnSlotRejectLog(err error) spawnSlotRejectLogPlan {
	return spawnSlotRejectLogPlan{Log: shouldLogSpawnSlotRejection(err)}
}

// spawnSlotReleasePlan is the pure deferred DecrChildCount gate on spawn error paths.
type spawnSlotReleasePlan struct {
	Release bool
}

// planSpawnSlotRelease reports whether the deferred spawn cleanup should DecrChildCount.
func planSpawnSlotRelease(err error, slotReserved bool) spawnSlotReleasePlan {
	return spawnSlotReleasePlan{Release: shouldReleaseReservedSpawnSlot(err, slotReserved)}
}

// subAgentCreateLogPlan is the pure CreateRun failure log gate for SpawnSubAgent.
type subAgentCreateLogPlan struct {
	Log bool
}

// planSubAgentCreateLog reports whether a sub-agent CreateRun error should be logged.
func planSubAgentCreateLog(err error) subAgentCreateLogPlan {
	return subAgentCreateLogPlan{Log: shouldLogSubAgentCreateFailure(err)}
}

// subAgentRegisterPlan is the pure registry presence gate before Register.
type subAgentRegisterPlan struct {
	Register bool
}

// planSubAgentRegister reports whether SpawnSubAgent should Register a child instance.
func planSubAgentRegister(hasRegistry bool) subAgentRegisterPlan {
	return subAgentRegisterPlan{Register: shouldRegisterSubAgentInstance(hasRegistry)}
}

// stdinPipeOpenPlan is the pure adapter stdin pipe open gate.
type stdinPipeOpenPlan struct {
	Open bool
}

// planStdinPipeOpen reports whether StdinPipe should be opened for the resolved adapter.
func planStdinPipeOpen(adapter adapters.AgentAdapter) stdinPipeOpenPlan {
	return stdinPipeOpenPlan{Open: needsAdapterStdin(adapter)}
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

// preflightAdapterPlan is the pure type-assert gate before PreflightCheck.
type preflightAdapterPlan struct {
	Check bool
}

// planPreflightAdapter reports whether the resolved adapter implements
// PreflightAdapter and should run PreflightCheck.
func planPreflightAdapter(ok bool) preflightAdapterPlan {
	return preflightAdapterPlan{Check: ok}
}

// subAgentInstanceLookupPlan is the pure gate before registry.Get in sendSubAgentResult.
type subAgentInstanceLookupPlan struct {
	Lookup bool
}

// planSubAgentInstanceLookup reports whether sendSubAgentResult should call
// agentRegistry.Get for the run→agent mapping.
func planSubAgentInstanceLookup(hasRegistry, mappingFound bool) subAgentInstanceLookupPlan {
	return subAgentInstanceLookupPlan{Lookup: hasRegistry && mappingFound}
}

// parentIDFromAgentInstance returns ParentID when inst is non-nil; empty otherwise.
// Keeps nil-deref free of orchestration in sendSubAgentResult.
func parentIDFromAgentInstance(inst *agents.AgentInstance) string {
	if inst == nil {
		return ""
	}
	return inst.ParentID
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

// buildSubAgentRunContext composes the pure sub-agent RunProcessContext from
// task fields, parent workdir memory, and sibling system prompt. Map/IO stays
// in SpawnSubAgent (parent workdir lookup).
func buildSubAgentRunContext(run store.Run, task adapters.SubAgentTask, threadID, parentWorkDir string) RunProcessContext {
	runCtx := newSubAgentRunContext(run, task, threadID)
	runCtx = applyParentWorkDirMemory(runCtx, parentWorkDir, threadID, task.AgentID)
	runCtx.AppendSystemPrompt = withSiblingSystemPrompt(runCtx.AppendSystemPrompt, task.SiblingAgents)
	return runCtx
}

// spawnSlotRejectPlan is the pure reject path after evaluateSpawnSlotReservation.
type spawnSlotRejectPlan struct {
	Reject bool
	Log    bool
}

// planSpawnSlotReject maps a non-nil reject error into reject/log flags.
// evaluateSpawnSlotReservation already filters non-reject cases; reject!=nil
// always logs (same as shouldLogSpawnSlotRejection for non-nil err).
func planSpawnSlotReject(reject error) spawnSlotRejectPlan {
	if reject == nil {
		return spawnSlotRejectPlan{}
	}
	return spawnSlotRejectPlan{Reject: true, Log: shouldLogSpawnSlotRejection(reject)}
}

// subAgentRegistrationOutcome is the pure Register result after registry.Register.
type subAgentRegistrationOutcome struct {
	Registered bool
	LogFailure bool
}

// planSubAgentRegistrationOutcome maps a Register error when the registry path
// was taken (hasRegistry=true at call site).
func planSubAgentRegistrationOutcome(regErr error) subAgentRegistrationOutcome {
	registered, logFailure := evaluateSubAgentRegistration(true, regErr)
	return subAgentRegistrationOutcome{Registered: registered, LogFailure: logFailure}
}

// spawnStartLogPlan reports whether a Start error should be logged.
type spawnStartLogPlan struct {
	Log bool
}

// planSpawnStartLog reports whether a Start error should be logged.
func planSpawnStartLog(startErr error) spawnStartLogPlan {
	return spawnStartLogPlan{Log: startErr != nil}
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

// persistAgentFailureGatePlan is the pure early gate for content/repo presence
// before ListThreadItems (avoids store scan when content/repo unavailable).
type persistAgentFailureGatePlan struct {
	ScanExists bool
}

// planPersistAgentFailureGate reports whether hasAgentMessageForRun should run.
func planPersistAgentFailureGate(contentOK, repoOK bool) persistAgentFailureGatePlan {
	return persistAgentFailureGatePlan{ScanExists: contentOK && repoOK}
}
