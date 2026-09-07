package lifecycle

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/store"
	"github.com/agenthub/pkg/testkit"
)

type typedCallbackEvent struct {
	taskID      string
	runID       string
	clientMsgID string
	eventType   string
	payload     json.RawMessage
}

type typedHubCallback struct {
	mu       sync.Mutex
	order    []string
	events   []typedCallbackEvent
	streams  []string
	acks     []string
	dones    []hub.TaskResult
	fails    []string
	doneSeen chan struct{}
}

func newTypedHubCallback() *typedHubCallback {
	return &typedHubCallback{doneSeen: make(chan struct{})}
}

func (c *typedHubCallback) TaskAck(_ context.Context, taskID, runID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.acks = append(c.acks, taskID+":"+runID)
	return nil
}

func (c *typedHubCallback) TaskStream(_ context.Context, _, _, _, content string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.order = append(c.order, "stream")
	c.streams = append(c.streams, content)
	return nil
}

func (c *typedHubCallback) TaskStreamEvent(_ context.Context, taskID, runID, clientMsgID, eventType string, payload json.RawMessage) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.order = append(c.order, "typed:"+eventType)
	c.events = append(c.events, typedCallbackEvent{
		taskID:      taskID,
		runID:       runID,
		clientMsgID: clientMsgID,
		eventType:   eventType,
		payload:     payload,
	})
	return nil
}

func (c *typedHubCallback) TaskDone(_ context.Context, _ string, result hub.TaskResult) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.order = append(c.order, "done")
	c.dones = append(c.dones, result)
	select {
	case <-c.doneSeen:
	default:
		close(c.doneSeen)
	}
	return nil
}

func (c *typedHubCallback) TaskFail(_ context.Context, taskID, runID, reason string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.order = append(c.order, "fail")
	c.fails = append(c.fails, taskID+":"+runID+":"+reason)
	return nil
}

func bindTypedHubRun(executor *ProcessExecutor, runID string) {
	executor.mu.Lock()
	defer executor.mu.Unlock()
	executor.hubTasks[runID] = "task-" + runID
	executor.hubOutputs[runID] = newHubOutputCollector(hubCallbackFinalMaxBytes)
}

func newTypedTestEmitter(t *testing.T) (*ProcessExecutor, *typedHubCallback, *hubCallbackEmitter, string) {
	t.Helper()
	bus := events.NewBus(100)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "success")
	cb := newTypedHubCallback()
	executor.WithHubCallback(cb)
	runID := uniqueHubTestRunID("typed-test")
	bindTypedHubRun(executor, runID)
	emitter := newHubCallbackEmitter(executor, runID, adapters.NewBusEventEmitter(bus))
	typed, ok := emitter.(*hubCallbackEmitter)
	if !ok {
		t.Fatal("newHubCallbackEmitter did not produce a *hubCallbackEmitter")
	}
	return executor, cb, typed, runID
}

func waitForTypedCallbackDone(t *testing.T, cb *typedHubCallback, wantEvents, wantDones int) {
	t.Helper()
	testkit.Eventually(t, 3*time.Second, func() bool {
		cb.mu.Lock()
		defer cb.mu.Unlock()
		return len(cb.events) >= wantEvents && len(cb.dones) >= wantDones
	}, fmt.Sprintf("typed events=%d dones=%d want events=%d dones=%d", wantEvents, wantDones, wantEvents, wantDones), func() string {
		cb.mu.Lock()
		defer cb.mu.Unlock()
		return fmt.Sprintf("events=%d dones=%d", len(cb.events), len(cb.dones))
	})
}

func TestHubCallbackEmitterForwardsTypedEventsInOrderAndBeforeDone(t *testing.T) {
	executor, cb, emitter, runID := newTypedTestEmitter(t)
	cases := []struct {
		typ     string
		payload map[string]any
	}{
		{adapters.BusEventThinking, map[string]any{"content": "reasoning"}},
		{adapters.BusEventToolCall, map[string]any{"callId": "call-1", "toolName": "Bash"}},
		{adapters.BusEventToolResult, map[string]any{"callId": "call-1", "result": "ok"}},
		{adapters.BusEventFileChange, map[string]any{"path": "src/a.go", "action": "modified"}},
		{adapters.BusEventPermissionRequested, map[string]any{
			"requestId": "req-1", "toolName": "Bash", "input": map[string]any{"apiKey": "placeholder"},
		}},
		{adapters.BusEventPermissionDecided, map[string]any{"requestId": "req-1", "decision": "allow"}},
		{adapters.BusEventRouteDecision, map[string]any{"action": "continue"}},
		{adapters.BusEventResult, map[string]any{"success": true, "content": "final answer"}},
	}

	for _, tc := range cases {
		emitter.Emit(tc.typ, map[string]any{}, tc.payload)
	}
	executor.fireHubDone(runID, nil)
	waitForTypedCallbackDone(t, cb, len(cases), 1)

	cb.mu.Lock()
	defer cb.mu.Unlock()
	if len(cb.events) != len(cases) {
		t.Fatalf("typed events = %d, want %d: %#v", len(cb.events), len(cases), cb.events)
	}
	wantOrder := make([]string, 0, len(cases)+1)
	for i, tc := range cases {
		if cb.events[i].eventType != tc.typ {
			t.Fatalf("event[%d] type = %q, want %q", i, cb.events[i].eventType, tc.typ)
		}
		if cb.events[i].runID != runID || cb.events[i].taskID != "task-"+runID {
			t.Fatalf("event[%d] run/task = %q/%q", i, cb.events[i].runID, cb.events[i].taskID)
		}
		wantID := hubStreamClientMsgID(runID, int64(i+1))
		if cb.events[i].clientMsgID != wantID {
			t.Fatalf("event[%d] clientMsgID = %q, want %q", i, cb.events[i].clientMsgID, wantID)
		}

		wantOrder = append(wantOrder, "typed:"+tc.typ)
	}
	wantOrder = append(wantOrder, "done")
	if len(cb.order) != len(wantOrder) {
		t.Fatalf("order = %v, want %v", cb.order, wantOrder)
	}
	for i := range wantOrder {
		if cb.order[i] != wantOrder[i] {
			t.Fatalf("order[%d] = %q, want %q (full order=%v)", i, cb.order[i], wantOrder[i], cb.order)
		}
	}
}

func TestHubCallbackEmitterKeepsTextWithoutTypedDoubleForward(t *testing.T) {
	executor, cb, emitter, runID := newTypedTestEmitter(t)
	emitter.Emit(adapters.BusEventTextDelta, map[string]any{}, map[string]any{"content": "hello"})
	emitter.FlushHubStream()
	emitter.Emit(adapters.BusEventThinking, map[string]any{}, map[string]any{"content": "reasoning"})
	executor.fireHubDone(runID, nil)

	waitForTypedCallbackDone(t, cb, 1, 1)
	cb.mu.Lock()
	defer cb.mu.Unlock()
	if len(cb.streams) != 1 || cb.streams[0] != "hello" {
		t.Fatalf("streams = %v, want [hello]", cb.streams)
	}
	if len(cb.events) != 1 || cb.events[0].eventType != adapters.BusEventThinking {
		t.Fatalf("typed events = %#v, want only thinking (text must not be double-forwarded)", cb.events)
	}
}

func TestHubCallbackEmitterLegacyReporterStillStreamsText(t *testing.T) {
	emitter, cb, runID := newCoalesceTestEmitter(t, "typed-legacy-reporter")
	emitter.Emit(adapters.BusEventThinking, map[string]any{}, map[string]any{"content": "reasoning"})
	emitter.Emit(adapters.BusEventTextDelta, map[string]any{}, map[string]any{"content": "hello"})
	emitter.FlushHubStream()
	emitter.executor.fireHubDone(runID, nil)

	waitForStreams(t, cb, 1)
	select {
	case <-cb.doneSeen:
	case <-time.After(3 * time.Second):
		t.Fatal("legacy reporter did not receive TaskDone")
	}
	cb.mu.Lock()
	defer cb.mu.Unlock()
	if len(cb.streams) != 1 || cb.streams[0] != "hello" {
		t.Fatalf("streams = %v, want [hello]", cb.streams)
	}
}

func TestHubCallbackEmitterTypedSkipsWithoutHubBinding(t *testing.T) {
	bus := events.NewBus(10)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "success")
	cb := newTypedHubCallback()
	executor.WithHubCallback(cb)
	runID := uniqueHubTestRunID("typed-no-binding")
	emitter := newHubCallbackEmitter(executor, runID, adapters.NewBusEventEmitter(bus))
	emitter.Emit(adapters.BusEventPermissionRequested, map[string]any{}, map[string]any{"requestId": "req-1"})
	emitter.Emit(adapters.BusEventTextDelta, map[string]any{}, map[string]any{"content": "hello"})
	flusher, ok := emitter.(hubStreamFlusher)
	if !ok {
		t.Fatal("hubCallbackEmitter does not implement hubStreamFlusher")
	}
	flusher.FlushHubStream()
	executor.fireHubDone(runID, nil)
	time.Sleep(100 * time.Millisecond)

	cb.mu.Lock()
	defer cb.mu.Unlock()
	if len(cb.events) != 0 {
		t.Fatalf("typed callbacks = %d, want 0 for a run without a Hub task binding", len(cb.events))
	}
	if len(cb.streams) != 0 {
		t.Fatalf("stream callbacks = %d, want 0 for a run without a Hub task binding", len(cb.streams))
	}
}

type typedBlockingHubCallback struct {
	*blockingHubCallback
	typedMu     sync.Mutex
	order       []string
	typedEvents []typedCallbackEvent
}

func newTypedBlockingHubCallback(capacity int) *typedBlockingHubCallback {
	return &typedBlockingHubCallback{blockingHubCallback: newBlockingHubCallback(capacity)}
}

func (c *typedBlockingHubCallback) TaskStreamEvent(_ context.Context, _ string, runID, clientMsgID, eventType string, payload json.RawMessage) error {
	c.track()
	defer c.untrack()
	select {
	case c.entered <- struct{}{}:
	default:
	}
	<-c.hold
	c.typedMu.Lock()
	c.order = append(c.order, "typed:"+eventType)
	c.typedEvents = append(c.typedEvents, typedCallbackEvent{
		runID:       runID,
		clientMsgID: clientMsgID,
		eventType:   eventType,
		payload:     payload,
	})
	c.typedMu.Unlock()
	return nil
}

func (c *typedBlockingHubCallback) TaskDone(ctx context.Context, taskID string, result hub.TaskResult) error {
	if err := c.blockingHubCallback.TaskDone(ctx, taskID, result); err != nil {
		return err
	}
	c.typedMu.Lock()
	c.order = append(c.order, "done")
	c.typedMu.Unlock()
	return nil
}

func TestHubCallbackQueueTypedApprovalBackpressuresThenDeliversBeforeDone(t *testing.T) {
	bus := events.NewBus(10)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "success")
	executor.callbackSem = make(chan struct{}, 1)
	cb := newTypedBlockingHubCallback(1)
	executor.WithHubCallback(cb)
	runID := uniqueHubTestRunID("typed-backpressure")
	bindTypedHubRun(executor, runID)

	state := loadOrInitHubCallbackQueue(runID)
	for i := 0; i < hubCallbackQueueCapacity; i++ {
		state.ch <- hubCallbackJob{
			kind:      hubJobStreamEvent,
			taskID:    "task-" + runID,
			runID:     runID,
			eventType: adapters.BusEventToolCall,
			payload:   json.RawMessage(`{"callId":"pre-approval"}`),
		}
	}
	executor.startHubCallbackQueue(state)
	select {
	case <-cb.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for first blocked typed callback")
	}
	// One typed delivery is in flight; fill the 128-slot channel completely so
	// the approval below must wait for a slot before it can be enqueued.
	state.ch <- hubCallbackJob{
		kind:      hubJobStreamEvent,
		taskID:    "task-" + runID,
		runID:     runID,
		eventType: adapters.BusEventToolResult,
		payload:   json.RawMessage(`{"callId":"pre-approval-2"}`),
	}

	entryDone := make(chan bool, 1)
	released := false
	defer func() {
		if !released {
			cb.releaseAll()
		}
	}()
	go func() {
		entryDone <- executor.enqueueHubTypedEventJob(runID, hubCallbackJob{
			kind:      hubJobStreamEvent,
			taskID:    "task-" + runID,
			runID:     runID,
			eventType: adapters.BusEventPermissionRequested,
			payload:   json.RawMessage(`{"requestId":"approval-1","toolName":"Bash"}`),
		})
	}()

	select {
	case ok := <-entryDone:
		t.Fatalf("approval typed event enqueue returned early: ok=%v", ok)
	case <-time.After(100 * time.Millisecond):
	}
	cb.releaseAll()
	released = true
	select {
	case ok := <-entryDone:
		if !ok {
			t.Fatal("approval typed event enqueue failed after queue made progress")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for approval typed event to enter the queue")
	}

	executor.fireHubDone(runID, nil)
	testkit.Eventually(t, 5*time.Second, func() bool {
		cb.typedMu.Lock()
		defer cb.typedMu.Unlock()
		if len(cb.order) < hubCallbackQueueCapacity+2 || cb.order[len(cb.order)-1] != "done" {
			return false
		}
		approvalBeforeDone := false
		for _, entry := range cb.order {
			if entry == "typed:"+adapters.BusEventPermissionRequested {
				approvalBeforeDone = true
			}
			if entry == "done" && !approvalBeforeDone {
				return false
			}
		}
		return approvalBeforeDone
	}, "approval typed event delivers before TaskDone", func() string {
		cb.typedMu.Lock()
		defer cb.typedMu.Unlock()
		return fmt.Sprintf("order=%v", cb.order)
	})
}
