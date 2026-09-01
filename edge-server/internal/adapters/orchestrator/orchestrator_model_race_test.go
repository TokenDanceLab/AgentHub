package orchestrator

import (
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"

	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/store"
)

// dispatchingExecutor is an AgentExecutor whose ParseStream emits one dispatch
// JSON text block so the orchestrator interceptor spawns a sub-agent task.
// Tests use it to observe which model each run's interceptor resolves for its
// sub-agent dispatch.
type dispatchingExecutor struct{}

func (d *dispatchingExecutor) Metadata() AdapterMetadata {
	return AdapterMetadata{ID: "dispatching-executor", Name: "Dispatching Executor"}
}

func (d *dispatchingExecutor) Capabilities() AgentCapabilities { return AgentCapabilities{} }

func (d *dispatchingExecutor) BuildCommand(RunProcessContext) (string, []string, []string, string) {
	return "fake", nil, nil, ""
}

func (d *dispatchingExecutor) ParseStream(_ context.Context, _ io.Reader, _ io.Writer, emitter EventEmitter, run store.Run) error {
	emitter.Emit(BusEventTextBlock, nil, map[string]any{
		"text": `{"action":"dispatch","agent":"codex","task":"task for ` + run.ID + `","role":"worker"}`,
	})
	return nil
}

func (d *dispatchingExecutor) NeedsStdin() bool { return false }
func (d *dispatchingExecutor) Available() bool  { return true }

// TestAdapter_ConcurrentRunsModelIsolation verifies that concurrent runs
// sharing one orchestrator Adapter each pass their own model to the
// sub-agents they spawn, never a sibling run's model.
//
// Background: the Adapter previously held a mutable parentModel field written
// by BuildCommand and read by ParseStream. Edge keeps a single orchestrator
// Adapter per agent while running up to MaxConcurrentRuns runs concurrently,
// so two runs with different models raced on the field and sub-agents could
// inherit the wrong parent model. This test must pass under `go test -race`.
func TestAdapter_ConcurrentRunsModelIsolation(t *testing.T) {
	orch := NewOrchestratorAdapter(&dispatchingExecutor{}, "You are an orchestrator")
	spawner := &recordingSpawner{}
	orch.WithAgentRegistry(agents.NewRegistry())
	orch.WithMessageQueue(agents.NewQueue())
	orch.WithSpawner(spawner)

	const runCount = 16
	wantModel := make(map[string]string, runCount)
	var wg sync.WaitGroup
	start := make(chan struct{})

	for i := 0; i < runCount; i++ {
		run := store.Run{ID: fmt.Sprintf("run-%02d", i), ProjectID: "p1", ThreadID: "t1"}
		model := fmt.Sprintf("model-%02d", i)
		wantModel[run.ID] = model

		wg.Add(1)
		go func(run store.Run, model string) {
			defer wg.Done()
			<-start
			rctx := RunProcessContext{Run: run, AgentID: "orchestrator", Model: model}
			orch.BuildCommand(rctx)
			ctx := context.WithValue(context.Background(), CtxModelKey, model)
			if err := orch.ParseStream(ctx, strings.NewReader(""), io.Discard, &stubEmitter{}, run); err != nil {
				t.Error("ParseStream:", err)
			}
		}(run, model)
	}
	close(start)
	wg.Wait()

	if got := spawner.callCount(); got != runCount {
		t.Fatalf("spawn calls = %d, want %d", got, runCount)
	}
	spawner.mu.Lock()
	defer spawner.mu.Unlock()
	for _, call := range spawner.calls {
		want := wantModel[call.parentRunID]
		if call.task.Model != want {
			t.Errorf("run %s spawned sub-agent with model %q, want %q (cross-run model bleed)",
				call.parentRunID, call.task.Model, want)
		}
	}
}
