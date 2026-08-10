package events

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

const (
	defaultMaxHistory           = 10000
	subscriberChannelBufferSize = 256
	defaultWorkerCount          = 4
	observerJobBufferSize       = 1024

	// persistDefaultMaxRetries bounds how many times persistWithRetry retries a
	// persistFn call that returned an error before declaring the event lost.
	// 1 = one original attempt + one retry; 3 = original + three retries.
	persistDefaultMaxRetries = 3
	// persistRetryBaseDelay is the exponential backoff base between persist
	// retry attempts. Kept short so the synchronous retry path does not
	// stall Publish under normal transient failures.
	persistRetryBaseDelay = 2 * time.Millisecond
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

// observerJob is a unit of work dispatched to the observer worker pool.
type observerJob struct {
	fn  func(EventEnvelope)
	evt EventEnvelope
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
//
// The log also maintains a seq→offset index so that a Bus restarting with an
// empty in-memory history can still replay events to a cursor-bearing
// subscriber (crash recovery / replay). The index is rebuilt on open and after
// every truncation; Subscribe also detects external file-size changes and
// rebuilds lazily so a truncate that happened between ticks stays safe.
type EventLog struct {
	mu          sync.Mutex
	f           *os.File
	path        string
	maxSize     int64           // max file size in bytes before truncation; 0 = unlimited
	index       map[int64]int64 // seq → byte offset of that line (exclusive of the seq→offset map)
	orderedSeq  []int64         // sorted seqs parallel to index, for binary search
	indexedSize int64           // file size at last index build, to detect external changes

	// truncations counts truncateLocked invocations (a truncation was
	// attempted because the log exceeded maxSize). Exposed via
	// Bus.EventLogTruncations for the edge_event_log_truncations_total metric.
	truncations atomic.Int64
	// truncateFailures counts truncateLocked invocations that hit an error
	// branch (seek/read/truncate/rewrite failure) and previously returned
	// silently. Exposed via Bus.EventLogTruncateFailures for
	// edge_event_log_truncate_failures_total so an operator whose log was
	// growing unbounded or losing replay data finally gets a signal.
	truncateFailures atomic.Int64
	// gaps counts ReadFrom calls that detected a cursor predating the oldest
	// surviving log event (replay would lose events). Exposed via
	// Bus.EventLogGaps for the edge_event_log_gaps_total metric.
	gaps atomic.Int64
}

const defaultEventLogMaxSize = 50 * 1024 * 1024 // 50 MiB

// NewEventLog opens or creates the append-only event log at the given path.
// The parent directory is created if it does not exist. The file is opened
// read+write so the log can serve replay reads in addition to appends. The
// seq→offset index is built by scanning existing lines so a restarted Bus can
// replay history from disk before any new Publish lands.
func NewEventLog(path string) (*EventLog, error) {
	if path == "" {
		return nil, nil
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, err
	}
	// #nosec G304 -- event log path comes from operator config (WithEventLogPath)
	// O_RDWR so the log is readable for replay; O_APPEND so writes always go to
	// the end regardless of the read seek position.
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	l := &EventLog{f: f, path: path, maxSize: defaultEventLogMaxSize, index: make(map[int64]int64)}
	if err := l.rebuildIndexLocked(); err != nil {
		// A corrupt or unreadable log is not fatal: the Bus keeps working with
		// an empty index (replay falls back to in-memory history only). Log the
		// error so operators can repair the file.
		slog.Error("event log index build failed; replay will be incomplete until the file is repaired",
			"path", path, "error", err)
		l.index = make(map[int64]int64)
		l.orderedSeq = nil
	}
	return l, nil
}

// rebuildIndexLocked scans the entire log file line by line, recording each
// event's seq and its byte offset. Must be called with l.mu held.
func (l *EventLog) rebuildIndexLocked() error {
	if l == nil || l.f == nil {
		return nil
	}
	if _, err := l.f.Seek(0, 0); err != nil {
		return err
	}
	index := make(map[int64]int64)
	var ordered []int64
	// Track the byte offset of each line start. json.Decoder does not expose
	// offsets, so we count bytes consumed by reading the raw file in a single
	// pass and splitting on newlines.
	raw, err := io.ReadAll(l.f)
	if err != nil {
		return err
	}
	offset := int64(0)
	for len(raw) > 0 {
		nl := indexByte(raw, '\n')
		var line []byte
		var lineLen int
		if nl < 0 {
			line = raw
			lineLen = len(raw)
			raw = nil
		} else {
			line = raw[:nl]
			lineLen = nl + 1
			raw = raw[lineLen:]
		}
		if len(line) == 0 {
			offset += int64(lineLen)
			continue
		}
		var env EventEnvelope
		if json.Unmarshal(line, &env) == nil && env.Seq > 0 {
			if _, exists := index[env.Seq]; !exists {
				ordered = append(ordered, env.Seq)
			}
			index[env.Seq] = offset
		}
		offset += int64(lineLen)
	}
	l.index = index
	l.orderedSeq = ordered
	if fi, statErr := l.f.Stat(); statErr == nil {
		l.indexedSize = fi.Size()
	}
	// Restore the write cursor to the end so the next Append writes at EOF.
	_, _ = l.f.Seek(0, 2)
	return nil
}

// indexByte returns the index of the first occurrence of b in s, or -1.
func indexByte(s []byte, b byte) int {
	for i, c := range s {
		if c == b {
			return i
		}
	}
	return -1
}

// Append writes an event to the log as a single JSON line followed by a newline.
// After the write, the event's seq→offset is added to the index so replay can
// find it without rescanning the file. When the file exceeds maxSize the log
// is truncated and the index rebuilt.
func (l *EventLog) Append(evt EventEnvelope) error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	// Record the write offset before writing so the index points at the line
	// start. With O_APPEND the current seek position is irrelevant for writes,
	// so we stat to get the current end-of-file size.
	writeOffset := int64(0)
	if fi, statErr := l.f.Stat(); statErr == nil {
		writeOffset = fi.Size()
	}

	data, err := json.Marshal(evt)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = l.f.Write(data)
	if err == nil {
		// Extend the live index so the just-appended event is immediately
		// replayable without a full rescan.
		if evt.Seq > 0 {
			if _, exists := l.index[evt.Seq]; !exists {
				l.orderedSeq = appendSorted(l.orderedSeq, evt.Seq)
			}
			l.index[evt.Seq] = writeOffset
		}
		if l.maxSize > 0 {
			if fi, statErr := l.f.Stat(); statErr == nil && fi.Size() > l.maxSize {
				l.truncateLocked()
			}
		}
	}
	return err
}

// appendSorted inserts seq into the sorted slice maintaining order. Used by
// Append to extend the ordered index without a full sort.
func appendSorted(sorted []int64, seq int64) []int64 {
	idx := sort.Search(len(sorted), func(i int) bool { return sorted[i] >= seq })
	if idx < len(sorted) && sorted[idx] == seq {
		return sorted // already present
	}
	sorted = append(sorted, 0)
	copy(sorted[idx+1:], sorted[idx:])
	sorted[idx] = seq
	return sorted
}

// truncateLocked rewrites the log file keeping only the trailing portion.
// Must be called with l.mu held. The index is rebuilt after the rewrite so
// replay offsets stay accurate after truncation. Every failure branch that
// previously returned silently now increments truncateFailures and emits a
// slog.Error so an operator whose log is growing unbounded or losing replay
// offsets finally gets a signal (edge_event_log_truncate_failures_total).
func (l *EventLog) truncateLocked() {
	l.truncations.Add(1)
	keepBytes := l.maxSize * 3 / 4 // keep last 75%
	if _, seekErr := l.f.Seek(-keepBytes, 2); seekErr != nil {
		// File too small or seek failed; skip truncation but surface it.
		l.truncateFailures.Add(1)
		slog.Error("event log truncate seek failed",
			"path", l.path, "keepBytes", keepBytes, "error", seekErr)
		return
	}
	buf := make([]byte, keepBytes)
	n, readErr := l.f.Read(buf)
	if readErr != nil && readErr.Error() != "EOF" {
		l.truncateFailures.Add(1)
		slog.Error("event log truncate read failed",
			"path", l.path, "keepBytes", keepBytes, "error", readErr)
		return
	}
	// Skip to next newline so we don't keep a partial line.
	start := 0
	for i := 0; i < n; i++ {
		if buf[i] == '\n' {
			start = i + 1
			break
		}
	}
	// Truncate and rewrite.
	if truncErr := l.f.Truncate(0); truncErr != nil {
		l.truncateFailures.Add(1)
		slog.Error("event log truncate Truncate(0) failed",
			"path", l.path, "error", truncErr)
		return
	}
	if _, seekErr := l.f.Seek(0, 0); seekErr != nil {
		l.truncateFailures.Add(1)
		slog.Error("event log truncate seek-to-start failed",
			"path", l.path, "error", seekErr)
		return
	}
	if start < n {
		// Best-effort rewrite: the log truncation path degrades silently on
		// write failure rather than failing the enclosing Append call.
		if written, writeErr := l.f.Write(buf[start:n]); writeErr != nil || written != n-start {
			l.truncateFailures.Add(1)
			slog.Error("event log truncate rewrite failed",
				"path", l.path, "written", written, "want", n-start, "error", writeErr)
		}
	}
	// Rebuild the index so replay offsets reflect the truncated file. A
	// rebuild failure also counts as a truncate failure (the log is now in a
	// partially-rewritten state and replay offsets are unreliable).
	if err := l.rebuildIndexLocked(); err != nil {
		l.truncateFailures.Add(1)
		slog.Error("event log truncate index rebuild failed",
			"path", l.path, "error", err)
	}
}

// EventLogTruncations returns the total number of truncateLocked invocations
// (truncations attempted because the log exceeded maxSize). Exposed for the
// edge_event_log_truncations_total Prometheus metric.
func (l *EventLog) EventLogTruncations() int64 {
	if l == nil {
		return 0
	}
	return l.truncations.Load()
}

// EventLogTruncateFailures returns the total number of truncateLocked
// invocations that hit an error branch. Exposed for the
// edge_event_log_truncate_failures_total Prometheus metric.
func (l *EventLog) EventLogTruncateFailures() int64 {
	if l == nil {
		return 0
	}
	return l.truncateFailures.Load()
}

// EventLogGaps returns the total number of replay/ fanout gaps detected
// (events lost to truncation or pre-dating the log, or subscriber-channel-full
// drops). Exposed for the edge_event_log_gaps_total Prometheus metric.
func (b *Bus) EventLogGaps() int64 {
	if b == nil {
		return 0
	}
	total := b.gaps.Load()
	if b.eventLog != nil {
		total += b.eventLog.gaps.Load()
	}
	return total
}

// EventLogTruncations returns the total number of truncateLocked invocations,
// delegating to the event log when one is configured. Exposed for the
// edge_event_log_truncations_total Prometheus metric.
func (b *Bus) EventLogTruncations() int64 {
	if b == nil || b.eventLog == nil {
		return 0
	}
	return b.eventLog.EventLogTruncations()
}

// EventLogTruncateFailures returns the total number of truncateLocked
// invocations that hit an error branch, delegating to the event log when one
// is configured. Exposed for the edge_event_log_truncate_failures_total
// Prometheus metric.
func (b *Bus) EventLogTruncateFailures() int64 {
	if b == nil || b.eventLog == nil {
		return 0
	}
	return b.eventLog.EventLogTruncateFailures()
}

// ReadFrom returns all events with seq >= cursor from the on-disk log. It is
// used by Bus.Subscribe when the in-memory history does not cover the cursor
// (e.g. after a process restart). The returned hasGap flag is true when cursor
// is non-zero and below the first seq in the log, indicating events were lost
// to truncation or predate the log. The caller injects a GapPayload in that
// case so the subscriber knows it must resync.
//
// Safe to call concurrently with Append; both serialize on l.mu. The caller
// (Subscribe) holds the Bus lock, but Append runs outside it, so the EventLog
// mutex is the serialization point.
func (l *EventLog) ReadFrom(cursor int64) (events []EventEnvelope, hasGap bool) {
	if l == nil || l.f == nil {
		return nil, false
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	// Detect external file-size changes (e.g. an operator truncating the log
	// between ticks) and rebuild the index so offsets stay accurate.
	if fi, statErr := l.f.Stat(); statErr == nil && fi.Size() != l.indexedSize {
		if err := l.rebuildIndexLocked(); err != nil {
			slog.Warn("event log index rebuild on size change failed", "path", l.path, "error", err)
			return nil, cursor > 0 && len(l.orderedSeq) > 0 && cursor < l.orderedSeq[0]
		}
	}

	if len(l.orderedSeq) == 0 {
		// No events in the log. A non-zero cursor means the caller expects
		// events that predate the (empty) log → gap.
		return nil, cursor > 0
	}
	firstSeq := l.orderedSeq[0]
	if cursor > 0 && cursor < firstSeq {
		// The cursor predates the oldest surviving log event: events between
		// cursor and firstSeq were lost (truncated or predate the log).
		hasGap = true
		// Surface the data loss so edge_event_log_gaps_total shows replay
		// gaps instead of letting them stay silent.
		l.gaps.Add(1)
	}

	// Binary search for the first seq >= cursor (or first overall when cursor
	// is 0 / below firstSeq).
	startSeqIdx := 0
	if cursor > firstSeq {
		startSeqIdx = sort.Search(len(l.orderedSeq), func(i int) bool {
			return l.orderedSeq[i] >= cursor
		})
	}
	if startSeqIdx >= len(l.orderedSeq) {
		// cursor is at or past the last logged seq: no log events to replay.
		return nil, hasGap
	}
	startOffset := l.index[l.orderedSeq[startSeqIdx]]

	// Seek to the start offset and read from there to EOF.
	if _, err := l.f.Seek(startOffset, 0); err != nil {
		slog.Warn("event log replay seek failed", "path", l.path, "offset", startOffset, "error", err)
		return nil, hasGap
	}
	raw, err := io.ReadAll(l.f)
	if err != nil {
		slog.Warn("event log replay read failed", "path", l.path, "error", err)
		return nil, hasGap
	}
	// Restore the write cursor to EOF for the next Append.
	_, _ = l.f.Seek(0, 2)

	for len(raw) > 0 {
		nl := indexByte(raw, '\n')
		var line []byte
		if nl < 0 {
			line = raw
			raw = nil
		} else {
			line = raw[:nl]
			raw = raw[nl+1:]
		}
		if len(line) == 0 {
			continue
		}
		var env EventEnvelope
		if json.Unmarshal(line, &env) == nil && env.Seq >= cursor {
			events = append(events, env)
		}
	}
	// Ensure the replay slice is sorted by seq (the file is append-order which
	// should already be seq-ordered, but truncation can leave partial overlap).
	sort.Slice(events, func(i, j int) bool { return events[i].Seq < events[j].Seq })
	return events, hasGap
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
	// history or fanned out to subscribers. Persist failures are retried
	// synchronously up to persistMaxRetries times with exponential backoff;
	// only after all retries fail is the event dropped and
	// persistFailures incremented.
	persistFn PersistFn

	// persistMaxRetries bounds the number of synchronous retry attempts
	// after a persistFn failure. -1 (the zero/unset value) means use
	// persistDefaultMaxRetries; 0 means no retries (original attempt only);
	// any positive N means original + N retries. Set via WithPersistMaxRetries.
	persistMaxRetries int

	// persistFailures counts events that exhausted all persist retry
	// attempts and were dropped. Exposed for Prometheus as
	// edge_event_persist_failures_total.
	persistFailures atomic.Int64

	// gaps counts subscriber-channel-full / replay-predates-log gap events
	// (GapPayload injections and ReadFrom hasGap detections). Exposed for
	// Prometheus as edge_event_log_gaps_total so operators see replay data
	// loss rate.
	gaps atomic.Int64

	// eventLog is the append-only event log opened by WithEventLogPath.
	// It is closed when Bus.Close() is called.
	eventLog *EventLog

	// persistOutputBatch controls whether run.output.batch events go through
	// the persistence hook. Default true.
	persistOutputBatch bool

	// Observer worker pool — fixed goroutines with channel-based dispatch.
	// stopCh is closed when the bus is shut down, signalling workers to exit.
	stopCh    chan struct{}
	jobs      chan observerJob
	workersWg sync.WaitGroup
}

// NewBus creates a new event bus with the given maximum history size.
// It reads AGENTHUB_EVENT_WORKERS from the environment (default 4) to
// determine the number of observer worker goroutines.
func NewBus(maxHistory int, opts ...BusOption) *Bus {
	if maxHistory <= 0 {
		maxHistory = defaultMaxHistory
	}

	workerCount := defaultWorkerCount
	if s := os.Getenv("AGENTHUB_EVENT_WORKERS"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n >= 1 && n <= 256 {
			workerCount = n
		}
	}

	b := &Bus{
		history:            make([]EventEnvelope, 0, maxHistory),
		maxHistory:         maxHistory,
		persistOutputBatch: true,
		persistMaxRetries:  -1, // -1 sentinel: use persistDefaultMaxRetries until WithPersistMaxRetries overrides
		stopCh:             make(chan struct{}),
		jobs:               make(chan observerJob, observerJobBufferSize),
	}

	// Start fixed-size observer worker pool.
	for i := 0; i < workerCount; i++ {
		b.workersWg.Add(1)
		go b.runWorker()
	}

	for _, o := range opts {
		o(b)
	}
	// When an event log is configured, initialize the seq counter to the max
	// seq in the log so a restarted Bus does not re-issue seqs that already
	// exist on disk (which would duplicate replay entries and break the
	// #130 idempotent dedup contract). The EventLog index is built in NewEventLog
	// (called by WithEventLogPath), so orderedSeq is already populated here.
	if b.eventLog != nil && len(b.eventLog.orderedSeq) > 0 {
		b.seq = b.eventLog.orderedSeq[len(b.eventLog.orderedSeq)-1]
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
	// On failure, the event is retried synchronously up to persistMaxRetries
	// times with exponential backoff. Only after all retries fail is the event
	// dropped — observers and subscribers never see it, and persistFailures
	// is incremented so the edge_event_persist_failures_total metric surfaces
	// the data loss.
	if b.persistFn != nil && b.shouldPersist(eventType) {
		if err := b.persistWithRetry(evt); err != nil {
			b.persistFailures.Add(1)
			slog.Error("event bus persist failed after retries, dropping event",
				"type", eventType, "seq", seq, "retries", b.maxPersistRetries(), "error", err)
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
				// Surface the gap so edge_event_log_gaps_total shows fanout
				// data loss instead of letting it stay silent.
				b.gaps.Add(1)
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

	// Dispatch to observer worker pool — no per-event goroutine creation.
	// Each observer function is submitted as a job to the fixed-size pool.
	// Jobs are dropped non-blockingly when the pool is saturated to avoid
	// back-pressuring Publish().
	if len(observers) > 0 {
		for _, obs := range observers {
			job := observerJob{fn: obs.fn, evt: evt}
			select {
			case b.jobs <- job:
			default:
				// Worker pool saturated; drop this observer notification.
			}
		}
	}

	return evt
}

// runWorker is a long-lived goroutine that processes observer jobs from the
// shared job channel. It exits when the stop channel is closed.
func (b *Bus) runWorker() {
	defer b.workersWg.Done()
	for {
		select {
		case job, ok := <-b.jobs:
			if !ok {
				return
			}
			func() {
				defer func() {
					if recovered := recover(); recovered != nil {
						slog.Error("event bus observer panic", "panic", recovered)
					}
				}()
				job.fn(job.evt)
			}()
		case <-b.stopCh:
			return
		}
	}
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
	//
	// Two sources feed the replay:
	//   1. In-memory history ring (events published since this process started).
	//   2. On-disk event log (events from before the process restarted).
	// When history does not cover the cursor (e.g. after a restart, history is
	// empty but the subscriber has cursor=N from the previous session), the
	// event log fills the gap. History takes priority for dedup so the freshest
	// copy of an event that exists in both wins. When the cursor predates the
	// oldest surviving log event, a GapPayload is injected so the subscriber
	// knows events were lost to truncation and must resync.
	replay, seenSeqs := b.replayFromHistory(cursor)
	if b.eventLog != nil && cursor > 0 {
		logEvents, hasGap := b.eventLog.ReadFrom(cursor)
		if hasGap {
			replay = append(replay, EventEnvelope{
				Version: "v1",
				ID:      genID("gap"),
				Seq:     0,
				Type:    GapEventType,
				Scope:   map[string]any{},
				SentAt:  time.Now().UTC().Format(time.RFC3339),
				Payload: &GapPayload{
					FirstDroppedSeq: cursor,
					LastDroppedSeq:  0,
					DroppedCount:    0,
				},
			})
		}
		for _, evt := range logEvents {
			if evt.Seq >= cursor && !seenSeqs[evt.Seq] {
				replay = append(replay, evt)
				seenSeqs[evt.Seq] = true
			}
		}
		// Merge-order: sort the combined slice by seq so the subscriber sees a
		// monotonic replay regardless of source ordering. The gap event (seq=0)
		// sorts to the front, ahead of any real events, so the subscriber
		// resyncs before processing replayed events.
		sort.Slice(replay, func(i, j int) bool { return replay[i].Seq < replay[j].Seq })
	}

	return id, ch, replay
}

// replayFromHistory returns the in-memory history slice filtered to seq >=
// cursor, plus the set of seen seqs so the caller can dedup against the event
// log. History takes priority (freshest copy wins).
func (b *Bus) replayFromHistory(cursor int64) ([]EventEnvelope, map[int64]bool) {
	var replay []EventEnvelope
	seenSeqs := make(map[int64]bool, len(b.history))
	for _, evt := range b.history {
		if evt.Seq >= cursor {
			replay = append(replay, evt)
			seenSeqs[evt.Seq] = true
		}
	}
	return replay, seenSeqs
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

// Close shuts down the observer worker pool, closes the job channel, and
// flushes and closes the underlying event log if one was configured via
// WithEventLogPath. It is safe to call Close on a Bus that has no event log.
func (b *Bus) Close() error {
	// Shut down the observer worker pool.
	close(b.stopCh)
	b.workersWg.Wait()

	if b.eventLog != nil {
		return b.eventLog.Close()
	}
	return nil
}
