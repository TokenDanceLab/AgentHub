package lifecycle

import (
	"context"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/runnerctx"
)

// Residual pure-helper peel #1121: domain pure helpers extracted from
// process_executor_pure.go. Same package lifecycle; zero behavior change.

// withParserContextValues injects budget / workdir / SDK run context into the
// parser context used by structured output adapters.
func withParserContextValues(ctx context.Context, runCtx RunProcessContext) context.Context {
	parserCtx := ctx
	if runCtx.Budget != nil {
		parserCtx = context.WithValue(parserCtx, adapters.CtxBudgetKey, runCtx.Budget)
	}
	if runCtx.WorkDir != "" {
		parserCtx = context.WithValue(parserCtx, adapters.CtxWorkDir, runCtx.WorkDir)
	}
	if runCtx.Model != "" {
		parserCtx = context.WithValue(parserCtx, adapters.CtxModelKey, runCtx.Model)
	}
	return adapters.SDKAdapterContext(parserCtx, runCtx)
}

// withFreshSession replaces the session ID and clears continue-last for a
// session-conflict retry attempt.
func withFreshSession(runCtx RunProcessContext, sessionID string) RunProcessContext {
	runCtx.SessionID = sessionID
	runCtx.ContinueLast = false
	return runCtx
}

// applyParentWorkDirMemory copies the parent workdir onto the child run context
// and injects AgentHub memory when available.
func applyParentWorkDirMemory(runCtx RunProcessContext, parentWorkDir, threadID, agentID string) RunProcessContext {
	if parentWorkDir == "" {
		return runCtx
	}
	runCtx.WorkDir = parentWorkDir
	if memPrompt := runnerctx.BuildMemoryPrompt(parentWorkDir, threadID, agentID); memPrompt != "" {
		runCtx.SkillsPrompt = memPrompt
	}
	return runCtx
}

// budgetFromParserContext extracts a non-nil context budget from parser context.
func budgetFromParserContext(ctx context.Context) (*runnerctx.ContextBudget, bool) {
	budget, ok := ctx.Value(adapters.CtxBudgetKey).(*runnerctx.ContextBudget)
	return budget, ok && budget != nil
}

// allowedToolsFromParserContext returns AllowedTools when present on the SDK run context.
func allowedToolsFromParserContext(ctx context.Context) ([]string, bool) {
	rc, ok := adapters.RunProcessContextFromContext(ctx)
	if !ok || len(rc.AllowedTools) == 0 {
		return nil, false
	}
	return rc.AllowedTools, true
}

// buildProcessSecurityHooks builds the unified security hook chain. When
// allowedTools is non-empty, the allowlist hook is prepended so it runs first.
func buildProcessSecurityHooks(allowedTools []string, emitter adapters.EventEmitter, scope map[string]any) adapters.HookChain {
	hooks := adapters.HookChain{adapters.NewSecurityHook()}
	if len(allowedTools) > 0 {
		allowlistHook := adapters.NewToolAllowlistHook(allowedTools, emitter, scope)
		hooks = adapters.HookChain{allowlistHook, adapters.NewSecurityHook()}
	}
	return hooks
}

// shouldTrackWorkDir reports whether a workdir snapshot should be retained for
// post-finish auto-surface detection.
func shouldTrackWorkDir(workDir string) bool {
	return workDir != ""
}

// shouldEmitContextCompaction reports whether the run budget crossed the
// auto-compaction threshold and should publish a compaction event.
func shouldEmitContextCompaction(budget *runnerctx.ContextBudget) bool {
	return budget != nil && budget.ShouldCompact()
}

// shouldApplyBudgetAwareEmitter reports whether the structured-output emitter
// should be wrapped with budget monitoring.
func shouldApplyBudgetAwareEmitter(hasBudget bool) bool {
	return hasBudget
}

// contextCompactionSnapshot reads compaction diagnostics from a budget. Pure
// relative to I/O (atomic load only).
func contextCompactionSnapshot(budget *runnerctx.ContextBudget) (usagePct float64, tokensUsed, remaining int64) {
	if budget == nil {
		return 0, 0, 0
	}
	return budget.UsagePercent(), budget.UsedTokens.Load(), budget.Remaining()
}

// workdirTrackPlan is the pure pre-run workdir snapshot gate.
type workdirTrackPlan struct {
	Track bool
}

// planWorkdirTrack reports whether a workdir should be snapshotted/tracked.
func planWorkdirTrack(workDir string) workdirTrackPlan {
	return workdirTrackPlan{Track: shouldTrackWorkDir(workDir)}
}

// contextCompactionPlan is the pure post-stream compaction emit plan.
type contextCompactionPlan struct {
	Emit       bool
	UsagePct   float64
	TokensUsed int64
	Remaining  int64
	Payload    map[string]any
}

// planContextCompaction snapshots budget usage and builds the bus payload when
// the auto-compaction threshold is crossed. Side-effects stay in the executor.
func planContextCompaction(budget *runnerctx.ContextBudget, runID string) contextCompactionPlan {
	if !shouldEmitContextCompaction(budget) {
		return contextCompactionPlan{}
	}
	usagePct, tokensUsed, remaining := contextCompactionSnapshot(budget)
	return contextCompactionPlan{
		Emit:       true,
		UsagePct:   usagePct,
		TokensUsed: tokensUsed,
		Remaining:  remaining,
		Payload:    contextCompactionPayload(runID, usagePct, tokensUsed, remaining),
	}
}
