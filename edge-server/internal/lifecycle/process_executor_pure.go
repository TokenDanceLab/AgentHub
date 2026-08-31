package lifecycle

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/metrics"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// process_executor_pure.go holds ProcessExecutorConfig, constructor pure
// helpers, and fluent wiring methods. Residual pure-helper peel #1121
// moved domain pure helpers into process_executor_pure_*.go companions.
// Zero behavior change — pure move only.

var ErrProcessBusRequired = errors.New("process event bus is required")

var ErrProcessCommandRequired = errors.New("process command is required")

var ErrProcessStoreRequired = errors.New("process store is required")

var ErrTooManyConcurrentRuns = errors.New("too many concurrent runs")

// ProcessExecutorConfig holds the configuration for a ProcessExecutor.
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

// newProcessExecutor is the implementation of NewProcessExecutor moved into the
// pure file. The exported thin wrapper stays in process_executor.go.
func newProcessExecutor(bus *events.Bus, runStore store.RunLifecycleStore, cfg ProcessExecutorConfig, adapter adapters.AgentAdapter, adapterReg *adapters.Registry) (*ProcessExecutor, error) {
	if err := requireProcessExecutorDeps(bus, runStore); err != nil {
		return nil, err
	}
	profile, err := NewGenericRunnerProfile(cfg.Command, cfg.Args, cfg.Env, cfg.ExtraEnv, cfg.WorkDir)
	ctor := planNewProcessExecutor(err, cfg.WorkDir)
	if ctor.FailProfile {
		return nil, err
	}
	if ctor.StatWorkDir {
		info, statErr := os.Stat(cfg.WorkDir)
		if err := validateConfiguredWorkDir(cfg.WorkDir, info, statErr); err != nil {
			return nil, err
		}
	}
	runTimeout, shutdownGP, shutdownFT := resolveProcessExecutorTimeouts(cfg)
	return buildProcessExecutor(
		bus,
		runStore,
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

// newProcessExecutorPlan is the pure constructor gate after profile construction.
type newProcessExecutorPlan struct {
	FailProfile bool
	StatWorkDir bool
}

// planNewProcessExecutor maps profile construction error + configured workDir into
// constructor control flags. Stat/Validate side-effects stay in NewProcessExecutor.
func planNewProcessExecutor(profileErr error, workDir string) newProcessExecutorPlan {
	return newProcessExecutorPlan{
		FailProfile: shouldFailNewRunnerProfile(profileErr),
		StatWorkDir: shouldStatConfiguredWorkDir(workDir),
	}
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
