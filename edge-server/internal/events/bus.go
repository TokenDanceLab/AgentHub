package events

import (
	"log/slog"
	"os"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

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

// Bus is an in-memory event bus with monotonic sequence numbers and
// support for cursor-based replay.
type Bus struct {
	mu sync.Mutex
	// seq is the last handed-out sequence number. Stamped under b.mu together
	// with the wireNext baseline so the two can never disagree (see Publish).
	seq int64
	// wireNext is the seq whose turn it is to reach the subscriber channels;
	// wireCond signals advance. A publisher that has finished persisting waits
	// at the gate in deliverInSeqOrder until every lower seq has been delivered
	// or consumed. This is what makes wire order equal seq order without holding
	// b.mu across the persist I/O. 0 means "no baseline yet"; it is set from the
	// first seq actually assigned, so a Bus whose counter was seeded (restart
	// recovery, or a test setting b.seq directly) cannot wedge the gate.
	wireNext   int64
	wireCond   *sync.Cond
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
	// synchronously up to persistDefaultMaxRetries times with exponential
	// backoff; only after all retries fail is the event dropped and
	// persistFailures incremented.
	persistFn PersistFn

	// persistFailures counts events that exhausted all persist retry
	// attempts and were dropped. Exposed via PersistFailures() for
	// operators that wire their own observability.
	persistFailures atomic.Int64

	// gaps counts subscriber-channel-full / replay-predates-log gap events
	// (GapPayload injections and ReadFrom hasGap detections). Exposed for
	// Prometheus as edge_event_log_gaps_total so operators see replay data
	// loss rate.
	gaps atomic.Int64

	// eventLog is the append-only event log opened by WithEventLogPath.
	// It is closed when Bus.Close() is called.
	eventLog *EventLog

	// eventLogMaxSize is the pending truncation threshold set by
	// WithEventLogMaxSize. Applied when WithEventLogPath opens the log;
	// 0 means use defaultEventLogMaxSize.
	eventLogMaxSize int64

	// Observer worker pool — fixed goroutines with channel-based dispatch.
	// stopCh is closed when the bus is shut down, signalling workers to exit.
	stopCh    chan struct{}
	jobs      chan observerJob
	workersWg sync.WaitGroup

	// closeOnce makes Close idempotent: a second call (e.g. from a shutdown
	// hook + a defer in the same process) must not re-close stopCh and panic.
	closeOnce sync.Once
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
		history:    make([]EventEnvelope, 0, maxHistory),
		maxHistory: maxHistory,
		stopCh:     make(chan struct{}),
		jobs:       make(chan observerJob, observerJobBufferSize),
	}
	b.wireCond = sync.NewCond(&b.mu)

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
	// (called by WithEventLogPath), so MaxSeq is already accurate here.
	//
	// MaxSeq — not "the seq of the last line in the file": the log is in append
	// order and concurrent Publish reaches Append out of seq order, so the last
	// line is not reliably the largest seq. Seeding from it let a restarted Bus
	// hand out seqs that were already on disk. Plain store: b is not observable
	// by any other goroutine until NewBus returns, and from then on seq is only
	// ever written under b.mu. wireNext stays 0 here on purpose — Publish derives
	// the gate baseline from the first seq it actually assigns, so a seeded
	// counter cannot wedge the gate.
	if b.eventLog != nil {
		b.seq = b.eventLog.MaxSeq()
	}
	return b
}

// Publish assigns a monotonic seq, persists the event (if a persister is
// configured and the event type is eligible), appends the event to history, and
// fans it out to all subscribers. The event ID and seq are set by the bus.
//
// WIRE ORDER == SEQ ORDER. Subscribers dedup on seq —
// app/shared/src/eventClient.ts:202 is `if (envelope.seq <= lastSeq) return;` —
// and api/events.md:67 promises "`seq` 同 stream 单调", so an envelope that
// reaches the wire after a larger seq is discarded permanently by the client as
// a "replay duplicate", with no system.gap to tell it that a state change was
// lost. Handing the seq out with a lock-free atomic and then running an unlocked
// persist left a preemption window in which exactly that happened: measured at
// 87-92 inversions per 1000 concurrently published events, both with and without
// an event log configured. hub-server/internal/ws/fanout.go:92-101 enforces the
// same contract for Hub frames.
//
// The ordering is enforced by a gate (wireNext/wireCond), NOT by holding b.mu
// across the persist. Holding the lock across persistFn was measured and
// rejected: EventLog truncation is linear in maxSize at ~16.7ms/MiB — 130ms at an
// 8 MiB log, ~835ms extrapolated at the 50 MiB default, once per ~25k events —
// and persistWithRetry's backoff ladder is ~14.5ms for a publish that fails all
// attempts. Inside b.mu those would freeze Subscribe, Unsubscribe, AddObserver
// and HistoryLen (a Prometheus scrape) bus-wide, and overflow the 256-slot
// subscriber channels into a gap storm. The gate keeps that I/O off b.mu: the
// blast radius of a slow persist stays exactly what it is today (publishers
// serialise on EventLog.mu), while delivery becomes ordered instead of racy.
//
// Cost: head-of-line blocking. A publisher waits at the gate until every lower
// seq has been delivered or consumed, so Publish latency now includes the
// slowest in-flight lower-seq persist. That is bounded by the same persist path
// that already serialises publishers today — it converts out-of-order delivery
// (silent client-side loss) into delayed delivery.
//
// If a persistence hook is configured and it returns an error, the event is
// NOT appended to history and NOT broadcast to subscribers. The caller receives
// a zero-value EventEnvelope with the event type populated so it can detect the
// failure. The seq is still consumed at the gate so a dropped event cannot wedge
// the wire order for everyone behind it.
func (b *Bus) Publish(eventType string, scope map[string]any, payload any) EventEnvelope {
	// Build everything that does not depend on the seq before taking b.mu: genID
	// is a crypto/rand read and the RFC3339 timestamp is a few hundred ns.
	evt := EventEnvelope{
		Version: "v1",
		ID:      genID("evt"),
		Type:    eventType,
		Scope:   scope,
		SentAt:  time.Now().UTC().Format(time.RFC3339),
		Payload: payload,
	}
	if evt.Scope == nil {
		evt.Scope = map[string]any{}
	}

	b.mu.Lock()
	b.seq++
	seq := b.seq
	evt.Seq = seq
	if b.wireNext == 0 {
		// First seq assigned on this Bus defines the gate baseline. Deriving it
		// from the first seq to ARRIVE at the gate instead would be wrong: that
		// publisher is not necessarily the lowest seq.
		b.wireNext = seq
	}
	b.mu.Unlock()

	// Persist before fanout: if a persistence hook is configured and the
	// event type is eligible, write to durable store before in-memory append.
	// On failure, the event is retried synchronously up to persistMaxRetries
	// times with exponential backoff. Only after all retries fail is the event
	// dropped — observers and subscribers never see it, and persistFailures
	// is incremented so the edge_event_persist_failures_total metric surfaces
	// the data loss.
	deliver := true
	if b.persistFn != nil {
		if err := b.persistWithRetry(evt); err != nil {
			b.persistFailures.Add(1)
			slog.Error("event bus persist failed after retries, dropping event",
				"type", eventType, "seq", seq, "retries", b.maxPersistRetries(), "error", err)
			deliver = false
		}
	}

	observers := b.deliverInSeqOrder(seq, evt, deliver)
	if !deliver {
		// Return a minimal envelope so callers can detect the failure.
		return EventEnvelope{Version: "v1", Type: eventType, Seq: seq}
	}

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

// deliverInSeqOrder waits for seq's turn at the wire gate and then, when deliver
// is true, appends evt to history and fans it out to every subscriber. It returns
// the observer list copied under the lock so the caller can dispatch to the worker
// pool after the gate is released.
//
// The gate advance runs in a defer: a seq that is assigned but never consumed
// would wedge every publisher behind it forever, so a panic or runtime.Goexit
// anywhere below must still hand the turn to the next seq.
//
// Wait releases b.mu, so Subscribe / Unsubscribe / HistoryLen stay responsive
// while a publisher is waiting for a slow lower-seq persist. That is the whole
// point of gating instead of holding b.mu across persistFn — see Publish.
func (b *Bus) deliverInSeqOrder(seq int64, evt EventEnvelope, deliver bool) []observer {
	b.mu.Lock()
	defer func() {
		b.wireNext = seq + 1
		b.wireCond.Broadcast()
		b.mu.Unlock()
	}()

	for b.wireNext < seq {
		b.wireCond.Wait()
	}

	if !deliver {
		// Persist failed and the event is dropped, but its seq is still consumed
		// so the wire stays contiguous for everyone behind it. The resulting hole
		// is the client-side loss signal — the same choice
		// hub-server/internal/ws/fanout.go documents for dropped frames.
		return nil
	}

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

	return observers
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
	// Read the on-disk gap-filler BEFORE taking b.mu. ReadFrom does file I/O
	// + per-line unmarshal (a reconnect with an old cursor can replay tens of
	// MiB); holding b.mu across it would stall every Publish fanout for the
	// whole replay duration (#2154 perf-lane F15). The event log pointer is
	// fixed at construction, so this is race-free.
	var logEvents []EventEnvelope
	var logHasGap bool
	logRead := b.eventLog != nil && cursor > 0
	if logRead {
		logEvents, logHasGap = b.eventLog.ReadFrom(cursor)
	}

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
	if logRead {
		replay = mergeReplayWithLog(replay, seenSeqs, logEvents, logHasGap, cursor)
	}

	return id, ch, replay
}

// mergeReplayWithLog merges on-disk log events into the in-memory replay.
// History takes priority (seenSeqs dedup, freshest copy wins); a gap payload
// (seq=0) is injected when the cursor predates the oldest surviving log event.
// Pure function extracted from Subscribe so the replay contract is unit-tested
// independently of the lock reordering (#2154 perf-lane F15).
func mergeReplayWithLog(
	replay []EventEnvelope,
	seenSeqs map[int64]bool,
	logEvents []EventEnvelope,
	hasGap bool,
	cursor int64,
) []EventEnvelope {
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
	return replay
}

// replayFromHistory returns the in-memory history slice filtered to seq >=
// cursor, plus the set of seen seqs so the caller can dedup against the event
// log. History takes priority (freshest copy wins).
//
// The result is sorted by seq unconditionally. b.history is filled in gate order,
// which is seq order, so this is normally a no-op on an already-ordered slice
// (pdqsort detects the run in O(n)) — but Subscribe only routes through
// mergeReplayWithLog (which sorts the merged result) when an event log is
// configured AND cursor > 0. A cursor=0 subscribe, i.e. the initial full-replay
// connect, and any bus without an event log therefore used to get history order
// raw, which handed the client a non-monotonic replay. Sorting here makes the
// contract independent of how history happened to be filled.
func (b *Bus) replayFromHistory(cursor int64) ([]EventEnvelope, map[int64]bool) {
	replay := make([]EventEnvelope, 0, len(b.history))
	seenSeqs := make(map[int64]bool, len(b.history))
	for _, evt := range b.history {
		if evt.Seq >= cursor {
			replay = append(replay, evt)
			seenSeqs[evt.Seq] = true
		}
	}
	sort.Slice(replay, func(i, j int) bool { return replay[i].Seq < replay[j].Seq })
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
//
// Close is idempotent: a second call (e.g. from a shutdown hook plus a defer
// in the same process) returns nil without re-closing stopCh and panicking.
func (b *Bus) Close() error {
	var eventLogErr error
	b.closeOnce.Do(func() {
		// Shut down the observer worker pool.
		close(b.stopCh)
		b.workersWg.Wait()

		if b.eventLog != nil {
			eventLogErr = b.eventLog.Close()
		}
	})
	return eventLogErr
}
