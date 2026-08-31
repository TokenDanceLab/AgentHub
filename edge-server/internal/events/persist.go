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

// maxPersistRetries returns the persist retry count for the bus. The
// override seam was removed with the unused WithPersistMaxRetries option, so
// this is always the compile-time default.
func (b *Bus) maxPersistRetries() int {
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
