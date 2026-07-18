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

func (e *ProcessExecutor) run(ctx context.Context, run store.Run, runCtx RunProcessContext) {
	// terminalFinish is true unless this attempt hands off to a fault-escalation
	// successor. The deferred finish must not tear down the concurrency slot the
	// successor just re-registered (see #867).
	// Do NOT rework #867 finish/escalation handoff beyond pure predicates.
	terminalFinish := true
	defer func() {
		if planTerminalFinish(terminalFinish).Finish {
			e.finish(run.ID)
		}
	}()

	// Store Hub task ID and allocate a bounded final-content collector for
	// Edge→Hub direct callback reporting. Without the collector, recordHubOutput
	// no-ops and fireHubDone falls back to literal "Run finished" (#987).
	// Pure gate only; hubOutputs allocation stays here (#987 residual ownership).
	if planHubTaskRecord(runCtx.HubTaskID).Record {
		e.mu.Lock()
		e.hubTasks[run.ID] = runCtx.HubTaskID
		e.hubOutputs[run.ID] = newHubOutputCollector(hubCallbackFinalMaxBytes)
		e.mu.Unlock()
	}

	// Resolve adapter for this run: explicit agentID first, then default
	adapter := e.adapter
	if planAdapterResolve(e.adapterReg != nil, runCtx.AgentID, adapter != nil).Resolve {
		resolved, err := e.adapterReg.Resolve(runCtx.AgentID)
		if planAdapterResolveFailure(err).Fail {
			e.publishFailed(run, err)
			return
		}
		adapter = resolved
	}

	// Preflight check: if the adapter implements PreflightAdapter, verify
	// it is properly configured (e.g. API keys, credentials) before launching
	// the subprocess. This prevents hangs from CLIs that block on auth prompts.
	if preflight, ok := asPreflightAdapter(adapter); planPreflightAdapter(ok).Check {
		err := preflight.PreflightCheck()
		if planPreflightFailure(err).Fail {
			slog.Warn("process: adapter preflight check failed", "runId", run.ID, "agentId", runCtx.AgentID, "error", err)
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
	if perm := planPermissionModeSanitization(runCtx); perm.Changed {
		slog.Warn("process: permission mode 'bypassPermissions' is forbidden, falling back to 'default'", "runId", run.ID, "agentId", runCtx.AgentID)
		runCtx = perm.RunCtx
	}

	var runStartTime time.Time
	metricsPlan := planRunMetrics(e.metrics != nil)
	if metricsPlan.AttachFinishDefer {
		defer func() {
			r, ok := e.store.GetRun(run.ID)
			if !planFinishMetricsRecord(runStartTime, ok).Record {
				return // never started or missing run
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
				return
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
		}

		_, extraEnv, err := e.profile.ExtraEnvTemplate.Expand(runCtx)
		if planCommandBuildFailure(err).Fail {
			e.publishFailed(run, err)
			return
		}
		// Use Command (not CommandContext) so cancelling the run context does not
		// immediately SIGKILL the child and defeat Cancel's grace escalation (#988).
		// Process lifetime is managed explicitly: Cancel arms a grace path, and
		// watchRunProcess force-kills on timeout when no grace path is active.
		cmd := exec.Command(cmdPath, args...)
		cmd.Dir = workDir
		// Adapter mode overlays auth env onto a sanitized base; profile mode
		// uses the administrator-configured env base. See envForAdapterOrProfile.
		cmd.Env = envForAdapterOrProfile(run, adapter != nil, env, extraEnv)
		stdout, err := cmd.StdoutPipe()
		if planPipeFailure(err).Fail {
			e.publishFailed(run, pipeOpenError("stdout", err))
			return
		}
		stderr, err := cmd.StderrPipe()
		if planPipeFailure(err).Fail {
			e.publishFailed(run, pipeOpenError("stderr", err))
			return
		}
		var stdin io.WriteCloser
		if planStdinPipeOpen(adapter).Open {
			stdin, err = cmd.StdinPipe()
			if planPipeFailure(err).Fail {
				e.publishFailed(run, pipeOpenError("stdin", err))
				return
			}
			e.mu.Lock()
			e.stdins[run.ID] = stdin
			e.mu.Unlock()
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
			return
		case cmdStartFailed:
			e.publishFailed(run, startErr)
			return
		}
		// Post-start cancel kill/wait plan. Kill uses killProcessTree so
		// process-group teardown from #988 remains intact.
		if cancelPlan := planPostStartCancel(ctx.Err(), cmd.Process); cancelPlan.Cancel {
			if cancelPlan.Kill {
				_ = killProcessTree(cmd.Process)
				if cancelPlan.Wait {
					_, _ = cmd.Process.Wait()
				}
			}
			e.publishCancelled(run)
			return
		}

		slog.Debug("executor.subprocess.started", subprocessStartedLogArgs(run.ID, cmd.Process)...)

		// Track process for graceful shutdown signals (SIGTERM on Unix).
		// watchStop is always created so close(watchStop) after Wait is safe even
		// when the process handle is not tracked.
		watchStop := make(chan struct{})
		if planTrackStartedProcess(cmd.Process).Track {
			e.mu.Lock()
			e.processes[run.ID] = cmd.Process
			e.mu.Unlock()
			// Ensure run-timeout / non-Cancel context cancellation still
			// terminates the child now that CommandContext is not used.
			go e.watchRunProcess(ctx, run.ID, cmd.Process, watchStop)
		}

		// Eager-close stdin when adapter/decision-loop do not need the pipe.
		// An open pipe with no data causes CLI agents (Claude Code) to wait
		// ~3s and warn "no stdin data", so we close it eagerly when neither
		// control protocol nor DecisionLoop requires stdin.
		stdinPlan := planEagerStdinClose(stdin != nil, planStdinPipeOpen(adapter).Open, e.decisionLoopFactory != nil)
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
			runStartTime = time.Now()
		}

		started, ok := e.store.SetRunStatusIf(run.ID, "started", "queued")
		if planPublishStatus(ok).Publish {
			e.bus.Publish("run.started", runScope(started), RunResponse(started))
			// Fire Hub TaskAck callback (Edge→Hub direct bridge)
			e.fireHubAck(run.ID)
		}
		e.checkPersistError(run.ID)

		// Create temp file for run output persistence and replay
		outStore, err := runnerctx.NewRunOutputStore(run.ID)
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
		go e.publishOutput(&wg, run, outStore, outputLimiter, "stderr", stderr)

		// Inject context budget for token tracking in stream parsers.
		// Also inject RunProcessContext unconditionally — SDK adapters
		// (anthropic-sdk, openai-sdk) need prompt, model, and messages
		// regardless of whether a WorkDir is set.
		parserCtx := withParserContextValues(ctx, runCtx)

		var parseErr error
		if cmdPlan.UseStructuredParser {
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
		// Stop the context watcher before Wait so it cannot race with reaping.
		close(watchStop)
		lastWaitErr = cmd.Wait()
		lastOutStore = outStore
		slog.Debug("executor.subprocess.exited", "runId", run.ID, "exitCode", ExitCodeFromErr(lastWaitErr), "attempt", attempt)

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
			return
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
		sessionPlan := planSessionConflictRetry(lastWaitErr, stderrCapture, attempt, time.Since(subprocessStart), outStore != nil)
		if sessionPlan.Retry {
			newSession := newRandomSessionID()
			slog.Warn("process: session conflict detected, retrying with fresh session ID", "runId", run.ID, "oldSessionId", runCtx.SessionID, "newSessionId", newSession, "error", lastWaitErr)
			runCtx = withFreshSession(runCtx, newSession)
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
			continue
		}

		// Wait error is not a session-conflict retry. Leave the session-retry
		// loop so fault-escalation can re-launch the run when configured.
		// Terminal publishFailed happens after the escalation check below.
		if planSessionRetryBreak(lastWaitErr).Break {
			break
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
			return
		}
		// Evidence gate: run post-completion verification before marking finished.
		// When enabled (default), the gate runs type-specific checks (Go build+vet,
		// TypeScript typecheck+test, generic file existence) against the workDir.
		// If verification fails, the run is marked as completed_with_issues instead
		// of finished, and the full evidence output is stored in run metadata.
		attempt := planEvidenceGateAttempt(isEvidenceGateEnabledForRun(e.evidenceGateCfg, workDir))
		finalStatus := attempt.FinalStatus
		if attempt.RunGate {
			evidenceResult := runEvidenceGate(workDir)
			e.store.SetRunEvidenceGate(run.ID, evidenceGateResultJSON(evidenceResult))
			evidencePlan := planEvidenceGateResult(evidenceResult.Passed)
			finalStatus = evidencePlan.FinalStatus
			if evidencePlan.LogFailure {
				slog.Warn("process: evidence gate verification failed", "runId", run.ID, "projectType", evidenceResult.ProjectType, "summary", evidenceResult.Summary)
			}
		}

		finished, ok := e.store.SetRunStatusIf(run.ID, finalStatus, "started")
		if planPublishStatus(ok).Publish {
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
	if planFaultEscalationAttempt(lastWaitErr, e.faultEscalationCfg).Attempt {
		r, ok := e.store.GetRun(run.ID)
		if planFaultEscalationHandoff(ok, e.faultEscalationCfg, r.RetryCount).Retry {
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
			e.bus.Publish("run.fault_escalation.retry", runScope(run),
				faultEscalationRetryPayload(run.ID, newCount, e.faultEscalationCfg.MaxRetries))
			slog.Warn("process: fault escalation auto-retry", "runId", run.ID, "retryCount", newCount, "maxRetries", e.faultEscalationCfg.MaxRetries)
			terminalFinish = false
			go e.run(newCtx, run, runCtx)
			return
		}
		// Max retries reached — emit escalation exhausted event (#867).
		if exhausted := planFaultEscalationExhausted(); exhausted.Publish {
			e.bus.Publish("run.fault_escalation.exhausted", runScope(run),
				faultEscalationExhaustedPayload(run.ID, e.faultEscalationCfg.MaxRetries))
			if exhausted.Log {
				slog.Warn("process: fault escalation exhausted", "runId", run.ID)
			}
		}
	}
	// Report the last error (terminal failure after retries exhausted or disabled).
	if planTerminalWaitFailure(lastWaitErr).Publish {
		e.publishFailed(run, errorWithRunOutput(lastWaitErr, lastOutStore))
		e.sendSubAgentResult(run.ID, "failed", subAgentErrorPayload(lastWaitErr))
	}
}
