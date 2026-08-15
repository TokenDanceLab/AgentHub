package orchestrator

import (
	"context"
	"io"
	"sync"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

// ── Leaf-local test doubles ─────────────────────────────────────────────────
//
// The leaf package must not import the root internal/adapters implementation
// package, so the tests that moved here use local doubles instead of the
// root package's helpers (stubAdapter, NewBusEventEmitter, NewRegistry).

// stubEmitter is a no-op EventEmitter for tests that don't assert emissions.
type stubEmitter struct{}

func (s *stubEmitter) Emit(eventType string, scope map[string]any, payload any) {}

// busEmitter adapts events.Bus to the EventEmitter interface, mirroring the
// root package's BusEventEmitter for tests that need real event capture.
type busEmitter struct {
	bus *events.Bus
}

func (e *busEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.bus.Publish(eventType, scope, payload)
}

// fakeAgentExecutor implements AgentExecutor for tests that exercise the
// orchestrator's BuildCommand/Metadata/Capabilities paths without spawning
// a real CLI process.
type fakeAgentExecutor struct {
	metadata  AdapterMetadata
	available bool
}

func (f *fakeAgentExecutor) Metadata() AdapterMetadata {
	if f.metadata.ID == "" {
		return AdapterMetadata{ID: "fake-executor", Name: "Fake Executor"}
	}
	return f.metadata
}
func (f *fakeAgentExecutor) Capabilities() AgentCapabilities {
	// Mirror the real ClaudeCodeAdapter capabilities the orchestrator's own
	// Capabilities() delegates to (Streaming etc.), so delegation tests keep
	// their meaning.
	return AgentCapabilities{
		Streaming:       true,
		ToolCalls:       true,
		FileChanges:     true,
		PermissionHooks: true,
		ThinkingVisible: true,
		MultiTurn:       true,
		MCPIntegration:  true,
	}
}
func (f *fakeAgentExecutor) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	return "fake", nil, nil, ""
}
func (f *fakeAgentExecutor) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	return nil
}
func (f *fakeAgentExecutor) NeedsStdin() bool { return false }
func (f *fakeAgentExecutor) Available() bool  { return f.available }

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
