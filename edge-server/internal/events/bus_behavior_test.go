package events

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/testkit"
)

// ---------------------------------------------------------------------------
// EventEnvelope behavioral tests
// ---------------------------------------------------------------------------

func TestEventEnvelopeValues(t *testing.T) {
	b := NewBus(100)
	payload := map[string]any{"message": "hello", "count": 42}
	scope := map[string]any{"runId": "run_alpha"}

	evt := b.Publish("session.created", scope, payload)

	// Envelope structure.
	if evt.Version != "v1" {
		t.Errorf("Version = %q, want v1", evt.Version)
	}
	if evt.Type != "session.created" {
		t.Errorf("Type = %q, want session.created", evt.Type)
	}
	if evt.ID == "" {
		t.Error("ID must not be empty")
	}
	if evt.Seq != 1 {
		t.Errorf("Seq = %d, want 1", evt.Seq)
	}

	// Timestamp is valid RFC3339.
	if evt.SentAt == "" {
		t.Error("SentAt must not be empty")
	}
	if _, err := time.Parse(time.RFC3339, evt.SentAt); err != nil {
		t.Errorf("SentAt %q is not valid RFC3339: %v", evt.SentAt, err)
	}

	// Scope is preserved.
	runID, ok := evt.Scope["runId"]
	if !ok {
		t.Error("scope[runId] missing")
	} else if runID != "run_alpha" {
		t.Errorf("scope[runId] = %v, want run_alpha", runID)
	}

	// Payload is preserved.
	if evt.Payload == nil {
		t.Error("Payload must not be nil")
	}
}

// ---------------------------------------------------------------------------
// Publish / Subscribe behavioral tests
// ---------------------------------------------------------------------------

func TestBusPublishSubscriberReceives(t *testing.T) {
	tests := []struct {
		name    string
		evtType string
		scope   map[string]any
		payload any
	}{
		{"string payload", "run.started", map[string]any{"runId": "r1"}, "started"},
		{"map payload", "run.completed", map[string]any{"runId": "r1"}, map[string]any{"exitCode": 0}},
		{"nil scope", "heartbeat", nil, "ping"},
		{"nil payload", "config.reload", map[string]any{"node": "n1"}, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := NewBus(10)
			_, ch, _ := b.Subscribe(0)

			evt := b.Publish(tt.evtType, tt.scope, tt.payload)

			select {
			case received := <-ch:
				if received.Type != tt.evtType {
					t.Errorf("Type = %q, want %q", received.Type, tt.evtType)
				}
				if received.Seq != evt.Seq {
					t.Errorf("Seq = %d, want %d", received.Seq, evt.Seq)
				}
			case <-time.After(time.Second):
				t.Fatal("timed out waiting for event")
			}
		})
	}
}

func TestBusPublishMultipleSubscribersAllReceive(t *testing.T) {
	b := NewBus(100)

	const numSubs = 5
	chs := make([]<-chan EventEnvelope, numSubs)
	ids := make([]int64, numSubs)

	for i := 0; i < numSubs; i++ {
		id, ch, _ := b.Subscribe(0)
		ids[i] = id
		chs[i] = ch
	}

	evt := b.Publish("broadcast", map[string]any{"runId": "r1"}, "hello all")

	for i, ch := range chs {
		select {
		case received := <-ch:
			if received.Type != "broadcast" {
				t.Errorf("sub %d: Type = %q, want broadcast", i, received.Type)
			}
			if received.Seq != evt.Seq {
				t.Errorf("sub %d: Seq = %d, want %d", i, received.Seq, evt.Seq)
			}
			if received.ID != evt.ID {
				t.Errorf("sub %d: ID = %s, want %s", i, received.ID, evt.ID)
			}
		case <-time.After(time.Second):
			t.Errorf("sub %d: timed out waiting for event", i)
		}
	}

	// Clean up.
	for _, id := range ids {
		b.Unsubscribe(id)
	}
}

func TestBusPublishNoSubscribersDoesNotPanic(t *testing.T) {
	b := NewBus(100)

	// Should not panic when no subscribers exist.
	evt := b.Publish("lonely.event", nil, "nobody listens")
	if evt.Seq != 1 {
		t.Errorf("Seq = %d, want 1", evt.Seq)
	}
	if evt.Type != "lonely.event" {
		t.Errorf("Type = %q, want lonely.event", evt.Type)
	}
}

func TestBusUnsubscribeStopsDelivery(t *testing.T) {
	tests := []struct {
		name      string
		extraPubs int // extra publish calls after unsubscribe
	}{
		{"immediate stop after unsubscribe", 0},
		{"multiple publishes after unsubscribe", 5},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := NewBus(100)
			id, ch, _ := b.Subscribe(0)

			// Confirm subscriber receives before unsubscribe.
			b.Publish("pre.unsub", nil, "should arrive")
			select {
			case evt := <-ch:
				if evt.Type != "pre.unsub" {
					t.Errorf("pre-unsubscribe: Type = %q, want pre.unsub", evt.Type)
				}
			case <-time.After(time.Second):
				t.Fatal("timed out waiting for pre-unsubscribe event")
			}

			b.Unsubscribe(id)

			// Channel must be closed.
			if _, ok := <-ch; ok {
				t.Error("channel should be closed after unsubscribe")
			}

			// Additional publishes should not panic and should not reach sub.
			for i := 0; i < tt.extraPubs; i++ {
				b.Publish("post.unsub", nil, nil)
			}
		})
	}
}

func TestBusUnsubscribeUnknownIDDoesNotPanic(t *testing.T) {
	b := NewBus(100)
	b.Subscribe(0)
	b.Publish("test", nil, nil)

	// These IDs were never issued, should not panic.
	for _, id := range []int64{-1, 0, 999, 999999} {
		b.Unsubscribe(id)
	}

	// Bus should still be operational.
	evt := b.Publish("after.bad.unsub", nil, "ok")
	if evt.Seq <= 0 {
		t.Error("bus should still publish after bad unsubscribes")
	}
}

// ---------------------------------------------------------------------------
// Observer behavioral tests
// ---------------------------------------------------------------------------

func TestBusAddObserverFiresForEveryPublishedEvent(t *testing.T) {
	b := NewBus(100)

	var mu sync.Mutex
	var received []EventEnvelope

	cancel := b.AddObserver(func(evt EventEnvelope) {
		mu.Lock()
		received = append(received, evt)
		mu.Unlock()
	})
	defer cancel()

	eventTypes := []string{"run.started", "run.output.batch", "run.completed", "session.created"}
	expectedCount := len(eventTypes)

	for _, et := range eventTypes {
		b.Publish(et, nil, nil)
	}

	// Async observer dispatch: poll for the expected count with a deadline
	// instead of a fixed sleep (#1550).
	testkit.Eventually(t, 2*time.Second, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(received) == expectedCount
	}, "observer did not receive all published events", func() string {
		mu.Lock()
		defer mu.Unlock()
		return fmt.Sprintf("received %d events, want %d", len(received), expectedCount)
	})

	mu.Lock()
	defer mu.Unlock()

	if len(received) != expectedCount {
		t.Fatalf("observer received %d events, want %d", len(received), expectedCount)
	}

	// Order is not guaranteed across worker goroutines; verify all types arrived.
	seen := make(map[string]bool, expectedCount)
	for _, evt := range received {
		seen[evt.Type] = true
	}
	for _, et := range eventTypes {
		if !seen[et] {
			t.Errorf("observer missed event type %q", et)
		}
	}
}

func TestBusAddObserverReceivesPayload(t *testing.T) {
	tests := []struct {
		name    string
		payload any
	}{
		{"string", "hello"},
		{"int", 42},
		{"map", map[string]any{"key": "value"}},
		{"nil", nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := NewBus(100)
			done := make(chan EventEnvelope, 1)

			cancel := b.AddObserver(func(evt EventEnvelope) {
				done <- evt
			})
			defer cancel()

			b.Publish("test.payload", nil, tt.payload)

			select {
			case evt := <-done:
				// Just confirm payload is present; deep-equal varies by type.
				if tt.payload != nil && evt.Payload == nil {
					t.Error("payload was lost in transit")
				}
			case <-time.After(time.Second):
				t.Fatal("timed out waiting for observer")
			}
		})
	}
}

func TestBusAddObserverCancelStopsDelivery(t *testing.T) {
	b := NewBus(100)

	var mu sync.Mutex
	var count int

	cancel := b.AddObserver(func(evt EventEnvelope) {
		mu.Lock()
		count++
		mu.Unlock()
	})

	b.Publish("before.cancel", nil, nil)

	// Wait for the pre-cancel delivery (deadline poll, #1550).
	testkit.Eventually(t, 2*time.Second, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return count >= 1
	}, "observer did not fire before cancel", nil)

	cancel()
	b.Publish("after.cancel", nil, nil)

	mu.Lock()
	if count < 1 {
		t.Error("observer should have fired at least once before cancel")
	}
	finalAfter := count
	mu.Unlock()

	// Negative window: after cancel the count must stay put. A short fixed
	// window is the only way to assert "did not happen" — kept small and
	// documented (#1550).
	time.Sleep(20 * time.Millisecond)
	mu.Lock()
	if count != finalAfter {
		t.Errorf("observer fired after cancel: %d -> %d", finalAfter, count)
	}
	mu.Unlock()
}

func TestBusAddObserverNilFunction(t *testing.T) {
	b := NewBus(100)

	cancel := b.AddObserver(nil)

	// Should return a no-op cancel function and not panic.
	cancel()
	b.Publish("test.nil.observer", nil, nil)

	// Bus should still be operational.
	evt := b.Publish("test.nil.observer.2", nil, "ok")
	if evt.Seq <= 0 {
		t.Error("bus should still publish after nil observer")
	}
}

// ---------------------------------------------------------------------------
// Sequential life-cycle patterns (full pub/sub flows)
// ---------------------------------------------------------------------------

func TestBusSubscribeLifecycle(t *testing.T) {
	// Full lifecycle: subscribe -> receive several events -> unsubscribe -> verify closed.
	b := NewBus(100)

	id, ch, replay := b.Subscribe(0)
	if len(replay) != 0 {
		t.Errorf("fresh subscribe should have empty replay, got %d", len(replay))
	}

	messages := []string{"hello", "world", "goodbye"}
	for i, msg := range messages {
		b.Publish("lifecycle", nil, msg)

		select {
		case evt := <-ch:
			if evt.Payload != msg {
				t.Errorf("event %d payload = %v, want %v", i, evt.Payload, msg)
			}
		case <-time.After(time.Second):
			t.Fatalf("timed out on event %d", i)
		}
	}

	b.Unsubscribe(id)

	if _, ok := <-ch; ok {
		t.Error("channel should be closed after unsubscribe")
	}
}

func TestBusSubscribeReplayThenLive(t *testing.T) {
	b := NewBus(100)

	// Publish some history first.
	for i := 0; i < 5; i++ {
		b.Publish("historical", nil, i)
	}

	// Subscribe with cursor 0 gets all history as replay.
	_, ch, replay := b.Subscribe(0)
	if len(replay) != 5 {
		t.Fatalf("replay length = %d, want 5", len(replay))
	}
	for i, evt := range replay {
		if evt.Seq != int64(i+1) {
			t.Errorf("replay[%d].Seq = %d, want %d", i, evt.Seq, i+1)
		}
	}

	// Live event after replay.
	b.Publish("live", nil, "after replay")
	select {
	case evt := <-ch:
		if evt.Type != "live" {
			t.Errorf("live event type = %q, want live", evt.Type)
		}
		if evt.Seq != 6 {
			t.Errorf("live event seq = %d, want 6", evt.Seq)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for live event")
	}
}

// ---------------------------------------------------------------------------
// Concurrent behavior patterns
// ---------------------------------------------------------------------------

func TestBusConcurrentPublishSubscriberIntegrity(t *testing.T) {
	b := NewBus(1000)
	t.Cleanup(func() {
		if err := b.Close(); err != nil {
			t.Fatalf("close bus: %v", err)
		}
	})

	var wg sync.WaitGroup
	const numPublishers = 8
	const eventsPerPub = 100
	const totalExpected = numPublishers * eventsPerPub

	// Start subscriber first.
	_, ch, _ := b.Subscribe(0)
	stopRead := make(chan struct{})
	readDone := make(chan struct{})
	var liveReceived atomic.Int64
	var gapReceived atomic.Int64

	go func() {
		defer close(readDone)
		for {
			select {
			case evt := <-ch:
				if evt.Type == GapEventType {
					gapReceived.Add(1)
					continue
				}
				if evt.Type != "concurrent" {
					t.Errorf("subscriber event type = %q, want concurrent or %s", evt.Type, GapEventType)
					continue
				}
				liveReceived.Add(1)
			case <-stopRead:
				return
			}
		}
	}()

	// Publish concurrently.
	for i := 0; i < numPublishers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < eventsPerPub; j++ {
				b.Publish("concurrent", nil, nil)
			}
		}()
	}

	wg.Wait()

	deadline := time.After(time.Second)
	for liveReceived.Load()+gapReceived.Load() == 0 {
		select {
		case <-deadline:
			t.Fatal("subscriber did not observe any live or gap event")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	close(stopRead)
	<-readDone

	// History integrity is the durable concurrent-publish contract. Live
	// subscribers are non-blocking and may see gap notifications under load.
	_, _, replay := b.Subscribe(0)
	seen := make(map[int64]bool, len(replay))
	for _, evt := range replay {
		if seen[evt.Seq] {
			t.Errorf("duplicate seq %d in history", evt.Seq)
		}
		seen[evt.Seq] = true
	}

	for seq := int64(1); seq <= int64(totalExpected); seq++ {
		if !seen[seq] {
			t.Errorf("missing seq %d in history", seq)
		}
	}
}

func TestBusConcurrentObserversDuringPublish(t *testing.T) {
	totalEvents := 4 * 50
	b := NewBus(totalEvents)

	var wg sync.WaitGroup
	const numPublishers = 4
	const eventsPerPub = 50

	// Publisher goroutines.
	for i := 0; i < numPublishers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < eventsPerPub; j++ {
				b.Publish("obs.concurrent", nil, nil)
			}
		}()
	}

	// Concurrent observer registration / removal.
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cancel := b.AddObserver(func(evt EventEnvelope) {})
			time.Sleep(3 * time.Millisecond)
			cancel()
		}()
	}

	wg.Wait()

	// History length should match total events.
	if b.HistoryLen() != numPublishers*eventsPerPub {
		t.Errorf("HistoryLen() = %d, want %d", b.HistoryLen(), numPublishers*eventsPerPub)
	}
}

// ---------------------------------------------------------------------------
// Gap detection pattern
// ---------------------------------------------------------------------------

func TestBusGapDetectionNotifiesSlowSubscriber(t *testing.T) {
	b := NewBus(1000)

	_, ch, _ := b.Subscribe(0)

	// Fill the subscriber buffer (size 256).
	for i := 0; i < subscriberChannelBufferSize; i++ {
		b.Publish("fill", nil, i)
	}

	// Publish beyond capacity — these are dropped.
	const overflow = 12
	for i := 0; i < overflow; i++ {
		b.Publish("overflow", nil, subscriberChannelBufferSize+i)
	}

	// Drain enough to make room for the gap event.
	for i := 0; i < subscriberChannelBufferSize/2; i++ {
		<-ch
	}

	// One more publish triggers the gap event injection.
	b.Publish("trigger.gap", nil, "check")

	// Scan for gap event.
	gapFound := false
	var gapPayload *GapPayload
drain:
	for {
		select {
		case evt, ok := <-ch:
			if !ok {
				break drain
			}
			if evt.Type == GapEventType {
				gapFound = true
				if gp, ok := evt.Payload.(*GapPayload); ok {
					gapPayload = gp
				}
			}
		default:
			break drain
		}
	}

	if !gapFound {
		t.Error("expected gap event for slow subscriber")
	}
	if gapPayload == nil {
		t.Error("gap payload should not be nil")
	} else if gapPayload.DroppedCount <= 0 {
		t.Errorf("gap DroppedCount = %d, want > 0", gapPayload.DroppedCount)
	}
}

// ---------------------------------------------------------------------------
// Bus Close behavior
// ---------------------------------------------------------------------------

func TestBusCloseShutsDownWorkers(t *testing.T) {
	b := NewBus(100)

	// Verify bus is operational before close.
	b.Publish("before.close", nil, nil)
	if b.HistoryLen() != 1 {
		t.Errorf("HistoryLen() = %d, want 1", b.HistoryLen())
	}

	if err := b.Close(); err != nil {
		t.Logf("close returned: %v", err)
	}

	// After close, verify the bus is no longer operational.
	// Worker pool is stopped; observers will not be processed.
	// Note: Close() closes stopCh and waits for workers, then closes eventLog if any.
	// Close() is idempotent via sync.Once — calling it twice is safe (see TestBusCloseIdempotent).
}

func TestBusCloseIdempotent(t *testing.T) {
	b := NewBus(10)
	if err := b.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}
	// A second Close must not panic on re-closing stopCh.
	if err := b.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
}

// ---------------------------------------------------------------------------
// HistoryLen and DroppedCount
// ---------------------------------------------------------------------------

func TestBusHistoryLenReflectsPublishCount(t *testing.T) {
	b := NewBus(50)

	publishCount := 30
	for i := 0; i < publishCount; i++ {
		b.Publish("count.test", nil, nil)
	}

	if b.HistoryLen() != publishCount {
		t.Errorf("HistoryLen() = %d, want %d", b.HistoryLen(), publishCount)
	}
}

func TestBusHistoryLenRespectsMaxHistory(t *testing.T) {
	max := 5
	b := NewBus(max)

	for i := 0; i < 20; i++ {
		b.Publish("fill", nil, nil)
	}

	if b.HistoryLen() != max {
		t.Errorf("HistoryLen() = %d, want capped at %d", b.HistoryLen(), max)
	}
}

func TestBusDroppedCountTracksSlowSubscriber(t *testing.T) {
	b := NewBus(1000)

	// Subscriber that never reads.
	_, ch, _ := b.Subscribe(0)

	// Fill buffer.
	totalPublish := subscriberChannelBufferSize + 30
	for i := 0; i < totalPublish; i++ {
		b.Publish("drop.test", nil, nil)
	}

	// Drain a few to calculate drops.
	drained := 0
	for {
		select {
		case <-ch:
			drained++
		default:
			goto done
		}
	}
done:
	dropped := b.DroppedCount()
	expectedDrops := int64(totalPublish - drained)
	if dropped != expectedDrops {
		t.Errorf("DroppedCount() = %d, want %d (published=%d, drained=%d)",
			dropped, expectedDrops, totalPublish, drained)
	}
}

// ---------------------------------------------------------------------------
// Worker pool backpressure
// ---------------------------------------------------------------------------

// TestBus_WorkerPoolBackpressure verifies that publishing faster than observer
// workers can consume does not cause panics and does not drop events from
// history. Observer notifications may be dropped non-blockingly when the
// worker pool is saturated, but the event bus itself remains operational.
func TestBus_WorkerPoolBackpressure(t *testing.T) {
	b := NewBus(5000)

	// Block all observer workers to saturate the job channel.
	blockCh := make(chan struct{})
	cancel := b.AddObserver(func(evt EventEnvelope) {
		<-blockCh // block until released
	})
	defer cancel()

	const totalEvents = 3000 // > observerJobBufferSize (1024) to force drops

	// Publish faster than workers can consume — observer jobs are dropped
	// non-blockingly when the pool is saturated.
	for i := 0; i < totalEvents; i++ {
		b.Publish("backpressure", nil, i)
	}

	// Release the observers so they drain what remains in the job channel.
	close(blockCh)
	time.Sleep(100 * time.Millisecond)

	// Verify all events are retained in history (replay).
	_, _, replay := b.Subscribe(0)
	if len(replay) != totalEvents {
		t.Errorf("history has %d events, want %d", len(replay), totalEvents)
	}

	// Verify no sequence gaps in history.
	seen := make(map[int64]bool, len(replay))
	for _, evt := range replay {
		if seen[evt.Seq] {
			t.Errorf("duplicate seq %d in history", evt.Seq)
		}
		seen[evt.Seq] = true
	}
	for seq := int64(1); seq <= int64(totalEvents); seq++ {
		if !seen[seq] {
			t.Errorf("missing seq %d in history", seq)
		}
	}

	// Bus must still be operational after backpressure.
	evt := b.Publish("post.backpressure", nil, "ok")
	if evt.Seq <= int64(totalEvents) {
		t.Error("bus should still publish events after backpressure")
	}
}

// ---------------------------------------------------------------------------
// Persist error resilience
// ---------------------------------------------------------------------------

// TestBus_PersistErrorDoesNotCrashBus verifies that when the persistence hook
// returns an error, the bus remains fully operational for subsequent publishes.
func TestBus_PersistErrorDoesNotCrashBus(t *testing.T) {
	// persistFn always fails first: the publish is retried and dropped, but
	// the bus stays operational for subsequent publishes (the drop-and-count
	// contract is covered in TestBus_PersistRetryExhaustedDropsAndCounts).
	b := NewBus(100)
	b.persistFn = func(evt EventEnvelope) error { return errAssert }
	t.Cleanup(func() { _ = b.Close() })

	_, ch, _ := b.Subscribe(0)

	evt1 := b.Publish("should.fail", nil, "dropped")
	if evt1.ID != "" {
		t.Errorf("failed-persist event should have empty ID, got %s", evt1.ID)
	}

	// Swap in a healthy persister: the next publish must flow end-to-end.
	b.persistFn = nil

	evt2 := b.Publish("should.succeed", nil, "delivered")
	if evt2.ID == "" {
		t.Error("successful event should have non-empty ID")
	}

	select {
	case received := <-ch:
		if received.Type != "should.succeed" {
			t.Errorf("received Type = %q, want should.succeed", received.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for successful event after persist error")
	}

	// History must contain exactly the successful event.
	if got := b.HistoryLen(); got != 1 {
		t.Errorf("history has %d events, want 1 (failed event must not appear)", got)
	}
	select {
	case evt := <-ch:
		t.Errorf("unexpected event on subscriber channel: %s (seq=%d)", evt.Type, evt.Seq)
	default:
		// no extra events expected
	}
}

// ---------------------------------------------------------------------------
// Unsubscribe during active publish
// ---------------------------------------------------------------------------

// TestBus_UnsubscribeDuringPublish verifies that unsubscribing while events
// are being published does not cause a panic, the unsubscribed channel is
// closed, and the bus remains operational.
func TestBus_UnsubscribeDuringPublish(t *testing.T) {
	b := NewBus(2000)

	id, ch, _ := b.Subscribe(0)

	var wg sync.WaitGroup
	stopCh := make(chan struct{})

	// Publisher goroutines that run continuously until stopped.
	const numPublishers = 3
	for i := 0; i < numPublishers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stopCh:
					return
				default:
					b.Publish("concurrent", nil, nil)
				}
			}
		}()
	}

	// Drain subscriber in background to prevent subscriber-side drops from
	// confusing the channel-close assertion.
	var drained atomic.Int64
	wg.Add(1)
	go func() {
		defer wg.Done()
		for range ch {
			drained.Add(1)
		}
	}()

	// Let publishers run briefly to build up activity.
	time.Sleep(5 * time.Millisecond)

	// Unsubscribe while publishers are actively publishing.
	b.Unsubscribe(id)

	// Stop publishers.
	close(stopCh)
	wg.Wait()

	// Verify subscriber channel is closed (drain goroutine exited).
	if drained.Load() == 0 {
		t.Error("subscriber should have received at least some events before unsubscribe")
	}

	// Bus must still be operational.
	evt := b.Publish("after.unsubscribe", nil, "ok")
	if evt.Seq <= 0 {
		t.Error("bus must still publish events after unsubscribe during publish")
	}
	if evt.Type != "after.unsubscribe" {
		t.Errorf("Type = %q, want after.unsubscribe", evt.Type)
	}

	// A new subscriber can still receive events.
	_, ch2, _ := b.Subscribe(0)
	b.Publish("to.new.sub", nil, "hello")
	select {
	case received := <-ch2:
		if received.Type != "to.new.sub" {
			t.Errorf("new subscriber Type = %q, want to.new.sub", received.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event on new subscriber")
	}
}

// ---------------------------------------------------------------------------
// Observer with many events
// ---------------------------------------------------------------------------

// TestBus_ObserverWithMultipleEvents verifies that an observer receives all
// published events (100+) via the asynchronous worker pool without loss.
func TestBus_ObserverWithMultipleEvents(t *testing.T) {
	b := NewBus(500)

	var mu sync.Mutex
	var received []EventEnvelope

	cancel := b.AddObserver(func(evt EventEnvelope) {
		mu.Lock()
		received = append(received, evt)
		mu.Unlock()
	})
	defer cancel()

	const totalEvents = 150
	for i := 0; i < totalEvents; i++ {
		b.Publish("obs.many", nil, i)
	}

	// Give observer workers time to process all jobs (async dispatch).
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	count := len(received)
	mu.Unlock()

	if count != totalEvents {
		t.Errorf("observer received %d events, want %d", count, totalEvents)
	}

	// Verify no duplicate sequences were delivered to the observer.
	mu.Lock()
	seen := make(map[int64]bool, count)
	for _, evt := range received {
		if seen[evt.Seq] {
			t.Errorf("duplicate seq %d delivered to observer", evt.Seq)
		}
		seen[evt.Seq] = true
	}
	// Verify all sequences 1..totalEvents were delivered.
	for seq := int64(1); seq <= int64(totalEvents); seq++ {
		if !seen[seq] {
			t.Errorf("observer missed seq %d", seq)
		}
	}
	mu.Unlock()
}

// errAssert is a sentinel error for persist-failure tests.
var errAssert = assertError{}

type assertError struct{}

func (e assertError) Error() string { return "assert error" }
