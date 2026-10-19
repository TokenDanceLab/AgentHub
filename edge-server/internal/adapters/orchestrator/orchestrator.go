package orchestrator

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"sync"

	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

const (
	// DefaultDispatchConcurrency is the default maximum number of concurrent
	// sub-agent dispatch goroutines. Matches OpenCode default tool concurrency of 10.
	DefaultDispatchConcurrency = 10
)

// Adapter wraps an AgentExecutor with an orchestrator system prompt.
// It is used in group-chat mode to decompose complex tasks and dispatch sub-agents.
//
// The orchestrator is an agent with a specialized system prompt that instructs
// it to break down user requests, identify sub-tasks, and coordinate other agents.
// Edge listens for orchestrator events to spawn sub-agent runs.
//
// The underlying agent executor is injected through the AgentExecutor port
// (composition root wires a ClaudeCodeAdapter); the leaf package never imports
// the concrete adapter package.
type Adapter struct {
	inner         AgentExecutor
	systemPrompt  string
	agentRegistry *agents.Registry
	messageQueue  *agents.Queue
	spawner       SubAgentSpawner
	depth         int

	// Plan approval gate: when non-nil, the orchestrator pauses after
	// detecting dispatch events and waits for user approval before spawning sub-agents.
	planBroker *PlanApprovalBroker
}

// NewOrchestratorAdapter creates an orchestrator wrapping the given agent
// executor. The executor is injected by the composition root so the leaf
// package stays decoupled from concrete adapters.
func NewOrchestratorAdapter(inner AgentExecutor, systemPrompt string) *Adapter {
	return &Adapter{
		inner:        inner,
		systemPrompt: escapePromptLiteral(systemPrompt),
		depth:        0,
	}
}

// WithAgentRegistry attaches an agent instance registry for tracking sub-agents.
func (a *Adapter) WithAgentRegistry(r *agents.Registry) *Adapter {
	a.agentRegistry = r
	return a
}

// WithMessageQueue attaches a message queue for inter-agent communication.
func (a *Adapter) WithMessageQueue(q *agents.Queue) *Adapter {
	a.messageQueue = q
	return a
}

// WithSpawner attaches a SubAgentSpawner for creating sub-agent runs.
func (a *Adapter) WithSpawner(s SubAgentSpawner) *Adapter {
	a.spawner = s
	return a
}

// WithDepth sets the delegation depth for this orchestrator instance.
func (a *Adapter) WithDepth(d int) *Adapter {
	a.depth = d
	return a
}

// WithPlanBroker attaches the plan approval broker for the plan confirmation gate.
// When set, the orchestrator pauses after detecting dispatch events and waits for
// user approval before spawning sub-agents.
func (a *Adapter) WithPlanBroker(b *PlanApprovalBroker) *Adapter {
	a.planBroker = b
	return a
}

func (a *Adapter) Metadata() AdapterMetadata {
	m := a.inner.Metadata()
	m.ID = "orchestrator"
	m.Name = "Orchestrator"
	m.Description = "Orchestrator Agent - decomposes tasks, dispatches sub-agents, aggregates results"
	return m
}

func (a *Adapter) Capabilities() AgentCapabilities {
	c := a.inner.Capabilities()
	c.SubAgentSpawn = true
	return c
}

func (a *Adapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	cmdPath, args, env, workDir := a.inner.BuildCommand(ctx)
	// Use --append-system-prompt (not --system-prompt) to avoid silently
	// discarding the agent profile's system prompt. Claude Code concatenates
	// multiple --append-system-prompt values, so both the agent's profile
	// prompt AND the orchestrator's orchestration instructions are included.
	if a.systemPrompt != "" {
		args = append(args, "--append-system-prompt", a.systemPrompt)
	}
	return cmdPath, args, env, workDir
}

func (a *Adapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	// Per-run model comes from the parser context (injected by the lifecycle
	// executor), never from shared Adapter state: one Adapter serves all
	// concurrent runs of its agent (#2154 data-race fix).
	parentModel, _ := ctx.Value(CtxModelKey).(string)
	effectiveEmitter := emitter
	if a.agentRegistry != nil || a.spawner != nil {
		if a.messageQueue != nil {
			a.messageQueue.EnsureAgent(run.ID, 64)
		}
		effectiveEmitter = &dispatchInterceptor{
			inner:      emitter,
			registry:   a.agentRegistry,
			queue:      a.messageQueue,
			spawner:    a.spawner,
			parentRun:  run,
			depth:      a.depth,
			threadID:   run.ThreadID,
			model:      parentModel,
			ctx:        ctx,
			dispatched: make(map[string]dispatchEvent),
			planBroker: a.planBroker,
		}
		if budget, ok := ctx.Value(CtxBudgetKey).(*runnerctx.ContextBudget); ok {
			effectiveEmitter.(*dispatchInterceptor).budget = budget
		}
	}
	return a.inner.ParseStream(ctx, stdout, stdin, effectiveEmitter, run)
}

func (a *Adapter) NeedsStdin() bool { return true }

func (a *Adapter) Available() bool {
	available := a.inner.Available()
	slog.Debug("adapter.availability", "adapter", "orchestrator", "available", available)
	return available
}

// --- dispatch interception ---

// dispatchInterceptor wraps an EventEmitter to detect dispatch events.
type dispatchInterceptor struct {
	inner     EventEmitter
	registry  *agents.Registry
	queue     *agents.Queue
	spawner   SubAgentSpawner
	parentRun store.Run
	depth     int
	threadID  string
	model     string
	budget    *runnerctx.ContextBudget

	// Plan approval gate: when planBroker is non-nil, the interceptor
	// pauses after detecting dispatch events and emits a plan.proposed event.
	// It then blocks until the user approves or rejects the plan, or the
	// approval timeout fires (default: deny). When nil, dispatches proceed immediately.
	planBroker *PlanApprovalBroker

	// Sub-agent result injection and status tracking.
	ctx                context.Context // set from ParseStream; cancelled when run ends
	resultListenerOnce sync.Once       // ensures result listener starts exactly once
	dispatchedMu       sync.Mutex
	dispatchedCount    int                      // total sub-agents dispatched by this interceptor
	dispatched         map[string]dispatchEvent // agentID -> original dispatch event for result injection

	// textBuffer accumulates streamed text deltas to prevent dispatch JSON
	// fragmentation across BusEventTextDelta events.
	// Reset on BusEventTextBlock or after successful dispatch detection.
	textBuffer strings.Builder
}
