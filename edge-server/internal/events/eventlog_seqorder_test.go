package events

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"
)

// This file pins the EventLog ordering invariant (#2154 lane B):
//
//	orderedSeq is sorted by seq, and no consumer may assume that the log
//	FILE is in seq order.
//
// The file is only ever in *append* order. Bus.Publish hands out seqs with an
// atomic increment and calls persistFn (== EventLog.Append) afterwards without
// holding any lock across the two, so concurrent publishers reach Append in an
// order unrelated to their seqs. TestConcurrentPublishWritesSeqUnorderedLogFile
// below measures that on the real Bus; the deterministic tests replay the same
// file shape through the exported Append API.

// unorderedFileSeqs is a log-file line order that TestConcurrentPublish...
// proves concurrent Publish really produces: the first line is not the smallest
// seq (8 > 3) and the last line is not the largest (6 < 13).
//
// It is written through EventLog.Append only — the exported method that
// Bus.persistFn calls — so nothing here pokes at unexported fields to fake a
// corrupt index.
var unorderedFileSeqs = []int64{8, 3, 12, 5, 11, 4, 13, 6}

// writeUnorderedLog produces a real on-disk log whose line order differs from
// its seq order, and returns the seqs in file order.
func writeUnorderedLog(t *testing.T, path string, fileOrder []int64) []int64 {
	t.Helper()
	log, err := NewEventLog(path)
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	for _, seq := range fileOrder {
		evt := EventEnvelope{
			Version: "v1",
			ID:      fmt.Sprintf("evt_%d", seq),
			Seq:     seq,
			Type:    "test.event",
			SentAt:  "2026-09-02T00:00:00Z",
			Payload: seq,
		}
		if err := log.Append(evt); err != nil {
			t.Fatalf("Append(seq=%d): %v", seq, err)
		}
	}
	if err := log.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	return fileOrder
}

// readFileSeqOrder reads the log file back the way an operator would and
// returns the seq of each line in file order. Used to assert on what actually
// landed on disk rather than on in-memory state.
func readFileSeqOrder(t *testing.T, path string) []int64 {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer func() { _ = f.Close() }()

	var seqs []int64
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var evt EventEnvelope
		if json.Unmarshal(line, &evt) != nil {
			continue
		}
		seqs = append(seqs, evt.Seq)
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("scan %s: %v", path, err)
	}
	return seqs
}

// countFileOrderInversions reports how many adjacent line pairs are out of seq
// order, i.e. how badly the file violates "line order == seq order".
func countFileOrderInversions(seqs []int64) int {
	n := 0
	for i := 1; i < len(seqs); i++ {
		if seqs[i] < seqs[i-1] {
			n++
		}
	}
	return n
}

// TestConcurrentPublishWritesSeqUnorderedLogFile is the reachability proof: a
// plain Bus with WithEventLogPath, published to from several goroutines exactly
// as the 46 production Publish call sites do, writes a log file whose line
// order is NOT its seq order.
//
// The assertion is the invariant, not the inversion: for every file this test
// produces, orderedSeq must be sorted and ReadFrom must return every event at
// or after the cursor. Inversion counts are logged so a future change that
// serialises Publish (and thereby makes the caveat comments unnecessary) is
// visible rather than silent.
func TestConcurrentPublishWritesSeqUnorderedLogFile(t *testing.T) {
	const (
		attempts  = 6
		writers   = 32
		perWriter = 16
	)
	totalInversions := 0
	unorderedFiles := 0

	for attempt := 0; attempt < attempts; attempt++ {
		path := filepath.Join(t.TempDir(), fmt.Sprintf("concurrent-%d.jsonl", attempt))

		bus := NewBus(writers*perWriter+16, WithEventLogPath(path))
		var wg sync.WaitGroup
		start := make(chan struct{})
		for w := 0; w < writers; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				for i := 0; i < perWriter; i++ {
					bus.Publish("probe.event", nil, i)
				}
			}()
		}
		close(start)
		wg.Wait()
		if err := bus.Close(); err != nil {
			t.Fatalf("attempt %d: bus.Close: %v", attempt, err)
		}

		fileOrder := readFileSeqOrder(t, path)
		if len(fileOrder) != writers*perWriter {
			t.Fatalf("attempt %d: log has %d lines, want %d", attempt, len(fileOrder), writers*perWriter)
		}
		inv := countFileOrderInversions(fileOrder)
		totalInversions += inv
		if inv > 0 {
			unorderedFiles++
		}
		wantSet := make(map[int64]bool, len(fileOrder))
		for _, seq := range fileOrder {
			wantSet[seq] = true
		}

		// Invariant 1: the index rebuilt from this file must be seq-sorted even
		// though the file is not.
		log, err := NewEventLog(path)
		if err != nil {
			t.Fatalf("attempt %d: NewEventLog: %v", attempt, err)
		}
		if !slices.IsSorted(log.orderedSeq) {
			t.Errorf("attempt %d: orderedSeq is not sorted after rebuild from a file with %d inversions", attempt, inv)
		}
		if len(log.orderedSeq) != len(log.index) {
			t.Errorf("attempt %d: len(orderedSeq)=%d != len(index)=%d", attempt, len(log.orderedSeq), len(log.index))
		}

		// Invariant 2: replay must never silently drop an event, whatever the
		// file order is.
		for _, cursor := range []int64{1, 2, 7, 64, 200, int64(len(fileOrder) / 2), int64(len(fileOrder) - 2)} {
			got, _ := log.ReadFrom(cursor)
			gotSet := make(map[int64]bool, len(got))
			for _, evt := range got {
				gotSet[evt.Seq] = true
			}
			missing := make([]int64, 0, 8)
			for seq := range wantSet {
				if seq >= cursor && !gotSet[seq] {
					missing = append(missing, seq)
				}
			}
			if len(missing) > 0 {
				slices.Sort(missing)
				t.Errorf("attempt %d (file inversions=%d): ReadFrom(cursor=%d) dropped %d event(s), e.g. %v",
					attempt, inv, cursor, len(missing), missing[:min(len(missing), 6)])
			}
		}

		// Invariant 3: a restart on this file must continue above the largest
		// seq on disk, never above the last line's seq.
		restarted := NewBus(writers*perWriter+16, WithEventLogPath(path))
		next := restarted.Publish("after.restart", nil, nil)
		_ = restarted.Close()
		maxOnDisk := int64(0)
		for seq := range wantSet {
			if seq > maxOnDisk {
				maxOnDisk = seq
			}
		}
		if next.Seq <= maxOnDisk {
			t.Errorf("attempt %d: after restart Publish returned seq=%d, which is already used on disk (max=%d, last line=%d)",
				attempt, next.Seq, maxOnDisk, fileOrder[len(fileOrder)-1])
		}
		_ = log.Close()
	}

	t.Logf("concurrent Publish produced %d/%d seq-unordered log files, %d inversions total",
		unorderedFiles, attempts, totalInversions)
}

// TestRestartAfterSeqUnorderedLogDoesNotReissueSeq is the deterministic red for
// bus.go's seq recovery. The log's last line is seq=6 but its largest seq is 13,
// so seeding b.seq from the last element of an unsorted orderedSeq makes the
// restarted Bus re-issue seqs 7..13 — events that already exist on disk and in
// every surviving subscriber's cursor.
func TestRestartAfterSeqUnorderedLogDoesNotReissueSeq(t *testing.T) {
	path := filepath.Join(t.TempDir(), "restart-unordered.jsonl")
	fileOrder := writeUnorderedLog(t, path, unorderedFileSeqs)

	maxOnDisk := int64(0)
	for _, seq := range fileOrder {
		if seq > maxOnDisk {
			maxOnDisk = seq
		}
	}
	if fileOrder[len(fileOrder)-1] >= maxOnDisk {
		t.Fatalf("test fixture is wrong: last line %d must be below max %d", fileOrder[len(fileOrder)-1], maxOnDisk)
	}

	bus := NewBus(100, WithEventLogPath(path))
	t.Cleanup(func() { _ = bus.Close() })

	published := make([]int64, 0, 4)
	for i := 0; i < 4; i++ {
		published = append(published, bus.Publish("after.restart", nil, i).Seq)
	}
	for _, seq := range published {
		if seq <= maxOnDisk {
			t.Fatalf("restarted Bus re-issued seq=%d which is already on disk (max on disk=%d, published=%v); "+
				"seq recovery must use the largest indexed seq, not the last line in the file",
				seq, maxOnDisk, published)
		}
	}
	if published[0] != maxOnDisk+1 {
		t.Errorf("first seq after restart = %d, want %d (max on disk + 1)", published[0], maxOnDisk+1)
	}
}

// TestReadFromIsCompleteOnSeqUnorderedLog is the deterministic red for the
// replay seek. ReadFrom binary-searches the sorted index for the first seq >=
// cursor and then reads from that seq's byte offset to EOF. When the file is
// not in seq order, a larger seq can sit *before* that offset and is silently
// skipped: with the fixture above, cursor=11 seeks to seq 11's line and never
// sees seq 12, which is on an earlier line.
func TestReadFromIsCompleteOnSeqUnorderedLog(t *testing.T) {
	path := filepath.Join(t.TempDir(), "readfrom-unordered.jsonl")
	fileOrder := writeUnorderedLog(t, path, unorderedFileSeqs)

	log, err := NewEventLog(path)
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = log.Close() })

	for _, cursor := range []int64{1, 3, 4, 5, 6, 8, 11, 12, 13, 14} {
		got, _ := log.ReadFrom(cursor)
		gotSeqs := make([]int64, 0, len(got))
		for _, evt := range got {
			gotSeqs = append(gotSeqs, evt.Seq)
		}
		wantSeqs := make([]int64, 0, len(fileOrder))
		for _, seq := range fileOrder {
			if seq >= cursor {
				wantSeqs = append(wantSeqs, seq)
			}
		}
		slices.Sort(wantSeqs)
		if !slices.Equal(gotSeqs, wantSeqs) {
			t.Errorf("ReadFrom(cursor=%d) on a seq-unordered log = %v, want %v", cursor, gotSeqs, wantSeqs)
		}
	}
}

// TestSubscribeReplayIsCompleteOnSeqUnorderedLog pins the subscriber-visible
// consequence of the same bug: after a restart, a client reconnecting with a
// cursor loses events with no gap notification, so it silently diverges.
func TestSubscribeReplayIsCompleteOnSeqUnorderedLog(t *testing.T) {
	path := filepath.Join(t.TempDir(), "subscribe-unordered.jsonl")
	writeUnorderedLog(t, path, unorderedFileSeqs)

	bus := NewBus(100, WithEventLogPath(path))
	t.Cleanup(func() { _ = bus.Close() })

	_, _, replay := bus.Subscribe(11)

	gotSeqs := make([]int64, 0, len(replay))
	for _, evt := range replay {
		if evt.Type == GapEventType {
			t.Errorf("unexpected gap event for cursor=11 (the log still holds seq 11): %+v", evt.Payload)
			continue
		}
		gotSeqs = append(gotSeqs, evt.Seq)
	}
	wantSeqs := []int64{11, 12, 13}
	if !slices.Equal(gotSeqs, wantSeqs) {
		t.Fatalf("Subscribe(cursor=11) replayed %v, want %v — a reconnecting client silently loses events",
			gotSeqs, wantSeqs)
	}
}

// TestReadFromGapBoundaryUsesTrueMinSeqOnSeqUnorderedLog is the deterministic
// red for the hasGap boundary. The fixture's first line is seq=8 while its
// smallest seq is 3, so treating orderedSeq[0] as the oldest surviving seq
// reports a gap for cursors 3..7 — events that are still in the log. A
// spurious gap tells the subscriber to throw away its state and resync.
func TestReadFromGapBoundaryUsesTrueMinSeqOnSeqUnorderedLog(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gap-unordered.jsonl")
	writeUnorderedLog(t, path, unorderedFileSeqs)

	log, err := NewEventLog(path)
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = log.Close() })

	for _, cursor := range []int64{1, 2, 3, 4, 5, 6, 7, 8} {
		_, hasGap := log.ReadFrom(cursor)
		wantGap := cursor < 3 // 3 is the smallest seq actually present
		if hasGap != wantGap {
			t.Errorf("ReadFrom(cursor=%d) hasGap = %v, want %v (smallest seq on disk is 3, first line is 8)",
				cursor, hasGap, wantGap)
		}
	}
}

// TestOrderedSeqInvariantHoldsAcrossMutationPaths pins the invariant itself on
// every path that touches orderedSeq: rebuild on open, Append above the current
// max, Append below it, and the rebuild that truncateLocked performs. It also
// pins that orderedSeq is exactly the key set of index — the old field comment
// claimed it was "parallel to index", which is not a thing a map and a slice can
// be.
func TestOrderedSeqInvariantHoldsAcrossMutationPaths(t *testing.T) {
	path := filepath.Join(t.TempDir(), "invariant.jsonl")
	writeUnorderedLog(t, path, unorderedFileSeqs)

	log, err := NewEventLog(path)
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = log.Close() })

	assertInvariant := func(stage string) {
		t.Helper()
		log.mu.Lock()
		defer log.mu.Unlock()
		if !slices.IsSorted(log.orderedSeq) {
			t.Errorf("%s: orderedSeq is not sorted: %v", stage, log.orderedSeq)
		}
		if len(log.orderedSeq) != len(log.index) {
			t.Errorf("%s: len(orderedSeq)=%d but len(index)=%d", stage, len(log.orderedSeq), len(log.index))
		}
		for _, seq := range log.orderedSeq {
			if _, ok := log.index[seq]; !ok {
				t.Errorf("%s: orderedSeq contains seq=%d which is not a key of index", stage, seq)
			}
		}
		for seq := range log.index {
			if !slices.Contains(log.orderedSeq, seq) {
				t.Errorf("%s: index key seq=%d is missing from orderedSeq", stage, seq)
			}
		}
	}

	assertInvariant("after open/rebuild")

	// Append above the current max, then below it — the latter is what a
	// straggling concurrent Publish does to a live log.
	if err := log.Append(EventEnvelope{Version: "v1", ID: "evt_99", Seq: 99, Type: "t", SentAt: "x"}); err != nil {
		t.Fatalf("Append(99): %v", err)
	}
	assertInvariant("after Append above max")

	if err := log.Append(EventEnvelope{Version: "v1", ID: "evt_2", Seq: 2, Type: "t", SentAt: "x"}); err != nil {
		t.Fatalf("Append(2): %v", err)
	}
	assertInvariant("after Append below max")

	if got := log.MaxSeq(); got != 99 {
		t.Errorf("MaxSeq() = %d, want 99", got)
	}

	// Force a truncation: truncateLocked rewrites the file and rebuilds the
	// index from the rewritten (still unordered) content.
	log.mu.Lock()
	log.maxSize = 256
	log.mu.Unlock()
	for seq := int64(100); seq <= 160; seq++ {
		if err := log.Append(EventEnvelope{Version: "v1", ID: fmt.Sprintf("evt_%d", seq), Seq: seq, Type: "t", SentAt: "x", Payload: "payload-padding"}); err != nil {
			t.Fatalf("Append(%d): %v", seq, err)
		}
	}
	if log.EventLogTruncations() < 1 {
		t.Fatal("fixture did not trigger a truncation; the post-truncate rebuild path was not exercised")
	}
	assertInvariant("after truncateLocked rebuild")

	if got, want := log.MaxSeq(), int64(160); got != want {
		t.Errorf("MaxSeq() after truncation = %d, want %d", got, want)
	}
}

// TestMaxSeqOnEmptyAndNilLog pins the degenerate cases of the new accessor: a
// nil log and an empty log both report 0 so NewBus leaves b.seq at 0.
func TestMaxSeqOnEmptyAndNilLog(t *testing.T) {
	var nilLog *EventLog
	if got := nilLog.MaxSeq(); got != 0 {
		t.Errorf("nil EventLog MaxSeq() = %d, want 0", got)
	}

	empty, err := NewEventLog(filepath.Join(t.TempDir(), "empty.jsonl"))
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	t.Cleanup(func() { _ = empty.Close() })
	if got := empty.MaxSeq(); got != 0 {
		t.Errorf("empty EventLog MaxSeq() = %d, want 0", got)
	}
}
