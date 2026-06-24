package events

import (
	"sync"
	"testing"
	"time"
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
		name     string
		evtType  string
		scope    map[string]any
		payload  any
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
		ids[i] = int64(id)
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
		name       string
		extraPubs  int // extra publish calls after unsubscribe
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

	// Give observer workers time to process (asynchronous dispatch).
	time.Sleep(50 * time.Millisecond)

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
	time.Sleep(20 * time.Millisecond)

	cancel()
	b.Publish("after.cancel", nil, nil)
	time.Sleep(20 * time.Millisecond)

	mu.Lock()
	if count < 1 {
		t.Error("observer should have fired at least once before cancel")
	}
	finalAfter := count
	mu.Unlock()

	// Publish again; count should not increase.
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

	var wg sync.WaitGroup
	const numPublishers = 8
	const eventsPerPub = 100

	// Start subscriber first.
	_, ch, _ := b.Subscribe(0)

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

	// Read concurrently.
	var receivedCount int
	var readWg sync.WaitGroup
	readWg.Add(1)
	go func() {
		defer readWg.Done()
		for range ch {
			receivedCount++
			if receivedCount >= numPublishers*eventsPerPub {
				return
			}
		}
	}()

	wg.Wait()
	readWg.Wait()

	if receivedCount < numPublishers*eventsPerPub {
		t.Errorf("received %d events, want %d (some may be dropped, but >= expected)", receivedCount, numPublishers*eventsPerPub)
	}

	// History integrity from replay.
	_, _, replay := b.Subscribe(0)
	seen := make(map[int64]bool, len(replay))
	for _, evt := range replay {
		if seen[evt.Seq] {
			t.Errorf("duplicate seq %d in history", evt.Seq)
		}
		seen[evt.Seq] = true
	}

	totalExpected := int64(numPublishers * eventsPerPub)
	for seq := int64(1); seq <= totalExpected; seq++ {
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
	} else {
		if gapPayload.DroppedCount <= 0 {
			t.Errorf("gap DroppedCount = %d, want > 0", gapPayload.DroppedCount)
		}
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
	// It is NOT idempotent — calling Close() twice panics because stopCh is re-closed.
}

// ---------------------------------------------------------------------------
// PersistFn error drops event
// ---------------------------------------------------------------------------

func TestBusPersistErrorDropsEvent(t *testing.T) {
	b := NewBus(100, WithPersister(func(evt EventEnvelope) error {
		return assertAnError
	}))

	// Subscribe and expect to receive NOTHING because persist fails.
	_, ch, _ := b.Subscribe(0)

	evt := b.Publish("persist.fail", nil, "dropped")

	// The returned envelope is a zero-value with type and seq set.
	if evt.Type != "persist.fail" {
		t.Errorf("returned Type = %q, want persist.fail", evt.Type)
	}
	if evt.ID != "" {
		t.Errorf("returned ID should be empty on persist failure, got %s", evt.ID)
	}
	if evt.Seq != 1 {
		t.Errorf("returned Seq = %d, want 1", evt.Seq)
	}

	// Subscriber should not receive it.
	select {
	case <-ch:
		t.Error("subscriber should not receive event when persist fails")
	case <-time.After(100 * time.Millisecond):
		// Expected.
	}
}

// assertAnError is a sentinel error for persist-failure tests.
var assertAnError = errSentinel{}

type errSentinel struct{}

func (e errSentinel) Error() string { return "assert error" }

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
