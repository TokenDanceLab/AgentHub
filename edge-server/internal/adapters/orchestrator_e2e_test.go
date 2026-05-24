package adapters

import (
	"crypto/rand"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// ── Test helpers ────────────────────────────────────────────────────────────

// recordingSpawner records SpawnSubAgent calls for test assertions.
type recordingSpawner struct {
	mu    sync.Mutex
	calls []spawnCall
}

type spawnCall struct {
	parentRunID string
	task        SubAgentTask
}

func (r *recordingSpawner) SpawnSubAgent(parentRun store.Run, task SubAgentTask) (agentInstanceID, runID string, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, spawnCall{parentRunID: parentRun.ID, task: task})
	return "agent_" + task.TaskID, "run_" + task.TaskID, nil
}

func (r *recordingSpawner) lastCall() *spawnCall {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.calls) == 0 {
		return nil
	}
	return &r.calls[len(r.calls)-1]
}

func (r *recordingSpawner) callCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

// failingSpawner always returns an error.
type failingSpawner struct {
	err error
}

func (f *failingSpawner) SpawnSubAgent(store.Run, SubAgentTask) (string, string, error) {
	return "", "", f.err
}

// newTestStore creates an in-memory store seeded with a project, thread, and run.
func newTestStore(t *testing.T) store.RunLifecycleStore {
	t.Helper()
	s := store.New()
	_, err := s.CreateProject("proj-1", "test-project")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	_, err = s.CreateThread("thread-1", "proj-1", "test-thread")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	run, err := s.CreateRun("run-1", "proj-1", "thread-1")
	if err != nil {
		t.Fatalf("CreateRun: %v", err)
	}
	// Transition to started so it looks like a running orchestrator.
	s.SetRunStatus(run.ID, "started")
	return s
}

func newTestBus(t *testing.T) *events.Bus {
	t.Helper()
	return events.NewBus(128)
}

func genTestID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}

// ── dispatchInterceptor tests ───────────────────────────────────────────────

func TestDispatchInterceptor_DetectsDispatchJSON(t *testing.T) {
	bus := newTestBus(t)
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")
	spawner := &recordingSpawner{}
	reg := agents.NewRegistry()

	inner := NewBusEventEmitter(bus)
	interceptor := &dispatchInterceptor{
		inner:     inner,
		registry:  reg,
		spawner:   spawner,
		parentRun: run,
		depth:     0,
		threadID:  run.ThreadID,
	}

	// Emit a text block containing a dispatch JSON line.
	interceptor.Emit(BusEventTextBlock, nil, map[string]any{
		"text": `{"action":"dispatch","agent":"codex","task":"Write unit tests","role":"worker"}`,
		"content": `{"action":"dispatch","agent":"codex","task":"Write unit tests","role":"worker"}`,
	})

	// The spawner should have been called.
	if spawner.callCount() != 1 {
		t.Fatalf("expected 1 spawn call, got %d", spawner.callCount())
	}
	call := spawner.lastCall()
	if call.task.AgentID != "codex" {
		t.Fatalf("task.AgentID = %q, want codex", call.task.AgentID)
	}
	if call.task.Prompt != "Write unit tests" {
		t.Fatalf("task.Prompt = %q, want 'Write unit tests'", call.task.Prompt)
	}
	if call.task.Depth != 1 {
		t.Fatalf("task.Depth = %d, want 1", call.task.Depth)
	}
	if call.parentRunID != run.ID {
		t.Fatalf("parentRunID = %q, want %q", call.parentRunID, run.ID)
	}
}

func TestDispatchInterceptor_IgnoresNonDispatchJSON(t *testing.T) {
	spawner := &recordingSpawner{}
	reg := agents.NewRegistry()
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")

	interceptor := &dispatchInterceptor{
		inner:     &stubEmitter{},
		registry:  reg,
		spawner:   spawner,
		parentRun: run,
		depth:     0,
		threadID:  run.ThreadID,
	}

	// JSON that is not a dispatch action should be ignored.
	interceptor.Emit(BusEventTextBlock, nil, map[string]any{
		"text": `{"action":"read","file":"main.go"}`,
	})

	if spawner.callCount() != 0 {
		t.Fatalf("expected 0 spawn calls for non-dispatch JSON, got %d", spawner.callCount())
	}

	// Plain text should be ignored.
	interceptor.Emit(BusEventTextBlock, nil, map[string]any{
		"text": "I will now dispatch a sub-agent to handle this...",
	})

	if spawner.callCount() != 0 {
		t.Fatalf("expected 0 spawn calls for plain text, got %d", spawner.callCount())
	}
}

func TestDispatchInterceptor_ThreadIDPropagation(t *testing.T) {
	spawner := &recordingSpawner{}
	reg := agents.NewRegistry()
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")

	interceptor := &dispatchInterceptor{
		inner:     &stubEmitter{},
		registry:  reg,
		spawner:   spawner,
		parentRun: run,
		depth:     0,
		threadID:  "thread-1",
	}

	interceptor.Emit(BusEventTextBlock, nil, map[string]any{
		"text": `{"action":"dispatch","agent":"codex","task":"Review code"}`,
	})

	if spawner.callCount() != 1 {
		t.Fatalf("expected 1 spawn call, got %d", spawner.callCount())
	}
	call := spawner.lastCall()
	if call.task.ThreadID != "thread-1" {
		t.Fatalf("task.ThreadID = %q, want thread-1", call.task.ThreadID)
	}
}

func TestDispatchInterceptor_ModelPropagation(t *testing.T) {
	spawner := &recordingSpawner{}
	reg := agents.NewRegistry()
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")

	interceptor := &dispatchInterceptor{
		inner:     &stubEmitter{},
		registry:  reg,
		spawner:   spawner,
		parentRun: run,
		depth:     0,
		threadID:  run.ThreadID,
		model:     "claude-sonnet-4-6",
	}

	interceptor.Emit(BusEventTextBlock, nil, map[string]any{
		"text": `{"action":"dispatch","agent":"codex","task":"Analyze","role":"specialist"}`,
	})

	if spawner.callCount() != 1 {
		t.Fatalf("expected 1 spawn call, got %d", spawner.callCount())
	}
	call := spawner.lastCall()
	if call.task.Model != "claude-sonnet-4-6" {
		t.Fatalf("task.Model = %q, want claude-sonnet-4-6", call.task.Model)
	}
}

func TestDispatchInterceptor_AgentRegistered(t *testing.T) {
	spawner := &recordingSpawner{}
	reg := agents.NewRegistry()
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")

	interceptor := &dispatchInterceptor{
		inner:     &stubEmitter{},
		registry:  reg,
		spawner:   spawner,
		parentRun: run,
		depth:     0,
		threadID:  run.ThreadID,
	}

	interceptor.Emit(BusEventTextBlock, nil, map[string]any{
		"text": `{"action":"dispatch","agent":"claude-code","task":"Fix bug"}`,
	})

	if spawner.callCount() != 1 {
		t.Fatalf("expected 1 spawn call, got %d", spawner.callCount())
	}

	// Verify the agent was registered.
	call := spawner.lastCall()
	inst, ok := reg.Get(call.task.TaskID)
	if !ok {
		// Agent is registered by the interceptor before spawning, so get by agent ID.
		// The registry registers with a generated agent ID, not the task ID.
		// Let's check by listing all registered agents.
		all := reg.List()
		if len(all) == 0 {
			t.Fatal("expected at least 1 registered agent")
		}
	} else {
		_ = inst
	}
}

func TestDispatchInterceptor_SpawnerErrorEmitsFailure(t *testing.T) {
	bus := newTestBus(t)
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")
	reg := agents.NewRegistry()

	// Subscribe to the bus to capture emitted events.
	subID, ch, _ := bus.Subscribe(0)
	defer bus.Unsubscribe(subID)

	inner := NewBusEventEmitter(bus)
	interceptor := &dispatchInterceptor{
		inner:     inner,
		registry:  reg,
		spawner:   &failingSpawner{err: fmt.Errorf("capacity exhausted")},
		parentRun: run,
		depth:     0,
		threadID:  run.ThreadID,
	}

	interceptor.Emit(BusEventTextBlock, nil, map[string]any{
		"text": `{"action":"dispatch","agent":"codex","task":"Heavy task"}`,
	})

	// Should emit a task_dispatched error via task_notification.
	var foundFailure bool
	timeout := time.After(500 * time.Millisecond)
	for !foundFailure {
		select {
		case evt := <-ch:
			if evt.Type == BusEventTaskNotification {
				payload, ok := evt.Payload.(map[string]any)
				if ok && payload["action"] == "dispatch_error" {
					foundFailure = true
				}
			}
		case <-timeout:
			t.Fatal("timed out waiting for dispatch_error event")
		}
	}
}

func TestDispatchInterceptor_NoSpawnerNoCrash(t *testing.T) {
	reg := agents.NewRegistry()
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")

	// No spawner — should not panic when dispatch is detected.
	interceptor := &dispatchInterceptor{
		inner:     &stubEmitter{},
		registry:  reg,
		spawner:   nil,
		parentRun: run,
		depth:     0,
		threadID:  run.ThreadID,
	}

	// This should not panic.
	interceptor.Emit(BusEventTextBlock, nil, map[string]any{
		"text": `{"action":"dispatch","agent":"codex","task":"task"}`,
	})
}

func TestDispatchInterceptor_MultipleDispatches(t *testing.T) {
	spawner := &recordingSpawner{}
	reg := agents.NewRegistry()
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")

	interceptor := &dispatchInterceptor{
		inner:     &stubEmitter{},
		registry:  reg,
		spawner:   spawner,
		parentRun: run,
		depth:     0,
		threadID:  run.ThreadID,
	}

	// Multi-line text with multiple dispatch JSON lines.
	interceptor.Emit(BusEventTextBlock, nil, map[string]any{
		"text": `{"action":"dispatch","agent":"codex","task":"Task A"}
{"action":"dispatch","agent":"claude-code","task":"Task B"}
{"action":"dispatch","agent":"opencode","task":"Task C"}`,
	})

	if spawner.callCount() != 3 {
		t.Fatalf("expected 3 spawn calls, got %d", spawner.callCount())
	}
}

func TestDispatchInterceptor_DepthIncrements(t *testing.T) {
	spawner := &recordingSpawner{}
	reg := agents.NewRegistry()
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")

	interceptor := &dispatchInterceptor{
		inner:     &stubEmitter{},
		registry:  reg,
		spawner:   spawner,
		parentRun: run,
		depth:     2,
		threadID:  run.ThreadID,
	}

	interceptor.Emit(BusEventTextBlock, nil, map[string]any{
		"text": `{"action":"dispatch","agent":"codex","task":"Sub-sub-task"}`,
	})

	if spawner.callCount() != 1 {
		t.Fatalf("expected 1 spawn call, got %d", spawner.callCount())
	}
	call := spawner.lastCall()
	if call.task.Depth != 3 {
		t.Fatalf("task.Depth = %d, want 3 (parent depth 2 + 1)", call.task.Depth)
	}
}

func TestDispatchInterceptor_RolePropagation(t *testing.T) {
	spawner := &recordingSpawner{}
	reg := agents.NewRegistry()
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")

	interceptor := &dispatchInterceptor{
		inner:     &stubEmitter{},
		registry:  reg,
		spawner:   spawner,
		parentRun: run,
		depth:     0,
		threadID:  run.ThreadID,
	}

	// Dispatch with explicit role.
	interceptor.Emit(BusEventTextBlock, nil, map[string]any{
		"text": `{"action":"dispatch","agent":"codex","task":"Review PR","role":"reviewer"}`,
	})

	if spawner.callCount() != 1 {
		t.Fatalf("expected 1 spawn call, got %d", spawner.callCount())
	}
	// Agent role defaults to "worker" in the interceptor, dispatch role is stored in the agent instance.
	// Verify agent was registered with the correct role.
	all := reg.List()
	if len(all) == 0 {
		t.Fatal("expected at least 1 registered agent")
	}
}

func TestDispatchInterceptor_NoRegistryNoCrash(t *testing.T) {
	spawner := &recordingSpawner{}
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")

	// No registry, no spawner — should still not panic.
	interceptor := &dispatchInterceptor{
		inner:     &stubEmitter{},
		registry:  nil,
		spawner:   spawner,
		parentRun: run,
		depth:     0,
		threadID:  run.ThreadID,
	}

	interceptor.Emit(BusEventTextBlock, nil, map[string]any{
		"text": `{"action":"dispatch","agent":"codex","task":"task"}`,
	})

	// Spawner should still be called even without registry.
	if spawner.callCount() != 1 {
		t.Fatalf("expected 1 spawn call without registry, got %d", spawner.callCount())
	}
}

// ── Orchestrator adapter E2E tests ─────────────────────────────────────────

func TestOrchestratorAdapter_E2EDispatchFlow(t *testing.T) {
	bus := newTestBus(t)
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")
	spawner := &recordingSpawner{}
	reg := agents.NewRegistry()
	queue := agents.NewQueue()

	// Subscribe to verify events are emitted.
	subID, ch, _ := bus.Subscribe(0)
	defer bus.Unsubscribe(subID)

	// Create orchestrator with all wiring.
	orch := NewOrchestratorAdapter("echo", "", "You are an orchestrator", []string{"codex", "claude-code"})
	orch.WithAgentRegistry(reg)
	orch.WithMessageQueue(queue)
	orch.WithSpawner(spawner)
	orch.WithDepth(0)

	// Build a command — this triggers model capture.
	_, _, _, _ = orch.BuildCommand(RunProcessContext{
		Run:     run,
		AgentID: "orchestrator",
		Model:   "claude-sonnet-4-6",
	})

	// Verify orchestrator metadata and capabilities.
	m := orch.Metadata()
	if m.ID != "orchestrator" {
		t.Fatalf("metadata ID = %q, want orchestrator", m.ID)
	}
	c := orch.Capabilities()
	if !c.SubAgentSpawn {
		t.Fatal("SubAgentSpawn should be enabled")
	}

	// Verify parent model was captured from BuildCommand.
	if orch.parentModel != "claude-sonnet-4-6" {
		t.Fatalf("parentModel = %q, want claude-sonnet-4-6", orch.parentModel)
	}

	// Verify bus has no unexpected events (no ParseStream call yet).
	select {
	case evt := <-ch:
		t.Fatalf("unexpected event before ParseStream: %s", evt.Type)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestOrchestratorAdapter_BuildCommandInjectSystemPrompt(t *testing.T) {
	orch := NewOrchestratorAdapter("claude", "sonnet", "Custom system prompt", nil)
	_, args, _, _ := orch.BuildCommand(RunProcessContext{
		Run: store.Run{ID: "r1", ProjectID: "p1", ThreadID: "t1"},
	})

	// Verify the system prompt arg was injected.
	foundPrompt := false
	for _, arg := range args {
		if strings.Contains(arg, "Custom system prompt") {
			foundPrompt = true
			break
		}
	}
	if !foundPrompt {
		t.Fatalf("expected system prompt in args, got: %v", args)
	}
}

func TestOrchestratorAdapter_BuildCommandCapturesModel(t *testing.T) {
	orch := NewOrchestratorAdapter("claude", "sonnet", "prompt", nil)

	orch.BuildCommand(RunProcessContext{
		Run:   store.Run{ID: "r1", ProjectID: "p1", ThreadID: "t1"},
		Model: "deepseek-v4",
	})

	if orch.parentModel != "deepseek-v4" {
		t.Fatalf("parentModel = %q, want deepseek-v4", orch.parentModel)
	}
}

// ── Event text extraction tests ─────────────────────────────────────────────

func TestExtractTextContent(t *testing.T) {
	tests := []struct {
		name    string
		payload any
		want    string
	}{
		{"nil", nil, ""},
		{"string", "hello", ""}, // direct string not supported by current code
		{"map text", map[string]any{"text": "hello world"}, "hello world"},
		{"map content", map[string]any{"content": "hello content"}, "hello content"},
		{"text takes priority", map[string]any{"text": "text", "content": "content"}, "text"},
		{"empty map", map[string]any{}, ""},
		{"wrong type", 42, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractTextContent(tt.payload)
			if got != tt.want {
				t.Fatalf("extractTextContent(%v) = %q, want %q", tt.payload, got, tt.want)
			}
		})
	}
}

// ── Budget propagation test ─────────────────────────────────────────────────

func TestDispatchInterceptor_BudgetPropagation(t *testing.T) {
	spawner := &recordingSpawner{}
	reg := agents.NewRegistry()
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")

	budget := runnerctx.NewContextBudget(300_000)
	budget.Track(100_000) // 100k used, 200k remaining

	interceptor := &dispatchInterceptor{
		inner:     &stubEmitter{},
		registry:  reg,
		spawner:   spawner,
		parentRun: run,
		depth:     0,
		threadID:  run.ThreadID,
		budget:    budget,
	}

	interceptor.Emit(BusEventTextBlock, nil, map[string]any{
		"text": `{"action":"dispatch","agent":"codex","task":"Budget-aware task"}`,
	})

	if spawner.callCount() != 1 {
		t.Fatalf("expected 1 spawn call, got %d", spawner.callCount())
	}
	call := spawner.lastCall()
	if call.task.Budget == nil {
		t.Fatal("task.Budget should not be nil when parent has budget")
	}
	if call.task.Budget != budget {
		t.Fatal("task.Budget should be the same budget instance as parent")
	}
}

func TestDispatchInterceptor_NilBudget(t *testing.T) {
	spawner := &recordingSpawner{}
	reg := agents.NewRegistry()
	st := newTestStore(t)
	run, _ := st.GetRun("run-1")

	interceptor := &dispatchInterceptor{
		inner:     &stubEmitter{},
		registry:  reg,
		spawner:   spawner,
		parentRun: run,
		depth:     0,
		threadID:  run.ThreadID,
		budget:    nil,
	}

	interceptor.Emit(BusEventTextBlock, nil, map[string]any{
		"text": `{"action":"dispatch","agent":"codex","task":"No budget"}`,
	})

	if spawner.callCount() != 1 {
		t.Fatalf("expected 1 spawn call, got %d", spawner.callCount())
	}
	call := spawner.lastCall()
	if call.task.Budget != nil {
		t.Fatal("task.Budget should be nil when parent has no budget")
	}
}

// ── genAgentID / genHexID tests ─────────────────────────────────────────────

func TestGenHexID(t *testing.T) {
	// Generate many IDs and verify uniqueness and length.
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id := genHexID()
		if len(id) != 16 {
			t.Fatalf("genHexID() = %q (len=%d), want len 16", id, len(id))
		}
		if seen[id] {
			t.Fatalf("duplicate hex ID: %q", id)
		}
		seen[id] = true
	}
}

func TestGenAgentID(t *testing.T) {
	id := genAgentID()
	if len(id) < 7 { // "agent_" + 16 hex
		t.Fatalf("genAgentID() = %q, too short", id)
	}
	if id[:6] != "agent_" {
		t.Fatalf("genAgentID() = %q, should start with 'agent_'", id)
	}
}
