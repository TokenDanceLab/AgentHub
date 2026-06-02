package events

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

const (
	defaultMaxHistory           = 10000
	subscriberChannelBufferSize = 256
)

// GapEventType is the event type for a gap-detection control message sent to a
// subscriber when one or more events were dropped because the subscriber channel
// was full. The payload is a *GapPayload.
const GapEventType = "system.gap"

// GapPayload describes a range of dropped events for a subscriber.
type GapPayload struct {
	FirstDroppedSeq int64 `json:"firstDroppedSeq"`
	LastDroppedSeq  int64 `json:"lastDroppedSeq"`
	DroppedCount    int64 `json:"droppedCount"`
}

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
	id          int64
	ch          chan EventEnvelope
	gapDetected bool  // true when events were dropped since last successful send
	firstGapSeq int64 // seq of first dropped event in the gap
	lastGapSeq  int64 // seq of last dropped event in the gap
}

type observer struct {
	id int64
	fn func(EventEnvelope)
}

// EventLog is an append-only JSON-lines event log backed by a file on disk.
// Each event is serialised as a single JSON line. Writes are safe for
// concurrent use.
type EventLog struct {
	mu   sync.Mutex
	f    *os.File
	path string
}

// NewEventLog opens or creates the append-only event log at the given path.
// The parent directory is created if it does not exist.
func NewEventLog(path string) (*EventLog, error) {
	if path == "" {
		return nil, nil
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	return &EventLog{f: f, path: path}, nil
}

// Append writes an event to the log as a single JSON line followed by a newline.
func (l *EventLog) Append(evt EventEnvelope) error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	data, err := json.Marshal(evt)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = l.f.Write(data)
	return err
}

// Close flushes and closes the underlying file.
func (l *EventLog) Close() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.f.Close()
}

// Path returns the file path of the event log, or empty if nil.
func (l *EventLog) Path() string {
	if l == nil {
		return ""
	}
	return l.path
}

// PersistFn is called before an event is broadcast to subscribers.
// If it returns an error, the event is NOT appended to history and NOT broadcast.
type PersistFn func(EventEnvelope) error

// BusOption configures a Bus.
type BusOption func(*Bus)

// WithPersister sets the persistence hook called before every event broadcast.
// If the hook returns an error, Publish() does NOT fan out the event.
func WithPersister(fn PersistFn) BusOption {
	return func(b *Bus) { b.persistFn = fn }
}

// WithPersistOutputBatch controls whether run.output.batch events are
// persisted before broadcast. Defaults to true (persist) for crash safety.
// Set to false to accept a tradeoff: output batch events exist only in the
// in-memory ring buffer and may be lost on crash, trading durability for
// throughput on high-frequency stdout events.
func WithPersistOutputBatch(persist bool) BusOption {
	return func(b *Bus) { b.persistOutputBatch = persist }
}

// WithEventLogPath configures an append-only JSON-lines event log at the
// given path. Events are written to durable storage before being broadcast
// to subscribers (persist-before-broadcast). This enables crash recovery
// and replay for reconnecting clients. The event log is closed when
// Bus.Close() is called.
func WithEventLogPath(path string) BusOption {
	return func(b *Bus) {
		log, err := NewEventLog(path)
		if err != nil {
			slog.Error("failed to open event log, events will not be persisted to disk",
				"path", path, "err", err)
			return
		}
		b.eventLog = log
		b.persistFn = func(evt EventEnvelope) error {
			return log.Append(evt)
		}
	}
}

// Bus is an in-memory event bus with monotonic sequence numbers and
// support for cursor-based replay.
type Bus struct {
	mu         sync.Mutex
	seq        int64
	dropped    atomic.Int64
	history    []EventEnvelope
	subs       []subscriber
	observers  []observer
	nextSubID  int64
	nextObsID  int64
	maxHistory int

	// persistFn is called before an event is broadcast. If non-nil and it
	// returns an error, the event is dropped without being appended to
	// history or fanned out to subscribers.
	persistFn PersistFn

	// eventLog is the append-only event log opened by WithEventLogPath.
	// It is closed when Bus.Close() is called.
	eventLog *EventLog

	// persistOutputBatch controls whether run.output.batch events go through
	// the persistence hook. Default true.
	persistOutputBatch bool
}

// NewBus creates a new event bus with the given maximum history size.
func NewBus(maxHistory int, opts ...BusOption) *Bus {
	if maxHistory <= 0 {
		maxHistory = defaultMaxHistory
	}
	b := &Bus{
		history:            make([]EventEnvelope, 0, maxHistory),
		maxHistory:         maxHistory,
		persistOutputBatch: true,
	}
	for _, o := range opts {
		o(b)
	}
	return b
}

// Publish assigns a monotonic seq, persists the event (if a persister is
// configured and the event type is eligible), appends the event to history, and
// fans it out to all subscribers. The event ID and seq are set by the bus.
//
// If a persistence hook is configured and it returns an error, the event is
// NOT appended to history and NOT broadcast to subscribers. The caller receives
// a zero-value EventEnvelope with the event type populated so it can detect the
// failure.
func (b *Bus) Publish(eventType string, scope map[string]any, payload any) EventEnvelope {
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

	// Persist before fanout: if a persistence hook is configured and the
	// event type is eligible, write to durable store before in-memory append.
	// On failure, the event is dropped — observers and subscribers never see it.
	if b.persistFn != nil && b.shouldPersist(eventType) {
		if err := b.persistFn(evt); err != nil {
			slog.Error("event bus persist failed, dropping event",
				"type", eventType, "seq", seq, "err", err)
			// Return a minimal envelope so callers can detect the failure.
			return EventEnvelope{Version: "v1", Type: eventType, Seq: seq}
		}
	}

	b.mu.Lock()

	// Store in history, trimming if needed.
	b.history = append(b.history, evt)
	if len(b.history) > b.maxHistory {
		b.history = b.history[len(b.history)-b.maxHistory:]
	}

	// Copy observer list under the lock for async dispatch.
	observers := append([]observer(nil), b.observers...)

	// Fan out to all subscribers (non-blocking).
	// Gap detection: when a subscriber channel was full on a previous
	// Publish call, a "system.gap" control event is injected in place of
	// the current event to alert the consumer of data loss. The current
	// event is intentionally not delivered to that subscriber because the
	// consumer must resync from scratch.
	for i := range b.subs {
		sub := &b.subs[i]
		if sub.gapDetected {
			// Inject a gap control event to notify the consumer of
			// the event range that was dropped.
			gapEvt := EventEnvelope{
				Version: "v1",
				ID:      genID("gap"),
				Seq:     0, // gap events have no meaningful seq
				Type:    GapEventType,
				Scope:   map[string]any{},
				SentAt:  evt.SentAt,
				Payload: &GapPayload{
					FirstDroppedSeq: sub.firstGapSeq,
					LastDroppedSeq:  sub.lastGapSeq,
					DroppedCount:    sub.lastGapSeq - sub.firstGapSeq + 1,
				},
			}
			select {
			case sub.ch <- gapEvt:
				sub.gapDetected = false
				sub.firstGapSeq = 0
				sub.lastGapSeq = 0
				// The current event is intentionally skipped for this
				// subscriber — the consumer must resync.
				b.dropped.Add(1)
			default:
				// Channel still full; extend gap range.
				b.dropped.Add(1)
				sub.lastGapSeq = evt.Seq
			}
		} else {
			select {
			case sub.ch <- evt:
				// Successful delivery.
			default:
				// Drop event for slow subscriber; track gap.
				b.dropped.Add(1)
				sub.gapDetected = true
				sub.firstGapSeq = evt.Seq
				sub.lastGapSeq = evt.Seq
			}
		}
	}

	b.mu.Unlock()

	// Notify observers asynchronously outside the lock so that
	// slow or blocking observers do not stall event publishing.
	for _, obs := range observers {
		go func(fn func(EventEnvelope)) {
			defer func() {
				if recovered := recover(); recovered != nil {
					slog.Error("event bus observer panic", "panic", recovered)
				}
			}()
			fn(evt)
		}(obs.fn)
	}

	return evt
}

// shouldPersist reports whether the given event type should go through the
// persistence hook. run.output.batch events are high-frequency and may be
// excluded via WithPersistOutputBatch(false).
func (b *Bus) shouldPersist(eventType string) bool {
	if eventType == "run.output.batch" {
		return b.persistOutputBatch
	}
	return true
}

// AddObserver registers a synchronous observer that receives every published
// event after it is appended to history and before subscribers can receive it.
// Observers must not call back into the same bus.
func (b *Bus) AddObserver(fn func(EventEnvelope)) func() {
	if fn == nil {
		return func() {}
	}
	b.mu.Lock()
	id := b.nextObsID
	b.nextObsID++
	b.observers = append(b.observers, observer{id: id, fn: fn})
	b.mu.Unlock()

	return func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		for i, obs := range b.observers {
			if obs.id == id {
				b.observers = append(b.observers[:i], b.observers[i+1:]...)
				return
			}
		}
	}
}

// Subscribe registers a new subscriber. If cursor is non-zero, all
// events with seq > cursor are replayed before the channel is returned.
func (b *Bus) Subscribe(cursor int64) (int64, <-chan EventEnvelope, []EventEnvelope) {
	b.mu.Lock()
	defer b.mu.Unlock()

	id := b.nextSubID
	b.nextSubID++

	ch := make(chan EventEnvelope, subscriberChannelBufferSize)
	b.subs = append(b.subs, subscriber{id: id, ch: ch})

	// Replay events starting from exact cursor position.
	// cursor=N means "I last saw event N-1", so replay starts at seq >= cursor.
	var replay []EventEnvelope
	for _, evt := range b.history {
		if evt.Seq >= cursor {
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

// DropCount returns the number of fanout deliveries dropped because a
// subscriber channel was full.
func (b *Bus) DroppedCount() int64 {
	return b.dropped.Load()
}

// Close flushes and closes the underlying event log if one was configured via
// WithEventLogPath. It is safe to call Close on a Bus that has no event log.
func (b *Bus) Close() error {
	if b.eventLog != nil {
		return b.eventLog.Close()
	}
	return nil
}
