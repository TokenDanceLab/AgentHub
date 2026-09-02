package events

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
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
		// Keep indexedSize in sync with the write so ReadFrom's external-change
		// check does not perform a redundant full-file rescan for appends we
		// made ourselves (the live index above is already correct). External
		// writes that bypass Append still change the size and trigger a rebuild.
		if fi, statErr := l.f.Stat(); statErr == nil {
			l.indexedSize = fi.Size()
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
