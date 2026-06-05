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
	"unicode/utf8"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/hub"
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
	hubCallback *hub.CallbackClient

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

	mu         sync.Mutex
	running    map[string]context.CancelFunc
	stdins     map[string]io.Writer                 // runID to stdin (for adapter-aware interrupt)
	processes  map[string]*os.Process               // runID to os.Process (for graceful shutdown)
	runOutputs map[string]*runnerctx.RunOutputStore // runID to temp log for output persistence and replay
	runToAgent map[string]string                    // runID to agentInstanceID for result aggregation
	hubTasks   map[string]string                    // runID to Hub taskID (for Edge→Hub callbacks)
	hubOutputs map[string]*hubOutputCollector       // runID to bounded final response collector
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
	runTimeout := cfg.RunTimeout
	if runTimeout <= 0 {
		runTimeout = defaultRunTimeout
	}
	shutdownGP := cfg.ShutdownGracePeriod
	if shutdownGP <= 0 {
		shutdownGP = defaultShutdownGracePeriod
	}
	shutdownFT := cfg.ShutdownForceTimeout
	if shutdownFT <= 0 {
		shutdownFT = defaultShutdownForceTimeout
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
		runTimeout:                runTimeout,
		shutdownGracePeriod:       shutdownGP,
		shutdownForceTimeout:      shutdownFT,
		running:                   make(map[string]context.CancelFunc),
		stdins:                    make(map[string]io.Writer),
		processes:                 make(map[string]*os.Process),
		runOutputs:                make(map[string]*runnerctx.RunOutputStore),
		runToAgent:                make(map[string]string),
		hubTasks:                  make(map[string]string),
		hubOutputs:                make(map[string]*hubOutputCollector),
	}, nil
}

// defaultRunTimeout is the hard deadline for any agent run. A hung subprocess
// should not block the executor goroutine forever.
const defaultRunTimeout = 30 * time.Minute

// defaultShutdownGracePeriod is the time between sending a stdin interrupt and
// escalating to SIGTERM (Unix) or Kill (Windows).
const defaultShutdownGracePeriod = 10 * time.Second

// defaultShutdownForceTimeout is the time between SIGTERM and SIGKILL on Unix.
const defaultShutdownForceTimeout = 5 * time.Second

const (
	defaultMaxConcurrentRuns          = 5
	defaultReadBufferSize             = 32 * 1024
	defaultRunOutputMaxBytes          = 1 * 1024 * 1024 // 1MB cap on run output before temp log write
	hubCallbackFinalMaxBytes          = 32 * 1024
	hubCallbackChunkMaxBytes          = 16 * 1024
	persistedAssistantMessageMaxBytes = 200 * 1024
	persistedFailureMessageMaxBytes   = 8 * 1024
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
func (e *ProcessExecutor) SetHubCallback(c *hub.CallbackClient) {
	e.hubCallback = c
}

// WithHubCallback is a fluent variant of SetHubCallback.
func (e *ProcessExecutor) WithHubCallback(c *hub.CallbackClient) *ProcessExecutor {
	e.SetHubCallback(c)
	return e
}

func (e *ProcessExecutor) Start(run store.Run, runCtx RunProcessContext) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	current, ok := e.store.GetRun(run.ID)
	if !ok {
		return store.ErrNotFound
	}
	if current.Status != "queued" {
		return ErrRunAlreadyStarted
	}

	max := e.maxConcurrentRuns
	if max <= 0 {
		max = defaultMaxConcurrentRuns
	}
	if len(e.running) >= max {
		return ErrTooManyConcurrentRuns
	}
	if _, ok := e.running[run.ID]; ok {
		return ErrRunAlreadyStarted
	}
	// Create context and atomically insert cancel into the map while holding
	// the lock, so a concurrent Cancel can never miss the cancel func.
	ctx, cancel := context.WithTimeout(context.Background(), e.runTimeout)
	e.running[run.ID] = cancel

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

	// Graceful shutdown: wait grace period for child to respond to stdin interrupt,
	// then send SIGTERM, wait force timeout, and escalate to SIGKILL as last resort.
	e.mu.Lock()
	proc := e.processes[runID]
	e.mu.Unlock()
	if proc != nil {
		// Wait shutdownGracePeriod for child process to naturally exit
		time.Sleep(e.shutdownGracePeriod)
		// Send SIGTERM (os.Interrupt)
		_ = proc.Signal(os.Interrupt)
		// Wait shutdownForceTimeout before escalating
		time.Sleep(e.shutdownForceTimeout)
		// Escalate to Kill
		_ = proc.Kill()
		_, _ = proc.Wait()
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

	// Store Hub task ID for Edge→Hub direct callback reporting
	if runCtx.HubTaskID != "" {
		e.mu.Lock()
		e.hubTasks[run.ID] = runCtx.HubTaskID
		e.hubOutputs[run.ID] = newHubOutputCollector(hubCallbackFinalMaxBytes)
		e.mu.Unlock()
	}

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

	// SEC-02: Defense-in-depth — reject 'bypassPermissions' at the executor level
	// before launching the agent process. If the API validation is somehow
	// bypassed (e.g. direct internal calls), this fallback ensures the agent
	// never receives a permission mode that disables all security hooks.
	if runCtx.PermissionMode == "bypassPermissions" {
		slog.Warn("process: permission mode 'bypassPermissions' is forbidden, falling back to 'default'",
			"runId", run.ID,
			"agentId", runCtx.AgentID,
		)
		runCtx.PermissionMode = "default"
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
			Run:                    runCtx.Run,
			Prompt:                 runCtx.Prompt,
			AgentID:                runCtx.AgentID,
			Model:                  runCtx.Model,
			WorkDir:                runCtx.WorkDir,
			SessionID:              runCtx.SessionID,
			ContinueLast:           runCtx.ContinueLast,
			ForkSession:            runCtx.ForkSession,
			ReasoningEffort:        runCtx.ReasoningEffort,
			ThinkingMode:           runCtx.ThinkingMode,
			MaxThinkingTokens:      runCtx.MaxThinkingTokens,
			PermissionMode:         runCtx.PermissionMode,
			IncludePartial:         runCtx.IncludePartial,
			StructuredOutputSchema: runCtx.StructuredOutputSchema,
			SystemPrompt:           runCtx.SystemPrompt,
			AppendSystemPrompt:     runCtx.AppendSystemPrompt,
			SkillsPrompt:           runCtx.SkillsPrompt,
			AgentDefinitions:       runCtx.AgentDefinitions,
			MCPConfig:              runCtx.MCPConfig,
			AllowedTools:           runCtx.AllowedTools,
			HubTaskID:              runCtx.HubTaskID,
			ConfigOverrides:        runCtx.ConfigOverrides,
			Ephemeral:              runCtx.Ephemeral,
			AgentName:              runCtx.AgentName,
			Budget:                 runCtx.Budget,
			Messages:               runCtx.Messages,
			PinnedMessages:         runCtx.PinnedMessages,
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
	slog.Debug("executor.subprocess.starting", "runId", run.ID, "command", cmdPath, "args", args)
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
			_, _ = cmd.Process.Wait()
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
	if stdin != nil && !adapter.NeedsStdin() && e.decisionLoopFactory == nil {
		_ = stdin.Close()
		e.mu.Lock()
		delete(e.stdins, run.ID)
		e.mu.Unlock()
	}

	// Record metrics: run has started successfully
	if e.metrics != nil {
		e.metrics.RecordRunStart(adapterLabel)
		runStartTime = time.Now()
	}

	started, ok := e.store.SetRunStatusIf(run.ID, "started", "queued")
	if ok {
		e.bus.Publish("run.started", runScope(started), RunResponse(started))
		// Fire Hub TaskAck callback (Edge→Hub direct bridge)
		e.fireHubAck(run.ID)
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

	var parseErr error
	if adapter != nil {
		wg.Add(1)
		go e.publishStructuredOutput(&wg, run, stdout, stdin, adapter, parserCtx, &parseErr)
	} else {
		// Raw capture: stdout goes to run.output.batch events
		wg.Add(1)
		go e.publishOutput(&wg, run, outStore, outputLimiter, "stdout", stdout)
	}

	waitErr := cmd.Wait()
	slog.Debug("executor.subprocess.exited", "runId", run.ID, "exitCode", ExitCodeFromErr(waitErr))
	wg.Wait()

	// Context budget compaction check: after the stream completes, evaluate
	// whether the context budget exceeded the auto-compaction threshold.
	// When triggered, we log the budget state and emit a compaction event
	// so upstream session managers can compact the actual message history.
	if runCtx.Budget != nil && runCtx.Budget.ShouldCompact() {
		usagePct := runCtx.Budget.UsagePercent()
		tokensUsed := runCtx.Budget.UsedTokens.Load()
		remaining := runCtx.Budget.Remaining()
		slog.Info("process: context compaction threshold reached",
			"runId", run.ID,
			"usagePercent", usagePct,
			"tokensUsed", tokensUsed,
			"tokensRemaining", remaining,
		)
		e.bus.Publish(adapters.BusEventContextCompaction, runScope(run), map[string]any{
			"runId":           run.ID,
			"usagePercent":    usagePct,
			"tokensUsed":      tokensUsed,
			"tokensRemaining": remaining,
			"threshold":       runnerctx.CompactionThreshold,
		})
	}

	if ctx.Err() != nil || e.runStatus(run.ID) == "cancelling" {
		e.publishCancelled(run)
		e.sendSubAgentResult(run.ID, "cancelled", nil)
		return
	}
	if waitErr != nil {
		e.publishFailed(run, errorWithRunOutput(waitErr, outStore))
		e.sendSubAgentResult(run.ID, "failed", map[string]any{"error": waitErr.Error()})
		return
	}
	// #179: handle structured output parse errors with recoverability distinction.
	// Non-recoverable errors (pipe broken, context cancelled) fail the run.
	// Recoverable errors (malformed event, orphaned tool) emit a warning and
	// allow the run to finish naturally — matching Kanna/OpenCode recovery patterns.
	if parseErr != nil {
		var psErr *adapters.ParseStreamError
		if errors.As(parseErr, &psErr) && psErr.Recoverable() {
			slog.Warn("process: recoverable stream parse error, continuing run", "runId", run.ID, "err", parseErr)
			e.bus.Publish(adapters.BusEventContextWarning, runScope(run), map[string]any{
				"runId":   run.ID,
				"message": fmt.Sprintf("Recoverable stream parse error: %v", psErr.Unwrap()),
				"warning": psErr.Error(),
			})
		} else {
			e.publishFailed(run, fmt.Errorf("structured output parse error: %w", parseErr))
			e.sendSubAgentResult(run.ID, "failed", map[string]any{"error": parseErr.Error()})
			return
		}
	}
	finished, ok := e.store.SetRunStatusIf(run.ID, "finished", "started")
	if ok {
		e.bus.Publish("run.finished", runScope(finished), RunResponse(finished))
		e.sendSubAgentResult(run.ID, "finished", RunResponse(finished))
		// Fire Hub TaskDone callback (Edge→Hub direct bridge)
		e.fireHubDone(run.ID, RunResponse(finished))
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
				if stream == "stdout" && text != "" {
					e.recordHubOutput(run.ID, text)
					e.fireHubStream(run.ID, text)
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
	slog.Debug("executor.run.failed", "runId", run.ID, "err", err)
	failed, ok := e.store.SetRunStatusIf(run.ID, "failed", "queued", "started")
	if ok {
		exitCode := ExitCodeFromErr(err)
		classified := ClassifyError(err, exitCode)
		if classified != nil {
			e.persistAgentFailureMessage(failed, classified.Message)
		}
		e.bus.Publish("run.failed", runScope(failed), map[string]any{
			"runId":  failed.ID,
			"status": failed.Status,
			"error":  classified,
		})
		// Fire Hub callback if configured
		e.fireHubFail(failed.ID, classified.Message)
	}
	e.checkPersistError(run.ID)
}

func errorWithRunOutput(err error, outStore *runnerctx.RunOutputStore) error {
	if err == nil || outStore == nil {
		return err
	}
	output, readErr := outStore.ReadAll()
	output = strings.TrimSpace(output)
	if readErr != nil || output == "" {
		return err
	}
	chunks := splitHubCallbackText(output, persistedFailureMessageMaxBytes)
	if len(chunks) == 0 {
		return err
	}
	message := chunks[0]
	if len(chunks) > 1 || len(output) > len(message) {
		message += "\n[output truncated]"
	}
	return fmt.Errorf("%w: %s", err, message)
}

func (e *ProcessExecutor) persistAgentFailureMessage(run store.Run, content string) {
	content = strings.TrimSpace(content)
	if content == "" {
		return
	}
	repository, ok := e.store.(interface {
		store.Reader
		store.Writer
	})
	if !ok {
		return
	}
	for _, item := range repository.ListThreadItems(run.ThreadID) {
		if item.RunID == run.ID && item.Type == "agent_message" {
			return
		}
	}
	item, err := repository.CreateItem(store.Item{
		ID:        transcriptItemID(run.ID),
		ProjectID: run.ProjectID,
		ThreadID:  run.ThreadID,
		RunID:     run.ID,
		Type:      "agent_message",
		Role:      "agent",
		Status:    "failed",
		Content:   content,
	})
	if err != nil {
		slog.Warn("process: failed to persist run failure message", "runId", run.ID, "err", err)
		return
	}
	scope := map[string]any{
		"projectId": item.ProjectID,
		"threadId":  item.ThreadID,
		"runId":     item.RunID,
		"itemId":    item.ID,
	}
	e.bus.Publish("message.created", scope, item)
	e.bus.Publish("item.created", scope, item)
}

func (e *ProcessExecutor) publishCancelled(run store.Run) {
	cancelled, ok := e.store.SetRunStatusIf(run.ID, "cancelled", "queued", "started", "cancelling")
	if ok {
		e.bus.Publish("run.cancelled", runScope(cancelled), RunResponse(cancelled))
		// Fire Hub callback if configured
		e.fireHubFail(cancelled.ID, "run cancelled")
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
	// Cascade: when a parent agent finishes, recursively terminate all
	// descendant sub-agents (Codex AgentTree shutdown pattern).
	if e.agentRegistry != nil {
		e.agentRegistry.ShutdownCascade(runID)
	}

	e.mu.Lock()
	delete(e.running, runID)
	delete(e.stdins, runID)
	delete(e.processes, runID)
	delete(e.runToAgent, runID)
	delete(e.hubTasks, runID)
	delete(e.hubOutputs, runID)
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
	switch status {
	case "failed", "cancelled":
		msgType = agents.MsgTypeError
		e.agentRegistry.SetStatus(agentID, agents.StatusError, "")
	case "finished":
		e.agentRegistry.SetStatus(agentID, agents.StatusCompleted, "")
	}

	e.messageQueue.EnsureAgent(inst.ParentID, 64)
	e.messageQueue.Send(agents.Message{
		ID:          "msg_" + runID,
		FromAgentID: agentID,
		ToAgentID:   inst.ParentID,
		Type:        msgType,
		TriggerTurn: true, // wake parent orchestrator on sub-agent completion
		Payload: map[string]any{
			"runId":     runID,
			"status":    status,
			"agentId":   agentID,
			"agentName": inst.Name,
			"result":    payload,
		},
		Timestamp: time.Now().UTC(),
	})

	// Store structured result in the aggregator's collector for eventual
	// synthesis when all children of the parent complete (or timeout).
	// Reference: AionUi Team Mode Mailbox — persisted sub-agent results.
	// Reference: LibreChat — structured subagent result return.
	if e.resultAgg != nil {
		e.resultAgg.StoreSubAgentResult(inst.ParentID, SubAgentResult{
			AgentID:     agentID,
			AgentName:   inst.Name,
			RunID:       runID,
			Status:      status,
			Output:      payload,
			CompletedAt: time.Now().UTC(),
		})
	}
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
	transcriptEmitter := newThreadTranscriptEmitter(e.store, run, emitter)
	if transcriptEmitter != nil {
		emitter = transcriptEmitter
	}

	// Wrap emitter with budget monitoring: emits run.agent.context_warning
	// when token usage exceeds the auto-compaction threshold (85%).
	if budget, ok := ctx.Value(adapters.CtxBudgetKey).(*runnerctx.ContextBudget); ok && budget != nil {
		emitter = adapters.NewBudgetAwareEmitter(emitter, budget, scope)
	}

	// Wrap emitter with decision-loop step tracking and max-steps enforcement.
	// When configured, tool_call events increment a step counter and force-finish
	// is triggered when maxSteps is exceeded.
	if e.decisionLoopFactory != nil {
		emitter = e.decisionLoopFactory.Wrap(stdin, emitter, run)
	}

	// Wrap emitter with security hooks (PreToolUse / PostToolUse).
	// This is the unified security layer: all three adapters (Claude Code,
	// Codex, OpenCode) are covered at the ProcessExecutor level, regardless
	// of whether they use NDJSONStreamParser or emit events directly.
	emitter = adapters.NewSecureEmitter(ctx, emitter, adapters.HookChain{adapters.NewSecurityHook()})

	if err := adapter.ParseStream(ctx, stdout, stdin, emitter, run); err != nil {
		slog.Error("structured output parse error", "runId", run.ID, "err", err)
		*parseErr = err
	}
	if transcriptEmitter != nil {
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
	// Enforce spawn slot and depth limits via the agent registry.
	if e.agentRegistry != nil {
		if err := e.agentRegistry.CanSpawn(parentRun.ID, task.Depth); err != nil {
			slog.Warn("spawn slot rejected",
				"parentRunId", parentRun.ID,
				"taskId", task.TaskID,
				"depth", task.Depth,
				"err", err,
			)
			return "", "", err
		}
	}

	runID = "run_" + task.TaskID
	agentInstanceID = "agent_" + task.TaskID

	// Resolve ThreadID: each sub-agent MUST have its own distinct thread so
	// that its context space is fully isolated from the parent. If the task
	// provides an explicit ThreadID we use it; otherwise we create a
	// hierarchical child thread ID derived from the parent ThreadID.
	// This prevents context contamination between parent and child.
	threadID := task.ThreadID
	if threadID == "" {
		threadID = parentRun.ThreadID + "/sub/" + runID
	}

	// Create the run in the store
	run, err := e.store.(store.Writer).CreateRun(runID, parentRun.ProjectID, threadID)
	if err != nil {
		slog.Error("failed to create sub-agent run", "taskId", task.TaskID, "err", err)
		return "", "", err
	}

	// Register the child agent instance in the agent registry with its own
	// context scope. This ensures budget tracking in publishStructuredOutput
	// monitors only the child's tokens, and parent/child results are
	// independently routed via the message queue.
	if e.agentRegistry != nil {
		inst := &agents.AgentInstance{
			ID:        agentInstanceID,
			Name:      task.AgentID,
			AdapterID: task.AgentID,
			Role:      "sub-agent",
			Status:    agents.StatusIdle,
			RunID:     runID,
			ThreadID:  threadID,
			ParentID:  parentRun.ID,
			Depth:     task.Depth,
			AgentPath: "/" + parentRun.ID + "/" + agentInstanceID,
			CreatedAt: time.Now(),
			LastSeen:  time.Now(),
		}
		if err := e.agentRegistry.Register(inst); err != nil {
			slog.Warn("failed to register sub-agent instance in registry",
				"agentInstanceId", agentInstanceID,
				"err", err,
			)
		}
	}

	// Emit run.queued
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}
	e.bus.Publish("run.queued", scope, run)

	// Build run context with the task prompt, target agent, and an isolated
	// context budget allocated from the parent via AllocateChild.
	// The child budget is independent — it does NOT reference the parent's
	// UsedTokens counter, so the child's token consumption never pollutes
	// the parent's budget tracking.
	runCtx := RunProcessContext{
		Run:       run,
		Prompt:    task.Prompt,
		AgentID:   task.AgentID,
		Budget:    childBudget(task.Budget, task.Depth),
		Model:     task.Model,
		SessionID: threadID, // always set to child's own thread
	}

	// Store the run-to-agent mapping so result aggregation can find the agent later.
	e.mu.Lock()
	e.runToAgent[runID] = agentInstanceID
	e.mu.Unlock()

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

// childBudget creates an isolated context budget for a sub-agent from the parent
// budget via ContextBudget.AllocateChild. Deeper delegation levels get a smaller
// fraction of remaining tokens to prevent budget exhaustion at the root. The child
// budget is fully independent — it does NOT reference the parent's UsedTokens
// counter, so the child's token consumption cannot pollute the parent's tracking.
func childBudget(parent *runnerctx.ContextBudget, depth int) *runnerctx.ContextBudget {
	if parent == nil {
		return runnerctx.NewContextBudget(0)
	}
	// Fraction reduces with depth: depth 1 gets 1/2, depth 2 gets 1/4, etc.
	// AllocateChild clamps to min 10K tokens and properly scales ReservedTokens.
	fraction := int64(1 << depth) // 2, 4, 8, ...
	ratio := 1.0 / float64(fraction)
	return parent.AllocateChild(ratio)
}

// ── Hub callback fire-and-forget helpers ─────────────────────────────────

// hubTaskID returns the Hub task ID for the given run, or empty string if not tracked.
func (e *ProcessExecutor) hubTaskID(runID string) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.hubTasks[runID]
}

// fireHubAck sends a TaskAck callback to Hub. Called when the run starts.
// Errors are logged but never block the run lifecycle.
func (e *ProcessExecutor) fireHubAck(runID string) {
	if e.hubCallback == nil {
		return
	}
	taskID := e.hubTaskID(runID)
	if taskID == "" {
		return
	}
	go func() {
		if err := e.hubCallback.TaskAck(context.Background(), taskID, runID); err != nil {
			slog.Warn("hub callback ack failed", "taskId", taskID, "runId", runID, "err", err)
		}
	}()
}

func (e *ProcessExecutor) recordHubOutput(runID, text string) {
	if text == "" {
		return
	}
	e.mu.Lock()
	collector := e.hubOutputs[runID]
	e.mu.Unlock()
	if collector == nil {
		return
	}
	collector.Append(text)
}

func (e *ProcessExecutor) recordHubFinalFallback(runID, text string) {
	if text == "" {
		return
	}
	e.mu.Lock()
	collector := e.hubOutputs[runID]
	e.mu.Unlock()
	if collector == nil {
		return
	}
	collector.SetFallback(text)
}

func (e *ProcessExecutor) hubFinalContent(runID string) string {
	e.mu.Lock()
	collector := e.hubOutputs[runID]
	e.mu.Unlock()
	if collector == nil {
		return ""
	}
	return collector.Final()
}

// fireHubStream sends a TaskStream callback to Hub for visible runtime output.
// Errors are logged but never block the run lifecycle.
func (e *ProcessExecutor) fireHubStream(runID string, content string) {
	if e.hubCallback == nil || content == "" {
		return
	}
	taskID := e.hubTaskID(runID)
	if taskID == "" {
		return
	}
	for _, chunk := range splitHubCallbackText(content, hubCallbackChunkMaxBytes) {
		chunk := chunk
		go func() {
			if err := e.hubCallback.TaskStream(context.Background(), taskID, runID, chunk); err != nil {
				slog.Warn("hub callback stream failed", "taskId", taskID, "runId", runID, "err", err)
			}
		}()
	}
}

// fireHubDone sends a TaskDone callback to Hub. Called when the run finishes successfully.
// Errors are logged but never block the run lifecycle.
func (e *ProcessExecutor) fireHubDone(runID string, runResp map[string]any) {
	if e.hubCallback == nil {
		return
	}
	taskID := e.hubTaskID(runID)
	if taskID == "" {
		return
	}
	content := e.hubFinalContent(runID)
	if content == "" {
		content = "Run finished"
	}
	go func() {
		result := hub.TaskResult{
			RunID:        runID,
			FinalContent: content,
		}
		if err := e.hubCallback.TaskDone(context.Background(), taskID, result); err != nil {
			slog.Warn("hub callback done failed", "taskId", taskID, "runId", runID, "err", err)
		}
	}()
}

type hubCallbackEmitter struct {
	executor *ProcessExecutor
	runID    string
	inner    adapters.EventEmitter
}

func newHubCallbackEmitter(executor *ProcessExecutor, runID string, inner adapters.EventEmitter) adapters.EventEmitter {
	if executor == nil || inner == nil {
		return inner
	}
	return &hubCallbackEmitter{executor: executor, runID: runID, inner: inner}
}

func (e *hubCallbackEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.inner.Emit(eventType, scope, payload)
	switch eventType {
	case adapters.BusEventTextDelta, adapters.BusEventTextBlock:
		if text := extractHubCallbackText(payload); text != "" {
			e.executor.recordHubOutput(e.runID, text)
			e.executor.fireHubStream(e.runID, text)
		}
	case adapters.BusEventResult:
		if text := extractHubCallbackText(payload); text != "" {
			e.executor.recordHubFinalFallback(e.runID, text)
		}
	}
}

type threadTranscriptEmitter struct {
	writer    store.Writer
	run       store.Run
	inner     adapters.EventEmitter
	collector *hubOutputCollector
	mu        sync.Mutex
	persisted bool
}

func newThreadTranscriptEmitter(repository store.RunLifecycleStore, run store.Run, inner adapters.EventEmitter) *threadTranscriptEmitter {
	writer, ok := repository.(store.Writer)
	if !ok || inner == nil {
		return nil
	}
	return &threadTranscriptEmitter{
		writer:    writer,
		run:       run,
		inner:     inner,
		collector: newHubOutputCollector(persistedAssistantMessageMaxBytes),
	}
}

func (e *threadTranscriptEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.inner.Emit(eventType, scope, payload)
	switch eventType {
	case adapters.BusEventTextDelta, adapters.BusEventTextBlock:
		if text := extractHubCallbackText(payload); text != "" {
			e.collector.Append(text)
		}
	case adapters.BusEventResult:
		if text := extractHubCallbackText(payload); text != "" {
			e.collector.SetFallback(text)
		}
	}
}

func (e *threadTranscriptEmitter) Flush() {
	e.mu.Lock()
	if e.persisted {
		e.mu.Unlock()
		return
	}
	e.persisted = true
	e.mu.Unlock()

	content := e.collector.Final()
	if strings.TrimSpace(content) == "" {
		return
	}
	item, err := e.writer.CreateItem(store.Item{
		ID:        transcriptItemID(e.run.ID),
		ProjectID: e.run.ProjectID,
		ThreadID:  e.run.ThreadID,
		RunID:     e.run.ID,
		Type:      "agent_message",
		Role:      "agent",
		Status:    "created",
		Content:   content,
	})
	if err != nil {
		slog.Warn("process: failed to persist assistant transcript", "runId", e.run.ID, "err", err)
		return
	}
	_ = item
}

func transcriptItemID(runID string) string {
	return fmt.Sprintf("item_%s_agent_%d", strings.TrimPrefix(runID, "run_"), time.Now().UnixNano())
}

type hubOutputCollector struct {
	mu        sync.Mutex
	builder   strings.Builder
	fallback  string
	maxBytes  int
	truncated bool
}

func newHubOutputCollector(maxBytes int) *hubOutputCollector {
	if maxBytes <= 0 {
		maxBytes = hubCallbackFinalMaxBytes
	}
	return &hubOutputCollector{maxBytes: maxBytes}
}

func (c *hubOutputCollector) Append(text string) {
	if text == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.builder.Len() >= c.maxBytes {
		c.truncated = true
		return
	}
	remaining := c.maxBytes - c.builder.Len()
	if len(text) > remaining {
		text = strings.ToValidUTF8(text[:remaining], "")
		c.truncated = true
	}
	c.builder.WriteString(text)
}

func (c *hubOutputCollector) SetFallback(text string) {
	if text == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.fallback == "" {
		c.fallback = strings.TrimSpace(text)
	}
}

func (c *hubOutputCollector) Final() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	content := strings.TrimSpace(c.builder.String())
	if content == "" {
		content = c.fallback
	}
	if content == "" {
		return ""
	}
	if c.truncated {
		return content + "\n[output truncated]"
	}
	return content
}

func extractHubCallbackText(payload any) string {
	payloadMap, ok := payload.(map[string]any)
	if !ok {
		return ""
	}
	for _, key := range []string{"content", "text", "delta", "output", "result"} {
		if value, ok := payloadMap[key].(string); ok && value != "" {
			return value
		}
	}
	if message, ok := payloadMap["message"].(map[string]any); ok {
		for _, key := range []string{"content", "text"} {
			if value, ok := message[key].(string); ok && value != "" {
				return value
			}
		}
	}
	return ""
}

func splitHubCallbackText(text string, maxBytes int) []string {
	if text == "" {
		return nil
	}
	if maxBytes <= 0 || len(text) <= maxBytes {
		return []string{text}
	}
	chunks := make([]string, 0, len(text)/maxBytes+1)
	for len(text) > 0 {
		if len(text) <= maxBytes {
			chunks = append(chunks, text)
			break
		}
		cut := maxBytes
		for cut > 0 && !utf8.ValidString(text[:cut]) {
			cut--
		}
		if cut == 0 {
			_, size := utf8.DecodeRuneInString(text)
			if size <= 0 {
				size = 1
			}
			cut = size
		}
		chunks = append(chunks, text[:cut])
		text = text[cut:]
	}
	return chunks
}

// fireHubFail sends a TaskFail callback to Hub. Called when the run fails or is cancelled.
// Errors are logged but never block the run lifecycle.
func (e *ProcessExecutor) fireHubFail(runID string, reason string) {
	if e.hubCallback == nil {
		return
	}
	taskID := e.hubTaskID(runID)
	if taskID == "" {
		return
	}
	go func() {
		if err := e.hubCallback.TaskFail(context.Background(), taskID, runID, reason); err != nil {
			slog.Warn("hub callback fail failed", "taskId", taskID, "runId", runID, "err", err)
		}
	}()
}
