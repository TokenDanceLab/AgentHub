// Package adapters provides the unified AgentAdapter interface and registry
// for integrating external Agent CLIs (Claude Code, Codex, OpenCode) into
// the Edge Server's run lifecycle.
package adapters

import (
	"context"
	"fmt"
	"strings"

	"github.com/agenthub/edge-server/internal/orchestration"
	"github.com/agenthub/edge-server/internal/runnerctx"
)

// RunProcessContext is an alias for the shared runnerctx.RunProcessContext.
type RunProcessContext = runnerctx.RunProcessContext

// DefaultWorkDir no longer invents a production workspace. Adapter runs must
// receive an explicit workDir from the API/MCP gate (#854). Returning empty
// keeps unit tests and defense-in-depth paths from silently expanding to the
// user home directory (or ".") when a caller bypasses the gate.
func DefaultWorkDir() string {
	return ""
}

// BuildSiblingContextPrompt generates a human-readable prompt section that informs
// a sub-agent about its sibling agents working in parallel. Returns empty string
// when there are no siblings. The prompt warns the agent not to modify files that
// other agents are touching.
func BuildSiblingContextPrompt(siblings []SiblingInfo) string {
	if len(siblings) == 0 {
		return ""
	}

	var b strings.Builder
	b.WriteString("[同级 Agent 上下文]\n")
	b.WriteString("你正在与其他 Agent 并行工作。以下是你的同级 Agent 及其任务：\n\n")

	for i, sib := range siblings {
		fmt.Fprintf(&b, "- Agent %d (%s): %s", i+1, sib.AgentName, sib.TaskDesc)
		if len(sib.TargetFiles) > 0 {
			b.WriteString(" (")
			for j, f := range sib.TargetFiles {
				if j > 0 {
					b.WriteString(", ")
				}
				b.WriteString(f)
			}
			b.WriteString(")")
		}
		b.WriteString("\n")
	}

	b.WriteString("\n注意：\n")
	b.WriteString("- 不要修改其他 Agent 正在处理的文件\n")
	b.WriteString("- 如果需要在共享文件上工作，先完成你的改动，不要等待\n")
	b.WriteString("- 如果两个 Agent 修改同一个文件，最后写入的会覆盖\n")

	return b.String()
}

// Context keys for adapter-level context propagation.
type ctxKey string

// CtxSessionID is used to pass the session ID through context to adapters
// so the permission handler can include it in permission events.
const CtxSessionID ctxKey = "agenthub-session-id"

// CtxWorkDir is used to pass the run workspace to stream parsers that need to
// redact or relativize paths from CLI-native events.
const CtxWorkDir ctxKey = "agenthub-work-dir"

// CtxRunContext is used by SDK adapters (anthropic-sdk, openai-sdk) to extract
// the full RunProcessContext from the context passed to ParseStream. SDK adapters
// need the prompt, model, and other parameters to build their HTTP requests.
// It is also used by the lifecycle layer to extract AllowedTools for runtime
// tool allowlist enforcement.
const CtxRunContext ctxKey = "agenthub-run-context"

// SDKAdapterContext returns a context with the RunProcessContext attached,
// enabling SDK adapters to extract prompt/model parameters in ParseStream.
func SDKAdapterContext(ctx context.Context, runCtx RunProcessContext) context.Context {
	return context.WithValue(ctx, CtxRunContext, runCtx)
}

// RunProcessContextFromContext extracts the RunProcessContext from the given
// context, if one was attached via SDKAdapterContext. Returns the zero value
// and false if no RunProcessContext is present.
func RunProcessContextFromContext(ctx context.Context) (RunProcessContext, bool) {
	rc, ok := ctx.Value(CtxRunContext).(RunProcessContext)
	return rc, ok
}

// --- Stream parse error handling ---

// ParseStreamError wraps an error from ParseStream with a recoverability flag.
// Non-recoverable errors (pipe broken, context cancelled) should fail the run.
// Recoverable errors (malformed tool result, orphaned tool, single bad event)
// should emit a BusEventContextWarning and allow the run to finish naturally.
//
// Reference: Kanna agent.ts:1406-1419 (try/catch in runTurn, appends error
// entry, calls recordTurnFailed), OpenCode prompt.ts:1281-1290 (orphaned
// interrupted tools handling — logs warning, exits loop cleanly).
type ParseStreamError struct {
	err         error
	recoverable bool
}

// NewRecoverableParseError creates a ParseStreamError that should not
// terminate the run. Use for individual malformed events, orphaned tool
// results, or other recoverable stream parsing issues.
func NewRecoverableParseError(err error) *ParseStreamError {
	return &ParseStreamError{err: err, recoverable: true}
}

// NewNonRecoverableParseError creates a ParseStreamError that should
// terminate the run. Use for broken pipes, context cancellation, and
// other unrecoverable I/O failures.
func NewNonRecoverableParseError(err error) *ParseStreamError {
	return &ParseStreamError{err: err, recoverable: false}
}

// Recoverable reports whether this error should allow the run to complete
// rather than being marked as failed.
func (e *ParseStreamError) Recoverable() bool { return e.recoverable }

// Error implements the error interface.
func (e *ParseStreamError) Error() string {
	if e.err == nil {
		return "parse stream error"
	}
	return fmt.Sprintf("parse stream error: %v", e.err)
}

// Unwrap returns the wrapped error for errors.Is/As support.
func (e *ParseStreamError) Unwrap() error { return e.err }

// PreflightAdapter is an optional interface that adapters can implement to
// provide a pre-execution readiness check. The process executor calls this
// before launching the subprocess and fails the run immediately with a
// descriptive error if the check fails.
type PreflightAdapter interface {
	PreflightCheck() error
}

// _ is a compile-time assertion that the contract types stay importable
// through this package for existing call sites (A-V1 Step 2, #1566).
var _ = orchestration.AgentAdapter(nil)
