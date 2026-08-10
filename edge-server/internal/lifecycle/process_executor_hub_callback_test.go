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

func (c *recordingHubCallback) TaskStream(_ context.Context, _ string, _ string, _ string, content string) error {
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

// blockingHubCallback holds every TaskStream until released, so tests can fill
// callbackSem and prove stream paths do not block the caller.
type blockingHubCallback struct {
	mu        sync.Mutex
	hold      chan struct{}
	entered   chan struct{}
	streams   int
	acks      int
	dones     int
	fails     int
	inFlight  int
	maxFlight int
}

func newBlockingHubCallback(capacity int) *blockingHubCallback {
	return &blockingHubCallback{
		hold:    make(chan struct{}),
		entered: make(chan struct{}, capacity*4),
	}
}

func (c *blockingHubCallback) TaskAck(context.Context, string, string) error {
	c.track()
	defer c.untrack()
	<-c.hold
	c.mu.Lock()
	c.acks++
	c.mu.Unlock()
	return nil
}

func (c *blockingHubCallback) TaskStream(context.Context, string, string, string, string) error {
	c.track()
	defer c.untrack()
	select {
	case c.entered <- struct{}{}:
	default:
	}
	<-c.hold
	c.mu.Lock()
	c.streams++
	c.mu.Unlock()
	return nil
}

func (c *blockingHubCallback) TaskDone(context.Context, string, hub.TaskResult) error {
	c.track()
	defer c.untrack()
	<-c.hold
	c.mu.Lock()
	c.dones++
	c.mu.Unlock()
	return nil
}

func (c *blockingHubCallback) TaskFail(context.Context, string, string, string) error {
	c.track()
	defer c.untrack()
	<-c.hold
	c.mu.Lock()
	c.fails++
	c.mu.Unlock()
	return nil
}

func (c *blockingHubCallback) track() {
	c.mu.Lock()
	c.inFlight++
	if c.inFlight > c.maxFlight {
		c.maxFlight = c.inFlight
	}
	c.mu.Unlock()
}

func (c *blockingHubCallback) untrack() {
	c.mu.Lock()
	c.inFlight--
	c.mu.Unlock()
}

func (c *blockingHubCallback) releaseAll() {
	close(c.hold)
}

// TestFireHubStreamNonBlockingWhenSemFull proves #1020: when callbackSem is full,
// fireHubStream returns immediately (drops) instead of blocking the lifecycle path.
// recordHubOutput remains independent of stream send success.
func TestFireHubStreamNonBlockingWhenSemFull(t *testing.T) {
	t.Parallel()

	bus := events.NewBus(10)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "success")

	// Tiny semaphore so we can fill it deterministically.
	const semCap = 2
	executor.callbackSem = make(chan struct{}, semCap)

	cb := newBlockingHubCallback(semCap)
	executor.WithHubCallback(cb)

	const runID = "run-stream-backpressure"
	const taskID = "task-stream-backpressure"
	executor.mu.Lock()
	executor.hubTasks[runID] = taskID
	executor.hubOutputs[runID] = newHubOutputCollector(hubCallbackFinalMaxBytes)
	executor.mu.Unlock()

	// Fill the semaphore with slow streams.
	for i := 0; i < semCap; i++ {
		executor.fireHubStream(runID, "held-stream")
	}

	// Wait until both held callbacks have entered TaskStream.
	deadline := time.After(2 * time.Second)
	for i := 0; i < semCap; i++ {
		select {
		case <-cb.entered:
		case <-deadline:
			t.Fatal("timed out waiting for held stream callbacks to enter")
		}
	}

	// Saturated sem: further stream fire must not block the caller.
	done := make(chan struct{})
	go func() {
		executor.fireHubStream(runID, "dropped-under-pressure")
		close(done)
	}()
	select {
	case <-done:
		// non-blocking path succeeded
	case <-time.After(500 * time.Millisecond):
		t.Fatal("fireHubStream blocked on full callbackSem; expected non-blocking drop")
	}

	// FinalContent collection is independent of stream send success (#987).
	executor.recordHubOutput(runID, "kept-final")
	if got := executor.hubFinalContent(runID); got != "kept-final" {
		t.Fatalf("hubFinalContent = %q, want kept-final (independent of stream drop)", got)
	}

	cb.releaseAll()
}

// TestFireHubTerminalBoundedBySem proves #1020: terminal ack/done/fail callbacks
// share callbackSem so concurrent Hub HTTP stays bounded.
func TestFireHubTerminalBoundedBySem(t *testing.T) {
	t.Parallel()

	bus := events.NewBus(10)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "success")

	const semCap = 2
	executor.callbackSem = make(chan struct{}, semCap)

	cb := newBlockingHubCallback(semCap)
	executor.WithHubCallback(cb)

	const runID = "run-terminal-bound"
	const taskID = "task-terminal-bound"
	executor.mu.Lock()
	executor.hubTasks[runID] = taskID
	executor.hubOutputs[runID] = newHubOutputCollector(hubCallbackFinalMaxBytes)
	executor.mu.Unlock()

	// Launch more terminal callbacks than the semaphore capacity.
	const launches = 6
	for i := 0; i < launches; i++ {
		switch i % 3 {
		case 0:
			executor.fireHubAck(runID)
		case 1:
			executor.fireHubDone(runID, nil)
		default:
			executor.fireHubFail(runID, "boom")
		}
	}

	// Give goroutines time to contend on the semaphore.
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		cb.mu.Lock()
		maxFlight := cb.maxFlight
		cb.mu.Unlock()
		if maxFlight > semCap {
			t.Fatalf("max concurrent terminal callbacks = %d, want <= %d", maxFlight, semCap)
		}
		time.Sleep(10 * time.Millisecond)
	}

	cb.mu.Lock()
	maxFlight := cb.maxFlight
	cb.mu.Unlock()
	if maxFlight == 0 {
		t.Fatal("expected at least one terminal callback to enter")
	}
	if maxFlight > semCap {
		t.Fatalf("max concurrent terminal callbacks = %d, want <= %d", maxFlight, semCap)
	}

	cb.releaseAll()

	// Wait for all terminal callbacks to finish after release.
	waitDeadline := time.After(2 * time.Second)
	for {
		cb.mu.Lock()
		total := cb.acks + cb.dones + cb.fails
		inFlight := cb.inFlight
		cb.mu.Unlock()
		if total == launches && inFlight == 0 {
			break
		}
		select {
		case <-waitDeadline:
			t.Fatalf("timed out waiting for terminal callbacks: total=%d inFlight=%d want total=%d", total, inFlight, launches)
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func TestTryAcquireHubCallbackSlot(t *testing.T) {
	t.Parallel()

	bus := events.NewBus(10)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "success")
	executor.callbackSem = make(chan struct{}, 1)

	if !executor.tryAcquireHubCallbackSlot() {
		t.Fatal("first tryAcquire should succeed")
	}
	if executor.tryAcquireHubCallbackSlot() {
		t.Fatal("second tryAcquire should fail when sem full")
	}
	executor.releaseHubCallbackSlot()
	if !executor.tryAcquireHubCallbackSlot() {
		t.Fatal("tryAcquire should succeed after release")
	}
	executor.releaseHubCallbackSlot()
}
