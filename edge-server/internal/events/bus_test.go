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
	if b.maxHistory != 10000 {
		t.Errorf("default maxHistory = %d, want 10000", b.maxHistory)
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

	// Subscribe with cursor=1: should replay seq 2 and 3.
	_, ch, replay := b.Subscribe(1)

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

func TestSlowSubscriberDrop(t *testing.T) {
	b := NewBus(100)
	// Create a subscriber with a tiny buffer so it drops.
	// Subscribe returns a 256-buffer channel, so we can't easily test drops
	// without filling it. Just verify publish doesn't block.
	_, ch, _ := b.Subscribe(0)

	// Fill the channel buffer (256) + some extra.
	for i := 0; i < 300; i++ {
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
	// We should have received at most 256 events (buffer size), not all 300.
	if count > 256 {
		t.Errorf("received %d events on slow sub, want <= 256 due to drops", count)
	}
}

func TestConcurrentPublishSubscribe(t *testing.T) {
	b := NewBus(1000)
	_, ch, _ := b.Subscribe(0)

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

	// Collect events while publishers run.
	received := 0
	done := make(chan struct{})
	go func() {
		for range ch {
			received++
		}
	}()
	time.Sleep(100 * time.Millisecond)
	wg.Wait()
	time.Sleep(100 * time.Millisecond)
	close(done)

	if received < publishers*eventsPerPub-50 {
		t.Errorf("received %d events, expected near %d", received, publishers*eventsPerPub)
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
