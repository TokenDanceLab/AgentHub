package lifecycle

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

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

// Pre-compiled regex patterns for SanitizeSubAgentResult.
// These are compiled at package init time and are safe for concurrent use.
var (
	// reStackTrace matches lines containing stack trace markers:
	//   - "\tat " prefixed lines (Java/Python/Go traces)
	//   - "goroutine" prefixed lines (Go runtime traces)
	//   - "...path/file.go:line" file references in traces
	reStackTrace = regexp.MustCompile(`(?m)^\s*(?:\t+at\s.*|goroutine\s+\d+.*|\.\.\.[/\w.\-]+\.go:\d+(?:\s+.*)?)$`)

	// reFilePath matches absolute file paths that reveal project directory
	// structure, e.g. "D:/Code/TokenDance/..." or "/home/user/...".
	// The trailing character class includes backslash for Windows paths.
	// Directory set includes common project roots: Code, Users, home, tmp,
	// Projects, Work, Data, Documents, Desktop.
	reFilePath = regexp.MustCompile(`[A-Za-z]:[/\\](?:Code|Users|home|tmp|Projects|Work|Data|Documents|Desktop)[/\\\w.\-]*|/(?:home|Users|tmp)/[\w.\-/]*`)

	// reAPIKey matches common API key patterns:
	//   - "sk-" prefix (OpenAI, Anthropic, etc.)
	//   - "api-key-" prefix (various providers)
	//   - Google API keys (AIza...)
	//   - GitHub personal access tokens (ghp_..., github_pat_...)
	//   - GitLab tokens (glpat-...)
	//   - HuggingFace tokens (hf_...)
	//   - JWT tokens (eyJ... base64url with dots)
	//   - AWS access keys (AKIA...)
	//   - Bearer token headers
	reAPIKey = regexp.MustCompile(`(?:sk-[a-zA-Z0-9_\-\^=]{20,}|api-key-[a-zA-Z0-9_\-]{16,}|AIza[0-9A-Za-z\-_]{35}|ghp_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{22,}|glpat-[0-9A-Za-z\-_]{20,}|hf_[0-9A-Za-z]{34}|eyJ[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9_\-\\.=]{20,})`)
)

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
	faultEscalationCfg := FaultEscalationConfigFromEnv()
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
		evidenceGateCfg:           EvidenceGateConfigFromEnv(),
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
	hubCallbackTimeout                = 15 * time.Second
	persistedAssistantMessageMaxBytes = 200 * 1024
	persistedFailureMessageMaxBytes   = 8 * 1024

	// sessionRetryWindow is the maximum wall-clock duration (from cmd.Start to
	// cmd.Wait) within which a "session already in use" or "no conversation
	// found" error triggers an automatic retry with a fresh session ID.
	sessionRetryWindow = 10 * time.Second
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
			slog.Debug("process: interrupt write failed", "runId", runID, "error", err)
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
			if _, err := proc.Wait(); err != nil {
				slog.Warn("process wait error after kill", "run_id", runID, "error", err)
			}
		}()
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
	if e.adapterReg != nil && (runCtx.AgentID != "" || adapter != nil) {
		resolved, err := e.adapterReg.Resolve(runCtx.AgentID)
		if err != nil {
			e.publishFailed(run, err)
			return
		}
		adapter = resolved
	}

	// Preflight check: if the adapter implements PreflightAdapter, verify
	// it is properly configured (e.g. API keys, credentials) before launching
	// the subprocess. This prevents hangs from CLIs that block on auth prompts.
	if preflight, ok := adapter.(adapters.PreflightAdapter); ok && preflight != nil {
		if err := preflight.PreflightCheck(); err != nil {
			slog.Warn("process: adapter preflight check failed",
				"runId", run.ID,
				"agentId", runCtx.AgentID,
				"error", err,
			)
			e.publishFailed(run, fmt.Errorf("adapter preflight failed: %w", err))
			return
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

	// Session retry loop: when CC exits quickly with a session conflict error
	// ("Session ID ... is already in use" or "No conversation found with session ID"),
	// generate a fresh random session ID and retry once. This handles the case where
	// a stale CC process from a previous Edge instance still holds the session lock.
	const maxSessionRetries = 2
	var lastWaitErr error
	for attempt := 0; attempt < maxSessionRetries; attempt++ {
		var cmdPath string
		var args, env []string
		var workDir string
		adapterCtx := adapters.RunProcessContext(runCtx)

		if adapter != nil {
			// Adapter mode: BuildCommand provides full command configuration
			cmdPath, args, env, workDir = adapter.BuildCommand(adapterCtx)
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
		if adapter != nil {
			plan := adapters.BuildCLIInvocationPlanFromCommand(adapter, adapterCtx, cmdPath, args, env, workDir)
			e.bus.Publish(adapters.BusEventCLIInvocationPlan, runScope(run), plan.Payload())
		}

		// Take workdir snapshot for auto-surface detection (post-finish).
		// Captures pre-run file state so we can detect new/modified files.
		if workDir != "" {
			snapshot := adapters.TakeWorkdirSnapshot(workDir)
			e.mu.Lock()
			e.workDirs[run.ID] = workDir
			e.surfacers[run.ID] = snapshot
			e.mu.Unlock()
		}

		_, extraEnv, err := e.profile.ExtraEnvTemplate.Expand(runCtx)
		if err != nil {
			e.publishFailed(run, err)
			return
		}
		cmd := exec.CommandContext(ctx, cmdPath, args...)
		cmd.Dir = workDir
		if adapter != nil {
			// Adapter mode: the adapter returns only auth env vars (e.g.
			// ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL) that must be overlaid on
			// top of the sanitized parent environment. Passing them as
			// profileEnv would replace the entire child env with just those
			// vars, stripping PATH, SYSTEMROOT and other OS essentials — which
			// causes the CLI to fail immediately. Instead, merge adapter env
			// into extraEnv so SanitizedEnv provides the full OS base plus the
			// adapter's auth passthrough.
			cmd.Env = e.envForRun(run, nil, append(extraEnv, env...))
		} else {
			cmd.Env = e.envForRun(run, env, extraEnv)
		}
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
			if ctx.Err() != nil {
				if cmd.Process != nil {
					_, _ = cmd.Process.Wait()
				}
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
			slog.Warn("process: failed to create run output store", "runId", run.ID, "error", err)
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
		// Also inject RunProcessContext unconditionally — SDK adapters
		// (anthropic-sdk, openai-sdk) need prompt, model, and messages
		// regardless of whether a WorkDir is set.
		parserCtx := ctx
		if runCtx.Budget != nil {
			parserCtx = context.WithValue(parserCtx, adapters.CtxBudgetKey, runCtx.Budget)
		}
		if runCtx.WorkDir != "" {
			parserCtx = context.WithValue(parserCtx, adapters.CtxWorkDir, runCtx.WorkDir)
		}
		parserCtx = adapters.SDKAdapterContext(parserCtx, adapters.RunProcessContext(runCtx))

		var parseErr error
		if adapter != nil {
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
		slog.Debug("executor.subprocess.exited", "runId", run.ID, "exitCode", ExitCodeFromErr(lastWaitErr), "attempt", attempt)

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

		// Session conflict retry: if CC failed quickly with a session conflict
		// error and this is the first attempt, reset the session ID and retry.
		// On Windows, exec.ExitError.Error() does not include stderr content
		// (stderr is read via StderrPipe in a separate goroutine and stored in
		// outStore), so we also pass the captured stderr output.
		var stderrCapture string
		if outStore != nil {
			stderrCapture, _ = outStore.ReadAll()
		}
		if lastWaitErr != nil && attempt == 0 && isSessionConflictError(lastWaitErr, stderrCapture) && time.Since(subprocessStart) < sessionRetryWindow {
			newSession := newRandomSessionID()
			slog.Warn("process: session conflict detected, retrying with fresh session ID",
				"runId", run.ID,
				"oldSessionId", runCtx.SessionID,
				"newSessionId", newSession,
				"error", lastWaitErr,
			)
			runCtx.SessionID = newSession
			runCtx.ContinueLast = false
			// Clean up the tracked process from this attempt before retrying.
			e.mu.Lock()
			delete(e.processes, run.ID)
			if s, ok := e.runOutputs[run.ID]; ok {
				_ = s.Close()
				delete(e.runOutputs, run.ID)
			}
			e.mu.Unlock()
			// Reset run status back to queued so the retry can transition to started.
			if _, ok := e.store.SetRunStatusIf(run.ID, "queued", "started", "failed"); ok {
				slog.Debug("process: reset run status to queued for session retry", "runId", run.ID)
			}
			continue
		}

		// Not retrying — process the final result.
		if lastWaitErr != nil {
			e.publishFailed(run, errorWithRunOutput(lastWaitErr, outStore))
			e.sendSubAgentResult(run.ID, "failed", map[string]any{"error": lastWaitErr.Error()})
			return
		}
		// #179: handle structured output parse errors with recoverability distinction.
		// Non-recoverable errors (pipe broken, context cancelled) fail the run.
		// Recoverable errors (malformed event, orphaned tool) emit a warning and
		// allow the run to finish naturally — matching Kanna/OpenCode recovery patterns.
		if parseErr != nil {
			var psErr *adapters.ParseStreamError
			if errors.As(parseErr, &psErr) && psErr.Recoverable() {
				slog.Warn("process: recoverable stream parse error, continuing run", "runId", run.ID, "error", parseErr)
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
		// Evidence gate: run post-completion verification before marking finished.
		// When enabled (default), the gate runs type-specific checks (Go build+vet,
		// TypeScript typecheck+test, generic file existence) against the workDir.
		// If verification fails, the run is marked as completed_with_issues instead
		// of finished, and the full evidence output is stored in run metadata.
		finalStatus := "finished"
		if isEvidenceGateEnabledForRun(e.evidenceGateCfg, workDir) {
			evidenceResult := runEvidenceGate(workDir)
			e.store.SetRunEvidenceGate(run.ID, evidenceGateResultJSON(evidenceResult))
			if !evidenceResult.Passed {
				finalStatus = "completed_with_issues"
				slog.Warn("process: evidence gate verification failed",
					"runId", run.ID,
					"projectType", evidenceResult.ProjectType,
					"summary", evidenceResult.Summary,
				)
			}
		}

		finished, ok := e.store.SetRunStatusIf(run.ID, finalStatus, "started")
		if ok {
			e.bus.Publish("run.finished", runScope(finished), RunResponse(finished))
			e.sendSubAgentResult(run.ID, finalStatus, RunResponse(finished))
			// Fire Hub TaskDone callback (Edge→Hub direct bridge)
			e.fireHubDone(run.ID, RunResponse(finished))
		}
		e.checkPersistError(run.ID)
		return
	}

	// Exhausted retries — attempt fault escalation if configured.
	if lastWaitErr != nil && e.faultEscalationCfg.Enabled && e.faultEscalationCfg.MaxRetries > 0 {
		r, ok := e.store.GetRun(run.ID)
		if ok && r.RetryCount < e.faultEscalationCfg.MaxRetries {
			newCount := r.RetryCount + 1
			e.store.SetRunRetryCount(run.ID, newCount)
			run.RetryCount = newCount
			if _, ok2 := e.store.SetRunStatusIf(run.ID, "queued", "failed"); ok2 {
				run.Status = "queued"
			}
			// Clean up process tracking.
			e.mu.Lock()
			delete(e.processes, run.ID)
			if s, ok3 := e.runOutputs[run.ID]; ok3 {
				_ = s.Close()
				delete(e.runOutputs, run.ID)
			}
			e.mu.Unlock()
			e.bus.Publish("run.fault_escalation.retry", runScope(run), map[string]any{
				"runId":      run.ID,
				"retryCount": newCount,
				"maxRetries": e.faultEscalationCfg.MaxRetries,
			})
			slog.Warn("process: fault escalation auto-retry",
				"runId", run.ID,
				"retryCount", newCount,
				"maxRetries", e.faultEscalationCfg.MaxRetries,
			)
			// Create fresh context and retry from Start().
			newCtx, cancel := context.WithTimeout(context.Background(), e.runTimeout)
			e.mu.Lock()
			if oldCancel, ok4 := e.running[run.ID]; ok4 {
				oldCancel()
			}
			e.running[run.ID] = cancel
			e.mu.Unlock()
			go e.run(newCtx, run, runCtx)
			return
		}
		// Max retries reached — emit escalation exhausted event.
		e.bus.Publish("run.fault_escalation.exhausted", runScope(run), map[string]any{
			"runId":      run.ID,
			"maxRetries": e.faultEscalationCfg.MaxRetries,
		})
		slog.Warn("process: fault escalation exhausted", "runId", run.ID)
	}
	// Report the last error.
	if lastWaitErr != nil {
		e.publishFailed(run, errorWithRunOutput(lastWaitErr, nil))
		e.sendSubAgentResult(run.ID, "failed", map[string]any{"error": lastWaitErr.Error()})
	}
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
				// Log stderr to structured logger so CC failure diagnostics
				// are visible in Edge server logs without subscribing to bus events.
				if stream == "stderr" && text != "" {
					for _, line := range strings.Split(text, "\n") {
						line = strings.TrimRight(line, "\r")
						if line != "" {
							sanitizedLine, _ := recursiveSanitizeString(line)
							slog.Error("cc stderr", "runId", run.ID, "line", sanitizedLine)
						}
					}
				}
				if outStore != nil && len(allowed) > 0 {
					if _, err := outStore.Write(text); err != nil {
						slog.Warn("process: failed to write output store", "runId", run.ID, "error", err)
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

type processArgLogSummary struct {
	ArgFlags               []string
	ConfigKeys             []string
	PositionalArgCount     int
	UnknownFlagCount       int
	RedactedConfigKeyCount int
}

func summarizeProcessArgsForLog(args []string) processArgLogSummary {
	var summary processArgLogSummary
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "" {
			continue
		}
		if arg == "--" {
			summary.PositionalArgCount += len(args) - i - 1
			break
		}
		if !strings.HasPrefix(arg, "-") || arg == "-" {
			summary.PositionalArgCount++
			continue
		}

		flag, value, hasInlineValue := strings.Cut(arg, "=")
		if !isSafeProcessArgFlag(flag) {
			summary.UnknownFlagCount++
			continue
		}
		summary.ArgFlags = appendUniqueString(summary.ArgFlags, flag)
		if flag == "-c" {
			if hasInlineValue {
				summary.ConfigKeys, summary.RedactedConfigKeyCount = appendConfigKeyName(summary.ConfigKeys, summary.RedactedConfigKeyCount, value)
			} else if i+1 < len(args) {
				summary.ConfigKeys, summary.RedactedConfigKeyCount = appendConfigKeyName(summary.ConfigKeys, summary.RedactedConfigKeyCount, args[i+1])
				i++
			}
			continue
		}
		if shouldConsumeNextProcessArgValue(flag, args, i) {
			i++
		}
	}
	return summary
}

func appendConfigKeyName(configKeys []string, redactedCount int, value string) ([]string, int) {
	key, _, _ := strings.Cut(value, "=")
	if key == "" || key == value || !isSafeProcessConfigKey(key) {
		return configKeys, redactedCount + 1
	}
	return appendUniqueString(configKeys, key), redactedCount
}

func processCommandNameForLog(cmdPath string) string {
	name := filepath.Base(cmdPath)
	if name == "." || name == string(filepath.Separator) {
		return ""
	}
	return name
}

func isSafeProcessArgFlag(flag string) bool {
	switch flag {
	case "-c",
		"-i",
		"-m",
		"-p",
		"-test.run",
		"--add-dir",
		"--agent",
		"--agents",
		"--allowedTools",
		"--append-system-prompt",
		"--cd",
		"--command",
		"--continue",
		"--dangerously-skip-permissions",
		"--dir",
		"--effort",
		"--ephemeral",
		"--fast",
		"--file",
		"--fork",
		"--fork-session",
		"--format",
		"--image",
		"--include-partial-messages",
		"--json",
		"--json-schema",
		"--max-budget-usd",
		"--max-turns",
		"--mcp-config",
		"--model",
		"--output-format",
		"--permission-mode",
		"--resume",
		"--sandbox",
		"--session",
		"--session-id",
		"--skip-git-repo-check",
		"--system-prompt",
		"--thinking",
		"--title",
		"--variant",
		"--verbose":
		return true
	default:
		return false
	}
}

func isSafeProcessConfigKey(key string) bool {
	for i, r := range key {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
			if i == 0 {
				return false
			}
		case r == '_' || r == '-' || r == '.':
			if i == 0 {
				return false
			}
		default:
			return false
		}
	}
	return key != ""
}

func processArgFlagTakesValue(flag string) bool {
	switch flag {
	case "-p",
		"-m",
		"-i",
		"--add-dir",
		"--agent",
		"--agents",
		"--allowedTools",
		"--append-system-prompt",
		"--cd",
		"--command",
		"--dir",
		"--effort",
		"--file",
		"--format",
		"--image",
		"--json-schema",
		"--max-budget-usd",
		"--mcp-config",
		"--model",
		"--output-format",
		"--permission-mode",
		"--resume",
		"--sandbox",
		"--session",
		"--session-id",
		"--thinking",
		"--system-prompt",
		"--title",
		"--variant":
		return true
	default:
		return false
	}
}

func shouldConsumeNextProcessArgValue(flag string, args []string, index int) bool {
	if !processArgFlagTakesValue(flag) || index+1 >= len(args) {
		return false
	}
	next := args[index+1]
	if next == "" || next == "--" || !strings.HasPrefix(next, "-") || next == "-" {
		return true
	}
	nextFlag, _, _ := strings.Cut(next, "=")
	return !isSafeProcessArgFlag(nextFlag)
}

func appendUniqueString(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

// envForRun builds the environment for a child process.
// When profileEnv is nil the child receives a minimal sanitized environment
// (only whitelisted parent vars + extraEnv + AGENTHUB_* runtime vars).
// A non-nil profileEnv is used verbatim as the base (administrator-configured).
func (e *ProcessExecutor) envForRun(run store.Run, profileEnv, extraEnv []string) []string {
	var env []string
	if profileEnv == nil {
		var audit EnvFilterAudit
		env, audit = SanitizedEnv(nil, extraEnv)
		// Log run-scoped audit context when vars were filtered.
		if audit.SensitiveVars > 0 || audit.NotWhitelisted > 0 {
			slog.Info("env sanitized for run",
				"runId", run.ID,
				"total", audit.TotalVars,
				"passed", audit.PassedVars,
				"sensitive", audit.SensitiveVars,
				"not_whitelisted", audit.NotWhitelisted,
			)
		}
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
	slog.Debug("executor.run.failed", "runId", run.ID, "error", err)
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
		slog.Warn("process: failed to persist run failure message", "runId", run.ID, "error", err)
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
		slog.Error("file store persist failed during run status transition", "runId", runID, "error", persistErr)
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
	if done, ok := e.cancelDone[runID]; ok {
		close(done)
		delete(e.cancelDone, runID)
	}
	if s, ok := e.runOutputs[runID]; ok {
		if err := s.Close(); err != nil {
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

	if snapshot == nil {
		return // no workdir tracked for this run
	}

	// Only surface for successfully finished runs.
	current, ok := e.store.GetRun(runID)
	if !ok || current.Status != "finished" {
		return
	}

	// Resolve a store.Writer for direct persistence.
	writer, ok := e.store.(store.Writer)
	if !ok {
		slog.Debug("surfacing: store does not implement Writer, skipping", "runId", runID)
		return
	}

	adapters.SurfaceAndEmit(e.bus, writer, snapshot, current)
}

// ── Sub-Agent Result Sanitization Layer ─────────────────────────────────
//
// ARCHITECTURE NOTE (2026-06): This sanitization layer was added as a safety
// gate between sub-agent completion and the message queue / result aggregator.
// Before this layer, raw sub-agent output (including stack traces, absolute
// file paths, and API keys) could enter the message queue unredacted.
//
// The layer operates at exactly one chokepoint — sendSubAgentResult — and
// applies three transformations:
//   1. Regex-based redaction of stack traces, file paths, and API keys
//      (via pre-compiled regex patterns: reStackTrace, reFilePath, reAPIKey).
//   2. Recursive structured-data scanning (maps and slices are walked depth-first
//      so attackers cannot evade sanitization by nesting sensitive data).
//   3. UTF-8-safe truncation at 32KB to bound message queue payload sizes.
//
// The same sanitized payload is written to both the message queue (for parent
// orchestrator consumption) and the result aggregator (for persisted synthesis),
// ensuring no bypass path exists. The _sanitized / _sanitized_reason metadata
// fields on the message payload allow the parent orchestrator to detect when
// output has been modified.

// maxSanitizedResultBytes is the maximum size of a sub-agent result string
// before truncation is applied. Strings longer than this are truncated to
// keep message queue payloads bounded and prevent memory bloat from runaway
// agent outputs.
const maxSanitizedResultBytes = 32 * 1024 // 32KB

// recursiveSanitizeString applies all regex-based sanitization to a string
// and returns the sanitized result plus a comma-separated list of what was
// modified (empty means no changes). This is the core sanitization logic
// shared by both string and structured payload paths.
func recursiveSanitizeString(s string) (string, string) {
	if len(s) == 0 {
		return s, ""
	}
	var reasons []string

	if reStackTrace.MatchString(s) {
		s = reStackTrace.ReplaceAllString(s, "[redacted:stack-trace]")
		reasons = append(reasons, "stack-trace-redacted")
	}

	if reFilePath.MatchString(s) {
		s = reFilePath.ReplaceAllString(s, "[redacted:file-path]")
		reasons = append(reasons, "file-paths-redacted")
	}

	if reAPIKey.MatchString(s) {
		s = reAPIKey.ReplaceAllString(s, "[redacted:api-key]")
		reasons = append(reasons, "api-keys-redacted")
	}

	return s, strings.Join(reasons, ",")
}

// SanitizeSubAgentResult sanitizes a sub-agent result payload before it enters
// the message queue. It applies the following transformations:
//
//  1. For string payloads: redacts stack traces, file paths, API keys, and
//     truncates oversized output at a UTF-8-safe boundary.
//  2. For structured payloads (map[string]any, []any): recursively walks the
//     structure and sanitizes all string values using the same regex pipeline.
//     This prevents attackers from evading sanitization by wrapping sensitive
//     data in a map or slice.
//  3. For all payloads: truncates the result if it exceeds maxSanitizedResultBytes
//     when serializable as a string, keeping the head and appending a truncation
//     marker.
//
// The function is designed to be safe (never panics) and fast (<1ms for
// typical payloads). It returns the sanitized payload and a reason string
// describing what was modified (empty string means no changes were made).
// Design note: absolute file paths are redacted for security, which may reduce synthesis fidelity.
// Structured file change data is available via BusEventFileChange on a separate event bus channel.
// Relative paths and _sanitized metadata flags provide escape hatches for downstream consumers.
func SanitizeSubAgentResult(payload any) (any, string) {
	if payload == nil {
		return nil, ""
	}

	switch v := payload.(type) {
	case string:
		s, reason := recursiveSanitizeString(v)
		// Truncate if the result exceeds the maximum allowed size.
		s, truncReason := truncateUTF8Safe(s)
		if truncReason != "" {
			if reason != "" {
				reason = reason + "," + truncReason
			} else {
				reason = truncReason
			}
		}
		return s, reason

	case map[string]any:
		// Recursively sanitize all string values and keys in the map.
		sanitized := make(map[string]any, len(v))
		combinedReason := ""
		for k, val := range v {
			sanVal, r := SanitizeSubAgentResult(val)
			sanitizedKey, keyReason := recursiveSanitizeString(k)
			sanitized[sanitizedKey] = sanVal
			if keyReason != "" {
				if combinedReason != "" {
					combinedReason = combinedReason + "," + keyReason
				} else {
					combinedReason = keyReason
				}
			}
			if r != "" {
				if combinedReason != "" {
					combinedReason = combinedReason + "," + r
				} else {
					combinedReason = r
				}
			}
		}
		return sanitized, combinedReason

	case []any:
		// Recursively sanitize all string values in the slice.
		sanitized := make([]any, len(v))
		combinedReason := ""
		for i, val := range v {
			sanVal, r := SanitizeSubAgentResult(val)
			sanitized[i] = sanVal
			if r != "" {
				if combinedReason != "" {
					combinedReason = combinedReason + "," + r
				} else {
					combinedReason = r
				}
			}
		}
		return sanitized, combinedReason

	case json.RawMessage:
		var m map[string]any
		if err := json.Unmarshal(v, &m); err == nil {
			return SanitizeSubAgentResult(m)
		}
		return v, ""

	case []byte:
		s, reason := recursiveSanitizeString(string(v))
		s, truncReason := truncateUTF8Safe(s)
		if truncReason != "" {
			if reason != "" {
				reason = reason + "," + truncReason
			} else {
				reason = truncReason
			}
		}
		return s, reason

	default:
		// Non-string, non-map, non-slice payloads (e.g. numbers, bools)
		// are passed through unchanged.
		return payload, ""
	}
}

// truncateUTF8Safe truncates s to maxSanitizedResultBytes at a UTF-8
// character boundary to avoid slicing multi-byte code points. Returns the
// (possibly truncated) string and a reason string (empty if no truncation).
func truncateUTF8Safe(s string) (string, string) {
	if len(s) <= maxSanitizedResultBytes {
		return s, ""
	}

	headSize := maxSanitizedResultBytes - 2*1024 // reserve 2KB for tail
	if headSize < 1024 {
		headSize = 1024 // safety floor
	}

	// Walk backward from headSize to the start of a UTF-8 character.
	// This prevents slicing in the middle of a multi-byte code point (e.g.
	// CJK characters at 3 bytes each).
	for headSize > 0 && headSize < len(s) {
		if utf8.RuneStart(s[headSize]) {
			break
		}
		headSize--
	}

	tailSize := len(s) - headSize
	if tailSize > 2048 {
		tailSize = 2048
	}
	// Also align tail start to UTF-8 boundary.
	tailStart := len(s) - tailSize
	for tailStart > 0 && tailStart < len(s) {
		if utf8.RuneStart(s[tailStart]) {
			break
		}
		tailStart++
	}
	tailSize = len(s) - tailStart

	truncated := s[:headSize] + "\n... [truncated " + strconv.Itoa(len(s)-maxSanitizedResultBytes) + " bytes] ...\n" + s[tailStart:]
	return truncated, "truncated-32kb"
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
	case "finished", "completed_with_issues":
		// completed_with_issues is a terminal status set by the evidence gate
		// when verification fails. It is still a result, so msgType stays
		// MsgTypeResult, but the agent registry must be updated to StatusCompleted
		// so the parent orchestrator does not wait indefinitely for a child it
		// thinks is still running.
		e.agentRegistry.SetStatus(agentID, agents.StatusCompleted, "")
	}

	// Sanitize the sub-agent result before it enters the message queue.
	// This redacts stack traces, file paths, and API keys, and truncates
	// oversized outputs to keep queue payloads bounded.
	sanitizedResult, sanitizeReason := SanitizeSubAgentResult(payload)

	e.messageQueue.EnsureAgent(inst.ParentID, 64)
	e.messageQueue.Send(agents.Message{
		ID:          "msg_" + runID,
		FromAgentID: agentID,
		ToAgentID:   inst.ParentID,
		Type:        msgType,
		TriggerTurn: true, // wake parent orchestrator on sub-agent completion
		Payload: map[string]any{
			"runId":             runID,
			"status":            status,
			"agentId":           agentID,
			"agentName":         inst.Name,
			"result":            sanitizedResult,
			"_sanitized":        sanitizeReason != "",
			"_sanitized_reason": sanitizeReason,
		},
		Timestamp: time.Now().UTC(),
	})

	// Store structured result in the aggregator's collector for eventual
	// synthesis when all children of the parent complete (or timeout).
	// Reference: AionUi Team Mode Mailbox — persisted sub-agent results.
	// Reference: LibreChat — structured subagent result return.
	//
	// Apply sanitization to the raw payload before storing in the result
	// aggregator. This ensures that even if the message queue copy is
	// tampered with, the raw persisted output does not leak API keys,
	// file paths, or stack traces.
	if e.resultAgg != nil {
		sanitizedOutput := payload
		if sanitizeReason != "" {
			sanitizedOutput = sanitizedResult
		}
		e.resultAgg.StoreSubAgentResult(inst.ParentID, SubAgentResult{
			AgentID:     agentID,
			AgentName:   inst.Name,
			RunID:       runID,
			Status:      status,
			Output:      sanitizedOutput,
			CompletedAt: time.Now().UTC(),
		})
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
	if evidenceEmitter := newRuntimeEvidenceEmitter(e.store, run, emitter); evidenceEmitter != nil {
		emitter = evidenceEmitter
	}
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

	// Build the security hook chain. The tool allowlist hook runs first (before
	// the security hook) so that allowlist-rejected tools are blocked before any
	// dangerous-pattern analysis. When AllowedTools is empty, the allowlist hook
	// is a no-op and is not added to the chain.
	//
	// This is the unified security layer: all three adapters (Claude Code,
	// Codex, OpenCode) are covered at the ProcessExecutor level, regardless
	// of whether they use NDJSONStreamParser or emit events directly.
	hooks := adapters.HookChain{adapters.NewSecurityHook()}
	if rc, ok := adapters.RunProcessContextFromContext(ctx); ok && len(rc.AllowedTools) > 0 {
		allowlistHook := adapters.NewToolAllowlistHook(rc.AllowedTools, emitter, scope)
		// Prepend: allowlist check runs before security classification
		hooks = adapters.HookChain{allowlistHook, adapters.NewSecurityHook()}
	}
	emitter = adapters.NewSecureEmitter(ctx, emitter, hooks)

	if err := adapter.ParseStream(ctx, stdout, stdin, emitter, run); err != nil {
		slog.Error("structured output parse error", "runId", run.ID, "error", err)
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
	// Atomically check and reserve a spawn slot under the same write lock.
	// This prevents the TOCTOU race where two concurrent goroutines both pass
	// CanSpawn (seeing count=4) and both subsequently increment, exceeding
	// MaxChildrenPerAgent=5.
	slotReserved := false
	if e.agentRegistry != nil {
		if err := e.agentRegistry.TryReserveSlot(parentRun.ID, task.Depth); err != nil {
			slog.Warn("spawn slot rejected",
				"parentRunId", parentRun.ID,
				"taskId", task.TaskID,
				"depth", task.Depth,
				"error", err,
			)
			return "", "", err
		}
		slotReserved = true
	}

	// Deferred cleanup: release the reserved slot on any error exit path.
	// On success, the slot is released by sendSubAgentResult when the child
	// run completes (keeps increment/decrement pair lexically close).
	defer func() {
		if err != nil && slotReserved {
			e.agentRegistry.DecrChildCount(parentRun.ID)
		}
	}()

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
	run, createErr := e.store.(store.Writer).CreateRun(runID, parentRun.ProjectID, threadID)
	if createErr != nil {
		slog.Error("failed to create sub-agent run", "taskId", task.TaskID, "error", createErr)
		err = createErr
		return "", "", err
	}

	// Register the child agent instance in the agent registry with its own
	// context scope. This ensures budget tracking in publishStructuredOutput
	// monitors only the child's tokens, and parent/child results are
	// independently routed via the message queue.
	registered := false
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
		if regErr := e.agentRegistry.Register(inst); regErr != nil {
			slog.Warn("failed to register sub-agent instance in registry",
				"agentInstanceId", agentInstanceID,
				"error", regErr,
			)
		} else {
			registered = true
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

	// Inject AgentHub memory into the sub-agent run so it has persistent context.
	// Mirror the same logic as the PostRuns handler in api/handlers.go.
	// The parent's workDir is looked up from the executor's tracking map.
	e.mu.Lock()
	parentWorkDir := e.workDirs[parentRun.ID]
	e.mu.Unlock()
	if parentWorkDir != "" {
		runCtx.WorkDir = parentWorkDir
		if memPrompt := runnerctx.BuildMemoryPrompt(parentWorkDir, threadID, task.AgentID); memPrompt != "" {
			runCtx.SkillsPrompt = memPrompt
		}
	}

	// Inject sibling context so the sub-agent knows about other agents working
	// in parallel. This prevents file conflicts when multiple sub-agents modify
	// the same workspace concurrently.
	if len(task.SiblingAgents) > 0 {
		siblingPrompt := adapters.BuildSiblingContextPrompt(task.SiblingAgents)
		if siblingPrompt != "" {
			if runCtx.AppendSystemPrompt != "" {
				runCtx.AppendSystemPrompt = siblingPrompt + "\n\n" + runCtx.AppendSystemPrompt
			} else {
				runCtx.AppendSystemPrompt = siblingPrompt
			}
		}
	}

	// Store the run-to-agent mapping so result aggregation can find the agent later.
	e.mu.Lock()
	e.runToAgent[runID] = agentInstanceID
	e.mu.Unlock()

	// Start the run
	if startErr := e.Start(run, runCtx); startErr != nil {
		slog.Error("failed to start sub-agent run", "runId", runID, "error", startErr)
		e.mu.Lock()
		delete(e.runToAgent, runID)
		e.mu.Unlock()

		// Cleanup on start failure: unregister the agent instance,
		// mark the run as failed, and release the reserved slot.
		// Set slotReserved=false BEFORE Unregister to prevent the
		// deferred DecrChildCount from double-decrementing.
		// Unregister already decrements childrenCount internally.
		if registered {
			slotReserved = false
			e.agentRegistry.Unregister(agentInstanceID)
		}
		_, _ = e.store.SetRunStatus(runID, "failed")

		err = startErr
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

// isSessionConflictError returns true when the error message or the process
// stderr indicates a Claude Code session conflict — either "Session ID ... is
// already in use" or "No conversation found with session ID". In both cases,
// retrying with a fresh random session ID (and ContinueLast=false) is the
// correct recovery.
//
// On Windows, exec.ExitError.Error() returns only "exit status N" without
// stderr content (stderr is read via StderrPipe in a separate goroutine).
// The caller should pass the captured stderr output as the second argument
// so the check can inspect it.
func isSessionConflictError(err error, stderrOutput string) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	if strings.Contains(msg, "is already in use") ||
		strings.Contains(msg, "No conversation found with session ID") {
		return true
	}
	// On Windows, stderr is not included in the ExitError message.
	// Check the captured stderr output from the pipe goroutine.
	if stderrOutput != "" {
		if strings.Contains(stderrOutput, "is already in use") ||
			strings.Contains(stderrOutput, "No conversation found with session ID") {
			return true
		}
	}
	// Also check ExitError.Stderr (populated when StderrPipe is NOT used).
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && len(exitErr.Stderr) > 0 {
		stderrStr := string(exitErr.Stderr)
		if strings.Contains(stderrStr, "is already in use") ||
			strings.Contains(stderrStr, "No conversation found with session ID") {
			return true
		}
	}
	return false
}

// newRandomSessionID generates a random UUID v4 string for retrying CC
// sessions when the deterministic session ID conflicts with a stale process.
func newRandomSessionID() string {
	var uuid [16]byte
	_, _ = rand.Read(uuid[:])
	uuid[6] = (uuid[6] & 0x0f) | 0x40 // version 4
	uuid[8] = (uuid[8] & 0x3f) | 0x80 // variant 2
	return fmt.Sprintf("%x-%x-%x-%x-%x",
		uuid[0:4], uuid[4:6], uuid[6:8], uuid[8:10], uuid[10:16])
}

// ── Hub callback fire-and-forget helpers ─────────────────────────────────

// hubTaskID returns the Hub task ID for the given run, or empty string if not tracked.
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
		slog.Warn("process: failed to persist assistant transcript", "runId", e.run.ID, "error", err)
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
