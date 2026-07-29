package lifecycle

import (
	"context"
	"io"
	"log/slog"
	"os/exec"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
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
