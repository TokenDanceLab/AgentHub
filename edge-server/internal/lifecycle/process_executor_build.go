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
	}

	_, extraEnv, err := e.profile.ExtraEnvTemplate.Expand(runCtx)
	if planCommandBuildFailure(err).Fail {
		e.publishFailed(run, err)
		return nil, err
	}
	// Use Command (not CommandContext) so cancelling the run context does not
	// immediately SIGKILL the child and defeat Cancel's grace escalation (#988).
	cmd := exec.Command(cmdPath, args...)
	cmd.Dir = workDir
	cmd.Env = envForAdapterOrProfile(run, adapter != nil, env, extraEnv)
	stdout, err := cmd.StdoutPipe()
	if planPipeFailure(err).Fail {
		e.publishFailed(run, pipeOpenError("stdout", err))
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if planPipeFailure(err).Fail {
		e.publishFailed(run, pipeOpenError("stderr", err))
		return nil, err
	}
	var stdin io.WriteCloser
	if planStdinPipeOpen(adapter).Open {
		stdin, err = cmd.StdinPipe()
		if planPipeFailure(err).Fail {
			e.publishFailed(run, pipeOpenError("stdin", err))
			return nil, err
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
		return nil, ctx.Err()
	case cmdStartFailed:
		e.publishFailed(run, startErr)
		return nil, startErr
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
		go e.watchRunProcess(ctx, run.ID, cmd.Process, watchStop)
	}

	// Eager-close stdin when adapter/decision-loop do not need the pipe.
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
		*runStartTime = time.Now()
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
	go e.publishOutput(&wg, run, outStore, outputLimiter, "stderr", proc.stderr)

	// Inject context budget for token tracking in stream parsers.
	// Also inject RunProcessContext unconditionally — SDK adapters
	// (anthropic-sdk, openai-sdk) need prompt, model, and messages
	// regardless of whether a WorkDir is set.
	parserCtx := withParserContextValues(ctx, runCtx)

	if proc.buildPlan.UseStructuredParser {
		wg.Add(1)
		go e.publishStructuredOutput(&wg, run, proc.stdout, proc.stdin, adapter, parserCtx, &parseErr)
	} else {
		// Raw capture: stdout goes to run.output.batch events
		wg.Add(1)
		go e.publishOutput(&wg, run, outStore, outputLimiter, "stdout", proc.stdout)
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
