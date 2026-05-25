package events

import (
	"sync"
	"testing"
	"time"
)

func TestNewBusDefaults(t *testing.T) {
	b := NewBus(0)
	if b == nil {
		t.Fatal("expected non-nil bus")
	}
	if b.maxHistory != defaultMaxHistory {
		t.Errorf("default maxHistory = %d, want %d", b.maxHistory, defaultMaxHistory)
	}
}

func TestNewBusCustomSize(t *testing.T) {
	b := NewBus(100)
	if b.maxHistory != 100 {
		t.Errorf("maxHistory = %d, want 100", b.maxHistory)
	}
}

func TestPublishAssignsSeq(t *testing.T) {
	b := NewBus(100)
	e1 := b.Publish("test.one", nil, "a")
	e2 := b.Publish("test.two", nil, "b")

	if e1.Seq != 1 {
		t.Errorf("first event seq = %d, want 1", e1.Seq)
	}
	if e2.Seq != 2 {
		t.Errorf("second event seq = %d, want 2", e2.Seq)
	}
	if e1.ID == e2.ID {
		t.Error("event IDs should be unique")
	}
}

func TestPublishFillsEnvelope(t *testing.T) {
	b := NewBus(100)
	e := b.Publish("run.started", map[string]any{"runId": "run_1"}, map[string]any{"status": "ok"})

	if e.Version != "v1" {
		t.Errorf("version = %q, want v1", e.Version)
	}
	if e.Type != "run.started" {
		t.Errorf("type = %q, want run.started", e.Type)
	}
	if e.Scope["runId"] != "run_1" {
		t.Errorf("scope.runId = %v, want run_1", e.Scope["runId"])
	}
	if e.SentAt == "" {
		t.Error("sentAt should not be empty")
	}
	// Verify RFC3339 format
	if _, err := time.Parse(time.RFC3339, e.SentAt); err != nil {
		t.Errorf("sentAt is not valid RFC3339: %v", err)
	}
}

func TestPublishNilScope(t *testing.T) {
	b := NewBus(100)
	e := b.Publish("test", nil, "x")
	if e.Scope == nil {
		t.Error("nil scope should be normalized to empty map")
	}
}

func TestAddObserverReceivesPublishedEvents(t *testing.T) {
	b := NewBus(100)
	observed := make(chan EventEnvelope, 1)
	cancel := b.AddObserver(func(evt EventEnvelope) {
		observed <- evt
	})
	defer cancel()

	b.Publish("test.observed", map[string]any{"runId": "run_1"}, "payload")

	select {
	case evt := <-observed:
		if evt.Type != "test.observed" {
			t.Fatalf("observer event type = %q, want test.observed", evt.Type)
		}
		if evt.Scope["runId"] != "run_1" {
			t.Fatalf("observer scope = %#v, want run_1", evt.Scope)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for observer")
	}
}

func TestAddObserverCancelStopsEvents(t *testing.T) {
	b := NewBus(100)
	observed := make(chan EventEnvelope, 1)
	cancel := b.AddObserver(func(evt EventEnvelope) {
		observed <- evt
	})
	cancel()

	b.Publish("test.after_cancel", nil, nil)

	select {
	case evt := <-observed:
		t.Fatalf("unexpected observer event after cancel: %s", evt.Type)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestSubscribeReceivesEvents(t *testing.T) {
	b := NewBus(100)
	_, ch, _ := b.Subscribe(0)

	go func() {
		b.Publish("test.one", nil, "hello")
	}()

	select {
	case evt := <-ch:
		if evt.Type != "test.one" {
			t.Errorf("type = %q, want test.one", evt.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
	}
}

func TestSubscribeCursorReplay(t *testing.T) {
	b := NewBus(100)
	b.Publish("e1", nil, 1) // seq=1
	b.Publish("e2", nil, 2) // seq=2
	b.Publish("e3", nil, 3) // seq=3

	// Subscribe with cursor=2: replay starts from exact cursor, so seq 2 and 3.
	_, ch, replay := b.Subscribe(2)

	if len(replay) != 2 {
		t.Fatalf("replay length = %d, want 2", len(replay))
	}
	if replay[0].Seq != 2 || replay[1].Seq != 3 {
		t.Errorf("replay seqs = %d, %d; want 2, 3", replay[0].Seq, replay[1].Seq)
	}

	// Also receive future events.
	done := make(chan EventEnvelope, 1)
	go func() {
		done <- <-ch
	}()
	b.Publish("e4", nil, 4)
	select {
	case evt := <-done:
		if evt.Seq != 4 {
			t.Errorf("future event seq = %d, want 4", evt.Seq)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for future event")
	}
}

func TestSubscribeCursorBeyondHistory(t *testing.T) {
	b := NewBus(100)
	b.Publish("e1", nil, 1)
	b.Publish("e2", nil, 2)

	_, _, replay := b.Subscribe(100)
	if len(replay) != 0 {
		t.Errorf("replay with cursor beyond history should be empty, got %d", len(replay))
	}
}

func TestUnsubscribeStopsDelivery(t *testing.T) {
	b := NewBus(100)
	id, ch, _ := b.Subscribe(0)

	b.Unsubscribe(id)

	// Try to receive; channel should be closed.
	_, ok := <-ch
	if ok {
		t.Error("channel should be closed after unsubscribe")
	}
}

func TestUnsubscribeUnknownID(t *testing.T) {
	b := NewBus(100)
	// Should not panic.
	b.Unsubscribe(999)
}

func TestHistoryTrimming(t *testing.T) {
	max := 5
	b := NewBus(max)

	// Publish more than max events.
	for i := 0; i < 10; i++ {
		b.Publish("test", nil, i)
	}

	// Subscribe with cursor=0: should only replay last `max` events.
	_, _, replay := b.Subscribe(0)
	if len(replay) != max {
		t.Errorf("replay length = %d, want %d", max, len(replay))
	}
	// First replayed event should have seq=6 (events 1-5 trimmed).
	if replay[0].Seq != 6 {
		t.Errorf("first replay seq = %d, want 6", replay[0].Seq)
	}
}

func TestCursorReplayAfterTrimReturnsRetainedEventsAfterCursor(t *testing.T) {
	b := NewBus(3)

	for i := 0; i < 5; i++ {
		b.Publish("test", nil, i)
	}

	_, _, replay := b.Subscribe(2)
	if len(replay) != 3 {
		t.Fatalf("replay length = %d, want 3", len(replay))
	}
	for i, wantSeq := range []int64{3, 4, 5} {
		if replay[i].Seq != wantSeq {
			t.Fatalf("replay[%d].Seq = %d, want %d", i, replay[i].Seq, wantSeq)
		}
	}
}

func TestCursorReplayAfterTrimSkipsTrimmedGap(t *testing.T) {
	b := NewBus(3)

	for i := 0; i < 5; i++ {
		b.Publish("test", nil, i)
	}

	_, _, replay := b.Subscribe(1)
	if len(replay) != 3 {
		t.Fatalf("replay length = %d, want retained history length 3", len(replay))
	}
	if replay[0].Seq != 3 {
		t.Fatalf("first replay seq = %d, want first retained seq 3", replay[0].Seq)
	}
}

func TestSlowSubscriberDrop(t *testing.T) {
	b := NewBus(100)
	// Create a subscriber with a tiny buffer so it drops.
	// Subscribe returns a buffered channel, so fill it past capacity to
	// verify publish doesn't block.
	_, ch, _ := b.Subscribe(0)

	publishCount := subscriberChannelBufferSize + 44
	for i := 0; i < publishCount; i++ {
		b.Publish("test", nil, i)
	}

	// Drain the channel to verify it didn't block publish.
	count := 0
drain:
	for {
		select {
		case <-ch:
			count++
		default:
			break drain
		}
	}
	if count > subscriberChannelBufferSize {
		t.Errorf("received %d events on slow sub, want <= %d due to drops", count, subscriberChannelBufferSize)
	}
	if got := b.DroppedCount(); got != int64(publishCount-count) {
		t.Errorf("DroppedCount() = %d, want %d", got, publishCount-count)
	}
}

func TestConcurrentPublishSubscribe(t *testing.T) {
	b := NewBus(1000)

	var wg sync.WaitGroup
	const publishers = 10
	const eventsPerPub = 50

	for i := 0; i < publishers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < eventsPerPub; j++ {
				b.Publish("test.concurrent", nil, nil)
			}
		}()
	}

	wg.Wait()

	_, _, replay := b.Subscribe(0)
	if len(replay) != publishers*eventsPerPub {
		t.Fatalf("history replay length = %d, want %d", len(replay), publishers*eventsPerPub)
	}
	seen := make(map[int64]bool, len(replay))
	for _, evt := range replay {
		if seen[evt.Seq] {
			t.Fatalf("duplicate seq %d in replay", evt.Seq)
		}
		seen[evt.Seq] = true
	}
	for seq := int64(1); seq <= publishers*eventsPerPub; seq++ {
		if !seen[seq] {
			t.Fatalf("missing seq %d in replay", seq)
		}
	}
}

func TestConcurrentSubscribeUnsubscribe(t *testing.T) {
	b := NewBus(1000)
	var wg sync.WaitGroup

	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id, ch, _ := b.Subscribe(0)
			time.Sleep(10 * time.Millisecond)
			b.Unsubscribe(id)
			// drain channel to avoid goroutine leak
			for range ch {
			}
		}()
	}
	wg.Wait()
	// Test that bus is still usable.
	b.Publish("after", nil, "ok")
}
