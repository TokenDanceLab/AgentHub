package lifecycle

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"strings"
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
}

type ProcessExecutor struct {
	bus        *events.Bus
	store      store.RunLifecycleStore
	profile    RunnerProfile
	adapter    adapters.AgentAdapter // default adapter; may be nil (raw stdout capture)
	adapterReg *adapters.Registry    // per-run adapter resolution; may be nil
	metrics    *metrics.EdgeMetrics  // Prometheus instrumentation; may be nil

	maxConcurrentRuns         int // maximum concurrent runs; 0 means use default (5)
	maxRunOutputBytes         int64
	maxStructuredPayloadBytes int64

	// Orchestrator result aggregation
	agentRegistry *agents.Registry  // agent instance registry for sub-agent tracking; may be nil
	messageQueue  *agents.Queue     // inter-agent message queue for result delivery; may be nil
	resultAgg     *ResultAggregator // tracks sub-agent completion and emits sub_agents_complete; may be nil

	mu         sync.Mutex
	running    map[string]context.CancelFunc
	stdins     map[string]io.Writer                 // runID to stdin (for adapter-aware interrupt)
	runOutputs map[string]*runnerctx.RunOutputStore // runID to temp log for output persistence and replay
	runToAgent map[string]string                    // runID to agentInstanceID for result aggregation
}

func NewProcessExecutor(bus *events.Bus, store store.RunLifecycleStore, cfg ProcessExecutorConfig, adapter adapters.AgentAdapter, adapterReg *adapters.Registry) (*ProcessExecutor, error) {
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
		bus:                       bus,
		store:                     store,
		profile:                   profile,
		adapter:                   adapter,
		adapterReg:                adapterReg,
		maxConcurrentRuns:         defaultMaxConcurrentRuns,
		maxRunOutputBytes:         defaultRunOutputMaxBytes,
		maxStructuredPayloadBytes: adapters.DefaultStructuredPayloadMaxBytes,
		running:                   make(map[string]context.CancelFunc),
		stdins:                    make(map[string]io.Writer),
		runOutputs:                make(map[string]*runnerctx.RunOutputStore),
		runToAgent:                make(map[string]string),
	}, nil
}

// defaultRunTimeout is the hard deadline for any agent run. A hung subprocess
// should not block the executor goroutine forever.
const defaultRunTimeout = 30 * time.Minute

const (
	defaultMaxConcurrentRuns = 5
	defaultReadBufferSize    = 32 * 1024
	defaultRunOutputMaxBytes = 1 * 1024 * 1024 // 1MB cap on run output before temp log write
)

type runOutputLimiter struct {
	mu        sync.Mutex
	maxBytes  int64
	written   int64
	truncated bool
}

func newRunOutputLimiter(maxBytes int64) *runOutputLimiter {
	if maxBytes <= 0 {
		maxBytes = defaultRunOutputMaxBytes
	}
	return &runOutputLimiter{maxBytes: maxBytes}
}

func (l *runOutputLimiter) allow(data []byte) (allowed []byte, truncatedNow bool, written int64, maxBytes int64) {
	l.mu.Lock()
	defer l.mu.Unlock()

	maxBytes = l.maxBytes
	remaining := maxBytes - l.written
	if remaining <= 0 {
		if !l.truncated {
			l.truncated = true
			return nil, true, l.written, maxBytes
		}
		return nil, false, l.written, maxBytes
	}
	if int64(len(data)) <= remaining {
		l.written += int64(len(data))
		return data, false, l.written, maxBytes
	}

	allowed = data[:int(remaining)]
	l.written = maxBytes
	if !l.truncated {
		l.truncated = true
		truncatedNow = true
	}
	return allowed, truncatedNow, l.written, maxBytes
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

func (e *ProcessExecutor) Start(run store.Run, runCtx RunProcessContext) error {
	current, ok := e.store.GetRun(run.ID)
	if !ok {
		return store.ErrNotFound
	}
	if current.Status != "queued" {
		return ErrRunAlreadyStarted
	}

	e.mu.Lock()
	max := e.maxConcurrentRuns
	if max <= 0 {
		max = defaultMaxConcurrentRuns
	}
	if len(e.running) >= max {
		e.mu.Unlock()
		return ErrTooManyConcurrentRuns
	}
	if _, ok := e.running[run.ID]; ok {
		e.mu.Unlock()
		return ErrRunAlreadyStarted
	}
	// Create context and atomically insert cancel into the map while holding
	// the lock, so a concurrent Cancel can never miss the cancel func.
	ctx, cancel := context.WithTimeout(context.Background(), defaultRunTimeout)
	e.running[run.ID] = cancel
	e.mu.Unlock()

	runCtx.Run = run
	go e.run(ctx, run, runCtx)
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

	// Send adapter-specific interrupt via stdin before canceling context.
	// This allows Claude Code to clean up gracefully (finish current API call,
	// flush session state) rather than being killed by SIGTERM.
	e.mu.Lock()
	if stdin, ok := e.stdins[runID]; ok {
		if err := adapters.WriteInterrupt(stdin, "interrupt-"+runID); err != nil {
			slog.Debug("process: interrupt write failed", "runId", runID, "err", err)
		}
	}
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

func (e *ProcessExecutor) run(ctx context.Context, run store.Run, runCtx RunProcessContext) {
	defer e.finish(run.ID)

	// Resolve adapter for this run: explicit agentID first, then default
	adapter := e.adapter
	if e.adapterReg != nil {
		if resolved, err := e.adapterReg.Resolve(runCtx.AgentID); err == nil {
			adapter = resolved
		}
	}

	// Resolve adapter label for Prometheus metrics
	var adapterLabel string
	if e.metrics != nil {
		if adapter != nil {
			adapterLabel = adapter.Metadata().ID
		} else {
			adapterLabel = "none"
		}
	}

	var runStartTime time.Time
	if e.metrics != nil {
		defer func() {
			if runStartTime.IsZero() {
				return // run never started (early failure before cmd.Start)
			}
			r, ok := e.store.GetRun(run.ID)
			if !ok {
				return
			}
			e.metrics.RecordRunFinish(adapterLabel, r.Status, time.Since(runStartTime).Seconds())
		}()
	}

	var cmdPath string
	var args, env []string
	var workDir string

	if adapter != nil {
		// Adapter mode: BuildCommand provides full command configuration
		cmdPath, args, env, workDir = adapter.BuildCommand(adapters.RunProcessContext{
			Run:               runCtx.Run,
			Prompt:            runCtx.Prompt,
			AgentID:           runCtx.AgentID,
			Model:             runCtx.Model,
			WorkDir:           runCtx.WorkDir,
			SessionID:         runCtx.SessionID,
			ContinueLast:      runCtx.ContinueLast,
			ForkSession:       runCtx.ForkSession,
			ReasoningEffort:   runCtx.ReasoningEffort,
			MaxThinkingTokens: runCtx.MaxThinkingTokens,
			PermissionMode:    runCtx.PermissionMode,
			IncludePartial:    runCtx.IncludePartial,
			AgentName:         runCtx.AgentName,
			Budget:            runCtx.Budget,
		})
	} else {
		// Profile mode: use configured command template
		var err error
		args, env, err = e.profile.Template.Expand(runCtx)
		if err != nil {
			e.publishFailed(run, err)
			return
		}
		cmdPath = e.profile.Command
		workDir = e.profile.WorkDir
	}

	_, extraEnv, err := e.profile.ExtraEnvTemplate.Expand(runCtx)
	if err != nil {
		e.publishFailed(run, err)
		return
	}
	cmd := exec.CommandContext(ctx, cmdPath, args...)
	cmd.Dir = workDir
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
	var stdin io.WriteCloser
	if adapter != nil && adapter.NeedsStdin() {
		stdin, err = cmd.StdinPipe()
		if err != nil {
			e.publishFailed(run, fmt.Errorf("open stdin pipe: %w", err))
			return
		}
		e.mu.Lock()
		e.stdins[run.ID] = stdin
		e.mu.Unlock()
	}
	if err := cmd.Start(); err != nil {
		if ctx.Err() != nil {
			e.publishCancelled(run)
			return
		}
		e.publishFailed(run, err)
		return
	}
	// If context was cancelled after Start but before we checked, kill the child.
	if ctx.Err() != nil {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		e.publishCancelled(run)
		return
	}

	// Record metrics: run has started successfully
	if e.metrics != nil {
		e.metrics.RecordRunStart(adapterLabel)
		runStartTime = time.Now()
	}

	started, ok := e.store.SetRunStatusIf(run.ID, "started", "queued")
	if ok {
		e.bus.Publish("run.started", runScope(started), RunResponse(started))
	}
	e.checkPersistError(run.ID)

	// Create temp file for run output persistence and replay
	outStore, err := runnerctx.NewRunOutputStore(run.ID)
	if err != nil {
		slog.Warn("process: failed to create run output store", "runId", run.ID, "err", err)
	} else {
		e.mu.Lock()
		e.runOutputs[run.ID] = outStore
		e.mu.Unlock()
	}

	var wg sync.WaitGroup
	outputLimiter := newRunOutputLimiter(e.maxRunOutputBytes)
	wg.Add(1)
	go e.publishOutput(&wg, run, outStore, outputLimiter, "stderr", stderr)

	// Inject context budget for token tracking in stream parsers.
	parserCtx := ctx
	if runCtx.Budget != nil {
		parserCtx = context.WithValue(ctx, adapters.CtxBudgetKey, runCtx.Budget)
	}

	if adapter != nil {
		wg.Add(1)
		go e.publishStructuredOutput(&wg, run, stdout, stdin, adapter, parserCtx)
	} else {
		// Raw capture: stdout goes to run.output.batch events
		wg.Add(1)
		go e.publishOutput(&wg, run, outStore, outputLimiter, "stdout", stdout)
	}

	waitErr := cmd.Wait()
	wg.Wait()

	if ctx.Err() != nil || e.runStatus(run.ID) == "cancelling" {
		e.publishCancelled(run)
		e.sendSubAgentResult(run.ID, "cancelled", nil)
		return
	}
	if waitErr != nil {
		e.publishFailed(run, waitErr)
		e.sendSubAgentResult(run.ID, "failed", map[string]any{"error": waitErr.Error()})
		return
	}
	finished, ok := e.store.SetRunStatusIf(run.ID, "finished", "started")
	if ok {
		e.bus.Publish("run.finished", runScope(finished), RunResponse(finished))
		e.sendSubAgentResult(run.ID, "finished", RunResponse(finished))
	}
	e.checkPersistError(run.ID)
}

func (e *ProcessExecutor) publishOutput(wg *sync.WaitGroup, run store.Run, outStore *runnerctx.RunOutputStore, limiter *runOutputLimiter, stream string, reader io.Reader) {
	defer wg.Done()

	buf := make([]byte, defaultReadBufferSize)
	offset := 0
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			allowed, truncatedNow, written, maxBytes := limiter.allow(buf[:n])
			if len(allowed) > 0 || truncatedNow {
				text := string(allowed)
				if outStore != nil && len(allowed) > 0 {
					if _, err := outStore.Write(text); err != nil {
						slog.Warn("process: failed to write output store", "runId", run.ID, "err", err)
					}
				}
				payload := map[string]any{
					"runId":  run.ID,
					"stream": stream,
					"chunks": []map[string]any{
						{"offset": offset, "text": text},
					},
				}
				if truncatedNow {
					payload["truncated"] = true
					payload["maxBytes"] = maxBytes
					payload["bytesWritten"] = written
					payload["message"] = fmt.Sprintf("run output truncated after %d bytes", maxBytes)
					slog.Warn("process: run output truncated", "runId", run.ID, "maxBytes", maxBytes)
				}
				e.bus.Publish("run.output.batch", runScope(run), payload)
				offset += len(allowed)
			}
		}
		if err != nil {
			return
		}
	}
}

// envForRun builds the environment for a child process.
// When profileEnv is nil the child receives a minimal sanitized environment
// (only whitelisted parent vars + extraEnv + AGENTHUB_* runtime vars).
// A non-nil profileEnv is used verbatim as the base (administrator-configured).
func (e *ProcessExecutor) envForRun(run store.Run, profileEnv, extraEnv []string) []string {
	var env []string
	if profileEnv == nil {
		env = SanitizedEnv(nil, extraEnv)
	} else {
		// Administrator explicitly configured the environment, respect it,
		// but still warn about any sensitive-looking variables it includes.
		for _, kv := range profileEnv {
			key, _, _ := strings.Cut(kv, "=")
			if IsSensitiveEnvKey(key) {
				slog.Warn("sensitive env var present in explicitly configured agent environment", "key", key)
			}
		}
		env = append(append([]string(nil), profileEnv...), extraEnv...)
	}
	return append(env,
		"AGENTHUB_RUN_ID="+run.ID,
		"AGENTHUB_PROJECT_ID="+run.ProjectID,
		"AGENTHUB_THREAD_ID="+run.ThreadID,
	)
}

func (e *ProcessExecutor) publishFailed(run store.Run, err error) {
	failed, ok := e.store.SetRunStatusIf(run.ID, "failed", "queued", "started")
	if ok {
		exitCode := ExitCodeFromErr(err)
		classified := ClassifyError(err, exitCode)
		e.bus.Publish("run.failed", runScope(failed), map[string]any{
			"runId":  failed.ID,
			"status": failed.Status,
			"error":  classified,
		})
	}
	e.checkPersistError(run.ID)
}

func (e *ProcessExecutor) publishCancelled(run store.Run) {
	cancelled, ok := e.store.SetRunStatusIf(run.ID, "cancelled", "queued", "started", "cancelling")
	if ok {
		e.bus.Publish("run.cancelled", runScope(cancelled), RunResponse(cancelled))
	}
	e.checkPersistError(run.ID)
}

// checkPersistError logs and emits a persistence_error event when the FileStore
// has a pending persistence failure after a status transition.
func (e *ProcessExecutor) checkPersistError(runID string) {
	type persistChecker interface {
		LastPersistError() error
	}
	pc, ok := e.store.(persistChecker)
	if !ok {
		return
	}
	if persistErr := pc.LastPersistError(); persistErr != nil {
		slog.Error("file store persist failed during run status transition", "runId", runID, "err", persistErr)
		e.bus.Publish("run.persistence_error", map[string]any{"runId": runID}, map[string]any{
			"runId": runID,
			"error": persistErr.Error(),
		})
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
	delete(e.stdins, runID)
	delete(e.runToAgent, runID)
	if s, ok := e.runOutputs[runID]; ok {
		if err := s.Close(); err != nil {
			slog.Warn("process: failed to close output store", "runId", runID, "err", err)
		}
		delete(e.runOutputs, runID)
	}
	e.mu.Unlock()
}

// sendSubAgentResult delivers a result message from a completed sub-agent run
// back to its parent agent via the message queue. This enables the orchestrator
// to aggregate results from dispatched sub-agents.
func (e *ProcessExecutor) sendSubAgentResult(runID, status string, payload any) {
	if e.agentRegistry == nil || e.messageQueue == nil {
		return
	}

	e.mu.Lock()
	agentID, ok := e.runToAgent[runID]
	e.mu.Unlock()
	if !ok {
		return
	}

	inst, found := e.agentRegistry.Get(agentID)
	if !found || inst.ParentID == "" {
		return
	}

	msgType := agents.MsgTypeResult
	if status == "failed" || status == "cancelled" {
		msgType = agents.MsgTypeError
		e.agentRegistry.SetStatus(agentID, agents.StatusError, "")
	} else if status == "finished" {
		e.agentRegistry.SetStatus(agentID, agents.StatusCompleted, "")
	}

	e.messageQueue.EnsureAgent(inst.ParentID, 64)
	e.messageQueue.Send(agents.Message{
		ID:          "msg_" + runID,
		FromAgentID: agentID,
		ToAgentID:   inst.ParentID,
		Type:        msgType,
		Payload: map[string]any{
			"runId":     runID,
			"status":    status,
			"agentId":   agentID,
			"agentName": inst.Name,
			"result":    payload,
		},
		Timestamp: time.Now().UTC(),
	})
}

// publishStructuredOutput uses the configured AgentAdapter to parse the CLI's
// native protocol and emit typed events to the bus.
func (e *ProcessExecutor) publishStructuredOutput(wg *sync.WaitGroup, run store.Run, stdout io.Reader, stdin io.Writer, adapter adapters.AgentAdapter, ctx context.Context) {
	defer wg.Done()
	scope := runScope(run)
	var emitter adapters.EventEmitter = adapters.NewScopedEventEmitter(
		adapters.NewPayloadLimitEmitter(adapters.NewBusEventEmitter(e.bus), e.maxStructuredPayloadBytes),
		scope,
	)

	// Wrap emitter with budget monitoring: emits run.agent.context_warning
	// when token usage exceeds the auto-compaction threshold (85%).
	if budget, ok := ctx.Value(adapters.CtxBudgetKey).(*runnerctx.ContextBudget); ok && budget != nil {
		emitter = adapters.NewBudgetAwareEmitter(emitter, budget, scope)
	}

	if err := adapter.ParseStream(ctx, stdout, stdin, emitter, run); err != nil {
		slog.Error("structured output parse error", "runId", run.ID, "err", err)
	}
}

// SpawnSubAgent implements adapters.SubAgentSpawner for the ProcessExecutor.
// It creates a new run for a sub-agent dispatched by the orchestrator, queues it,
// and starts execution using the resolved agent adapter.
//
// Reference: docs/reference/cross-comparison/03-orchestration.md Layer 3 (Supervisor routing).
func (e *ProcessExecutor) SpawnSubAgent(parentRun store.Run, task adapters.SubAgentTask) (agentInstanceID string, runID string, err error) {
	runID = "run_" + task.TaskID
	agentInstanceID = "agent_" + task.TaskID

	// Resolve ThreadID: prefer the explicit override from task, fall back to parent
	threadID := task.ThreadID
	if threadID == "" {
		threadID = parentRun.ThreadID
	}

	// Create the run in the store
	run, err := e.store.(store.Writer).CreateRun(runID, parentRun.ProjectID, threadID)
	if err != nil {
		slog.Error("failed to create sub-agent run", "taskId", task.TaskID, "err", err)
		return "", "", err
	}

	// Emit run.queued
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}
	e.bus.Publish("run.queued", scope, run)

	// Build run context with the task prompt, target agent, and propagated
	// context budget from the parent orchestrator.
	runCtx := RunProcessContext{
		Run:     run,
		Prompt:  task.Prompt,
		AgentID: task.AgentID,
		Budget:  childBudget(task.Budget, task.Depth),
		Model:   task.Model,
	}

	// Store the run-to-agent mapping so result aggregation can find the agent later.
	e.mu.Lock()
	e.runToAgent[runID] = agentInstanceID
	e.mu.Unlock()

	// Use parent thread if no explicit ThreadID in task
	if task.ThreadID != "" {
		runCtx.SessionID = task.ThreadID
	}

	// Start the run
	if err := e.Start(run, runCtx); err != nil {
		slog.Error("failed to start sub-agent run", "runId", runID, "err", err)
		e.mu.Lock()
		delete(e.runToAgent, runID)
		e.mu.Unlock()
		return "", "", err
	}

	return agentInstanceID, runID, nil
}

// childBudget creates a context budget for a sub-agent from the parent budget.
// Deeper delegation levels get a smaller fraction of remaining tokens to prevent
// budget exhaustion at the root.
func childBudget(parent *runnerctx.ContextBudget, depth int) *runnerctx.ContextBudget {
	if parent == nil {
		return runnerctx.NewContextBudget(0)
	}
	remaining := parent.Remaining()
	// Fraction reduces with depth: depth 1 gets 1/2, depth 2 gets 1/4, etc.
	// Minimum 16K tokens to ensure useful work can be done.
	fraction := int64(1 << depth) // 2, 4, 8, ...
	alloc := remaining / fraction
	const minTokens = 16_000
	if alloc < minTokens {
		alloc = minTokens
	}
	if alloc > remaining {
		alloc = remaining
	}
	return runnerctx.NewContextBudget(int(alloc))
}
