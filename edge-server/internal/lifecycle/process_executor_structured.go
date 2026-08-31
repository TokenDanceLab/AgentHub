package lifecycle

import (
	"context"
	"io"
	"log/slog"
	"sync"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

func (e *ProcessExecutor) publishStructuredOutput(wg *sync.WaitGroup, run store.Run, stdout io.Reader, stdin io.Writer, adapter adapters.AgentAdapter, ctx context.Context, parseErr *error) {
	defer wg.Done()
	scope := runScope(run)
	var emitter adapters.EventEmitter = adapters.NewScopedEventEmitter(
		adapters.NewPayloadLimitEmitter(adapters.NewBusEventEmitter(e.bus), e.maxStructuredPayloadBytes),
		scope,
	)
	emitter = newHubCallbackEmitter(e, run.ID, emitter)
	hubEmitter := emitter
	emitter = coalesceEmitter(emitter, newRuntimeEvidenceEmitter(e.store, run, emitter))
	transcriptEmitter := newThreadTranscriptEmitter(e.store, run, emitter)
	emitter = coalesceEmitter(emitter, transcriptEmitter)

	// Wrap emitter with budget monitoring: emits run.agent.context_warning
	// when token usage exceeds the auto-compaction threshold (85%).
	budget, hasBudget := budgetFromParserContext(ctx)
	wrapPlan := planStructuredEmitterWraps(hasBudget)
	if wrapPlan.ApplyBudget {
		emitter = adapters.NewBudgetAwareEmitter(emitter, budget, scope)
	}

	// Build the security hook chain. The tool allowlist hook runs first (before
	// the security hook) so that allowlist-rejected tools are blocked before any
	// dangerous-pattern analysis. When AllowedTools is empty, the allowlist hook
	// is a no-op and is not added to the chain.
	//
	// This is the unified security layer: all three adapters (Claude Code,
	// Codex, OpenCode) are covered at the ProcessExecutor level, regardless
	// of whether they use NDJSONStreamParser or emit events directly.
	allowedTools, _ := allowedToolsFromParserContext(ctx)
	hooks := buildProcessSecurityHooks(allowedTools, emitter, scope)
	emitter = adapters.NewSecureEmitter(ctx, emitter, hooks)

	err := adapter.ParseStream(ctx, stdout, stdin, emitter, run)

	// Drain the hub stream coalescer so a sub-threshold tail of text deltas
	// is delivered before the run finalizes (the collector itself is fed
	// per-event, so done-final is unaffected; this only matters for live
	// chat projection). The assertion targets the hubCallbackEmitter captured
	// before the outer wrappers, which do not implement FlushHubStream.
	if flusher, ok := hubEmitter.(hubStreamFlusher); ok {
		flusher.FlushHubStream()
	}

	// Close stdin after the turn so a long-running subprocess (the ACP agent,
	// e.g. npx → claude-agent-acp → claude) sees EOF and exits. The ACP agent
	// does not self-terminate after a single turn; without this close the
	// executor's process-wait blocks on the still-open stderr pipe forever and
	// the run never finalizes out of "started". Legacy one-shot CLI adapters
	// (claude -p) have already exited by this point, so the close is a no-op.
	if closer, ok := stdin.(io.Closer); ok {
		_ = closer.Close()
	}

	parsePlan := planStructuredParsePost(err, transcriptEmitter != nil)
	if parsePlan.RecordError {
		slog.Error("structured output parse error", "runId", run.ID, "error", err)
		*parseErr = err
	}
	if parsePlan.Flush {
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
