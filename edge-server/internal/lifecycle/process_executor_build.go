package lifecycle

import (
	"context"
	"io"
	"log/slog"
	"os/exec"
	"sync"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// startedProcess holds the state of a successfully launched subprocess attempt.
// All fields are read-only to the caller after buildAndStartProcess returns.
type startedProcess struct {
	cmd             *exec.Cmd
	stdout          io.ReadCloser
	stderr          io.ReadCloser
	stdin           io.WriteCloser
	watchStop       chan struct{}
	subprocessStart time.Time
	workDir         string
	buildPlan       commandBuildPlan
}

// buildAndStartProcess constructs the command, opens pipes, starts the
// subprocess, and performs post-start setup (process tracking, stdin
// management, metrics, status transition).
//
// On failure, it publishes the error/cancellation event and returns a
// non-nil error — the caller must return from run() immediately.
// On success, the returned startedProcess is ready for output collection.
func (e *ProcessExecutor) buildAndStartProcess(
	ctx context.Context,
	run store.Run,
	runCtx RunProcessContext,
	adapter adapters.AgentAdapter,
	adapterLabel string,
	metricsPlan runMetricsPlan,
	runStartTime *time.Time,
	attempt int,
) (*startedProcess, error) {
	var cmdPath string
	var args, env []string
	var workDir string
	adapterCtx := runCtx
	cmdPlan := planCommandBuild(adapter != nil)

	if cmdPlan.UseAdapter {
		// Adapter mode: BuildCommand provides full command configuration
		cmdPath, args, env, workDir = adapter.BuildCommand(adapterCtx)
	} else {
		// Profile mode: use configured command template
		var err error
		args, env, err = e.profile.Template.Expand(runCtx)
		if planCommandBuildFailure(err).Fail {
			e.publishFailed(run, err)
			return nil, err
		}
		cmdPath = e.profile.Command
		workDir = e.profile.WorkDir
	}
	if cmdPlan.PublishCLIPlan {
		plan := adapters.BuildCLIInvocationPlanFromCommand(adapter, adapterCtx, cmdPath, args, env, workDir)
		e.bus.Publish(adapters.BusEventCLIInvocationPlan, runScope(run), plan.Payload())
	}

	// Pre-run workdir snapshot for auto-surface.
	if planWorkdirTrack(workDir).Track {
		snapshot := adapters.TakeWorkdirSnapshot(workDir)
		e.mu.Lock()
		e.workDirs[run.ID] = workDir
		e.surfacers[run.ID] = snapshot
		e.mu.Unlock()
		// #1968 checkpoint evidence: persist the pre-run snapshot and emit the
		// checkpoint event before run.started so the timeline card precedes
		// run output. A nil snapshot (empty/inaccessible workdir) is an honest
		// absence — no checkpoint event, no card.
		if snapshot != nil {
			e.publishRunCheckpoint(run, workDir, snapshot)
		}
	}

	_, extraEnv, err := e.profile.ExtraEnvTemplate.Expand(runCtx)
	if planCommandBuildFailure(err).Fail {
		e.publishFailed(run, err)
		return nil, err
	}
	// Use Command (not CommandContext) so cancelling the run context does not
	// immediately SIGKILL the child and defeat Cancel's grace escalation (#988).
	// #nosec G204 -- executing the user-configured agent CLI is the core
	// function of the Edge runtime; cmdPath/args come from profile config.
	cmd := exec.Command(cmdPath, args...)
	cmd.Dir = workDir
	cmd.Env = envForAdapterOrProfile(run, adapter != nil, env, extraEnv)
	stdout, stderr, stdin, err := e.openProcessPipes(cmd, run, adapter)
	if err != nil {
		return nil, err
	}
	setResourceLimits(cmd)
	slog.Debug("executor.subprocess.starting", subprocessStartingLogArgs(run.ID, cmdPath, args, attempt)...)
	subprocessStart := time.Now()
	startErr := cmd.Start()
	switch classifyCmdStartOutcome(startErr, ctx.Err()) {
	case cmdStartCancelled:
		if planCmdStartCancelWait(cmd.Process).Wait {
			_, _ = cmd.Process.Wait()
		}
		e.publishCancelled(run)
		return nil, ctx.Err()
	case cmdStartFailed:
		e.publishFailed(run, startErr)
		return nil, startErr
	case cmdStartOK:
		// Process started successfully; continue to post-start setup.
	}
	// Post-start cancel kill/wait plan.
	if cancelPlan := planPostStartCancel(ctx.Err(), cmd.Process); cancelPlan.Cancel {
		if cancelPlan.Kill {
			_ = killProcessTree(cmd.Process)
			if cancelPlan.Wait {
				_, _ = cmd.Process.Wait()
			}
		}
		e.publishCancelled(run)
		return nil, ctx.Err()
	}

	slog.Debug("executor.subprocess.started", subprocessStartedLogArgs(run.ID, cmd.Process)...)

	// Track process for graceful shutdown signals.
	watchStop := make(chan struct{})
	if planTrackStartedProcess(cmd.Process).Track {
		e.mu.Lock()
		e.processes[run.ID] = cmd.Process
		e.mu.Unlock()
		safeGo("watchRunProcess", func() { e.watchRunProcess(ctx, run.ID, cmd.Process, watchStop) })
	}

	// Eager-close stdin when the adapter does not need the pipe.
	stdinPlan := planEagerStdinClose(stdin != nil, planStdinPipeOpen(adapter).Open, false)
	if stdinPlan.ClosePipe {
		_ = stdin.Close()
	}
	if stdinPlan.ClearMap {
		e.mu.Lock()
		delete(e.stdins, run.ID)
		e.mu.Unlock()
	}

	// Record metrics: run has started successfully
	if metricsPlan.RecordStart {
		e.metrics.RecordRunStart(adapterLabel)
		*runStartTime = time.Now()
	}

	// Record the executor-resolved workDir as run evidence before the started
	// transition so run.started carries it (#1967). Empty workDir is honest:
	// it means no workspace was resolved and run review stays read-only.
	if workDir != "" {
		if _, ok := e.store.SetRunWorkDir(run.ID, workDir); !ok {
			slog.Warn("executor.run.workdir_record_failed", "runId", run.ID, "workDir", workDir)
		}
	}
	started, ok := e.store.SetRunStatusIf(run.ID, "started", "queued")
	if planPublishStatus(ok).Publish {
		e.bus.Publish("run.started", runScope(started), RunResponse(started))
		e.fireHubAck(run.ID)
	}
	e.checkPersistError(run.ID)

	return &startedProcess{
		cmd:             cmd,
		stdout:          stdout,
		stderr:          stderr,
		stdin:           stdin,
		watchStop:       watchStop,
		subprocessStart: subprocessStart,
		workDir:         workDir,
		buildPlan:       cmdPlan,
	}, nil
}

// openProcessPipes opens the stdout/stderr pipes and, when the adapter needs a
// stdin pipe, opens it and tracks it for eager-close or interrupt signalling.
// On failure it publishes the pipe error and returns it — the caller must
// return from buildAndStartProcess immediately.
func (e *ProcessExecutor) openProcessPipes(cmd *exec.Cmd, run store.Run, adapter adapters.AgentAdapter) (stdout, stderr io.ReadCloser, stdin io.WriteCloser, err error) {
	stdout, err = cmd.StdoutPipe()
	if planPipeFailure(err).Fail {
		e.publishFailed(run, pipeOpenError("stdout", err))
		return nil, nil, nil, err
	}
	stderr, err = cmd.StderrPipe()
	if planPipeFailure(err).Fail {
		e.publishFailed(run, pipeOpenError("stderr", err))
		return nil, nil, nil, err
	}
	if planStdinPipeOpen(adapter).Open {
		stdin, err = cmd.StdinPipe()
		if planPipeFailure(err).Fail {
			e.publishFailed(run, pipeOpenError("stdin", err))
			return nil, nil, nil, err
		}
		e.mu.Lock()
		e.stdins[run.ID] = stdin
		e.mu.Unlock()
	}
	return stdout, stderr, stdin, nil
}

// collectAndWaitOutput launches stderr/stdout collection goroutines, waits for
// them to complete, closes the context watcher, and waits for the subprocess
// to exit.
//
// It returns the output store (for session-conflict diagnostics and terminal
// error reporting), the subprocess wait error, and any structured parse
// error encountered by the adapter.
//
// The caller is responsible for logging the exit and assigning the returned
// values to the loop-scoped lastWaitErr/lastOutStore variables.
func (e *ProcessExecutor) collectAndWaitOutput(
	ctx context.Context,
	run store.Run,
	runCtx RunProcessContext,
	proc *startedProcess,
	adapter adapters.AgentAdapter,
) (outStore *runnerctx.RunOutputStore, waitErr error, parseErr error) {
	var err error
	outStore, err = runnerctx.NewRunOutputStore(run.ID)
	outTrack := planRunOutputStoreTrack(err)
	if outTrack.LogFailure {
		slog.Warn("process: failed to create run output store", "runId", run.ID, "error", err)
	} else if outTrack.Track {
		e.mu.Lock()
		e.runOutputs[run.ID] = outStore
		e.mu.Unlock()
	}

	var wg sync.WaitGroup
	outputLimiter := newRunOutputLimiter(e.maxRunOutputBytes)
	wg.Add(1)
	safeGo("publishOutput.stderr", func() { e.publishOutput(&wg, run, outStore, outputLimiter, "stderr", proc.stderr) })

	// Inject context budget for token tracking in stream parsers.
	// Also inject RunProcessContext unconditionally — SDK adapters
	// (anthropic-sdk, openai-sdk) need prompt, model, and messages
	// regardless of whether a WorkDir is set.
	parserCtx := withParserContextValues(ctx, runCtx)

	if proc.buildPlan.UseStructuredParser {
		wg.Add(1)
		safeGo("publishStructuredOutput", func() { e.publishStructuredOutput(&wg, run, proc.stdout, proc.stdin, adapter, parserCtx, &parseErr) })
	} else {
		// Raw capture: stdout goes to run.output.batch events
		wg.Add(1)
		safeGo("publishOutput.stdout", func() { e.publishOutput(&wg, run, outStore, outputLimiter, "stdout", proc.stdout) })
	}

	// StdoutPipe/StderrPipe readers must finish before Wait closes the pipe
	// descriptors; otherwise structured parsers can race with Wait and see
	// transient "file already closed" read errors.
	wg.Wait()
	// Stop the context watcher before Wait so it cannot race with reaping.
	close(proc.watchStop)
	waitErr = proc.cmd.Wait()
	return
}

// completeRunAttempt finalizes a successful attempt: context compaction,
// cancellation check, session-conflict retry decision, parse-error handling,
// evidence gate, and the terminal finished publish.
//
// It reports the attempt outcome so the caller can drive the retry loop and
// post-loop fault escalation. The returned outcome controls the caller's
// control flow:
//
//	*outcomeDone       — the run reached a terminal state; caller returns.
//	*outcomeRetry      — a session-conflict retry is requested; caller continues the loop.
//	*outcomeBreak      — the wait error is non-recoverable; caller breaks to fault escalation.
//	*outcomeHandoff    — fault-escalation successor already launched; caller returns (terminalFinish=false).
//	*outcomeDeferred   — an orchestrator parent with active sub-agents: the terminal
//	                     publish is deferred to FinalizeParentRun (via ResultAggregator);
//	                     the caller returns; finish() skips the cascade-cancel.
type attemptOutcome int

const (
	outcomeDone attemptOutcome = iota
	outcomeRetry
	outcomeBreak
	outcomeHandoff
	outcomeDeferred
)

// completeRunAttempt runs Phase 3 of the attempt loop. ctx is the run context
// (for cancellation checks); attempt is the current retry index; lastWaitErr
// / parseErr / outStore / proc come from collectAndWaitOutput. It mutates
// runCtx (session retry path rewrites runCtx in place) and returns the outcome.
//
// The run context pointer is taken so the session-conflict retry can rewrite
// the caller's runCtx for the next loop iteration.
func (e *ProcessExecutor) completeRunAttempt(
	ctx context.Context,
	run store.Run,
	runCtx *RunProcessContext,
	proc *startedProcess,
	attempt int,
	lastWaitErr error,
	parseErr error,
	outStore *runnerctx.RunOutputStore,
) attemptOutcome {
	// Context budget compaction check: after the stream completes, evaluate
	// whether the context budget exceeded the auto-compaction threshold.
	// When triggered, we log the budget state and emit a compaction event
	// so upstream session managers can compact the actual message history.
	if compact := planContextCompaction(runCtx.Budget, run.ID); compact.Emit {
		slog.Info("process: context compaction threshold reached", "runId", run.ID, "usagePercent", compact.UsagePct, "tokensUsed", compact.TokensUsed, "tokensRemaining", compact.Remaining)
		e.bus.Publish(adapters.BusEventContextCompaction, runScope(run), compact.Payload)
	}

	if planCancelledRun(ctx.Err(), e.runStatus(run.ID)).Cancelled {
		e.publishCancelled(run)
		e.sendSubAgentResult(run.ID, "cancelled", nil)
		return outcomeDone
	}

	// Session conflict retry: if CC failed quickly with a session conflict
	// error and this is the first attempt, reset the session ID and retry.
	// On Windows, exec.ExitError.Error() does not include stderr content
	// (stderr is read via StderrPipe in a separate goroutine and stored in
	// outStore), so we also pass the captured stderr output.
	var stderrCapture string
	if planOutputStoreCapture(outStore != nil).Read {
		stderrCapture, _ = outStore.ReadAll()
	}
	sessionPlan := planSessionConflictRetry(lastWaitErr, stderrCapture, attempt, time.Since(proc.subprocessStart), outStore != nil)
	if sessionPlan.Retry {
		newSession := newRandomSessionID()
		slog.Warn("process: session conflict detected, retrying with fresh session ID", "runId", run.ID, "oldSessionId", runCtx.SessionID, "newSessionId", newSession, "error", lastWaitErr)
		*runCtx = withFreshSession(*runCtx, newSession)
		// Clean up the tracked process from this attempt before retrying.
		e.mu.Lock()
		delete(e.processes, run.ID)
		if s, ok := e.runOutputs[run.ID]; shouldApplyTrackedClose(sessionPlan.CloseOutput, ok) {
			_ = s.Close()
			delete(e.runOutputs, run.ID)
		}
		e.mu.Unlock()
		// Reset run status back to queued so the retry can transition to started.
		if _, ok := e.store.SetRunStatusIf(run.ID, "queued", "started", "failed"); planSessionRetryStatus(ok).LogReset {
			slog.Debug("process: reset run status to queued for session retry", "runId", run.ID)
		}
		return outcomeRetry
	}

	// Wait error is not a session-conflict retry. Leave the session-retry
	// loop so fault-escalation can re-launch the run when configured.
	// Terminal publishFailed happens after the escalation check below.
	if planSessionRetryBreak(lastWaitErr).Break {
		return outcomeBreak
	}
	// #179: handle structured output parse errors with recoverability distinction.
	// Non-recoverable errors (pipe broken, context cancelled) fail the run.
	// Recoverable errors (malformed event, orphaned tool) emit a warning and
	// allow the run to finish naturally — matching Kanna/OpenCode recovery patterns.
	parseHandle := planStructuredParseHandleFromErr(parseErr, run.ID)
	if parseHandle.WarnRecoverable {
		slog.Warn("process: recoverable stream parse error, continuing run", "runId", run.ID, "error", parseErr)
		e.bus.Publish(adapters.BusEventContextWarning, runScope(run), parseHandle.WarningPayload)
	} else if parseHandle.FailFatal {
		e.publishFailed(run, structuredOutputParseFailed(parseErr))
		e.sendSubAgentResult(run.ID, "failed", subAgentErrorPayload(parseErr))
		return outcomeDone
	}
	// Evidence gate: run post-completion verification before marking finished.
	// When enabled (default), the gate runs type-specific checks (Go build+vet,
	// TypeScript typecheck+test, generic file existence) against the workDir.
	// If verification fails, the run is marked as completed_with_issues instead
	// of finished, and the full evidence output is stored in run metadata.
	gateAttempt := planEvidenceGateAttempt(isEvidenceGateEnabledForRun(e.evidenceGateCfg, proc.workDir))
	finalStatus := gateAttempt.FinalStatus
	if gateAttempt.RunGate {
		evidenceResult := runEvidenceGate(proc.workDir)
		e.store.SetRunEvidenceGate(run.ID, evidenceGateResultJSON(evidenceResult))
		evidencePlan := planEvidenceGateResult(evidenceResult.Passed)
		finalStatus = evidencePlan.FinalStatus
		if evidencePlan.LogFailure {
			slog.Warn("process: evidence gate verification failed", "runId", run.ID, "projectType", evidenceResult.ProjectType, "summary", evidenceResult.Summary)
		}
	}

	// Orchestration deferral: an orchestrator parent whose sub-agents are
	// still running must not terminal-finish yet — finish() would
	// cascade-cancel the children (Codex AgentTree shutdown), aborting the
	// multi-agent workflow right after dispatch. Park the terminal publish;
	// the ResultAggregator finalizes the parent via FinalizeParentRun when
	// the last child completes (or the collector timeout fires).
	if planParentWaitChildren(e.agentRegistry != nil, e.hasActiveChildren(run.ID)).Defer {
		e.mu.Lock()
		if e.pendingParentFinish == nil {
			e.pendingParentFinish = make(map[string]deferredParentFinish)
		}
		e.pendingParentFinish[run.ID] = deferredParentFinish{run: run, finalStatus: finalStatus}
		e.mu.Unlock()
		slog.Info("process: parent waiting for sub-agents before finish", "runId", run.ID)
		return outcomeDeferred
	}

	finished, ok := e.store.SetRunStatusIf(run.ID, finalStatus, "started")
	if planPublishStatus(ok).Publish {
		e.bus.Publish("run.finished", runScope(finished), RunResponse(finished))
		e.sendSubAgentResult(run.ID, finalStatus, RunResponse(finished))
		// Fire Hub TaskDone callback (Edge→Hub direct bridge)
		e.fireHubDone(run.ID, RunResponse(finished))
	}
	e.checkPersistError(run.ID)
	return outcomeDone
}

// handleFaultEscalation runs the post-loop fault-escalation path when the
// session-retry loop is exhausted with a non-recoverable wait error.
//
// It returns true when a successor attempt has been launched via a recursive
// goroutine — in that case the caller must NOT run the deferred finish (the
// successor owns it) and must NOT publish a terminal failure. The caller sets
// terminalFinish=false and returns.
//
// Returns false when no handoff occurred (escalation disabled or retries
// exhausted); the caller then publishes the terminal wait-failure itself.
//
// Do NOT rework #867 finish/escalation handoff beyond pure predicates.
func (e *ProcessExecutor) handleFaultEscalation(
	run *store.Run,
	runCtx RunProcessContext,
	lastWaitErr error,
) bool {
	if !planFaultEscalationAttempt(lastWaitErr, e.faultEscalationCfg).Attempt {
		return false
	}
	r, ok := e.store.GetRun(run.ID)
	if !planFaultEscalationHandoff(ok, e.faultEscalationCfg, r.RetryCount).Retry {
		// Max retries reached — emit escalation exhausted event (#867).
		if exhausted := planFaultEscalationExhausted(); exhausted.Publish {
			e.bus.Publish("run.fault_escalation.exhausted", runScope(*run),
				faultEscalationExhaustedPayload(run.ID, e.faultEscalationCfg.MaxRetries))
			if exhausted.Log {
				slog.Warn("process: fault escalation exhausted", "runId", run.ID)
			}
		}
		return false
	}
	newCount := nextFaultEscalationRetryCount(r.RetryCount)
	e.store.SetRunRetryCount(run.ID, newCount)
	run.RetryCount = newCount
	// Re-queue from started (normal wait failure) or failed (defensive).
	// Status mutation only - #867 successor handoff stays below.
	_, requeued := e.store.SetRunStatusIf(run.ID, "queued", "started", "failed")
	*run = applyFaultEscalationQueuedStatus(*run, requeued)
	// Attempt-local cleanup only - leave concurrency slot / hub bookkeeping
	// for the successor attempt. Terminal finish is owned by the successor.
	e.mu.Lock()
	delete(e.processes, run.ID)
	s, hasOut := e.runOutputs[run.ID]
	oldCancel, hasOldCancel := e.running[run.ID]
	cleanup := planFaultEscalationCleanup(hasOut, hasOldCancel)
	if cleanup.CloseOutput {
		_ = s.Close()
		delete(e.runOutputs, run.ID)
	}
	// Re-register the cancel func before releasing the slot ownership so
	// Cancel() and max-concurrent accounting stay consistent across handoff.
	newCtx, cancel := context.WithTimeout(context.Background(), e.runTimeout)
	if cleanup.InvokeOldCancel {
		oldCancel()
	}
	e.running[run.ID] = cancel
	e.mu.Unlock()
	e.bus.Publish("run.fault_escalation.retry", runScope(*run),
		faultEscalationRetryPayload(run.ID, newCount, e.faultEscalationCfg.MaxRetries))
	slog.Warn("process: fault escalation auto-retry", "runId", run.ID, "retryCount", newCount, "maxRetries", e.faultEscalationCfg.MaxRetries)
	safeGo("run.faultEscalation", func() { e.run(newCtx, *run, runCtx) })
	return true
}

// publishRunCheckpoint persists the pre-run workdir snapshot as the run's
// checkpoint and emits the run.checkpoint event (#1968). Persistence failure
// degrades to a warning: the run proceeds without checkpoint evidence rather
// than failing the run (honest absence, same contract as workDir evidence).
func (e *ProcessExecutor) publishRunCheckpoint(run store.Run, workDir string, snapshot *adapters.WorkdirSnapshot) {
	files, totalBytes := snapshot.CheckpointFiles()
	cp := store.RunCheckpoint{
		ID:         "cp-" + run.ID,
		RunID:      run.ID,
		WorkDir:    workDir,
		FileCount:  len(files),
		TotalBytes: totalBytes,
		Files:      files,
	}
	saved, err := e.store.UpsertRunCheckpoint(cp)
	if err != nil {
		slog.Warn("executor.checkpoint.persist_failed", "runId", run.ID, "error", err)
		return
	}
	e.bus.Publish("run.checkpoint", runScope(run), map[string]any{
		"runId":        run.ID,
		"checkpointId": saved.ID,
		"workDir":      saved.WorkDir,
		"fileCount":    saved.FileCount,
		"totalBytes":   saved.TotalBytes,
		"createdAt":    saved.CreatedAt,
	})
}
