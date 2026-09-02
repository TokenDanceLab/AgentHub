package events

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// shortReader returns at most max bytes per Read — exactly what read(2) on a
// regular file is allowed to do (large reads, signal interruption, network or
// overlay filesystems), and what os.File.Read maps one syscall to.
type shortReader struct {
	r   io.Reader
	max int
}

func (s shortReader) Read(p []byte) (int, error) {
	if len(p) > s.max {
		p = p[:s.max]
	}
	return s.r.Read(p)
}

// TestReadRetentionWindow_ToleratesShortReads is the data-loss pin.
//
// truncateLocked seeks to -keepBytes from EOF, reads the window and rewrites it
// after Truncate(0) has already destroyed the original. A single Read that comes
// back short therefore drops the *unread tail* of the window — which is the
// newest, highest-seq part of the log — silently and permanently. keepBytes is
// maxSize*3/4, i.e. 37.5 MiB at the 50 MiB default, so this is a big read on
// every truncation.
func TestReadRetentionWindow_ToleratesShortReads(t *testing.T) {
	var want []byte
	for i := 0; i < 40; i++ {
		want = append(want, []byte(`{"seq":`+string(rune('0'+i%10))+`,"line":`+strings.Repeat("x", 20)+`}`+"\n")...)
	}

	for _, chunk := range []int{1, 3, 7, 64} {
		got, n, err := readRetentionWindow(shortReader{r: bytes.NewReader(want), max: chunk}, int64(len(want)))
		if err != nil {
			t.Fatalf("chunk=%d: readRetentionWindow returned error %v", chunk, err)
		}
		if n != len(want) {
			t.Fatalf("chunk=%d: read %d of %d bytes — a short read silently drops the newest, highest-seq tail of the retention window after Truncate(0) already destroyed the original", chunk, n, len(want))
		}
		if !bytes.Equal(got[:n], want) {
			t.Fatalf("chunk=%d: window contents differ from the file tail", chunk)
		}
	}
}

// TestReadRetentionWindow_ShorterFileIsNotAnError covers the other direction: a
// file that shrank under us (external truncation) yields fewer bytes than the
// window and must be reported as "here is what exists", not as a failure.
func TestReadRetentionWindow_ShorterFileIsNotAnError(t *testing.T) {
	content := []byte("only a little\n")
	got, n, err := readRetentionWindow(bytes.NewReader(content), 4096)
	if err != nil {
		t.Fatalf("a file shorter than the window must not be an error, got %v", err)
	}
	if n != len(content) || !bytes.Equal(got[:n], content) {
		t.Fatalf("got %d bytes %q, want %d bytes %q", n, got[:n], len(content), content)
	}
}

// TestTruncateLocked_KeepsNewestEventsEndToEnd is the regression pin on the real
// path: after a truncation the surviving window must still contain the newest
// events, and the rebuilt index must find them. It is green before and after the
// short-read fix (a local ext4 read of this size does not come back short), so it
// is a pin, not red evidence — the red evidence is the injected short reader
// above.
func TestTruncateLocked_KeepsNewestEventsEndToEnd(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "events.jsonl")
	log, err := NewEventLog(path)
	if err != nil {
		t.Fatalf("NewEventLog: %v", err)
	}
	log.SetMaxSize(4096)
	t.Cleanup(func() { _ = log.Close() })

	var lastSeq int64
	for i := int64(1); i <= 200; i++ {
		evt := EventEnvelope{Version: "v1", ID: "evt-" + strings.Repeat("x", 40), Seq: i, Type: "test.truncate", SentAt: "2026-09-03T00:00:00Z", Payload: strings.Repeat("payload", 8)}
		if err := log.Append(evt); err != nil {
			t.Fatalf("Append seq=%d: %v", i, err)
		}
		lastSeq = i
	}

	fi, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if fi.Size() > 4096 {
		t.Fatalf("log grew to %d bytes with maxSize 4096: truncation never ran", fi.Size())
	}
	if got := log.MaxSeq(); got != lastSeq {
		t.Fatalf("MaxSeq() = %d, want %d: truncation dropped the newest events", got, lastSeq)
	}
	events, hasGap := log.ReadFrom(lastSeq - 1)
	if hasGap {
		t.Fatalf("replay reported a gap for a cursor inside the retained window")
	}
	if len(events) == 0 || events[len(events)-1].Seq != lastSeq {
		t.Fatalf("replay after truncation = %d events ending at %v, want the newest seq %d", len(events), seqOfLast(events), lastSeq)
	}
}

func seqOfLast(events []EventEnvelope) int64 {
	if len(events) == 0 {
		return 0
	}
	return events[len(events)-1].Seq
}
