package lifecycle

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/store"
)

// hubTestRunSeq makes hub-callback test runIDs unique per go test -count=N
// invocation. hubCallbackQueues/hubStreamChunkSeq are package-scoped maps
// keyed by runID whose entries only drain after a terminal job; the emitter
// and backpressure tests below never send one, so a reused literal runID
// would pick up the stale queue (and the consumer goroutine bound to the
// previous iteration's executor) left by the previous iteration (#2038).
var hubTestRunSeq atomic.Int64

// uniqueHubTestRunID derives a per-invocation runID from base.
func uniqueHubTestRunID(base string) string {
	return fmt.Sprintf("%s-%d", base, hubTestRunSeq.Add(1))
}

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
	mu          sync.Mutex
	hold        chan struct{}
	entered     chan struct{}
	streams     int
	streamOrder []string
	acks        int
	dones       int
	fails       int
	inFlight    int
	maxFlight   int
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

func (c *blockingHubCallback) TaskStream(_ context.Context, _ string, _ string, _ string, content string) error {
	c.track()
	defer c.untrack()
	select {
	case c.entered <- struct{}{}:
	default:
	}
	<-c.hold
	c.mu.Lock()
	c.streams++
	c.streamOrder = append(c.streamOrder, content)
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
// fireHubStream returns immediately instead of blocking the lifecycle path.
// With the per-run ordered queue (#1409), chunks queue up and deliver in
// emission order once pressure clears; recordHubOutput remains independent of
// stream send success.
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

	runID := uniqueHubTestRunID("run-stream-backpressure")
	const taskID = "task-stream-backpressure"
	executor.mu.Lock()
	executor.hubTasks[runID] = taskID
	executor.hubOutputs[runID] = newHubOutputCollector(hubCallbackFinalMaxBytes)
	executor.mu.Unlock()

	// Queue streams while the first delivery blocks on the hold channel.
	executor.fireHubStream(runID, "held-stream-1")
	executor.fireHubStream(runID, "held-stream-2")

	// Wait until the first queued delivery has entered TaskStream.
	deadline := time.After(2 * time.Second)
	select {
	case <-cb.entered:
	case <-deadline:
		t.Fatal("timed out waiting for the first held stream callback to enter")
	}

	// Saturated delivery: further stream fire must not block the caller —
	// chunks queue behind the held ones instead.
	done := make(chan struct{})
	go func() {
		executor.fireHubStream(runID, "queued-under-pressure")
		close(done)
	}()
	select {
	case <-done:
		// non-blocking path succeeded
	case <-time.After(500 * time.Millisecond):
		t.Fatal("fireHubStream blocked on full callbackSem; expected non-blocking queue")
	}

	// FinalContent collection is independent of stream send success (#987).
	executor.recordHubOutput(runID, "kept-final")
	if got := executor.hubFinalContent(runID); got != "kept-final" {
		t.Fatalf("hubFinalContent = %q, want kept-final (independent of stream drop)", got)
	}

	cb.releaseAll()

	// All three chunks must deliver in emission order (#1409).
	deadline = time.After(2 * time.Second)
	for {
		cb.mu.Lock()
		got := append([]string(nil), cb.streamOrder...)
		cb.mu.Unlock()
		if len(got) == 3 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for queued streams: got %v", got)
		case <-time.After(20 * time.Millisecond):
		}
	}
	cb.mu.Lock()
	got := append([]string(nil), cb.streamOrder...)
	cb.mu.Unlock()
	want := []string{"held-stream-1", "held-stream-2", "queued-under-pressure"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("streams = %v, want ordered %v", got, want)
		}
	}
}

// TestFireHubTerminalBoundedBySem proves #1020: terminal ack/done/fail callbacks
// share callbackSem so concurrent Hub HTTP stays bounded. Each done/fail fires
// on its own run (a run has exactly one terminal callback in reality, and the
// per-run queue closes on the first one), while acks stay run-agnostic.
func TestFireHubTerminalBoundedBySem(t *testing.T) {
	t.Parallel()

	bus := events.NewBus(10)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "success")

	const semCap = 2
	executor.callbackSem = make(chan struct{}, semCap)

	cb := newBlockingHubCallback(semCap)
	executor.WithHubCallback(cb)

	bindRun := func(runID string) {
		executor.mu.Lock()
		executor.hubTasks[runID] = "task-" + runID
		executor.hubOutputs[runID] = newHubOutputCollector(hubCallbackFinalMaxBytes)
		executor.mu.Unlock()
	}

	// Launch more terminal callbacks than the semaphore capacity.
	const launches = 6
	runCounter := 0
	nextRun := func() string {
		runID := "run-terminal-" + strconv.Itoa(runCounter)
		runCounter++
		bindRun(runID)
		return runID
	}
	for i := 0; i < launches; i++ {
		switch i % 3 {
		case 0:
			executor.fireHubAck(nextRun())
		case 1:
			executor.fireHubDone(nextRun(), nil)
		default:
			executor.fireHubFail(nextRun(), "boom")
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
