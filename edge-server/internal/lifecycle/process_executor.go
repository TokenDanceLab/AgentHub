package lifecycle

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

var ErrProcessBusRequired = errors.New("process event bus is required")
var ErrProcessCommandRequired = errors.New("process command is required")
var ErrProcessStoreRequired = errors.New("process store is required")

type ProcessExecutorConfig struct {
	Command  string
	Args     []string
	Env      []string
	ExtraEnv []string
	WorkDir  string
}

type ProcessExecutor struct {
	bus     *events.Bus
	store   store.RunLifecycleStore
	profile RunnerProfile
	adapter adapters.AgentAdapter // nil = raw stdout capture

	mu      sync.Mutex
	running map[string]context.CancelFunc
}

func NewProcessExecutor(bus *events.Bus, store store.RunLifecycleStore, cfg ProcessExecutorConfig, adapter adapters.AgentAdapter) (*ProcessExecutor, error) {
	if bus == nil {
		return nil, ErrProcessBusRequired
	}
	if store == nil {
		return nil, ErrProcessStoreRequired
	}
	profile, err := NewGenericRunnerProfile(cfg.Command, cfg.Args, cfg.Env, cfg.ExtraEnv, cfg.WorkDir)
	if err != nil {
		return nil, err
	}
	if cfg.WorkDir != "" {
		info, err := os.Stat(cfg.WorkDir)
		if err != nil {
			return nil, fmt.Errorf("process workdir %q is not accessible: %w", cfg.WorkDir, err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("process workdir %q is not a directory", cfg.WorkDir)
		}
	}
	return &ProcessExecutor{
		bus:     bus,
		store:   store,
		profile: profile,
		adapter: adapter,
		running: make(map[string]context.CancelFunc),
	}, nil
}

func (e *ProcessExecutor) Start(run store.Run) error {
	current, ok := e.store.GetRun(run.ID)
	if !ok {
		return store.ErrNotFound
	}
	if current.Status != "queued" {
		return ErrRunAlreadyStarted
	}

	ctx, cancel := context.WithCancel(context.Background())
	e.mu.Lock()
	if _, ok := e.running[run.ID]; ok {
		e.mu.Unlock()
		cancel()
		return ErrRunAlreadyStarted
	}
	e.running[run.ID] = cancel
	e.mu.Unlock()

	go e.run(ctx, run)
	return nil
}

func (e *ProcessExecutor) Cancel(runID string) CancelResult {
	run, ok := e.store.GetRun(runID)
	if !ok {
		return CancelResult{Found: false, Status: "not_found"}
	}
	switch run.Status {
	case "queued", "started", "cancelling":
	default:
		return CancelResult{Run: run, Found: true, Status: run.Status}
	}

	e.mu.Lock()
	cancel, ok := e.running[runID]
	e.mu.Unlock()
	if !ok {
		return CancelResult{Found: false, Status: "not_running"}
	}
	cancel()

	run, ok = e.store.SetRunStatusIf(runID, "cancelling", "queued", "started", "cancelling")
	if !ok {
		if current, found := e.store.GetRun(runID); found {
			return CancelResult{Run: current, Found: true, Status: current.Status}
		}
		return CancelResult{Found: false, Status: "not_found"}
	}
	return CancelResult{Run: run, Found: true, Status: run.Status}
}

func (e *ProcessExecutor) run(ctx context.Context, run store.Run) {
	defer e.finish(run.ID)

	args, env, err := e.profile.Template.Expand(RunProcessContext{Run: run})
	if err != nil {
		e.publishFailed(run, err)
		return
	}
	_, extraEnv, err := e.profile.ExtraEnvTemplate.Expand(RunProcessContext{Run: run})
	if err != nil {
		e.publishFailed(run, err)
		return
	}
	cmd := exec.CommandContext(ctx, e.profile.Command, args...)
	cmd.Dir = e.profile.WorkDir
	cmd.Env = e.envForRun(run, env, extraEnv)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		e.publishFailed(run, fmt.Errorf("open stdout pipe: %w", err))
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		e.publishFailed(run, fmt.Errorf("open stderr pipe: %w", err))
		return
	}
	if err := cmd.Start(); err != nil {
		if ctx.Err() != nil {
			e.publishCancelled(run)
			return
		}
		e.publishFailed(run, err)
		return
	}

	started, ok := e.store.SetRunStatusIf(run.ID, "started", "queued")
	if ok {
		e.bus.Publish("run.started", runScope(started), RunResponse(started))
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go e.publishOutput(&wg, run, "stderr", stderr)

	if e.adapter != nil {
		// Structured parsing: adapter translates CLI protocol to typed events
		wg.Add(1)
		go e.publishStructuredOutput(&wg, run, stdout)
	} else {
		// Raw capture: stdout goes to run.output.batch events
		wg.Add(1)
		go e.publishOutput(&wg, run, "stdout", stdout)
	}

	waitErr := cmd.Wait()
	wg.Wait()

	if ctx.Err() != nil || e.runStatus(run.ID) == "cancelling" {
		e.publishCancelled(run)
		return
	}
	if waitErr != nil {
		e.publishFailed(run, waitErr)
		return
	}
	finished, ok := e.store.SetRunStatusIf(run.ID, "finished", "started")
	if ok {
		e.bus.Publish("run.finished", runScope(finished), RunResponse(finished))
	}
}

func (e *ProcessExecutor) publishOutput(wg *sync.WaitGroup, run store.Run, stream string, reader io.Reader) {
	defer wg.Done()

	buf := make([]byte, 32*1024)
	offset := 0
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			text := string(buf[:n])
			e.bus.Publish("run.output.batch", runScope(run), map[string]any{
				"runId":  run.ID,
				"stream": stream,
				"chunks": []map[string]any{
					{"offset": offset, "text": text},
				},
			})
			offset += n
		}
		if err != nil {
			return
		}
	}
}

func (e *ProcessExecutor) envForRun(run store.Run, profileEnv, extraEnv []string) []string {
	env := profileEnv
	if env == nil {
		env = os.Environ()
	} else {
		env = append([]string(nil), env...)
	}
	env = append(env, extraEnv...)
	return append(env,
		"AGENTHUB_RUN_ID="+run.ID,
		"AGENTHUB_PROJECT_ID="+run.ProjectID,
		"AGENTHUB_THREAD_ID="+run.ThreadID,
	)
}

func (e *ProcessExecutor) publishFailed(run store.Run, err error) {
	failed, ok := e.store.SetRunStatusIf(run.ID, "failed", "queued", "started")
	if ok {
		e.bus.Publish("run.failed", runScope(failed), map[string]any{
			"runId":  failed.ID,
			"status": failed.Status,
			"error":  err.Error(),
		})
	}
}

func (e *ProcessExecutor) publishCancelled(run store.Run) {
	cancelled, ok := e.store.SetRunStatusIf(run.ID, "cancelled", "queued", "started", "cancelling")
	if ok {
		e.bus.Publish("run.cancelled", runScope(cancelled), RunResponse(cancelled))
	}
}

func (e *ProcessExecutor) runStatus(runID string) string {
	run, ok := e.store.GetRun(runID)
	if !ok {
		return ""
	}
	return run.Status
}

func (e *ProcessExecutor) finish(runID string) {
	e.mu.Lock()
	delete(e.running, runID)
	e.mu.Unlock()
}

// publishStructuredOutput uses the configured AgentAdapter to parse the CLI's
// native protocol and emit typed events to the bus.
func (e *ProcessExecutor) publishStructuredOutput(wg *sync.WaitGroup, run store.Run, stdout io.Reader) {
	defer wg.Done()
	emitter := &busEventEmitter{bus: e.bus}
	if err := e.adapter.ParseStream(context.Background(), stdout, nil, emitter, run); err != nil {
		// Structured parse errors are non-fatal; raw stderr is still captured
	}
}

// busEventEmitter adapts events.Bus to the adapters.EventEmitter interface.
type busEventEmitter struct {
	bus *events.Bus
}

func (e *busEventEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.bus.Publish(eventType, scope, payload)
}
