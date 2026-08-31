package lifecycle

import (
	"context"
	"io"
	"os"
	"sync"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/metrics"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

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

	// Configurable timeouts for run lifecycle and graceful shutdown.
	runTimeout           time.Duration
	shutdownGracePeriod  time.Duration
	shutdownForceTimeout time.Duration

	// Evidence gate configuration for post-run verification.
	evidenceGateCfg EvidenceGateConfig

	// Fault auto-retry configuration for run failure recovery.
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
	callbackSem chan struct{}                        // bounds concurrent hub callbacks (max 10); stream acquires non-blocking, terminal blocks

	// pendingParentFinish holds parent runs whose terminal finish is deferred
	// until all of their sub-agents complete (orchestration). Keyed by parent
	// run ID; the ResultAggregator finalizes these via FinalizeParentRun.
	pendingParentFinish map[string]deferredParentFinish
}

// deferredParentFinish is the terminal-finish snapshot for an orchestrator
// parent run waiting on its sub-agents.
type deferredParentFinish struct {
	run         store.Run
	finalStatus string
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
	return newProcessExecutor(bus, store, cfg, adapter, adapterReg)
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
