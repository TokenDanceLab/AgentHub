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
