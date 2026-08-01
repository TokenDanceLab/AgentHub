package adapters

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

// ── Test Doubles ────────────────────────────────────────────────────────────
//
// The package already provides `stubAdapter` (registry_test.go) but its
// Available() is hardcoded to true. The registry-facing methods under test
// (findAlternateAgent / FindAlternateAgentID) need a controllable
// availability flag, so we define a dedicated mock here.
//
// The package also provides `mockEmitter` (parser_ndjson_test.go), but it
// coerces payloads to map[string]any, which would discard the typed
// FailureClassifiedEvent. We use a typed emitter to assert on the event
// struct fields.

// mockAgentAdapter implements AgentAdapter with a controllable availability flag.
type mockAgentAdapter struct {
	id        string
	available bool
}

func (m *mockAgentAdapter) Metadata() AdapterMetadata {
	return AdapterMetadata{ID: m.id, Name: m.id}
}
func (m *mockAgentAdapter) Capabilities() AgentCapabilities { return AgentCapabilities{} }
func (m *mockAgentAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	return "", nil, nil, ""
}
func (m *mockAgentAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	return nil
}
func (m *mockAgentAdapter) NeedsStdin() bool { return false }
func (m *mockAgentAdapter) Available() bool  { return m.available }

// failureRecoveryEmittedEvent records a single Emit call with the raw payload.
type failureRecoveryEmittedEvent struct {
	eventType string
	scope     map[string]any
	payload   any
}

// failureRecoveryEmitter is a concurrency-safe EventEmitter that preserves
// typed payloads (unlike the package's map-only mockEmitter).
type failureRecoveryEmitter struct {
	mu     sync.Mutex
	events []failureRecoveryEmittedEvent
}

func (e *failureRecoveryEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.events = append(e.events, failureRecoveryEmittedEvent{eventType: eventType, scope: scope, payload: payload})
}

func (e *failureRecoveryEmitter) len() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.events)
}

// last returns the most recent FailureClassifiedEvent emission, or zero values
// if no event (or no typed event) has been emitted.
func (e *failureRecoveryEmitter) last() (string, map[string]any, FailureClassifiedEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.events) == 0 {
		return "", nil, FailureClassifiedEvent{}
	}
	ev := e.events[len(e.events)-1]
	fc, _ := ev.payload.(FailureClassifiedEvent)
	return ev.eventType, ev.scope, fc
}

// newTestRegistry builds a real *Registry pre-populated with mock adapters.
// ids maps adapter ID -> availability.
func newTestRegistry(avail map[string]bool) *Registry {
	r := NewRegistry()
	for id, available := range avail {
		r.Register(&mockAgentAdapter{id: id, available: available})
	}
	return r
}

// ── NewFailureRecoveryManager ───────────────────────────────────────────────

func TestNewFailureRecoveryManager(t *testing.T) {
	m := NewFailureRecoveryManager(nil, nil)
	if m == nil {
		t.Fatal("NewFailureRecoveryManager(nil, nil) returned nil")
	}
	if m.policies == nil {
		t.Error("policies map should be initialized (non-nil)")
	}
	if len(m.policies) != 3 {
		t.Errorf("policies has %d entries, want 3 (transient/capability/cancel)", len(m.policies))
	}
	if m.mu == nil {
		t.Error("recovery state map should be initialized (non-nil)")
	}
	if m.circuitBreakers == nil {
		t.Error("circuit breakers map should be initialized (non-nil)")
	}
	if m.adapterRegistry != nil {
		t.Error("adapterRegistry should be nil when passed nil")
	}
	if m.spawner != nil {
		t.Error("spawner should be nil when passed nil")
	}
}

// ── getOrCreateCircuitBreaker ───────────────────────────────────────────────

func TestFailureRecoveryManager_GetOrCreateCircuitBreaker(t *testing.T) {
	m := NewFailureRecoveryManager(nil, nil)

	// Lazy creation: first access creates a new circuit breaker with defaults.
	cb := m.getOrCreateCircuitBreaker("code-reviewer")
	if cb == nil {
		t.Fatal("getOrCreateCircuitBreaker returned nil for new key")
	}
	if cb.State() != CircuitClosed {
		t.Errorf("new circuit breaker state = %v, want %v", cb.State(), CircuitClosed)
	}
	if got := len(m.circuitBreakers); got != 1 {
		t.Errorf("circuitBreakers size = %d, want 1", got)
	}

	// Idempotent: same key returns the same instance.
	cb2 := m.getOrCreateCircuitBreaker("code-reviewer")
	if cb2 != cb {
		t.Error("getOrCreateCircuitBreaker with same key returned a different instance")
	}
	if got := len(m.circuitBreakers); got != 1 {
		t.Errorf("circuitBreakers size after second lookup = %d, want 1 (no duplicate)", got)
	}

	// Distinct keys get distinct breakers.
	cb3 := m.getOrCreateCircuitBreaker("builder")
	if cb3 == cb {
		t.Error("distinct keys should produce distinct circuit breaker instances")
	}
	if got := len(m.circuitBreakers); got != 2 {
		t.Errorf("circuitBreakers size = %d, want 2", got)
	}
}

func TestFailureRecoveryManager_GetOrCreateCircuitBreakerConcurrent(t *testing.T) {
	m := NewFailureRecoveryManager(nil, nil)

	const goroutines = 100
	results := make([]*AgentCircuitBreaker, goroutines)
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i] = m.getOrCreateCircuitBreaker("shared-agent")
		}(i)
	}
	wg.Wait()

	// Double-checked locking must produce exactly one shared instance.
	for i := 1; i < goroutines; i++ {
		if results[i] != results[0] {
			t.Fatalf("goroutine %d got a different circuit breaker instance than goroutine 0", i)
		}
	}
	if got := len(m.circuitBreakers); got != 1 {
		t.Errorf("circuitBreakers size after %d concurrent accesses = %d, want 1", goroutines, got)
	}
}

// ── checkCircuitBreaker ─────────────────────────────────────────────────────

func TestFailureRecoveryManager_CheckCircuitBreaker(t *testing.T) {
	m := NewFailureRecoveryManager(nil, nil)

	// Closed state: allowed through (nil error).
	if err := m.checkCircuitBreaker("agent-1"); err != nil {
		t.Errorf("checkCircuitBreaker in closed state returned error: %v", err)
	}

	// Trip the breaker with 5 recordCircuitFailure calls (default threshold).
	for i := 0; i < 5; i++ {
		m.recordCircuitFailure("agent-1")
	}
	if cb := m.circuitBreakers["agent-1"]; cb.State() != CircuitOpen {
		t.Fatalf("circuit state after 5 failures = %v, want %v", cb.State(), CircuitOpen)
	}

	// Open state: checkCircuitBreaker returns an error.
	err := m.checkCircuitBreaker("agent-1")
	if err == nil {
		t.Fatal("checkCircuitBreaker in open state should return an error")
	}
	if want := "circuit breaker open"; !contains(err.Error(), want) {
		t.Errorf("error = %q, want it to contain %q", err.Error(), want)
	}

	// A different key is unaffected.
	if err := m.checkCircuitBreaker("other-agent"); err != nil {
		t.Errorf("checkCircuitBreaker for unrelated key returned error: %v", err)
	}
}

// ── recordCircuitFailure / RecordCircuitSuccess ─────────────────────────────

func TestFailureRecoveryManager_RecordCircuitFailure(t *testing.T) {
	m := NewFailureRecoveryManager(nil, nil)

	cb := m.getOrCreateCircuitBreaker("agent-1")
	for i := 0; i < 4; i++ {
		m.recordCircuitFailure("agent-1")
		if cb.State() != CircuitClosed {
			t.Fatalf("state after %d failures = %v, want closed (threshold 5)", i+1, cb.State())
		}
	}
	m.recordCircuitFailure("agent-1") // 5th failure trips the breaker
	if cb.State() != CircuitOpen {
		t.Errorf("state after 5th failure = %v, want %v (recordCircuitFailure delegates to cb.RecordFailure)", cb.State(), CircuitOpen)
	}
}

func TestFailureRecoveryManager_RecordCircuitSuccess(t *testing.T) {
	m := NewFailureRecoveryManager(nil, nil)

	// Closed state: success resets the failure counter (does not trip early).
	for i := 0; i < 4; i++ {
		m.recordCircuitFailure("agent-1")
	}
	m.RecordCircuitSuccess("agent-1")
	cb := m.circuitBreakers["agent-1"]
	if cb.State() != CircuitClosed {
		t.Fatalf("state after failures + success = %v, want closed", cb.State())
	}
	// Counter was reset: 4 more failures must NOT trip (would have tripped at
	// 5 total if the counter had not been reset).
	for i := 0; i < 4; i++ {
		m.recordCircuitFailure("agent-1")
	}
	if cb.State() != CircuitClosed {
		t.Errorf("state after 4+4 failures with a success between = %v, want closed (counter reset by RecordCircuitSuccess)", cb.State())
	}

	// Open state: RecordCircuitSuccess force-resets to closed (safety path).
	m.recordCircuitFailure("agent-1") // 5th consecutive -> open
	if cb.State() != CircuitOpen {
		t.Fatalf("expected open before success reset, got %v", cb.State())
	}
	m.RecordCircuitSuccess("agent-1")
	if cb.State() != CircuitClosed {
		t.Errorf("state after success in open = %v, want %v (force reset)", cb.State(), CircuitClosed)
	}
}

// ── findAlternateAgent ──────────────────────────────────────────────────────

func TestFailureRecoveryManager_FindAlternateAgent(t *testing.T) {
	t.Run("nil registry returns false", func(t *testing.T) {
		m := NewFailureRecoveryManager(nil, nil)
		if m.findAlternateAgent("a1") {
			t.Error("findAlternateAgent with nil registry should return false")
		}
	})

	t.Run("empty registry returns false", func(t *testing.T) {
		m := NewFailureRecoveryManager(newTestRegistry(nil), nil)
		if m.findAlternateAgent("a1") {
			t.Error("findAlternateAgent with empty registry should return false")
		}
	})

	t.Run("available alternate returns true", func(t *testing.T) {
		m := NewFailureRecoveryManager(newTestRegistry(map[string]bool{
			"a1": true,
			"a2": true,
		}), nil)
		if !m.findAlternateAgent("a1") {
			t.Error("findAlternateAgent should return true when an available alternate exists")
		}
	})

	t.Run("only failed agent present returns false", func(t *testing.T) {
		m := NewFailureRecoveryManager(newTestRegistry(map[string]bool{
			"a1": true,
		}), nil)
		if m.findAlternateAgent("a1") {
			t.Error("findAlternateAgent should return false when only the failed agent is registered")
		}
	})

	t.Run("alternate present but unavailable returns false", func(t *testing.T) {
		m := NewFailureRecoveryManager(newTestRegistry(map[string]bool{
			"a1": true,
			"a2": false, // registered but CLI binary not available
		}), nil)
		if m.findAlternateAgent("a1") {
			t.Error("findAlternateAgent should return false when the alternate is unavailable")
		}
	})

	t.Run("failed agent not in registry and no available alternate returns false", func(t *testing.T) {
		m := NewFailureRecoveryManager(newTestRegistry(map[string]bool{
			"a2": false,
		}), nil)
		if m.findAlternateAgent("a1") {
			t.Error("findAlternateAgent should return false when no registered adapter is available")
		}
	})
}

// ── FindAlternateAgentID ────────────────────────────────────────────────────

func TestFailureRecoveryManager_FindAlternateAgentID(t *testing.T) {
	t.Run("nil registry returns empty", func(t *testing.T) {
		m := NewFailureRecoveryManager(nil, nil)
		if got := m.FindAlternateAgentID("a1"); got != "" {
			t.Errorf("FindAlternateAgentID with nil registry = %q, want empty", got)
		}
	})

	t.Run("empty registry returns empty", func(t *testing.T) {
		m := NewFailureRecoveryManager(newTestRegistry(nil), nil)
		if got := m.FindAlternateAgentID("a1"); got != "" {
			t.Errorf("FindAlternateAgentID with empty registry = %q, want empty", got)
		}
	})

	t.Run("available alternate returns its ID", func(t *testing.T) {
		m := NewFailureRecoveryManager(newTestRegistry(map[string]bool{
			"a1": true,
			"a2": true,
		}), nil)
		got := m.FindAlternateAgentID("a1")
		if got != "a2" {
			t.Errorf("FindAlternateAgentID = %q, want %q", got, "a2")
		}
	})

	t.Run("failed agent not registered returns the available adapter", func(t *testing.T) {
		m := NewFailureRecoveryManager(newTestRegistry(map[string]bool{
			"a2": true,
		}), nil)
		if got := m.FindAlternateAgentID("a1"); got != "a2" {
			t.Errorf("FindAlternateAgentID = %q, want %q", got, "a2")
		}
	})

	t.Run("only failed agent present returns empty", func(t *testing.T) {
		m := NewFailureRecoveryManager(newTestRegistry(map[string]bool{
			"a1": true,
		}), nil)
		if got := m.FindAlternateAgentID("a1"); got != "" {
			t.Errorf("FindAlternateAgentID with only failed agent = %q, want empty", got)
		}
	})

	t.Run("alternate present but unavailable returns empty", func(t *testing.T) {
		m := NewFailureRecoveryManager(newTestRegistry(map[string]bool{
			"a1": true,
			"a2": false,
		}), nil)
		if got := m.FindAlternateAgentID("a1"); got != "" {
			t.Errorf("FindAlternateAgentID with unavailable alternate = %q, want empty", got)
		}
	})
}

// ── ResetRecoveryState ──────────────────────────────────────────────────────

func TestFailureRecoveryManager_ResetRecoveryState(t *testing.T) {
	m := NewFailureRecoveryManager(nil, nil)

	// Populate state and circuit breaker for the agent.
	m.mu["agent-1"] = &RecoveryState{AgentID: "agent-1", TaskID: "task-1", RetryCount: 2}
	m.getOrCreateCircuitBreaker("agent-1")

	m.ResetRecoveryState("agent-1")

	if _, ok := m.mu["agent-1"]; ok {
		t.Error("recovery state should be deleted by ResetRecoveryState")
	}
	if _, ok := m.circuitBreakers["agent-1"]; ok {
		t.Error("circuit breaker should be deleted by ResetRecoveryState")
	}

	// Subsequent circuit check lazily re-creates a fresh (closed) breaker.
	if err := m.checkCircuitBreaker("agent-1"); err != nil {
		t.Errorf("checkCircuitBreaker after reset returned error: %v", err)
	}
	if cb := m.circuitBreakers["agent-1"]; cb == nil {
		t.Error("circuit breaker should be lazily re-created after reset")
	} else if cb.State() != CircuitClosed {
		t.Errorf("re-created breaker state = %v, want %v (state reset)", cb.State(), CircuitClosed)
	}
}

// ── HandleSubAgentFailure Orchestration ─────────────────────────────────────
//
// NOTE ON SPAWNER: HandleSubAgentFailure never invokes the spawner — the
// spawner is used by the dispatch interceptor layer (orchestrator.go), not by
// the recovery manager. All tests below therefore pass a nil spawner.

func TestHandleSubAgentFailure_CircuitOpen(t *testing.T) {
	m := NewFailureRecoveryManager(nil, nil)
	emitter := &failureRecoveryEmitter{}
	scope := map[string]any{"runId": "run-1"}
	run := store.Run{ID: "run-1"}

	// Trip the breaker for agentName "agent-1" (Step 0 check happens before
	// classification and would otherwise let the call through).
	for i := 0; i < 5; i++ {
		m.recordCircuitFailure("agent-1")
	}

	decision, err := m.HandleSubAgentFailure(
		context.Background(), run, "agent-1", "agent-1", "task-1",
		errors.New("permission denied"), nil, emitter, scope,
	)

	if decision != DecisionSkip {
		t.Errorf("decision = %v, want %v (circuit open intercepts in Step 0)", decision, DecisionSkip)
	}
	if err == nil {
		t.Error("expected circuit breaker error, got nil")
	}
	if !contains(err.Error(), "circuit breaker open") {
		t.Errorf("error = %q, want it to mention circuit breaker open", err.Error())
	}

	// Step 0 path emits its own event with Cancel/Skip classification.
	if n := emitter.len(); n != 1 {
		t.Fatalf("emitter received %d events, want 1", n)
	}
	eventType, gotScope, evt := emitter.last()
	if eventType != BusEventFailureClassified {
		t.Errorf("event type = %q, want %q", eventType, BusEventFailureClassified)
	}
	if gotScope["runId"] != "run-1" {
		t.Errorf("scope = %v, want runId=run-1", gotScope)
	}
	if evt.RunID != "run-1" || evt.AgentID != "agent-1" || evt.TaskID != "task-1" {
		t.Errorf("event run/agent/task = %q/%q/%q, want run-1/agent-1/task-1", evt.RunID, evt.AgentID, evt.TaskID)
	}
	if evt.Category != FailureCancel {
		t.Errorf("event category = %v, want %v", evt.Category, FailureCancel)
	}
	if evt.Decision != DecisionSkip {
		t.Errorf("event decision = %v, want %v", evt.Decision, DecisionSkip)
	}
	if evt.Error == "" {
		t.Error("event error should carry the circuit breaker reason")
	}
}

func TestHandleSubAgentFailure_Skip(t *testing.T) {
	m := NewFailureRecoveryManager(nil, nil)
	emitter := &failureRecoveryEmitter{}
	scope := map[string]any{"runId": "run-1"}
	run := store.Run{ID: "run-1"}

	// context.Canceled -> FailureCancel -> DecideRecovery -> DecisionSkip.
	decision, err := m.HandleSubAgentFailure(
		context.Background(), run, "agent-1", "agent-1", "task-1",
		context.Canceled, nil, emitter, scope,
	)

	if decision != DecisionSkip {
		t.Errorf("decision = %v, want %v", decision, DecisionSkip)
	}
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	if n := emitter.len(); n != 1 {
		t.Fatalf("emitter received %d events, want 1", n)
	}
	eventType, _, evt := emitter.last()
	if eventType != BusEventFailureClassified {
		t.Errorf("event type = %q, want %q", eventType, BusEventFailureClassified)
	}
	if evt.Category != FailureCancel || evt.Decision != DecisionSkip {
		t.Errorf("event category/decision = %v/%v, want %v/%v", evt.Category, evt.Decision, FailureCancel, DecisionSkip)
	}
	if evt.RetryCount != 0 {
		t.Errorf("event retryCount = %d, want 0 (cancel never retries)", evt.RetryCount)
	}

	// Recovery state was created for the agent.
	if _, ok := m.mu["agent-1"]; !ok {
		t.Error("recovery state should be created for agent-1")
	}
}

func TestHandleSubAgentFailure_FailTripsCircuit(t *testing.T) {
	m := NewFailureRecoveryManager(nil, nil)
	emitter := &failureRecoveryEmitter{}
	scope := map[string]any{"runId": "run-1"}
	run := store.Run{ID: "run-1"}

	// Capability error with no alternate (nil registry) -> DecisionFail.
	// Each DecisionFail records a circuit failure; default threshold is 5.
	for i := 0; i < 5; i++ {
		decision, err := m.HandleSubAgentFailure(
			context.Background(), run, "agent-1", "agent-1", "task-1",
			errors.New("permission denied"), nil, emitter, scope,
		)
		if decision != DecisionFail {
			t.Fatalf("call %d: decision = %v, want %v", i+1, decision, DecisionFail)
		}
		if err != nil {
			t.Fatalf("call %d: unexpected error: %v", i+1, err)
		}
	}
	if cb := m.circuitBreakers["agent-1"]; cb.State() != CircuitOpen {
		t.Fatalf("circuit state after 5 definitive failures = %v, want %v", cb.State(), CircuitOpen)
	}

	// 6th call: Step 0 circuit check intercepts -> DecisionSkip + error.
	decision, err := m.HandleSubAgentFailure(
		context.Background(), run, "agent-1", "agent-1", "task-1",
		errors.New("permission denied"), nil, emitter, scope,
	)
	if decision != DecisionSkip {
		t.Errorf("6th call decision = %v, want %v (circuit now open)", decision, DecisionSkip)
	}
	if err == nil {
		t.Error("6th call should return the circuit breaker error")
	}

	// 6 events: 5 fail + 1 skip.
	if n := emitter.len(); n != 6 {
		t.Fatalf("emitter received %d events, want 6", n)
	}
	_, _, evt := emitter.last()
	if evt.Category != FailureCancel || evt.Decision != DecisionSkip {
		t.Errorf("6th event category/decision = %v/%v, want %v/%v", evt.Category, evt.Decision, FailureCancel, DecisionSkip)
	}
}

func TestHandleSubAgentFailure_SwitchAgent(t *testing.T) {
	m := NewFailureRecoveryManager(newTestRegistry(map[string]bool{
		"agent-1": true,
		"agent-2": true,
	}), nil)
	emitter := &failureRecoveryEmitter{}
	scope := map[string]any{"runId": "run-1"}
	run := store.Run{ID: "run-1"}

	// Capability error with an available alternate -> DecisionSwitchAgent.
	decision, err := m.HandleSubAgentFailure(
		context.Background(), run, "agent-1", "agent-1", "task-1",
		errors.New("permission denied"), nil, emitter, scope,
	)

	if decision != DecisionSwitchAgent {
		t.Errorf("decision = %v, want %v", decision, DecisionSwitchAgent)
	}
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	if n := emitter.len(); n != 1 {
		t.Fatalf("emitter received %d events, want 1", n)
	}
	_, _, evt := emitter.last()
	if evt.Category != FailureCapability || evt.Decision != DecisionSwitchAgent {
		t.Errorf("event category/decision = %v/%v, want %v/%v", evt.Category, evt.Decision, FailureCapability, DecisionSwitchAgent)
	}
	if evt.AlternateID != "agent-2" {
		t.Errorf("event alternateID = %q, want %q", evt.AlternateID, "agent-2")
	}
}

func TestHandleSubAgentFailure_RetryCtxCancel(t *testing.T) {
	m := NewFailureRecoveryManager(nil, nil)
	emitter := &failureRecoveryEmitter{}
	scope := map[string]any{"runId": "run-1"}
	run := store.Run{ID: "run-1"}

	// Transient error -> DecisionRetry. Step 6 waits for backoff via
	// select { <-ctx.Done(); <-time.After(backoff) }. Cancel the context
	// BEFORE the call so the select takes the ctx.Done branch immediately
	// instead of waiting out the real backoff duration (which carries
	// ±25% jitter and would be slow/flaky to assert on).
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	decision, err := m.HandleSubAgentFailure(
		ctx, run, "agent-1", "agent-1", "task-1",
		errors.New("connection refused"), nil, emitter, scope,
	)

	if decision != DecisionSkip {
		t.Errorf("decision = %v, want %v (ctx.Done branch converts retry to skip)", decision, DecisionSkip)
	}
	if err != context.Canceled {
		t.Errorf("error = %v, want %v (ctx.Err())", err, context.Canceled)
	}

	// The ctx.Done branch returns before the emit at the end of Step 6, so
	// no FailureClassifiedEvent is emitted on this path.
	if n := emitter.len(); n != 0 {
		t.Errorf("emitter received %d events, want 0 (retry aborted by ctx cancel emits nothing)", n)
	}

	// The retry decision was still recorded: state retryCount incremented
	// and totalDepth incremented in Step 4.
	if state, ok := m.mu["agent-1"]; !ok {
		t.Error("recovery state should exist after a retry decision")
	} else if state.RetryCount != 1 {
		t.Errorf("state retryCount = %d, want 1", state.RetryCount)
	}
	if m.totalDepth != 1 {
		t.Errorf("totalDepth = %d, want 1 (incremented on DecisionRetry)", m.totalDepth)
	}
}

// ── Honest TODOs (no fabrication) ───────────────────────────────────────────
//
// TODO(failure-recovery): assert the real backoff wait path of DecisionRetry
// (select's `<-time.After(backoff)` branch). BackoffDuration applies ±25%
// jitter (0.75d..1.25d, capped at 30s), so asserting exact wait duration is
// flaky. Testing would need a backoff injector (e.g. a function field on
// FailureRecoveryManager) or a mock clock. The ctx.Done branch is tested in
// TestHandleSubAgentFailure_RetryCtxCancel; the time.After branch remains
// untested. Note HandleSubAgentFailure does not take a *testing.T or emit on
// the aborted path, so there is no way to observe the branch without a wait.
//
// TODO(failure-recovery): HandleSubAgentFailure never calls the spawner
// (SubAgentSpawner is used by the dispatch interceptor in orchestrator.go),
// so all orchestration tests pass nil spawner. If HandleSubAgentFailure gains
// spawner-based recovery (e.g. automatic re-dispatch on DecisionSwitchAgent),
// add a mock spawner assertion here.

// contains is a thin alias so the assertions read naturally.
func contains(s, substr string) bool { return strings.Contains(s, substr) }
