package events

import (
	"bytes"
	"testing"
)

// legacyIndexByte is the pre-#2154 hand-rolled newline scanner, kept only as a
// benchmark baseline. rebuildIndexLocked calls it once per line while holding
// EventLog.mu, over up to maxSize*3/4 bytes (37.5 MiB at the 50 MiB default),
// so the difference between a byte-at-a-time Go loop and memchr shows up
// directly as fan-out stall during truncation.
func legacyIndexByte(s []byte, b byte) int {
	for i, c := range s {
		if c == b {
			return i
		}
	}
	return -1
}

// benchScanPayload builds JSON-lines shaped data: ~500 byte records, matching
// the event size the 25,000-events-per-truncation estimate in #2154 assumes.
func benchScanPayload(totalBytes int) []byte {
	record := []byte(`{"id":"evt_0123456789abcdef","seq":123456,"type":"run.output.batch","sent_at":"2026-09-02T10:00:00Z","scope":{"run_id":"run_0123456789abcdef","thread_id":"thr_0123456789abcdef"},"payload":{"content":"`)
	tail := []byte(`"}}` + "\n")
	filler := bytes.Repeat([]byte("lorem ipsum dolor sit amet "), 14)

	buf := make([]byte, 0, totalBytes+len(record)+len(filler)+len(tail))
	for len(buf) < totalBytes {
		buf = append(buf, record...)
		buf = append(buf, filler...)
		buf = append(buf, tail...)
	}
	return buf[:totalBytes]
}

func countNewlines(s []byte, find func([]byte, byte) int) int {
	lines := 0
	for len(s) > 0 {
		i := find(s, '\n')
		if i < 0 {
			return lines + 1
		}
		lines++
		s = s[i+1:]
	}
	return lines
}

// scanSize is 16 MiB: large enough to be representative of a truncation-driven
// rebuild, small enough to keep the benchmark runtime sane. The default maxSize
// path scans 37.5 MiB, i.e. ~2.3x these numbers.
const scanSize = 16 * 1024 * 1024

func BenchmarkRebuildIndexScanLegacyIndexByte(b *testing.B) {
	data := benchScanPayload(scanSize)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchLineSink = countNewlines(data, legacyIndexByte)
	}
}

func BenchmarkRebuildIndexScanStdlibIndexByte(b *testing.B) {
	data := benchScanPayload(scanSize)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchLineSink = countNewlines(data, bytes.IndexByte)
	}
}

var benchLineSink int
