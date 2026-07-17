package lifecycle

import (
	"context"
	"errors"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/store"
)

// isQueuedRunStatus reports whether a run may still be transitioned to started.
func isQueuedRunStatus(status string) bool {
	return status == "queued"
}

// isCancellableRunStatus reports whether Cancel may act on the given run status.
func isCancellableRunStatus(status string) bool {
	switch status {
	case "queued", "started", "cancelling":
		return true
	default:
		return false
	}
}

// resolveAdapterMetricsLabel returns the Prometheus adapter label for a resolved
// adapter (or "none" when no adapter is bound).
func resolveAdapterMetricsLabel(adapter adapters.AgentAdapter) string {
	if adapter == nil {
		return adapterMetricsLabel("", false)
	}
	return adapterMetricsLabel(adapter.Metadata().ID, true)
}

// shouldCloseStdinEagerly reports whether the executor should close the child
// stdin pipe immediately after Start. Stdin stays open when the adapter needs
// the control protocol or a DecisionLoop may force-finish via interrupt.
func shouldCloseStdinEagerly(needsStdin, hasDecisionLoop bool) bool {
	return !needsStdin && !hasDecisionLoop
}

// shouldRetrySessionConflict reports whether a wait error should trigger a
// single fresh-session retry inside the session-retry window.
func shouldRetrySessionConflict(err error, stderrCapture string, attempt int, elapsed time.Duration) bool {
	return err != nil &&
		attempt == 0 &&
		isSessionConflictError(err, stderrCapture) &&
		elapsed < sessionRetryWindow
}

// recoverableParseStreamError returns the recoverable ParseStreamError when err
// is a recoverable structured-output parse failure.
func recoverableParseStreamError(err error) (*adapters.ParseStreamError, bool) {
	if err == nil {
		return nil, false
	}
	var psErr *adapters.ParseStreamError
	if errors.As(err, &psErr) && psErr.Recoverable() {
		return psErr, true
	}
	return nil, false
}

// faultEscalationActive reports whether fault-escalation is configured to run
// at least one auto-retry. Exhausted events are only emitted when this is true.
func faultEscalationActive(cfg FaultEscalationConfig) bool {
	return cfg.Enabled && cfg.MaxRetries > 0
}

// shouldFaultEscalateRetry reports whether fault-escalation should re-launch
// the run for the given retry count.
func shouldFaultEscalateRetry(cfg FaultEscalationConfig, retryCount int) bool {
	return faultEscalationActive(cfg) && retryCount < cfg.MaxRetries
}

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
	return adapters.SDKAdapterContext(parserCtx, adapters.RunProcessContext(runCtx))
}

// newSubAgentRunContext builds the isolated RunProcessContext for a dispatched
// sub-agent. SessionID is always the child thread so context stays isolated.
func newSubAgentRunContext(run store.Run, task adapters.SubAgentTask, threadID string) RunProcessContext {
	return RunProcessContext{
		Run:       run,
		Prompt:    task.Prompt,
		AgentID:   task.AgentID,
		Budget:    childBudget(task.Budget, task.Depth),
		Model:     task.Model,
		SessionID: threadID,
	}
}

// withSiblingSystemPrompt prepends a sibling-context prompt when the task lists
// parallel sibling agents.
func withSiblingSystemPrompt(existing string, siblingAgents []adapters.SiblingInfo) string {
	if len(siblingAgents) == 0 {
		return existing
	}
	return appendSystemPromptPrefix(existing, adapters.BuildSiblingContextPrompt(siblingAgents))
}

// hubDoneFinalContent returns the TaskDone final content, substituting the
// default finished message when the collector produced nothing.
func hubDoneFinalContent(content string) string {
	if content == "" {
		return "Run finished"
	}
	return content
}

// hubTaskDoneResult builds the Hub TaskDone payload for a finished run.
func hubTaskDoneResult(runID, content string) hub.TaskResult {
	return hub.TaskResult{
		RunID:        runID,
		FinalContent: hubDoneFinalContent(content),
	}
}

// needsAdapterStdin reports whether the resolved adapter requires a live stdin pipe.
func needsAdapterStdin(adapter adapters.AgentAdapter) bool {
	return adapter != nil && adapter.NeedsStdin()
}
