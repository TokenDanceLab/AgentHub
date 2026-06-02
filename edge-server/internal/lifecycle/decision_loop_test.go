package lifecycle

import (
	"errors"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

func TestDecisionLoop_DefaultConfig(t *testing.T) {
	cfg := DefaultDecisionLoopConfig()
	if cfg.MaxSteps != 50 {
		t.Errorf("expected MaxSteps=50, got %d", cfg.MaxSteps)
	}
	if cfg.MaxRunTimeout != 30*time.Minute {
		t.Errorf("expected MaxRunTimeout=30m, got %v", cfg.MaxRunTimeout)
	}
	// ForceFinishPrompt is not set in DefaultDecisionLoopConfig; it defaults
	// in NewDecisionLoop which has access to the internal default constant.
}

func TestDecisionLoop_NewDecisionLoop(t *testing.T) {
	dl := NewDecisionLoop(DecisionLoopConfig{MaxSteps: 5})
	if dl.MaxSteps() != 5 {
		t.Errorf("expected MaxSteps=5, got %d", dl.MaxSteps())
	}
	if dl.CurrentStep() != 0 {
		t.Errorf("expected CurrentStep=0, got %d", dl.CurrentStep())
	}
	if dl.Phase() != PhaseIdle {
		t.Errorf("expected Phase=idle, got %s", dl.Phase())
	}
	if dl.IsDone() {
		t.Error("expected IsDone=false for idle phase")
	}
}

func TestDecisionLoop_ZeroMaxStepsUsesDefault(t *testing.T) {
	dl := NewDecisionLoop(DecisionLoopConfig{MaxSteps: 0})
	if dl.MaxSteps() != 50 {
		t.Errorf("expected default MaxSteps=50 for zero input, got %d", dl.MaxSteps())
	}
}

func TestDecisionLoop_NegativeMaxStepsUsesDefault(t *testing.T) {
	dl := NewDecisionLoop(DecisionLoopConfig{MaxSteps: -1})
	if dl.MaxSteps() != 50 {
		t.Errorf("expected default MaxSteps=50 for negative input, got %d", dl.MaxSteps())
	}
}

func TestDecisionLoop_StepCounting(t *testing.T) {
	dl := NewDecisionLoop(DecisionLoopConfig{MaxSteps: 3})

	// Simulate the emitter pattern: wrap an inner emitter (capturing events)
	inner := &captureEmitter{events: make([]capturedEvent, 0)}
	stdin := &nopWriteCloser{}
	wrapped := dl.WrapEmitter(inner, stdin, makeRun("test-run"))

	// Phase should be calling_llm after wrap
	if dl.Phase() != PhaseCallingLLM {
		t.Errorf("expected Phase=calling_llm after wrap, got %s", dl.Phase())
	}

	// Emit a tool_call event — step should increment
	wrapped.Emit(adapters.BusEventToolCall, nil, map[string]any{
		"callId": "tc-001",
		"tool":   "read_file",
	})
	if dl.CurrentStep() != 1 {
		t.Errorf("expected CurrentStep=1 after tool_call, got %d", dl.CurrentStep())
	}

	// Emit two more tool calls
	wrapped.Emit(adapters.BusEventToolCall, nil, map[string]any{
		"callId": "tc-002",
		"tool":   "write_file",
	})
	wrapped.Emit(adapters.BusEventToolCall, nil, map[string]any{
		"callId": "tc-003",
		"tool":   "bash",
	})

	if dl.CurrentStep() != 3 {
		t.Errorf("expected CurrentStep=3 after 3 tool_calls, got %d", dl.CurrentStep())
	}
	if !dl.HasExceededMaxSteps() {
		t.Error("expected HasExceededMaxSteps=true after 3 steps with max 3")
	}
}

func TestDecisionLoop_PhaseTransitions(t *testing.T) {
	dl := NewDecisionLoop(DecisionLoopConfig{MaxSteps: 10})
	inner := &captureEmitter{events: make([]capturedEvent, 0)}
	stdin := &nopWriteCloser{}
	wrapped := dl.WrapEmitter(inner, stdin, makeRun("test-run"))

	// After wrap: calling_llm
	if dl.Phase() != PhaseCallingLLM {
		t.Errorf("expected Phase=calling_llm, got %s", dl.Phase())
	}

	// Tool result event
	wrapped.Emit(adapters.BusEventToolResult, nil, map[string]any{
		"callId": "tc-001",
		"result": "ok",
	})
	if dl.Phase() != PhaseToolResult {
		t.Errorf("expected Phase=tool_result after tool_result event, got %s", dl.Phase())
	}

	// Text delta should set back to calling_llm
	wrapped.Emit(adapters.BusEventTextDelta, nil, map[string]any{
		"text": "thinking...",
	})
	if dl.Phase() != PhaseCallingLLM {
		t.Errorf("expected Phase=calling_llm after text_delta, got %s", dl.Phase())
	}

	// Result event should set to done
	wrapped.Emit(adapters.BusEventResult, nil, map[string]any{
		"content": "final answer",
	})
	if dl.Phase() != PhaseDone {
		t.Errorf("expected Phase=done after result event, got %s", dl.Phase())
	}
}

func TestDecisionLoop_ToolApprovalGating(t *testing.T) {
	dl := NewDecisionLoop(DecisionLoopConfig{MaxSteps: 10})

	// Await approval for a tool call
	ch := dl.AwaitApproval("tc-001")

	// Should be pending
	pending := dl.PendingApprovals()
	if len(pending) != 1 || pending[0] != "tc-001" {
		t.Errorf("expected pending=[tc-001], got %v", pending)
	}

	// Approve the tool call
	go func() {
		time.Sleep(10 * time.Millisecond)
		dl.ApproveTool("tc-001")
	}()

	select {
	case approved := <-ch:
		if !approved {
			t.Error("expected approved=true")
		}
	case <-time.After(time.Second):
		t.Error("approval channel timed out")
	}

	// Should no longer be pending
	pending = dl.PendingApprovals()
	if len(pending) != 0 {
		t.Errorf("expected no pending approvals, got %v", pending)
	}
}

func TestDecisionLoop_DenyTool(t *testing.T) {
	dl := NewDecisionLoop(DecisionLoopConfig{MaxSteps: 10})

	ch := dl.AwaitApproval("tc-deny")
	dl.DenyTool("tc-deny")

	select {
	case approved := <-ch:
		if approved {
			t.Error("expected approved=false for denied tool")
		}
	case <-time.After(time.Second):
		t.Error("deny channel timed out")
	}
}

func TestDecisionLoop_ForceFinishWithoutStdin(t *testing.T) {
	dl := NewDecisionLoop(DecisionLoopConfig{MaxSteps: 3})

	err := dl.ForceFinish()
	if err == nil {
		t.Error("expected error when ForceFinish called without stdin")
	}
}

func TestDecisionLoop_MarkDone(t *testing.T) {
	dl := NewDecisionLoop(DecisionLoopConfig{MaxSteps: 10})

	dl.markDone(nil)
	if !dl.IsDone() {
		t.Error("expected IsDone=true after markDone(nil)")
	}
	if dl.Phase() != PhaseDone {
		t.Errorf("expected Phase=done, got %s", dl.Phase())
	}
	if dl.Err() != nil {
		t.Errorf("expected nil error, got %v", dl.Err())
	}
}

func TestDecisionLoop_MarkDoneWithError(t *testing.T) {
	dl := NewDecisionLoop(DecisionLoopConfig{MaxSteps: 10})

	dl.markDone(errors.New("mock adapter error"))
	if !dl.IsDone() {
		t.Error("expected IsDone=true after markDone(error)")
	}
	if dl.Phase() != PhaseError {
		t.Errorf("expected Phase=error, got %s", dl.Phase())
	}
	if dl.Err() == nil {
		t.Error("expected non-nil error after markDone(error)")
	}
}

func TestDecisionLoop_Elapsed(t *testing.T) {
	dl := NewDecisionLoop(DecisionLoopConfig{MaxSteps: 10})

	// Before wrap, elapsed should be 0
	if dl.Elapsed() != 0 {
		t.Errorf("expected elapsed=0 before start, got %v", dl.Elapsed())
	}

	// Wrap triggers start
	inner := &captureEmitter{events: make([]capturedEvent, 0)}
	stdin := &nopWriteCloser{}
	_ = dl.WrapEmitter(inner, stdin, makeRun("test-run"))

	// A minimal sleep to ensure time has advanced.
	time.Sleep(time.Millisecond)

	elapsed := dl.Elapsed()
	if elapsed <= 0 {
		t.Errorf("expected elapsed > 0 after wrap+sleep, got %v", elapsed)
	}
}

func TestDecisionLoop_ApproachingMaxStepsWarning(t *testing.T) {
	dl := NewDecisionLoop(DecisionLoopConfig{MaxSteps: 5})
	inner := &captureEmitter{events: make([]capturedEvent, 0)}
	stdin := &nopWriteCloser{}
	wrapped := dl.WrapEmitter(inner, stdin, makeRun("test-run"))

	// Steps 1-2: no warning yet
	wrapped.Emit(adapters.BusEventToolCall, nil, map[string]any{"callId": "tc-001"})
	wrapped.Emit(adapters.BusEventToolCall, nil, map[string]any{"callId": "tc-002"})

	// Step 3: should trigger warning (5-3=2 remaining)
	wrapped.Emit(adapters.BusEventToolCall, nil, map[string]any{"callId": "tc-003"})

	// Check that a context_warning event was emitted
	hasWarning := false
	for _, evt := range inner.events {
		if evt.eventType == adapters.BusEventContextWarning {
			hasWarning = true
			break
		}
	}
	if !hasWarning {
		t.Error("expected context_warning event when approaching max steps")
	}
}

func TestDecisionLoopEmitterFactory(t *testing.T) {
	factory := NewDecisionLoopEmitterFactory(DecisionLoopConfig{MaxSteps: 7})

	if factory.Loop().MaxSteps() != 7 {
		t.Errorf("expected MaxSteps=7, got %d", factory.Loop().MaxSteps())
	}

	inner := &captureEmitter{events: make([]capturedEvent, 0)}
	stdin := &nopWriteCloser{}
	_ = factory.Wrap(stdin, inner, makeRun("test-run"))

	if factory.Loop().Phase() != PhaseCallingLLM {
		t.Errorf("expected Phase=calling_llm, got %s", factory.Loop().Phase())
	}
}

func TestAgentPhase_IsTerminal(t *testing.T) {
	tests := []struct {
		phase    AgentPhase
		terminal bool
	}{
		{PhaseIdle, false},
		{PhaseCallingLLM, false},
		{PhaseToolResult, false},
		{PhaseDone, true},
		{PhaseError, true},
		{PhaseForceFinish, false},
		{PhaseInterrupted, true},
	}

	for _, tt := range tests {
		if tt.phase.IsTerminal() != tt.terminal {
			t.Errorf("Phase %s: expected IsTerminal=%v, got %v", tt.phase, tt.terminal, !tt.terminal)
		}
	}
}

// ── Test Helpers ────────────────────────────────────────────────────────────

type capturedEvent struct {
	eventType string
	scope     map[string]any
	payload   any
}

type captureEmitter struct {
	events []capturedEvent
}

func (e *captureEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.events = append(e.events, capturedEvent{
		eventType: eventType,
		scope:     scope,
		payload:   payload,
	})
}

type nopWriteCloser struct{}

func (w *nopWriteCloser) Write(p []byte) (int, error) { return len(p), nil }
func (w *nopWriteCloser) Close() error                 { return nil }

func makeRun(id string) store.Run {
	return store.Run{
		ID:        id,
		ProjectID: "proj-test",
		ThreadID:  "thread-test",
		Status:    "started",
	}
}
