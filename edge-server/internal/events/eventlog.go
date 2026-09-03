package events

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// EventLog is an append-only JSON-lines event log backed by a file on disk.
// Each event is serialised as a single JSON line. Writes are safe for
// concurrent use.
//
// The log also maintains a seq→offset index so that a Bus restarting with an
// empty in-memory history can still replay events to a cursor-bearing
// subscriber (crash recovery / replay). The index is rebuilt on open and after
// every truncation; Subscribe also detects external file-size changes and
// rebuilds lazily so a truncate that happened between ticks stays safe.
//
// ORDERING CONTRACT: the file is in *append* order, which is NOT seq order.
// Bus.Publish hands out seqs with an atomic increment and only then calls
// persistFn (== Append), with no lock spanning the two, so concurrent
// publishers reach Append in an order unrelated to their seqs. Measured on a
// plain Bus with WithEventLogPath at 512 concurrent publishes per log:
// TestConcurrentPublishWritesSeqUnorderedLogFile below logs 46-56 inversions in
// 6/6 runs, and a 60-run sweep of the same shape saw the last line not be the
// largest seq in 10/60 runs and the first line not be the smallest in 20/60.
// Everything derived from the file must therefore be order-independent:
// orderedSeq is kept sorted by seq rather than by file position, and ReadFrom
// must not assume that a seq's byte offset bounds the offsets of larger seqs.
type EventLog struct {
	mu          sync.Mutex
	f           *os.File
	path        string
	maxSize     int64           // max file size in bytes before truncation; 0 = unlimited
	index       map[int64]int64 // seq → byte offset of the start of that line
	orderedSeq  []int64         // distinct keys of index, sorted ascending; binary-searched by ReadFrom
	indexedSize int64           // file size at last index build, to detect external changes

	// Invariant: orderedSeq is sorted ascending and holds exactly the keys of
	// index, so len(orderedSeq) == len(index). It is not positionally
	// "parallel" to index — index is a map, and the file's line order is
	// append order, not seq order (see the ORDERING CONTRACT above).
	// rebuildIndexLocked sorts after scanning, Append maintains the order via
	// appendSorted. Consumers rely on it: orderedSeq[0] is the oldest surviving
	// seq (ReadFrom's hasGap boundary) and orderedSeq[len-1] is the largest
	// (MaxSeq, which seeds Bus.seq on restart).

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
	// truncateNanos accumulates the wall time spent inside truncateLocked.
	// truncateLocked runs with l.mu held, so it stalls every publisher and
	// every replay for its whole duration; measured cost is ~26 ms per MiB of
	// retained window (#2304), i.e. ≈0.97 s of frozen bus per truncation at the
	// 50 MiB default (which retains 37.5 MiB). truncations says how *often*
	// that happens; without this the *how long* is invisible, so an operator
	// cannot distinguish a 1 ms truncation from a 1 s bus freeze and cannot
	// decide whether the structural fix (rotation instead of rewrite) is owed.
	// Exposed via Bus.EventLogTruncateDurationSeconds for
	// edge_event_log_truncate_duration_seconds_total.
	truncateNanos atomic.Int64
	// truncateLastNanos is the duration of the most recent truncateLocked call.
	// A cumulative counter hides a single long stall inside a rate() window;
	// this makes the most recent freeze directly readable in one scrape.
	// Exposed via Bus.EventLogTruncateLastDurationSeconds for
	// edge_event_log_truncate_last_duration_seconds.
	truncateLastNanos atomic.Int64
}

const defaultEventLogMaxSize = 50 * 1024 * 1024 // 50 MiB

// SetMaxSize overrides the maximum file size (in bytes) before truncation.
// 0 means unlimited. Values <= 0 are ignored (default preserved). This is
// intended to be called via WithEventLogMaxSize before any Append; calling
// it after writes have landed is safe but may trigger an immediate truncate
// on the next Append if the current file already exceeds the new limit.
func (l *EventLog) SetMaxSize(bytes int64) {
	if l == nil || bytes <= 0 {
		return
	}
	l.mu.Lock()
	l.maxSize = bytes
	l.mu.Unlock()
}

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
//
// Lines arrive in file (append) order, which is not seq order, so the collected
// seqs are sorted before they become orderedSeq. Without the sort every restart
// and every truncation left orderedSeq in file order and broke all three of its
// consumers: MaxSeq returned the last line's seq instead of the largest (so the
// restarted Bus re-issued seqs that were already on disk), orderedSeq[0] was
// the first line's seq instead of the smallest (so ReadFrom reported a gap for
// cursors the log still covered), and ReadFrom's sort.Search ran on unsorted
// input.
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
		nl := bytes.IndexByte(raw, '\n')
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
	// File order is append order, not seq order: sort to establish the
	// orderedSeq invariant (see the field comment). Duplicate seqs were already
	// collapsed above, so this is a plain ascending sort of distinct values.
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	l.index = index
	l.orderedSeq = ordered
	if fi, statErr := l.f.Stat(); statErr == nil {
		l.indexedSize = fi.Size()
	}
	// Restore the write cursor to the end so the next Append writes at EOF.
	_, _ = l.f.Seek(0, 2)
	return nil
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
		// Permanent, not transient: the same envelope fails to marshal every
		// time (a chan/func/NaN in the payload), so the retry ladder in
		// persistWithRetry can only add latency. Tagged so the retry loop can
		// fail fast — and since the wire gate (#2154) makes a slow persist a
		// bus-wide delay rather than this publisher's problem, that latency is
		// everybody's.
		return fmt.Errorf("%w: %v", errUnpersistableEvent, err)
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
		// The maxSize check and indexedSize each used to Stat the file again
		// here — two syscalls per event, inside l.mu, on the bus's hottest
		// lock, to learn something the arithmetic already gives us: the file is
		// opened O_APPEND, so a successful write of len(data) bytes at
		// writeOffset leaves it exactly writeOffset+len(data) long. Measured
		// over 3x2000 appends of a ~660-byte envelope, dropping the two Stats
		// takes Append from a 13.5us median to 11.8us (-13%), and the same
		// ~11% shows up under contention because the saving is inside the
		// critical section every publisher and every replay waits on (#2256
		// E-P3-7).
		//
		// Truncation is the one path where the size is genuinely not derivable
		// — truncateLocked rewrites the file — so that rare branch keeps a real
		// Stat and eventlog_append_size_test.go pins it.
		newSize := writeOffset + int64(len(data))
		if l.maxSize > 0 && newSize > l.maxSize {
			l.truncateLocked()
			if fi, statErr := l.f.Stat(); statErr == nil {
				newSize = fi.Size()
			}
		}
		// Keep indexedSize in sync with the write so ReadFrom's external-change
		// check does not perform a redundant full-file rescan for appends we
		// made ourselves (the live index above is already correct). External
		// writes that bypass Append still change the size and trigger a rebuild.
		l.indexedSize = newSize
	}
	return err
}

// readRetentionWindow reads the trailing keepBytes window that truncateLocked is
// about to rewrite, tolerating short reads, and returns the buffer, how many
// bytes of it are valid, and any real error.
//
// Looping is not defensive padding, it is the whole point. read(2) on a regular
// file may legally return fewer bytes than requested — large reads, a signal
// interrupting the call, network or overlay filesystems — and os.File.Read maps
// exactly one syscall to one call. keepBytes here is maxSize*3/4, i.e. 37.5 MiB
// at the 50 MiB default, so this is one of the largest reads the process does.
// The single Read this replaces meant that whenever the kernel came back short,
// truncateLocked rewrote only what it happened to get and Truncate(0) had
// already destroyed the rest: the unread tail is the *newest, highest-seq* part
// of the log, so a truncation could silently drop the most recent events and
// then rebuild an index that no longer mentions them. Injected short reads of 1,
// 3, 7 and 64 bytes per call are what TestReadRetentionWindow_ToleratesShortReads
// uses to pin this.
//
// A file shorter than the window (it shrank under us — an external truncation)
// is not an error: io.EOF / io.ErrUnexpectedEOF return what exists, and the
// caller rewrites that. Only a genuine read failure is reported, and the caller
// counts it as a truncate failure. errors.Is replaces the previous
// `err.Error() != "EOF"` string comparison, which missed any wrapped EOF.
func readRetentionWindow(r io.Reader, keepBytes int64) ([]byte, int, error) {
	buf := make([]byte, keepBytes)
	total := 0
	for int64(total) < keepBytes {
		n, err := r.Read(buf[total:])
		total += n
		if err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				return buf, total, nil
			}
			return buf, total, err
		}
	}
	return buf, total, nil
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
	// Timed because the whole body runs under l.mu: this is the bus freeze an
	// operator needs to be able to see (#2304). Both counters are written once
	// per truncation, not per event, so they add nothing to the Append path.
	truncateStarted := time.Now()
	defer func() {
		elapsed := time.Since(truncateStarted).Nanoseconds()
		l.truncateNanos.Add(elapsed)
		l.truncateLastNanos.Store(elapsed)
	}()

	l.truncations.Add(1)
	keepBytes := l.maxSize * 3 / 4 // keep last 75%
	if _, seekErr := l.f.Seek(-keepBytes, 2); seekErr != nil {
		// File too small or seek failed; skip truncation but surface it.
		l.truncateFailures.Add(1)
		slog.Error("event log truncate seek failed",
			"path", l.path, "keepBytes", keepBytes, "error", seekErr)
		return
	}
	buf, n, readErr := readRetentionWindow(l.f, keepBytes)
	if readErr != nil {
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
	// Rewrite through a *separate* O_RDWR handle, not through l.f.
	//
	// l.f is opened O_APPEND, and Windows denies SetEndOfFile on an append-mode
	// handle: every truncation failed with "Access is denied", so the event log
	// of every shipped Windows Edge (the desktop installer's
	// agenthub-edge-x86_64-pc-windows-msvc sidecar, and the portable build)
	// grew without bound, with only an error line per Append and
	// edge_event_log_truncate_failures_total to show for it. Linux accepted the
	// same call, which is why the defect was invisible until a test asserted on
	// the resulting file size on the Native Windows CI job.
	//
	// A second handle keeps the append handle's semantics untouched: Go opens
	// files with FILE_SHARE_READ|WRITE|DELETE, the rewrite is inside l.mu like
	// every other mutation, and the O_APPEND handle needs no repositioning
	// (rebuildIndexLocked below still seeks it to EOF for replay reads).
	rw, openErr := os.OpenFile(l.path, os.O_RDWR, 0o600)
	if openErr != nil {
		l.truncateFailures.Add(1)
		slog.Error("event log truncate reopen failed",
			"path", l.path, "error", openErr)
		return
	}
	if truncErr := rw.Truncate(0); truncErr != nil {
		_ = rw.Close()
		l.truncateFailures.Add(1)
		slog.Error("event log truncate Truncate(0) failed",
			"path", l.path, "error", truncErr)
		return
	}
	if _, seekErr := rw.Seek(0, 0); seekErr != nil {
		_ = rw.Close()
		l.truncateFailures.Add(1)
		slog.Error("event log truncate seek-to-start failed",
			"path", l.path, "error", seekErr)
		return
	}
	if start < n {
		// Best-effort rewrite: the log truncation path degrades silently on
		// write failure rather than failing the enclosing Append call.
		if written, writeErr := rw.Write(buf[start:n]); writeErr != nil || written != n-start {
			l.truncateFailures.Add(1)
			slog.Error("event log truncate rewrite failed",
				"path", l.path, "written", written, "want", n-start, "error", writeErr)
		}
	}
	if closeErr := rw.Close(); closeErr != nil {
		l.truncateFailures.Add(1)
		slog.Error("event log truncate close failed",
			"path", l.path, "error", closeErr)
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

// MaxSeq returns the largest seq currently indexed in the log, or 0 when the
// log is empty or nil. Bus uses it to seed its seq counter on restart.
//
// Callers must use this instead of reading orderedSeq directly: the slice is
// guarded by l.mu.
func (l *EventLog) MaxSeq() int64 {
	if l == nil {
		return 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.orderedSeq) == 0 {
		return 0
	}
	return l.orderedSeq[len(l.orderedSeq)-1]
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

// EventLogTruncateDurationNanos returns the cumulative wall time spent inside
// truncateLocked, in nanoseconds. Exposed for the
// edge_event_log_truncate_duration_seconds_total Prometheus metric; divided by
// EventLogTruncations it gives the mean bus freeze per truncation, and its rate
// gives the fraction of wall time the bus spends frozen by truncation.
func (l *EventLog) EventLogTruncateDurationNanos() int64 {
	if l == nil {
		return 0
	}
	return l.truncateNanos.Load()
}

// EventLogTruncateLastDurationNanos returns the wall time of the most recent
// truncateLocked call, in nanoseconds (0 if none yet). Exposed for the
// edge_event_log_truncate_last_duration_seconds Prometheus metric.
func (l *EventLog) EventLogTruncateLastDurationNanos() int64 {
	if l == nil {
		return 0
	}
	return l.truncateLastNanos.Load()
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
	firstSeq := l.orderedSeq[0] // oldest surviving seq: orderedSeq is sorted
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
	startOffset := l.replayStartOffsetLocked(startSeqIdx)

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
		nl := bytes.IndexByte(raw, '\n')
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
	// Sort the replay by seq. This is not a belt-and-braces no-op: the lines
	// above were read in file order, and file order is append order, so a
	// concurrent Publish can have written a larger seq before a smaller one.
	sort.Slice(events, func(i, j int) bool { return events[i].Seq < events[j].Seq })
	return events, hasGap
}

// replayStartOffsetLocked returns the byte offset ReadFrom has to seek to in
// order to see every event with seq >= cursor. Must be called with l.mu held and
// with 0 <= startSeqIdx < len(l.orderedSeq).
//
// The file is in append order, not seq order (see the EventLog ORDERING
// CONTRACT), so the offset of the first seq >= cursor is NOT a lower bound for
// the offsets of the remaining seqs >= cursor — a larger seq can sit on an
// earlier line. Seeking straight to index[orderedSeq[startSeqIdx]] and reading
// to EOF therefore silently dropped every such event from the replay, with no
// gap notification to tell the subscriber it had diverged. The minimum offset
// across the whole suffix is the correct start; ReadFrom's seq >= cursor filter
// still discards the extra earlier lines the wider read pulls in, so the result
// is exact rather than merely safe.
//
// Cost is O(k) map lookups where k is the number of events about to be replayed
// — the same k lines that get json.Unmarshal'ed immediately afterwards (~µs each
// vs ~ns per lookup), so this is noise next to the I/O it guards. When the file
// does happen to be seq-ordered the minimum is orderedSeq[startSeqIdx] itself
// and the offset is unchanged. A seq missing from index reads as offset 0, which
// widens the read to the whole file: over-reading is safe, under-reading is not.
func (l *EventLog) replayStartOffsetLocked(startSeqIdx int) int64 {
	startOffset := l.index[l.orderedSeq[startSeqIdx]]
	for _, seq := range l.orderedSeq[startSeqIdx+1:] {
		if off := l.index[seq]; off < startOffset {
			startOffset = off
		}
	}
	return startOffset
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
