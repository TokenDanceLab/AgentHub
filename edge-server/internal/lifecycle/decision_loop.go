// Package lifecycle provides the DecisionLoop — a structured multi-step
// execution loop that wraps an AgentAdapter with step counting, max-steps
// enforcement, and tool-approval gating.
//
// This addresses the gap documented in:
//
//	Historical LobeHub borrow-list Finding 1, indexed by docs/history.md:
//	"AgentHub relies on Claude Code's opaque internal loop"
//
// Design:
//   - DecisionLoop wraps the adapter's event stream emitted during ParseStream.
//   - It intercepts tool_call events to count steps and check against maxSteps.
//   - When maxSteps is exceeded, it injects a force-finish instruction via stdin
//     (control protocol) and emits a context_warning event.
//   - The loop state (currentStep, phase, pending approvals) is exposed through
//     thread-safe accessors so the API layer can report progress.
package lifecycle

import (
	"fmt"
	"log/slog"
	"io"
	"sync"
	"sync/atomic"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

// ── Phase Constants ─────────────────────────────────────────────────────────

// AgentPhase represents the current phase of the agent decision loop.
// Mirrors LobeHub's phase concept (init, user_input, llm_result, tool_result, etc.)
// but simplified for the initial implementation.
type AgentPhase string

const (
	PhaseIdle        AgentPhase = "idle"         // loop not yet started
	PhaseCallingLLM  AgentPhase = "calling_llm"  // LLM request in flight
	PhaseToolResult  AgentPhase = "tool_result"  // tool execution completed, results being processed
	PhaseDone        AgentPhase = "done"         // agent finished successfully
	PhaseError       AgentPhase = "error"        // agent encountered an error
	PhaseForceFinish AgentPhase = "force_finish" // max steps reached, forcing summary
	PhaseInterrupted AgentPhase = "interrupted"  // agent was interrupted (human or system)
)

// String returns the string representation of the phase.
func (p AgentPhase) String() string { return string(p) }

// IsTerminal returns true if the phase indicates the loop has ended.
func (p AgentPhase) IsTerminal() bool {
	switch p {
	case PhaseDone, PhaseError, PhaseInterrupted:
		return true
	case PhaseIdle, PhaseCallingLLM, PhaseToolResult, PhaseForceFinish:
		return false
	default:
		return false
	}
}

// ── DecisionLoop ────────────────────────────────────────────────────────────

// DecisionLoopConfig holds configuration for the decision loop.
type DecisionLoopConfig struct {
	// MaxSteps is the maximum number of tool-call rounds before force-finish.
	// Zero or negative means use the default (50).
	MaxSteps int32

	// MaxRunTimeout is the maximum wall-clock time for the entire loop.
	// Zero means no timeout.
	MaxRunTimeout time.Duration

	// ForceFinishPrompt is injected via stdin when maxSteps is reached.
	// If empty, a sensible default is used.
	ForceFinishPrompt string
}

// DefaultDecisionLoopConfig returns a config with safe defaults.
func DefaultDecisionLoopConfig() DecisionLoopConfig {
	return DecisionLoopConfig{
		MaxSteps:      50,
		MaxRunTimeout: 30 * time.Minute,
	}
}

// DecisionLoop wraps an AgentAdapter event stream to provide structured
// multi-step execution with step counting, max-steps enforcement, and
// tool-approval gating.
//
// It intercepts events emitted during the adapter's ParseStream call to:
//  1. Count steps — each tool_call event increments the step counter.
//  2. Enforce maxSteps — when exceeded, sends a control interrupt via stdin
//     and emits a force_finish context_warning event.
//  3. Track phase transitions — idle → calling_llm → tool_result → done/error.
//  4. Expose loop state for API progress reporting.
//
// All exported methods are safe for concurrent use.
// ApprovalMetricsRecorder abstracts the edge_approval_decisions_total counter
// so lifecycle stays decoupled from the concrete metrics package (testable with
// a stub). Nil receivers are safe — Record is a no-op.
type ApprovalMetricsRecorder interface {
	RecordApprovalDecision(decision string)
}

type DecisionLoop struct {
	cfg DecisionLoopConfig

	currentStep atomic.Int32
	phase       atomic.Value // stores AgentPhase

	// Approval gate: map of tool call ID → approval channel.
	// When a tool call requires human approval, the loop pauses until
	// the channel receives a value (true=approve, false=deny).
	pendingApprovals map[string]chan bool
	approvalMu       sync.Mutex

	// stdin writer for sending control-protocol messages (interrupt, etc.)
	stdinWriter io.Writer
	stdinMu     sync.Mutex

	// Outcome tracking
	startTime time.Time
	endTime   time.Time
	endTimeMu sync.Mutex
	err       error
	errMu     sync.Mutex

	// approvalMetrics is optional; when set, ApproveTool/DenyTool increment
	// edge_approval_decisions_total{decision}. Nil-safe.
	approvalMetrics ApprovalMetricsRecorder
}

// NewDecisionLoop creates a new DecisionLoop wrapping the given event stream.
// The adapter's ParseStream outputs are intercepted for step tracking.
// stdin is used to send control-protocol messages (interrupt for force-finish).
func NewDecisionLoop(cfg DecisionLoopConfig) *DecisionLoop {
	if cfg.MaxSteps <= 0 {
		cfg.MaxSteps = 50
	}
	if cfg.MaxRunTimeout <= 0 {
		cfg.MaxRunTimeout = 30 * time.Minute
	}
	if cfg.ForceFinishPrompt == "" {
		cfg.ForceFinishPrompt = defaultForceFinishPrompt
	}

	dl := &DecisionLoop{
		cfg:              cfg,
		pendingApprovals: make(map[string]chan bool),
	}
	dl.phase.Store(PhaseIdle)
	return dl
}

// ── Public Accessors ────────────────────────────────────────────────────────

// CurrentStep returns the current step count (number of tool-call rounds).
func (dl *DecisionLoop) CurrentStep() int32 { return dl.currentStep.Load() }

// MaxSteps returns the configured maximum steps.
func (dl *DecisionLoop) MaxSteps() int32 { return dl.cfg.MaxSteps }

// Phase returns the current phase of the decision loop.
func (dl *DecisionLoop) Phase() AgentPhase {
	v := dl.phase.Load()
	if v == nil {
		return PhaseIdle
	}
	return v.(AgentPhase)
}

// IsDone returns true when the loop has terminated (done, error, or interrupted).
func (dl *DecisionLoop) IsDone() bool { return dl.Phase().IsTerminal() }

// HasExceededMaxSteps returns true when the step count has reached or exceeded maxSteps.
func (dl *DecisionLoop) HasExceededMaxSteps() bool {
	return dl.currentStep.Load() >= dl.cfg.MaxSteps
}

// Elapsed returns the wall-clock duration since the loop started.
func (dl *DecisionLoop) Elapsed() time.Duration {
	if dl.startTime.IsZero() {
		return 0
	}
	dl.endTimeMu.Lock()
	end := dl.endTime
	dl.endTimeMu.Unlock()
	if !end.IsZero() {
		return end.Sub(dl.startTime)
	}
	return time.Since(dl.startTime)
}

// Err returns the error that caused the loop to terminate, or nil.
func (dl *DecisionLoop) Err() error {
	dl.errMu.Lock()
	defer dl.errMu.Unlock()
	return dl.err
}

// ── Approval Gating ─────────────────────────────────────────────────────────

// AwaitApproval registers a pending approval for a tool call and blocks until
// the approval decision is made. Returns true if approved, false if denied.
// toolCallID is the unique identifier for the tool call (from the adapter event).
func (dl *DecisionLoop) AwaitApproval(toolCallID string) <-chan bool {
	dl.approvalMu.Lock()
	defer dl.approvalMu.Unlock()

	// Return existing channel if already awaiting.
	if ch, ok := dl.pendingApprovals[toolCallID]; ok {
		return ch
	}

	ch := make(chan bool, 1)
	dl.pendingApprovals[toolCallID] = ch
	return ch
}

// ApproveTool approves a pending tool call. Returns false if the tool_call_id
// is not found in the pending approvals map.
func (dl *DecisionLoop) ApproveTool(toolCallID string) bool {
	dl.approvalMu.Lock()
	ch, ok := dl.pendingApprovals[toolCallID]
	if ok {
		delete(dl.pendingApprovals, toolCallID)
	}
	dl.approvalMu.Unlock()

	if ok {
		ch <- true
		close(ch)
		if dl.approvalMetrics != nil {
			dl.approvalMetrics.RecordApprovalDecision("approve")
		}
		slog.Info("approval: tool approved", "tool_call_id", toolCallID, "decision", "approve")
	}
	return ok
}

// DenyTool denies a pending tool call.
func (dl *DecisionLoop) DenyTool(toolCallID string) bool {
	dl.approvalMu.Lock()
	ch, ok := dl.pendingApprovals[toolCallID]
	if ok {
		delete(dl.pendingApprovals, toolCallID)
	}
	dl.approvalMu.Unlock()

	if ok {
		ch <- false
		close(ch)
		if dl.approvalMetrics != nil {
			dl.approvalMetrics.RecordApprovalDecision("deny")
		}
		slog.Info("approval: tool denied", "tool_call_id", toolCallID, "decision", "deny")
	}
	return ok
}

// PendingApprovals returns the IDs of all tool calls currently awaiting approval.
func (dl *DecisionLoop) PendingApprovals() []string {
	dl.approvalMu.Lock()
	defer dl.approvalMu.Unlock()

	ids := make([]string, 0, len(dl.pendingApprovals))
	for id := range dl.pendingApprovals {
		ids = append(ids, id)
	}
	return ids
}

// SetApprovalMetrics wires an optional metrics recorder for approval decisions.
// Safe to call with nil; existing tests that don't set it keep working.
func (dl *DecisionLoop) SetApprovalMetrics(r ApprovalMetricsRecorder) {
	dl.approvalMetrics = r
}

// ── Force Finish ────────────────────────────────────────────────────────────

// ForceFinish sends an interrupt via stdin to trigger graceful shutdown.
// This is used when maxSteps is exceeded. It writes the force-finish
// prompt via the control protocol so the CLI can summarize its findings.
func (dl *DecisionLoop) ForceFinish() error {
	dl.stdinMu.Lock()
	defer dl.stdinMu.Unlock()

	if dl.stdinWriter == nil {
		return fmt.Errorf("no stdin writer available for force-finish")
	}

	if err := adapters.WriteInterrupt(dl.stdinWriter, "force-finish-max-steps"); err != nil {
		return fmt.Errorf("force-finish interrupt failed: %w", err)
	}

	dl.setPhase(PhaseForceFinish)
	return nil
}

// ── Event Emitter Wrapper ───────────────────────────────────────────────────

// WrapEmitter returns an EventEmitter that intercepts all adapter events
// to track step count, phase transitions, and enforce maxSteps.
// The returned emitter delegates to the inner emitter for all events.
func (dl *DecisionLoop) WrapEmitter(inner adapters.EventEmitter, stdin io.Writer, run store.Run) adapters.EventEmitter {
	dl.stdinMu.Lock()
	dl.stdinWriter = stdin
	dl.stdinMu.Unlock()

	dl.startTime = time.Now()
	dl.setPhase(PhaseCallingLLM)

	return &decisionLoopEmitter{
		loop:  dl,
		inner: inner,
		run:   run,
	}
}

// setPhase atomically updates the current phase.
func (dl *DecisionLoop) setPhase(p AgentPhase) {
	dl.phase.Store(p)
}

// markDone records the end time and error (if any).
func (dl *DecisionLoop) markDone(err error) {
	dl.endTimeMu.Lock()
	dl.endTime = time.Now()
	dl.endTimeMu.Unlock()

	dl.errMu.Lock()
	dl.err = err
	dl.errMu.Unlock()

	if err != nil {
		dl.setPhase(PhaseError)
	} else {
		dl.setPhase(PhaseDone)
	}
}

// ── decisionLoopEmitter ─────────────────────────────────────────────────────

// decisionLoopEmitter intercepts adapter events to track the decision loop state.
type decisionLoopEmitter struct {
	loop  *DecisionLoop
	inner adapters.EventEmitter
	run   store.Run
}

func (e *decisionLoopEmitter) Emit(eventType string, scope map[string]any, payload any) {
	// Always pass through to the inner emitter first so events are not lost.
	e.inner.Emit(eventType, scope, payload)

	switch eventType {
	// ── Step Counting ──────────────────────────────────────────────────
	case adapters.BusEventToolCall:
		e.loop.currentStep.Add(1)
		step := e.loop.CurrentStep()
		maxSteps := e.loop.MaxSteps()

		// Force-finish when max steps exceeded.
		if step >= maxSteps {
			e.injectForceFinish(step, maxSteps)
			return
		}

		// Warning when approaching max steps.
		if step >= maxSteps-3 {
			e.inner.Emit(adapters.BusEventContextWarning, scope, map[string]any{
				"runId":     e.run.ID,
				"step":      step,
				"maxSteps":  maxSteps,
				"remaining": maxSteps - step,
				"message":   fmt.Sprintf("Approaching max steps: %d/%d (%d remaining)", step, maxSteps, maxSteps-step),
				"phase":     e.loop.Phase().String(),
			})
		}

	// ── Phase Tracking ────────────────────────────────────────────────
	case adapters.BusEventToolResult:
		e.loop.setPhase(PhaseToolResult)

	case adapters.BusEventResult:
		e.loop.setPhase(PhaseDone)

	// ── Error Tracking ─────────────────────────────────────────────────
	case adapters.BusEventContextCompaction:
		// Context compaction reached — record but don't stop the loop.
		// The adapter will handle compaction internally.

	case adapters.BusEventPermissionRequested:
		// Permission request detected — emit additional metadata for
		// the approval gate to pick up.
		e.trackPermissionRequest(payload, scope)

	// ── Text Events: LLM is actively generating ───────────────────────
	case adapters.BusEventTextBlock, adapters.BusEventTextDelta:
		if e.loop.Phase() != PhaseCallingLLM && e.loop.Phase() != PhaseForceFinish {
			e.loop.setPhase(PhaseCallingLLM)
		}
	}
}

// trackPermissionRequest emits additional structured metadata when a
// permission_requested event is detected. This makes it easier for the
// API layer (and Desktop UI) to pick up and present the approval dialog.
func (e *decisionLoopEmitter) trackPermissionRequest(payload any, scope map[string]any) {
	payloadMap, ok := payload.(map[string]any)
	if !ok {
		return
	}

	// Enrich with decision-loop metadata.
	enriched := make(map[string]any, len(payloadMap)+3)
	for k, v := range payloadMap {
		enriched[k] = v
	}
	enriched["step"] = e.loop.CurrentStep()
	enriched["maxSteps"] = e.loop.MaxSteps()
	enriched["phase"] = e.loop.Phase().String()

	e.inner.Emit(adapters.BusEventPermissionRequested, scope, enriched)
}

// injectForceFinish sends a force-finish interrupt when max steps is exceeded.
func (e *decisionLoopEmitter) injectForceFinish(step, maxSteps int32) {
	// Emit context warning first so upstream can react.
	e.inner.Emit(adapters.BusEventContextWarning, e.runScope(), map[string]any{
		"runId":    e.run.ID,
		"step":     step,
		"maxSteps": maxSteps,
		"message":  fmt.Sprintf("Max steps reached (%d/%d). Forcing summary.", step, maxSteps),
		"phase":    PhaseForceFinish.String(),
	})

	// Send interrupt via stdin to trigger graceful shutdown.
	if err := e.loop.ForceFinish(); err != nil {
		// Force-finish failed (e.g., no stdin writer available).
		// Logging is handled by the ProcessExecutor caller.
		e.loop.setPhase(PhaseError)
		e.loop.markDone(fmt.Errorf("force-finish failed at step %d/%d: %w", step, maxSteps, err))
	}
}

func (e *decisionLoopEmitter) runScope() map[string]any {
	return map[string]any{
		"projectId": e.run.ProjectID,
		"threadId":  e.run.ThreadID,
		"runId":     e.run.ID,
	}
}

// ── Integration Helpers ─────────────────────────────────────────────────────

// DecisionLoopEmitterFactory creates decision-loop-wrapped emitters for use
// in ProcessExecutor.publishStructuredOutput. When DecisionLoop is configured,
// this factory wraps the raw adapter emitter with step tracking.
type DecisionLoopEmitterFactory struct {
	loop *DecisionLoop
}

// NewDecisionLoopEmitterFactory creates a factory that wraps emitters with
// decision-loop step tracking and max-steps enforcement.
func NewDecisionLoopEmitterFactory(cfg DecisionLoopConfig) *DecisionLoopEmitterFactory {
	return &DecisionLoopEmitterFactory{
		loop: NewDecisionLoop(cfg),
	}
}

// Wrap wraps an EventEmitter with decision-loop tracking for the given run.
// The returned emitter intercepts tool_call, tool_result, and permission events
// to track step count and enforce maxSteps.
func (f *DecisionLoopEmitterFactory) Wrap(stdin io.Writer, inner adapters.EventEmitter, run store.Run) adapters.EventEmitter {
	return f.loop.WrapEmitter(inner, stdin, run)
}

// Loop returns the underlying DecisionLoop for state queries.
func (f *DecisionLoopEmitterFactory) Loop() *DecisionLoop {
	return f.loop
}

// defaultForceFinishPrompt is sent via stdin interrupt when max steps is reached.
const defaultForceFinishPrompt = `You have reached the maximum number of steps.
Please summarize your findings and provide a concise conclusion.
Do not start any new tasks or tool calls — just wrap up what you have.`
