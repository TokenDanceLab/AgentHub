package events

import (
	"log/slog"
	"time"
)

// persistDefaultMaxRetries bounds how many times persistWithRetry retries a
// persistFn call that returned an error before declaring the event lost.
// 1 = one original attempt + one retry; 3 = original + three retries.
const persistDefaultMaxRetries = 3

// persistRetryBaseDelay is the exponential backoff base between persist
// retry attempts. Kept short so the synchronous retry path does not
// stall Publish under normal transient failures.
const persistRetryBaseDelay = 2 * time.Millisecond

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

// WithPersistMaxRetries overrides the number of synchronous retry attempts a
// Publish call makes when persistFn returns an error before declaring the
// event lost. n must be >= 0; 0 disables retries (original-attempt-only),
// negative values are ignored (default applies). This is primarily a test
// seam for forcing fast failure in tests that assert the persist-failure path,
// but also lets operators tune the retry budget.
func WithPersistMaxRetries(n int) BusOption {
	return func(b *Bus) {
		if n >= 0 {
			b.persistMaxRetries = n
		}
	}
}

// maxPersistRetries returns the effective persist retry count for the bus,
// falling back to persistDefaultMaxRetries when no override is set (the -1
// sentinel left by the zero value / unset state).
func (b *Bus) maxPersistRetries() int {
	if b.persistMaxRetries >= 0 {
		return b.persistMaxRetries
	}
	return persistDefaultMaxRetries
}

// persistWithRetry calls persistFn for evt, retrying up to maxRetries times
// with exponential backoff on error. It returns the last error if every
// attempt failed, or nil if any attempt succeeded. The retry loop is
// synchronous so the Publish contract (persist-before-broadcast) is
// preserved: an event either lands in the durable store before it is seen by
// subscribers, or it is dropped with persistFailures incremented.
func (b *Bus) persistWithRetry(evt EventEnvelope) error {
	maxRetries := b.maxPersistRetries()
	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		err := b.persistFn(evt)
		if err == nil {
			return nil
		}
		lastErr = err
		if attempt < maxRetries {
			// Exponential backoff: 2ms, 4ms, 8ms, … capped at 50ms so the
			// synchronous retry path cannot stall Publish for too long.
			delay := persistRetryBaseDelay << attempt
			if delay > 50*time.Millisecond {
				delay = 50 * time.Millisecond
			}
			time.Sleep(delay)
		}
	}
	return lastErr
}

// PersistFailures returns the total number of events that exhausted all
// persist retry attempts and were dropped. Exposed for the
// edge_event_persist_failures_total Prometheus metric.
func (b *Bus) PersistFailures() int64 {
	if b == nil {
		return 0
	}
	return b.persistFailures.Load()
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
				"path", path, "error", err)
			return
		}
		b.eventLog = log
		if b.eventLogMaxSize > 0 {
			log.SetMaxSize(b.eventLogMaxSize)
		}
		b.persistFn = func(evt EventEnvelope) error {
			return log.Append(evt)
		}
	}
}

// WithEventLogMaxSize overrides the event log truncation threshold (bytes).
// Must be > 0 to take effect; <= 0 is ignored and the default 50 MiB applies.
// This option is order-independent with WithEventLogPath: whichever runs
// second applies the size to the already-opened or yet-to-be-opened log.
func WithEventLogMaxSize(bytes int64) BusOption {
	return func(b *Bus) {
		if bytes <= 0 {
			return
		}
		b.eventLogMaxSize = bytes
		if b.eventLog != nil {
			b.eventLog.SetMaxSize(bytes)
		}
	}
}
