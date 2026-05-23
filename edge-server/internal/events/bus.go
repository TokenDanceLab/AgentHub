package events

import (
	"sync"
	"sync/atomic"
	"time"
)

// EventEnvelope is the standard event wrapper for all WebSocket events.
type EventEnvelope struct {
	Version string         `json:"version"`
	ID      string         `json:"id"`
	Seq     int64          `json:"seq"`
	Type    string         `json:"type"`
	Scope   map[string]any `json:"scope"`
	TraceID string         `json:"traceId"`
	SentAt  string         `json:"sentAt"`
	Payload any            `json:"payload"`
}

// subscriber receives events on its channel.
type subscriber struct {
	id int64
	ch chan EventEnvelope
}

// Bus is an in-memory event bus with monotonic sequence numbers and
// support for cursor-based replay.
type Bus struct {
	mu         sync.Mutex
	seq        int64
	history    []EventEnvelope
	subs       []subscriber
	nextSubID  int64
	maxHistory int
}

// NewBus creates a new event bus with the given maximum history size.
func NewBus(maxHistory int) *Bus {
	if maxHistory <= 0 {
		maxHistory = 10000
	}
	return &Bus{
		history:    make([]EventEnvelope, 0, maxHistory),
		maxHistory: maxHistory,
	}
}

// Publish assigns a monotonic seq, appends the event to history, and
// fans it out to all subscribers. The event ID and seq are set by the bus.
func (b *Bus) Publish(eventType string, scope map[string]any, payload any) EventEnvelope {
	b.mu.Lock()
	defer b.mu.Unlock()

	seq := atomic.AddInt64(&b.seq, 1)
	evt := EventEnvelope{
		Version: "v1",
		ID:      genID("evt"),
		Seq:     seq,
		Type:    eventType,
		Scope:   scope,
		SentAt:  time.Now().UTC().Format(time.RFC3339),
		Payload: payload,
	}
	if evt.Scope == nil {
		evt.Scope = map[string]any{}
	}

	// Store in history, trimming if needed.
	b.history = append(b.history, evt)
	if len(b.history) > b.maxHistory {
		b.history = b.history[len(b.history)-b.maxHistory:]
	}

	// Fan out to all subscribers (non-blocking).
	for _, sub := range b.subs {
		select {
		case sub.ch <- evt:
		default:
			// Drop event for slow subscriber.
		}
	}

	return evt
}

// Subscribe registers a new subscriber. If cursor is non-zero, all
// events with seq > cursor are replayed before the channel is returned.
func (b *Bus) Subscribe(cursor int64) (int64, <-chan EventEnvelope, []EventEnvelope) {
	b.mu.Lock()
	defer b.mu.Unlock()

	id := b.nextSubID
	b.nextSubID++

	ch := make(chan EventEnvelope, 256)
	b.subs = append(b.subs, subscriber{id: id, ch: ch})

	// Replay events after cursor.
	var replay []EventEnvelope
	for _, evt := range b.history {
		if evt.Seq > cursor {
			replay = append(replay, evt)
		}
	}

	return id, ch, replay
}

// Unsubscribe removes a subscriber.
func (b *Bus) Unsubscribe(subID int64) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for i, sub := range b.subs {
		if sub.id == subID {
			// Remove subscriber, close channel.
			close(sub.ch)
			b.subs = append(b.subs[:i], b.subs[i+1:]...)
			return
		}
	}
}

// HistoryLen returns the current number of events retained in the bus history.
// Exposed for Prometheus metrics (edge_event_bus_depth gauge).
func (b *Bus) HistoryLen() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.history)
}
