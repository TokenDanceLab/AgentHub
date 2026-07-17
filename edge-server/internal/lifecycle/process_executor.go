package lifecycle

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/metrics"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

var ErrProcessBusRequired = errors.New("process event bus is required")
var ErrProcessCommandRequired = errors.New("process command is required")
var ErrProcessStoreRequired = errors.New("process store is required")
var ErrTooManyConcurrentRuns = errors.New("too many concurrent runs")

type ProcessExecutorConfig struct {
	Command  string
	Args     []string
	Env      []string
	ExtraEnv []string
	WorkDir  string

	// RunTimeout is the per-run deadline. After this duration the runner
	// context is cancelled, which triggers process termination. Zero means
	// use defaultRunTimeout (30 minutes).
	RunTimeout time.Duration

	// ShutdownGracePeriod is how long to wait after sending a stdin interrupt
	// before escalating to process termination. On Unix, SIGTERM is sent first
	// and the process is given ShutdownForceTimeout before a final SIGKILL.
	// Zero means use defaultShutdownGracePeriod (10 seconds).
	ShutdownGracePeriod time.Duration

	// ShutdownForceTimeout is how long to wait after sending SIGTERM (Unix)
	// before escalating to SIGKILL. Zero means use defaultShutdownForceTimeout
	// (5 seconds). Only relevant on Unix; on Windows we escalate directly to
	// os.Kill after the grace period.
	ShutdownForceTimeout time.Duration
}

type ProcessExecutor struct {
	bus        *events.Bus
	store      store.RunLifecycleStore
	profile    RunnerProfile
	adapter    adapters.AgentAdapter // default adapter; may be nil (raw stdout capture)
	adapterReg *adapters.Registry    // per-run adapter resolution; may be nil
	metrics    *metrics.EdgeMetrics  // Prometheus instrumentation; may be nil

	// Hub callback client for Edge→Hub direct reporting
	hubCallback CallbackReporter

	maxConcurrentRuns         int // maximum concurrent runs; 0 means use default (5)
	maxRunOutputBytes         int64
	maxStructuredPayloadBytes int64

	// Orchestrator result aggregation
	agentRegistry *agents.Registry  // agent instance registry for sub-agent tracking; may be nil
	messageQueue  *agents.Queue     // inter-agent message queue for result delivery; may be nil
	resultAgg     *ResultAggregator // tracks sub-agent completion and emits sub_agents_complete; may be nil

	// Decision loop step tracking (optional). When configured, the emitter in
	// publishStructuredOutput is wrapped with step-counting and max-steps enforcement.
	decisionLoopFactory *DecisionLoopEmitterFactory

	// Configurable timeouts for run lifecycle and graceful shutdown.
	runTimeout           time.Duration
	shutdownGracePeriod  time.Duration
	shutdownForceTimeout time.Duration

	// Evidence gate configuration for post-run verification.
	evidenceGateCfg EvidenceGateConfig

	// Fault escalation configuration for 3-layer recovery on run failure.
	faultEscalationCfg FaultEscalationConfig

	mu          sync.Mutex
	running     map[string]context.CancelFunc
	stdins      map[string]io.Writer                 // runID to stdin (for adapter-aware interrupt)
	processes   map[string]*os.Process               // runID to os.Process (for graceful shutdown)
	runOutputs  map[string]*runnerctx.RunOutputStore // runID to temp log for output persistence and replay
	runToAgent  map[string]string                    // runID to agentInstanceID for result aggregation
	hubTasks    map[string]string                    // runID to Hub taskID (for Edge→Hub callbacks)
	hubOutputs  map[string]*hubOutputCollector       // runID to bounded final response collector
	workDirs    map[string]string                    // runID to workDir (for post-finish surfacing)
	surfacers   map[string]*adapters.WorkdirSnapshot // runID to pre-run snapshot (for auto-surface detection)
	cancelDone  map[string]chan struct{}             // runID to done channel for graceful shutdown goroutines
	callbackSem chan struct{}                        // bounds concurrent hub callbacks (max 10); prevents goroutine explosion
}

// NewProcessExecutor creates a ProcessExecutor that manages agent run lifecycles.
// It requires a non-nil event bus and run store. The adapter and adapterReg may be
// nil for raw-stdout capture mode; otherwise adapterReg is used for per-run adapter
// resolution (via profile.AdapterID or run-level overrides).
//
// The returned executor is safe for concurrent use. Callers should configure
// optional dependencies (agent registry, message queue, result aggregator, hub
// callback, decision loop, metrics) via the fluent With* methods before calling
// Start for the first time.
func NewProcessExecutor(bus *events.Bus, store store.RunLifecycleStore, cfg ProcessExecutorConfig, adapter adapters.AgentAdapter, adapterReg *adapters.Registry) (*ProcessExecutor, error) {
	if err := requireProcessExecutorDeps(bus, store); err != nil {
		return nil, err
	}
	profile, err := NewGenericRunnerProfile(cfg.Command, cfg.Args, cfg.Env, cfg.ExtraEnv, cfg.WorkDir)
	if shouldFailNewRunnerProfile(err) {
		return nil, err
	}
	if shouldStatConfiguredWorkDir(cfg.WorkDir) {
		info, statErr := os.Stat(cfg.WorkDir)
		if err := validateConfiguredWorkDir(cfg.WorkDir, info, statErr); err != nil {
			return nil, err
		}
	}
	runTimeout, shutdownGP, shutdownFT := resolveProcessExecutorTimeouts(cfg)
	return buildProcessExecutor(
		bus,
		store,
		profile,
		adapter,
		adapterReg,
		runTimeout,
		shutdownGP,
		shutdownFT,
		EvidenceGateConfigFromEnv(),
		FaultEscalationConfigFromEnv(),
	), nil
}

// SetMetrics attaches Prometheus instrumentation to this executor.
// It is safe to call with nil to disable metrics.
func (e *ProcessExecutor) SetMetrics(m *metrics.EdgeMetrics) {
	e.metrics = m
}

// WithAgentRegistry attaches an agent instance registry for sub-agent tracking
// and result aggregation. When set, the executor will send result messages via
// the message queue when sub-agent runs complete.
func (e *ProcessExecutor) WithAgentRegistry(r *agents.Registry) *ProcessExecutor {
	e.agentRegistry = r
	return e
}

// WithMessageQueue attaches an inter-agent message queue for delivering sub-agent
// results back to parent orchestration runs.
func (e *ProcessExecutor) WithMessageQueue(q *agents.Queue) *ProcessExecutor {
	e.messageQueue = q
	return e
}

// WithResultAggregator attaches a ResultAggregator for tracking sub-agent
// completion and emitting sub_agents_complete events.
func (e *ProcessExecutor) WithResultAggregator(ra *ResultAggregator) *ProcessExecutor {
	e.resultAgg = ra
	return e
}

// WithDecisionLoop attaches a DecisionLoopEmitterFactory that wraps the
// adapter event stream with step counting, max-steps enforcement, and
// tool-approval gating. This enables multi-step execution visibility for
// agents that otherwise run as opaque single-shot processes.
//
// When set, the factory is applied in publishStructuredOutput to wrap the
// raw adapter emitter. The DecisionLoop state (currentStep, phase, etc.)
// is accessible via the factory's Loop() method for API progress reporting.
func (e *ProcessExecutor) WithDecisionLoop(factory *DecisionLoopEmitterFactory) *ProcessExecutor {
	e.decisionLoopFactory = factory
	return e
}

// SetHubCallback configures the Edge→Hub direct callback client.
// When set, run lifecycle transitions (started, finished, failed, cancelled)
// are reported to the Hub server. Callbacks are fire-and-forget: errors are
// logged but never block the run lifecycle.
func (e *ProcessExecutor) SetHubCallback(c CallbackReporter) {
	e.hubCallback = c
}

// WithHubCallback is a fluent variant of SetHubCallback.
func (e *ProcessExecutor) WithHubCallback(c CallbackReporter) *ProcessExecutor {
	e.SetHubCallback(c)
	return e
}

// Start creates a background context with the configured run timeout, registers
// the run's cancel function in the executor's running map (so Cancel can find it),
// and launches the run lifecycle in a new goroutine.
//
// Errors:
//   - store.ErrNotFound if the run does not exist
//   - ErrRunAlreadyStarted if the run is already running
//   - ErrTooManyConcurrentRuns if the max concurrent runs limit is exceeded
//
// Start returns immediately after launching the background goroutine and does not
// wait for the run to complete. Use the event bus to observe run lifecycle events.
func (e *ProcessExecutor) Start(run store.Run, runCtx RunProcessContext) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	current, ok := e.store.GetRun(run.ID)
	if err := validateStartRunState(ok, current.Status); err != nil {
		return err
	}

	_, alreadyRunning := e.running[run.ID]
	if err := canStartRun(len(e.running), e.maxConcurrentRuns, alreadyRunning); err != nil {
		return err
	}
	// Create context and atomically insert cancel into the map while holding
	// the lock, so a concurrent Cancel can never miss the cancel func.
	ctx, cancel := context.WithTimeout(context.Background(), e.runTimeout)
	e.running[run.ID] = cancel

	runCtx.Run = run
	go e.run(ctx, run, runCtx)
	return nil
}

// Cancel attempts to cancel a running or queued run. It looks up the run's cancel
// function in the executor's running map and invokes it, which cancels the run
// context and triggers graceful shutdown (stdin interrupt, then process termination
// after the configured grace period).
//
// Returns a CancelResult indicating whether the run was found and whether the
// cancellation was actually performed (a run already in terminal state cannot be
// cancelled). Cancel is safe to call on a run that has already finished.
func (e *ProcessExecutor) Cancel(runID string) CancelResult {
	run, ok := e.store.GetRun(runID)
	if early, proceed := cancelPrecheck(run, ok); !proceed {
		return early
	}

	// Send adapter-specific interrupt via stdin before canceling context.
	// This allows Claude Code to clean up gracefully (finish current API call,
	// flush session state) rather than being killed by SIGTERM.
	e.mu.Lock()
	stdin, hasStdin := e.stdins[runID]
	if shouldWriteInterruptStdin(hasStdin) {
		if err := adapters.WriteInterrupt(stdin, interruptRequestID(runID)); shouldLogInterruptWriteFailure(err) {
			slog.Debug("process: interrupt write failed", "runId", runID, "error", err)
		}
	}
	cancel, ok := e.running[runID]
	e.mu.Unlock()
	if early, proceed := cancelRunningLookup(ok); !proceed {
		return early
	}

	// Graceful shutdown: wait grace period for child to respond to stdin interrupt,
	// then send SIGTERM, wait force timeout, and escalate to SIGKILL as last resort.
	e.mu.Lock()
	proc := e.processes[runID]
	e.mu.Unlock()
	if shouldStartGracefulProcessShutdown(proc) {
		// Graceful shutdown: run in a goroutine so Cancel() returns
		// immediately and does not block the HTTP response. The goroutine
		// is tracked via cancelDone so finish() can abort it early if the
		// process exits on its own before the grace periods elapse.
		done := make(chan struct{})
		e.mu.Lock()
		e.cancelDone[runID] = done
		e.mu.Unlock()
		go func() {
			select {
			case <-done:
				return
			case <-time.After(e.shutdownGracePeriod):
			}
			_ = proc.Signal(os.Interrupt)
			select {
			case <-done:
				return
			case <-time.After(e.shutdownForceTimeout):
			}
			_ = proc.Kill()
			if _, err := proc.Wait(); shouldLogProcessWaitAfterKill(err) {
				slog.Warn("process wait error after kill", "run_id", runID, "error", err)
			}
		}()
	}

	cancel()

	run, ok = e.store.SetRunStatusIf(runID, "cancelling", "queued", "started", "cancelling")
	if result, needLookup := cancelTransitionResult(run, ok); !needLookup {
		return result
	}
	current, found := e.store.GetRun(runID)
	return lookupCancelResult(current, found)
}

func (e *ProcessExecutor) run(ctx context.Context, run store.Run, runCtx RunProcessContext) {
	// terminalFinish is true unless this attempt hands off to a fault-escalation
	// successor. The deferred finish must not tear down the concurrency slot the
	// successor just re-registered (see #867).
	// Do NOT rework #867 finish/escalation handoff beyond pure predicates.
	terminalFinish := true
	defer func() {
		if shouldPerformTerminalFinish(terminalFinish) {
			e.finish(run.ID)
		}
	}()

	// Store Hub task ID for Edge→Hub direct callback reporting
	if shouldRecordHubTask(runCtx.HubTaskID) {
		e.mu.Lock()
		e.hubTasks[run.ID] = runCtx.HubTaskID
		e.mu.Unlock()
	}

	// Resolve adapter for this run: explicit agentID first, then default
	adapter := e.adapter
	if shouldResolveAdapter(e.adapterReg != nil, runCtx.AgentID, adapter != nil) {
		resolved, err := e.adapterReg.Resolve(runCtx.AgentID)
		if shouldPublishAdapterResolveFailure(err) {
			e.publishFailed(run, err)
			return
		}
		adapter = resolved
	}

	// Preflight check: if the adapter implements PreflightAdapter, verify
	// it is properly configured (e.g. API keys, credentials) before launching
	// the subprocess. This prevents hangs from CLIs that block on auth prompts.
	if preflight, ok := asPreflightAdapter(adapter); ok {
		if err := preflight.PreflightCheck(); shouldPublishPreflightFailure(err) {
			slog.Warn("process: adapter preflight check failed",
				"runId", run.ID,
				"agentId", runCtx.AgentID,
				"error", err,
			)
			e.publishFailed(run, adapterPreflightFailed(err))
			return
		}
	}

	// Resolve adapter label for Prometheus metrics
	adapterLabel := resolveMetricsAdapterLabel(e.metrics != nil, adapter)

	// SEC-02: Defense-in-depth — reject 'bypassPermissions' at the executor level
	// before launching the agent process. If the API validation is somehow
	// bypassed (e.g. direct internal calls), this fallback ensures the agent
	// never receives a permission mode that disables all security hooks.
	if sanitized, forbidden := applyPermissionModeSanitization(runCtx); shouldLogForbiddenPermissionMode(forbidden) {
		slog.Warn("process: permission mode 'bypassPermissions' is forbidden, falling back to 'default'",
			"runId", run.ID,
			"agentId", runCtx.AgentID,
		)
		runCtx = sanitized
	}

	var runStartTime time.Time
	if shouldAttachFinishMetricsDefer(e.metrics != nil) {
		defer func() {
			if !shouldRecordRunFinishMetrics(runStartTime) {
				return // run never started (early failure before cmd.Start)
			}
			r, ok := e.store.GetRun(run.ID)
			if !shouldRecordFinishMetricsForRun(ok) {
				return
			}
			e.metrics.RecordRunFinish(adapterLabel, r.Status, time.Since(runStartTime).Seconds())
		}()
	}

	// Session retry loop: when CC exits quickly with a session conflict error
	// ("Session ID ... is already in use" or "No conversation found with session ID"),
	// generate a fresh random session ID and retry once. This handles the case where
	// a stale CC process from a previous Edge instance still holds the session lock.
	var lastWaitErr error
	var lastOutStore *runnerctx.RunOutputStore
	for attempt := 0; attempt < maxSessionRetries; attempt++ {
		var cmdPath string
		var args, env []string
		var workDir string
		adapterCtx := adapters.RunProcessContext(runCtx)

		if shouldUseAdapterCommand(adapter != nil) {
			// Adapter mode: BuildCommand provides full command configuration
			cmdPath, args, env, workDir = adapter.BuildCommand(adapterCtx)
		} else {
			// Profile mode: use configured command template
			var err error
			args, env, err = e.profile.Template.Expand(runCtx)
			if shouldPublishCommandBuildFailure(err) {
				e.publishFailed(run, err)
				return
			}
			cmdPath = e.profile.Command
			workDir = e.profile.WorkDir
		}
		if shouldPublishCLIInvocationPlan(adapter != nil) {
			plan := adapters.BuildCLIInvocationPlanFromCommand(adapter, adapterCtx, cmdPath, args, env, workDir)
			e.bus.Publish(adapters.BusEventCLIInvocationPlan, runScope(run), plan.Payload())
		}

		// Take workdir snapshot for auto-surface detection (post-finish).
		// Captures pre-run file state so we can detect new/modified files.
		if shouldTrackWorkDir(workDir) {
			snapshot := adapters.TakeWorkdirSnapshot(workDir)
			e.mu.Lock()
			e.workDirs[run.ID] = workDir
			e.surfacers[run.ID] = snapshot
			e.mu.Unlock()
		}

		_, extraEnv, err := e.profile.ExtraEnvTemplate.Expand(runCtx)
		if shouldPublishCommandBuildFailure(err) {
			e.publishFailed(run, err)
			return
		}
		cmd := exec.CommandContext(ctx, cmdPath, args...)
		cmd.Dir = workDir
		// Adapter mode overlays auth env onto a sanitized base; profile mode
		// uses the administrator-configured env base. See envForAdapterOrProfile.
		cmd.Env = envForAdapterOrProfile(run, adapter != nil, env, extraEnv)
		stdout, err := cmd.StdoutPipe()
		if shouldPublishPipeFailure(err) {
			e.publishFailed(run, pipeOpenError("stdout", err))
			return
		}
		stderr, err := cmd.StderrPipe()
		if shouldPublishPipeFailure(err) {
			e.publishFailed(run, pipeOpenError("stderr", err))
			return
		}
		var stdin io.WriteCloser
		if needsAdapterStdin(adapter) {
			stdin, err = cmd.StdinPipe()
			if shouldPublishPipeFailure(err) {
				e.publishFailed(run, pipeOpenError("stdin", err))
				return
			}
			e.mu.Lock()
			e.stdins[run.ID] = stdin
			e.mu.Unlock()
		}
		setResourceLimits(cmd)
		argSummary := summarizeProcessArgsForLog(args)
		slog.Debug("executor.subprocess.starting",
			"runId", run.ID,
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
		)
		subprocessStart := time.Now()
		if err := cmd.Start(); err != nil {
			if shouldTreatStartFailureAsCancelled(ctx.Err()) {
				if shouldWaitProcessAfterCancel(cmd.Process) {
					_, _ = cmd.Process.Wait()
				}
				e.publishCancelled(run)
				return
			}
			e.publishFailed(run, err)
			return
		}
		// If context was cancelled after Start but before we checked, kill the child.
		if shouldKillStartedProcessOnCancel(ctx.Err()) {
			if shouldKillProcessAfterCancel(cmd.Process) {
				_ = cmd.Process.Kill()
				if shouldWaitProcessAfterCancel(cmd.Process) {
					_, _ = cmd.Process.Wait()
				}
			}
			e.publishCancelled(run)
			return
		}

		slog.Debug("executor.subprocess.started", "runId", run.ID, "pid", cmd.Process.Pid)

		// Track process for graceful shutdown signals (SIGTERM on Unix).
		e.mu.Lock()
		e.processes[run.ID] = cmd.Process
		e.mu.Unlock()

		// Close stdin unless the adapter needs it for the control protocol
		// (permission responses) or a DecisionLoop is configured (force-finish
		// via stdin interrupt). An open pipe with no data causes CLI agents
		// (Claude Code) to wait ~3s and warn "no stdin data", so we close it
		// eagerly when neither mechanism requires stdin.
		if shouldCloseStdinAfterStart(stdin != nil, needsAdapterStdin(adapter), e.decisionLoopFactory != nil) {
			if shouldCloseStdinPipe(stdin != nil) {
				_ = stdin.Close()
			}
			e.mu.Lock()
			delete(e.stdins, run.ID)
			e.mu.Unlock()
		}

		// Record metrics: run has started successfully
		if shouldRecordRunStartMetrics(e.metrics != nil) {
			e.metrics.RecordRunStart(adapterLabel)
			runStartTime = time.Now()
		}

		started, ok := e.store.SetRunStatusIf(run.ID, "started", "queued")
		if shouldPublishStatusTransition(ok) {
			e.bus.Publish("run.started", runScope(started), RunResponse(started))
			// Fire Hub TaskAck callback (Edge→Hub direct bridge)
			e.fireHubAck(run.ID)
		}
		e.checkPersistError(run.ID)

		// Create temp file for run output persistence and replay
		outStore, err := runnerctx.NewRunOutputStore(run.ID)
		if shouldLogRunOutputStoreCreateFailure(err) {
			slog.Warn("process: failed to create run output store", "runId", run.ID, "error", err)
		} else if shouldTrackRunOutputStore(err) {
			e.mu.Lock()
			e.runOutputs[run.ID] = outStore
			e.mu.Unlock()
		}

		var wg sync.WaitGroup
		outputLimiter := newRunOutputLimiter(e.maxRunOutputBytes)
		wg.Add(1)
		go e.publishOutput(&wg, run, outStore, outputLimiter, "stderr", stderr)

		// Inject context budget for token tracking in stream parsers.
		// Also inject RunProcessContext unconditionally — SDK adapters
		// (anthropic-sdk, openai-sdk) need prompt, model, and messages
		// regardless of whether a WorkDir is set.
		parserCtx := withParserContextValues(ctx, runCtx)

		var parseErr error
		if shouldUseStructuredOutputParser(adapter != nil) {
			wg.Add(1)
			go e.publishStructuredOutput(&wg, run, stdout, stdin, adapter, parserCtx, &parseErr)
		} else {
			// Raw capture: stdout goes to run.output.batch events
			wg.Add(1)
			go e.publishOutput(&wg, run, outStore, outputLimiter, "stdout", stdout)
		}

		// StdoutPipe/StderrPipe readers must finish before Wait closes the pipe
		// descriptors; otherwise structured parsers can race with Wait and see
		// transient "file already closed" read errors.
		wg.Wait()
		lastWaitErr = cmd.Wait()
		lastOutStore = outStore
		slog.Debug("executor.subprocess.exited", "runId", run.ID, "exitCode", ExitCodeFromErr(lastWaitErr), "attempt", attempt)

		// Context budget compaction check: after the stream completes, evaluate
		// whether the context budget exceeded the auto-compaction threshold.
		// When triggered, we log the budget state and emit a compaction event
		// so upstream session managers can compact the actual message history.
		if shouldEmitContextCompaction(runCtx.Budget) {
			usagePct, tokensUsed, remaining := contextCompactionSnapshot(runCtx.Budget)
			slog.Info("process: context compaction threshold reached",
				"runId", run.ID,
				"usagePercent", usagePct,
				"tokensUsed", tokensUsed,
				"tokensRemaining", remaining,
			)
			e.bus.Publish(adapters.BusEventContextCompaction, runScope(run),
				contextCompactionPayload(run.ID, usagePct, tokensUsed, remaining))
		}

		if shouldTreatAsCancelled(ctx.Err(), e.runStatus(run.ID)) {
			e.publishCancelled(run)
			e.sendSubAgentResult(run.ID, "cancelled", nil)
			return
		}

		// Session conflict retry: if CC failed quickly with a session conflict
		// error and this is the first attempt, reset the session ID and retry.
		// On Windows, exec.ExitError.Error() does not include stderr content
		// (stderr is read via StderrPipe in a separate goroutine and stored in
		// outStore), so we also pass the captured stderr output.
		var stderrCapture string
		if shouldReadOutputStoreCapture(outStore != nil) {
			stderrCapture, _ = outStore.ReadAll()
		}
		if shouldRetrySessionConflict(lastWaitErr, stderrCapture, attempt, time.Since(subprocessStart)) {
			newSession := newRandomSessionID()
			slog.Warn("process: session conflict detected, retrying with fresh session ID",
				"runId", run.ID,
				"oldSessionId", runCtx.SessionID,
				"newSessionId", newSession,
				"error", lastWaitErr,
			)
			runCtx = withFreshSession(runCtx, newSession)
			// Clean up the tracked process from this attempt before retrying.
			e.mu.Lock()
			delete(e.processes, run.ID)
			if s, ok := e.runOutputs[run.ID]; shouldCloseTrackedRunOutput(ok) {
				_ = s.Close()
				delete(e.runOutputs, run.ID)
			}
			e.mu.Unlock()
			// Reset run status back to queued so the retry can transition to started.
			if _, ok := e.store.SetRunStatusIf(run.ID, "queued", "started", "failed"); shouldResetSessionRetryStatus(ok) {
				slog.Debug("process: reset run status to queued for session retry", "runId", run.ID)
			}
			continue
		}

		// Wait error is not a session-conflict retry. Leave the session-retry
		// loop so fault-escalation can re-launch the run when configured.
		// Terminal publishFailed happens after the escalation check below.
		if shouldBreakSessionRetryOnWaitError(lastWaitErr) {
			break
		}
		// #179: handle structured output parse errors with recoverability distinction.
		// Non-recoverable errors (pipe broken, context cancelled) fail the run.
		// Recoverable errors (malformed event, orphaned tool) emit a warning and
		// allow the run to finish naturally — matching Kanna/OpenCode recovery patterns.
		if shouldHandleStructuredParseError(parseErr) {
			if psErr, ok := recoverableParseStreamError(parseErr); ok {
				slog.Warn("process: recoverable stream parse error, continuing run", "runId", run.ID, "error", parseErr)
				e.bus.Publish(adapters.BusEventContextWarning, runScope(run),
					recoverableParseWarningPayload(
						run.ID,
						recoverableParseWarningMessage(psErr.Unwrap()),
						psErr.Error(),
					))
			} else {
				e.publishFailed(run, structuredOutputParseFailed(parseErr))
				e.sendSubAgentResult(run.ID, "failed", subAgentErrorPayload(parseErr))
				return
			}
		}
		// Evidence gate: run post-completion verification before marking finished.
		// When enabled (default), the gate runs type-specific checks (Go build+vet,
		// TypeScript typecheck+test, generic file existence) against the workDir.
		// If verification fails, the run is marked as completed_with_issues instead
		// of finished, and the full evidence output is stored in run metadata.
		gateEnabled := isEvidenceGateEnabledForRun(e.evidenceGateCfg, workDir)
		finalStatus := resolveEvidenceFinalStatus(gateEnabled, true)
		if shouldRunEvidenceGate(gateEnabled) {
			evidenceResult := runEvidenceGate(workDir)
			e.store.SetRunEvidenceGate(run.ID, evidenceGateResultJSON(evidenceResult))
			finalStatus = resolveEvidenceFinalStatus(true, evidenceResult.Passed)
			if shouldLogEvidenceGateFailure(evidenceResult.Passed) {
				slog.Warn("process: evidence gate verification failed",
					"runId", run.ID,
					"projectType", evidenceResult.ProjectType,
					"summary", evidenceResult.Summary,
				)
			}
		}

		finished, ok := e.store.SetRunStatusIf(run.ID, finalStatus, "started")
		if shouldPublishStatusTransition(ok) {
			e.bus.Publish("run.finished", runScope(finished), RunResponse(finished))
			e.sendSubAgentResult(run.ID, finalStatus, RunResponse(finished))
			// Fire Hub TaskDone callback (Edge→Hub direct bridge)
			e.fireHubDone(run.ID, RunResponse(finished))
		}
		e.checkPersistError(run.ID)
		return
	}

	// Exhausted session retries — attempt fault escalation if configured.
	// Do NOT rework #867 finish/escalation handoff beyond pure predicates.
	if shouldAttemptFaultEscalation(lastWaitErr, e.faultEscalationCfg) {
		r, ok := e.store.GetRun(run.ID)
		if shouldAcceptFaultEscalationRetry(ok, e.faultEscalationCfg, r.RetryCount) {
			newCount := nextFaultEscalationRetryCount(r.RetryCount)
			e.store.SetRunRetryCount(run.ID, newCount)
			run.RetryCount = newCount
			// Re-queue from started (normal wait failure) or failed (defensive).
			// Status mutation only - #867 successor handoff stays below.
			_, requeued := e.store.SetRunStatusIf(run.ID, "queued", "started", "failed")
			run = applyFaultEscalationQueuedStatus(run, requeued)
			// Attempt-local cleanup only - leave concurrency slot / hub bookkeeping
			// for the successor attempt. Terminal finish is owned by the successor.
			e.mu.Lock()
			delete(e.processes, run.ID)
			if s, ok3 := e.runOutputs[run.ID]; shouldCloseTrackedRunOutput(ok3) {
				_ = s.Close()
				delete(e.runOutputs, run.ID)
			}
			// Re-register the cancel func before releasing the slot ownership so
			// Cancel() and max-concurrent accounting stay consistent across handoff.
			newCtx, cancel := context.WithTimeout(context.Background(), e.runTimeout)
			if oldCancel, ok4 := e.running[run.ID]; shouldInvokeOldCancelOnEscalationHandoff(ok4) {
				oldCancel()
			}
			e.running[run.ID] = cancel
			e.mu.Unlock()
			e.bus.Publish("run.fault_escalation.retry", runScope(run),
				faultEscalationRetryPayload(run.ID, newCount, e.faultEscalationCfg.MaxRetries))
			slog.Warn("process: fault escalation auto-retry",
				"runId", run.ID,
				"retryCount", newCount,
				"maxRetries", e.faultEscalationCfg.MaxRetries,
			)
			terminalFinish = false
			go e.run(newCtx, run, runCtx)
			return
		}
		// Max retries reached — emit escalation exhausted event.
		e.bus.Publish("run.fault_escalation.exhausted", runScope(run),
			faultEscalationExhaustedPayload(run.ID, e.faultEscalationCfg.MaxRetries))
		slog.Warn("process: fault escalation exhausted", "runId", run.ID)
	}
	// Report the last error (terminal failure after retries exhausted or disabled).
	if shouldPublishTerminalWaitFailure(lastWaitErr) {
		e.publishFailed(run, errorWithRunOutput(lastWaitErr, lastOutStore))
		e.sendSubAgentResult(run.ID, "failed", subAgentErrorPayload(lastWaitErr))
	}
}

func (e *ProcessExecutor) publishOutput(wg *sync.WaitGroup, run store.Run, outStore *runnerctx.RunOutputStore, limiter *runOutputLimiter, stream string, reader io.Reader) {
	defer wg.Done()

	buf := make([]byte, defaultReadBufferSize)
	offset := 0
	for {
		n, err := reader.Read(buf)
		if shouldProcessOutputRead(n) {
			allowed, truncatedNow, written, maxBytes := limiter.allow(buf[:n])
			if shouldPublishOutputChunk(len(allowed), truncatedNow) {
				text := string(allowed)
				// Log stderr to structured logger so CC failure diagnostics
				// are visible in Edge server logs without subscribing to bus events.
				if shouldLogStderrLines(stream, text) {
					for _, line := range stderrLogLines(text) {
						sanitizedLine, _ := recursiveSanitizeString(line)
						slog.Error("cc stderr", "runId", run.ID, "line", sanitizedLine)
					}
				}
				if shouldWriteRunOutputStore(outStore != nil, len(allowed)) {
					if _, err := outStore.Write(text); shouldLogRunOutputStoreWriteFailure(err) {
						slog.Warn("process: failed to write output store", "runId", run.ID, "error", err)
					}
				}
				if shouldForwardStdoutToHub(stream, text) {
					e.recordHubOutput(run.ID, text)
					e.fireHubStream(run.ID, text)
				}
				payload := runOutputBatchPayload(run.ID, stream, text, offset, truncatedNow, written, maxBytes)
				if shouldLogRunOutputTruncation(truncatedNow) {
					slog.Warn("process: run output truncated", "runId", run.ID, "maxBytes", maxBytes)
				}
				e.bus.Publish("run.output.batch", runScope(run), payload)
				offset += len(allowed)
			}
		}
		if shouldStopOutputRead(err) {
			return
		}
	}
}

func (e *ProcessExecutor) publishFailed(run store.Run, err error) {
	slog.Debug("executor.run.failed", "runId", run.ID, "error", err)
	failed, ok := e.store.SetRunStatusIf(run.ID, "failed", "queued", "started")
	if shouldPublishStatusTransition(ok) {
		classified := classifyPublishedFailure(err)
		if shouldPersistClassifiedFailure(classified) {
			e.persistAgentFailureMessage(failed, classified.Message)
		}
		e.bus.Publish("run.failed", runScope(failed),
			runFailedEventPayload(failed.ID, failed.Status, classified))
		// Fire Hub callback if configured
		e.fireHubFail(failed.ID, classified.Message)
	}
	e.checkPersistError(run.ID)
}

func (e *ProcessExecutor) persistAgentFailureMessage(run store.Run, content string) {
	content, ok := trimAgentFailureContent(content)
	if !shouldPersistAgentFailureContent(ok) {
		return
	}
	repository, ok := asAgentFailureRepository(e.store)
	if !shouldUseAgentFailureRepository(ok) {
		return
	}
	if shouldSkipExistingAgentFailureMessage(hasAgentMessageForRun(repository.ListThreadItems(run.ThreadID), run.ID)) {
		return
	}
	item, err := repository.CreateItem(agentFailureItem(run, transcriptItemID(run.ID), content))
	if shouldLogAgentFailurePersistError(err) {
		slog.Warn("process: failed to persist run failure message", "runId", run.ID, "error", err)
		return
	}
	scope := itemEventScope(item)
	e.bus.Publish("message.created", scope, item)
	e.bus.Publish("item.created", scope, item)
}

func (e *ProcessExecutor) publishCancelled(run store.Run) {
	cancelled, ok := e.store.SetRunStatusIf(run.ID, "cancelled", "queued", "started", "cancelling")
	if shouldPublishStatusTransition(ok) {
		e.bus.Publish("run.cancelled", runScope(cancelled), RunResponse(cancelled))
		// Fire Hub callback if configured
		e.fireHubFail(cancelled.ID, cancelledFailReason())
	}
	e.checkPersistError(run.ID)
}

// checkPersistError logs and emits a persistence_error event when the FileStore
// has a pending persistence failure after a status transition.
func (e *ProcessExecutor) checkPersistError(runID string) {
	pc, ok := asPersistErrorSource(e.store)
	if !shouldCheckPersistErrorSource(ok) {
		return
	}
	if persistErr := pc.LastPersistError(); shouldEmitPersistenceError(persistErr) {
		slog.Error("file store persist failed during run status transition", "runId", runID, "error", persistErr)
		scope, payload := persistenceErrorScopePayload(runID, persistErr)
		e.bus.Publish("run.persistence_error", scope, payload)
	}
}

func (e *ProcessExecutor) runStatus(runID string) string {
	run, ok := e.store.GetRun(runID)
	return runStatusFromLookup(run, ok)
}

func (e *ProcessExecutor) finish(runID string) {
	// Cascade: when a parent agent finishes, recursively terminate all
	// descendant sub-agents (Codex AgentTree shutdown pattern).
	if shouldCascadeAgentShutdown(e.agentRegistry != nil) {
		e.agentRegistry.ShutdownCascade(runID)
	}

	// Auto-surface: detect file changes and emit artifact/preview/diff events.
	// Only surfaces when the run finished successfully.
	e.surfaceRunArtifacts(runID)

	e.mu.Lock()
	delete(e.running, runID)
	delete(e.stdins, runID)
	delete(e.processes, runID)
	delete(e.runToAgent, runID)
	delete(e.hubTasks, runID)
	delete(e.hubOutputs, runID)
	delete(e.workDirs, runID)
	delete(e.surfacers, runID)
	if done, ok := e.cancelDone[runID]; shouldCloseCancelDoneChannel(ok) {
		close(done)
		delete(e.cancelDone, runID)
	}
	if s, ok := e.runOutputs[runID]; shouldCloseTrackedRunOutput(ok) {
		if err := s.Close(); shouldLogRunOutputStoreCloseFailure(err) {
			slog.Warn("process: failed to close output store", "runId", runID, "error", err)
		}
		delete(e.runOutputs, runID)
	}
	e.mu.Unlock()
}

// surfaceRunArtifacts performs auto-surface detection after a run completes.
// It reads the pre-run workdir snapshot, scans for new/modified files, and
// emits surfaced artifact/preview/diff events so the frontend can render them
// inline in the chat transcript. Errors are logged but never block cleanup.
func (e *ProcessExecutor) surfaceRunArtifacts(runID string) {
	e.mu.Lock()
	snapshot := e.surfacers[runID]
	e.mu.Unlock()

	if !shouldSurfaceWithSnapshot(snapshot) {
		return // no workdir tracked for this run
	}

	// Only surface for successfully finished runs.
	current, ok := e.store.GetRun(runID)
	if !shouldSurfaceRunArtifacts(ok, current.Status) {
		return
	}

	// Resolve a store.Writer for direct persistence.
	writer, ok := asStoreWriter(e.store)
	if !shouldSurfaceWithWriter(ok) {
		slog.Debug("surfacing: store does not implement Writer, skipping", "runId", runID)
		return
	}

	adapters.SurfaceAndEmit(e.bus, writer, snapshot, current)
}

// sendSubAgentResult delivers a result message from a completed sub-agent run
// back to its parent agent via the message queue. This enables the orchestrator
// to aggregate results from dispatched sub-agents.
func (e *ProcessExecutor) sendSubAgentResult(runID, status string, payload any) {
	if !shouldDeliverSubAgentResult(e.agentRegistry != nil, e.messageQueue != nil) {
		return
	}

	e.mu.Lock()
	agentID, ok := e.runToAgent[runID]
	e.mu.Unlock()
	if !shouldLookupSubAgentMapping(ok) {
		return
	}

	inst, found := e.agentRegistry.Get(agentID)
	if !shouldRouteSubAgentToParent(found, inst.ParentID) {
		return
	}

	if regStatus, update := subAgentRegistryTerminalStatus(status); update {
		// completed_with_issues is a terminal status set by the evidence gate
		// when verification fails. It is still a result (MsgTypeResult), but the
		// agent registry must be updated to StatusCompleted so the parent
		// orchestrator does not wait indefinitely for a child it thinks is still
		// running.
		e.agentRegistry.SetStatus(agentID, regStatus, "")
	}

	// Sanitize the sub-agent result before it enters the message queue.
	// This redacts stack traces, file paths, and API keys, and truncates
	// oversized outputs to keep queue payloads bounded.
	sanitizedResult, sanitizeReason := SanitizeSubAgentResult(payload)

	e.messageQueue.EnsureAgent(inst.ParentID, 64)
	e.messageQueue.Send(buildSubAgentResultMessage(
		runID,
		agentID,
		inst.Name,
		inst.ParentID,
		status,
		sanitizedResult,
		sanitizeReason,
		time.Now().UTC(),
	))

	// Store structured result in the aggregator's collector for eventual
	// synthesis when all children of the parent complete (or timeout).
	// Reference: AionUi Team Mode Mailbox — persisted sub-agent results.
	// Reference: LibreChat — structured subagent result return.
	//
	// Apply sanitization to the raw payload before storing in the result
	// aggregator. This ensures that even if the message queue copy is
	// tampered with, the raw persisted output does not leak API keys,
	// file paths, or stack traces.
	if shouldStoreSubAgentAggregatorResult(e.resultAgg != nil) {
		e.resultAgg.StoreSubAgentResult(inst.ParentID, buildSubAgentResult(
			agentID,
			inst.Name,
			runID,
			status,
			aggregatorOutput(payload, sanitizedResult, sanitizeReason),
			time.Now().UTC(),
		))
	}

	// Decrement per-parent active child count so the slot can be reused.
	e.agentRegistry.DecrChildCount(inst.ParentID)
}

// publishStructuredOutput uses the configured AgentAdapter to parse the CLI's
// native protocol and emit typed events to the bus.
func (e *ProcessExecutor) publishStructuredOutput(wg *sync.WaitGroup, run store.Run, stdout io.Reader, stdin io.Writer, adapter adapters.AgentAdapter, ctx context.Context, parseErr *error) {
	defer wg.Done()
	scope := runScope(run)
	var emitter adapters.EventEmitter = adapters.NewScopedEventEmitter(
		adapters.NewPayloadLimitEmitter(adapters.NewBusEventEmitter(e.bus), e.maxStructuredPayloadBytes),
		scope,
	)
	emitter = newHubCallbackEmitter(e, run.ID, emitter)
	emitter = coalesceEmitter(emitter, newRuntimeEvidenceEmitter(e.store, run, emitter))
	transcriptEmitter := newThreadTranscriptEmitter(e.store, run, emitter)
	emitter = coalesceEmitter(emitter, transcriptEmitter)

	// Wrap emitter with budget monitoring: emits run.agent.context_warning
	// when token usage exceeds the auto-compaction threshold (85%).
	if budget, ok := budgetFromParserContext(ctx); shouldApplyBudgetAwareEmitter(ok) {
		emitter = adapters.NewBudgetAwareEmitter(emitter, budget, scope)
	}

	// Wrap emitter with decision-loop step tracking and max-steps enforcement.
	// When configured, tool_call events increment a step counter and force-finish
	// is triggered when maxSteps is exceeded.
	if shouldWrapDecisionLoopEmitter(e.decisionLoopFactory != nil) {
		emitter = e.decisionLoopFactory.Wrap(stdin, emitter, run)
	}

	// Build the security hook chain. The tool allowlist hook runs first (before
	// the security hook) so that allowlist-rejected tools are blocked before any
	// dangerous-pattern analysis. When AllowedTools is empty, the allowlist hook
	// is a no-op and is not added to the chain.
	//
	// This is the unified security layer: all three adapters (Claude Code,
	// Codex, OpenCode) are covered at the ProcessExecutor level, regardless
	// of whether they use NDJSONStreamParser or emit events directly.
	allowedTools, _ := allowedToolsFromParserContext(ctx)
	hooks := buildProcessSecurityHooks(allowedTools, emitter, scope)
	emitter = adapters.NewSecureEmitter(ctx, emitter, hooks)

	if err := adapter.ParseStream(ctx, stdout, stdin, emitter, run); shouldRecordStructuredParseError(err) {
		slog.Error("structured output parse error", "runId", run.ID, "error", err)
		*parseErr = err
	}
	if shouldFlushTranscriptEmitter(transcriptEmitter != nil) {
		transcriptEmitter.Flush()
	}
}

// SpawnSubAgent implements adapters.SubAgentSpawner for the ProcessExecutor.
// It creates a new run for a sub-agent dispatched by the orchestrator, queues it,
// and starts execution using the resolved agent adapter.
//
// Before spawning, it checks the agent registry for slot availability and depth
// limits (Codex AgentTree pattern parity).
//
// Each sub-agent receives its own isolated context budget (allocated via
// ContextBudget.AllocateChild) and a unique ThreadID/SessionID so its token
// tracking and context space never pollute the parent. This matches OpenCode's
// sessions.create({parentID}) pattern where sub-agents get independent sessions
// with derived permissions and no shared context contamination.
//
// Reference: docs/reference/cross-comparison/03-orchestration.md Layer 3 (Supervisor routing).
// Reference: OpenCode task.ts:145-162 (sessions.create with parentID, deriveSubagentSessionPermission).
func (e *ProcessExecutor) SpawnSubAgent(parentRun store.Run, task adapters.SubAgentTask) (agentInstanceID string, runID string, err error) {
	// Atomically check and reserve a spawn slot under the same write lock.
	// This prevents the TOCTOU race where two concurrent goroutines both pass
	// CanSpawn (seeing count=4) and both subsequently increment, exceeding
	// MaxChildrenPerAgent=5.
	slotReserved := false
	if shouldReserveSpawnSlot(e.agentRegistry != nil) {
		if reserveErr := e.agentRegistry.TryReserveSlot(parentRun.ID, task.Depth); shouldLogSpawnSlotRejection(reserveErr) {
			slog.Warn("spawn slot rejected",
				"parentRunId", parentRun.ID,
				"taskId", task.TaskID,
				"depth", task.Depth,
				"error", reserveErr,
			)
			return "", "", reserveErr
		}
		slotReserved = true
	}

	// Deferred cleanup: release the reserved slot on any error exit path.
	// On success, the slot is released by sendSubAgentResult when the child
	// run completes (keeps increment/decrement pair lexically close).
	defer func() {
		if shouldReleaseReservedSpawnSlot(err, slotReserved) {
			e.agentRegistry.DecrChildCount(parentRun.ID)
		}
	}()

	runID, agentInstanceID = subAgentSpawnIDs(task.TaskID)

	// Resolve ThreadID: each sub-agent MUST have its own distinct thread so
	// that its context space is fully isolated from the parent. If the task
	// provides an explicit ThreadID we use it; otherwise we create a
	// hierarchical child thread ID derived from the parent ThreadID.
	// This prevents context contamination between parent and child.
	threadID := resolveSubAgentThreadID(parentRun.ThreadID, runID, task.ThreadID)

	// Create the run in the store
	run, createErr := e.store.(store.Writer).CreateRun(runID, parentRun.ProjectID, threadID)
	if shouldLogSubAgentCreateFailure(createErr) {
		slog.Error("failed to create sub-agent run", "taskId", task.TaskID, "error", createErr)
		err = createErr
		return "", "", err
	}

	// Register the child agent instance in the agent registry with its own
	// context scope. This ensures budget tracking in publishStructuredOutput
	// monitors only the child's tokens, and parent/child results are
	// independently routed via the message queue.
	registered := false
	if shouldRegisterSubAgentInstance(e.agentRegistry != nil) {
		inst := newSubAgentInstance(parentRun.ID, agentInstanceID, runID, threadID, task, time.Now())
		if regErr := e.agentRegistry.Register(inst); shouldLogSubAgentRegisterFailure(regErr) {
			slog.Warn("failed to register sub-agent instance in registry",
				"agentInstanceId", agentInstanceID,
				"error", regErr,
			)
		} else if shouldMarkSubAgentRegistered(regErr) {
			registered = true
		}
	}

	// Emit run.queued
	e.bus.Publish("run.queued", runScope(run), run)

	// Build run context with the task prompt, target agent, and an isolated
	// context budget allocated from the parent via AllocateChild.
	// The child budget is independent - it does NOT reference the parent's
	// UsedTokens counter, so the child's token consumption never pollutes
	// the parent's budget tracking.
	runCtx := newSubAgentRunContext(run, task, threadID)

	// Inject AgentHub memory into the sub-agent run so it has persistent context.
	// Mirror the same logic as the PostRuns handler in api/handlers.go.
	// The parent's workDir is looked up from the executor's tracking map.
	e.mu.Lock()
	parentWorkDir := e.workDirs[parentRun.ID]
	e.mu.Unlock()
	runCtx = applyParentWorkDirMemory(runCtx, parentWorkDir, threadID, task.AgentID)

	// Inject sibling context so the sub-agent knows about other agents working
	// in parallel. This prevents file conflicts when multiple sub-agents modify
	// the same workspace concurrently.
	runCtx.AppendSystemPrompt = withSiblingSystemPrompt(runCtx.AppendSystemPrompt, task.SiblingAgents)

	// Store the run-to-agent mapping so result aggregation can find the agent later.
	e.mu.Lock()
	e.runToAgent[runID] = agentInstanceID
	e.mu.Unlock()

	// Start the run
	if startErr := e.Start(run, runCtx); shouldClearRunAgentMappingOnStartFailure(startErr) {
		slog.Error("failed to start sub-agent run", "runId", runID, "error", startErr)
		e.mu.Lock()
		delete(e.runToAgent, runID)
		e.mu.Unlock()

		// Cleanup on start failure: unregister the agent instance,
		// mark the run as failed, and release the reserved slot.
		// Set slotReserved=false BEFORE Unregister to prevent the
		// deferred DecrChildCount from double-decrementing.
		// Unregister already decrements childrenCount internally.
		if shouldUnregisterOnStartFailure(registered) {
			slotReserved = false
			e.agentRegistry.Unregister(agentInstanceID)
		}
		_, _ = e.store.SetRunStatus(runID, "failed")

		err = startErr
		return "", "", err
	}

	return agentInstanceID, runID, nil
}
