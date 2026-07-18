package lifecycle

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/store"
)

// recordingHubCallback captures Edge→Hub callbacks for regression assertions.
type recordingHubCallback struct {
	mu       sync.Mutex
	acks     []string
	streams  []string
	dones    []hub.TaskResult
	fails    []string
	doneSeen chan struct{}
}

func newRecordingHubCallback() *recordingHubCallback {
	return &recordingHubCallback{doneSeen: make(chan struct{})}
}

func (c *recordingHubCallback) TaskAck(_ context.Context, taskID string, runID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.acks = append(c.acks, taskID+":"+runID)
	return nil
}

func (c *recordingHubCallback) TaskStream(_ context.Context, _ string, _ string, content string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.streams = append(c.streams, content)
	return nil
}

func (c *recordingHubCallback) TaskDone(_ context.Context, _ string, result hub.TaskResult) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.dones = append(c.dones, result)
	select {
	case <-c.doneSeen:
	default:
		close(c.doneSeen)
	}
	return nil
}

func (c *recordingHubCallback) TaskFail(_ context.Context, taskID string, runID string, reason string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.fails = append(c.fails, taskID+":"+runID+":"+reason)
	return nil
}

// TestHubOutputsAllocatedForHubTask verifies #987: when a Hub task is bound,
// ProcessExecutor allocates hubOutputs so stream text reaches TaskDone.FinalContent
// instead of the "Run finished" fallback.
func TestHubOutputsAllocatedForHubTask(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	executor := newTestProcessExecutor(t, bus, s, "success")
	cb := newRecordingHubCallback()
	executor.WithHubCallback(cb)

	if err := executor.Start(run, RunProcessContext{HubTaskID: "task-hub-final"}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	// Drain lifecycle events until finished so stdout has been recorded.
	_ = collectEventsUntilRunDone(t, ch)

	select {
	case <-cb.doneSeen:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for TaskDone callback")
	}

	cb.mu.Lock()
	defer cb.mu.Unlock()
	if len(cb.dones) == 0 {
		t.Fatal("expected TaskDone callback, got none")
	}
	final := cb.dones[0].FinalContent
	if final == "" {
		t.Fatal("FinalContent is empty")
	}
	if final == "Run finished" {
		t.Fatalf("FinalContent = %q, want collected stream content (not fallback)", final)
	}
	if !strings.Contains(final, "stdout chunk") && !strings.Contains(final, "run="+run.ID) {
		t.Fatalf("FinalContent = %q, want stream text from helper stdout", final)
	}
	if cb.dones[0].RunID != run.ID {
		t.Fatalf("TaskDone RunID = %q, want %q", cb.dones[0].RunID, run.ID)
	}
}

// TestRecordHubOutputNoOpWithoutCollector keeps non-hub runs unchanged: without a
// bound Hub task, recordHubOutput remains a no-op and hubFinalContent is empty.
func TestRecordHubOutputNoOpWithoutCollector(t *testing.T) {
	bus := events.NewBus(10)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "success")

	executor.recordHubOutput("run-no-hub", "should-not-be-kept")
	if got := executor.hubFinalContent("run-no-hub"); got != "" {
		t.Fatalf("hubFinalContent without collector = %q, want empty", got)
	}
}

// TestHubOutputCollectorAllocatedOnBind exercises the bind path used by run():
// hubOutputs is allocated under the same lock as hubTasks, then stream appends
// produce non-empty Final content.
func TestHubOutputCollectorAllocatedOnBind(t *testing.T) {
	bus := events.NewBus(10)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "success")

	const runID = "run-bind-collector"
	const taskID = "task-bind"

	// Mirror the allocation path in ProcessExecutor.run when HubTaskID is set.
	if !shouldRecordHubTask(taskID) {
		t.Fatal("shouldRecordHubTask(taskID) = false, want true")
	}
	executor.mu.Lock()
	executor.hubTasks[runID] = taskID
	executor.hubOutputs[runID] = newHubOutputCollector(hubCallbackFinalMaxBytes)
	executor.mu.Unlock()

	executor.recordHubOutput(runID, "hello from stream")
	executor.recordHubOutput(runID, " more text")

	got := executor.hubFinalContent(runID)
	if got != "hello from stream more text" {
		t.Fatalf("hubFinalContent = %q, want collected stream text", got)
	}

	// finish must clean both maps (already present — assert no leak).
	executor.finish(runID)
	executor.mu.Lock()
	_, taskPresent := executor.hubTasks[runID]
	_, outPresent := executor.hubOutputs[runID]
	executor.mu.Unlock()
	if taskPresent || outPresent {
		t.Fatalf("after finish: hubTasks present=%v hubOutputs present=%v, want both cleaned", taskPresent, outPresent)
	}
}
