package adapters

// #2246 slice 1: Parse guarded each line's parseLine call with a private, bare
// recover() that only wrote slog.Error("ndjson: panic in parseLine", ...) — no
// stack, no counter, no PanicObserver. It now goes through pkg/safego.
//
// The behaviour under test is the reason the guard exists at all: parseLine
// drives the emitter and hook chain over untrusted agent stdout, so one bad
// line must not abort the stream and strand the run. These tests pin that the
// stream keeps going, that Parse still returns nil, and that the panic is
// attributed to a stable safego name so the Edge observer can label it.
//
// No time.Sleep in this file: the test-sleep ratchet budgets sleeps per file and
// a newly added file has no baseline entry.

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/pkg/safego"
)

// panickingEmitter satisfies EventEmitter and panics on every Emit, recording
// how many lines actually reached it.
type panickingEmitter struct {
	mu    sync.Mutex
	calls int
}

func (e *panickingEmitter) Emit(string, map[string]any, any) {
	e.mu.Lock()
	e.calls++
	e.mu.Unlock()
	panic("induced emitter panic")
}

func (e *panickingEmitter) callCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.calls
}

// ndjsonSystemInitLines builds n NDJSON lines that each parse successfully and
// each produce exactly one emitter call (system/init → emitSessionInit).
func ndjsonSystemInitLines(n int) string {
	var sb strings.Builder
	for i := 0; i < n; i++ {
		sb.WriteString(`{"type":"system","subtype":"init","model":"claude-sonnet-4-6","session_id":"ses_panic"}`)
		sb.WriteString("\n")
	}
	return sb.String()
}

func TestParse_PanicInParseLineRecoveredUnderStableSafegoName(t *testing.T) {
	const lines = 3

	recorded := make(chan string, lines+1)
	// This package installs no observer of its own (EdgeMetrics.
	// InstallPanicObserver is called from httpserver at startup), so cleanup
	// restores the nil hook the package started with.
	safego.SetPanicObserver(func(name string, _ any, _ string) {
		select {
		case recorded <- name:
		default:
		}
	})
	t.Cleanup(func() { safego.SetPanicObserver(nil) })

	emitter := &panickingEmitter{}
	parser := NewNDJSONStreamParser(emitter, testRun())

	// The observer runs synchronously inside Parse's own goroutine, so by the
	// time Parse returns every recovered panic has already been reported.
	err := parser.Parse(context.Background(), strings.NewReader(ndjsonSystemInitLines(lines)))
	if err != nil {
		t.Fatalf("Parse returned %v, want nil: a panicking line must be recovered so the stream runs to EOF", err)
	}

	for i := 0; i < lines; i++ {
		select {
		case name := <-recorded:
			if name != "ndjson.parse_line" {
				t.Fatalf("line #%d panic recovered under safego name %q, want %q (#2246)", i+1, name, "ndjson.parse_line")
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("line #%d panicked but nothing reached the safego PanicObserver within 3s: parseLine is not being recovered through pkg/safego", i+1)
		}
	}

	if got := emitter.callCount(); got != lines {
		t.Errorf("emitter was reached %d times, want %d: every line after a recovered panic must still be parsed", got, lines)
	}
}

// TestParse_PanicInParseLineKeepsLaterLinesIntact is the regression that the
// guard exists for: with a per-line panic the run must not be stranded, and a
// well-behaved line following the panicking one must still be emitted normally.
func TestParse_PanicInParseLineKeepsLaterLinesIntact(t *testing.T) {
	safego.SetPanicObserver(func(string, any, string) {})
	t.Cleanup(func() { safego.SetPanicObserver(nil) })

	emitter := &mixedEmitter{panicOn: 1}
	parser := NewNDJSONStreamParser(emitter, testRun())

	err := parser.Parse(context.Background(), strings.NewReader(ndjsonSystemInitLines(3)))
	if err != nil {
		t.Fatalf("Parse returned %v, want nil", err)
	}

	if got := emitter.callCount(); got != 3 {
		t.Errorf("emitter was reached %d times, want 3", got)
	}
	if got := emitter.succeeded(); got != 2 {
		t.Errorf("emitter completed %d calls, want 2 (line 1 panicked, lines 2-3 must still be emitted)", got)
	}
}

// mixedEmitter panics on the panicOn-th Emit (1-based) and completes the rest.
type mixedEmitter struct {
	mu      sync.Mutex
	calls   int
	ok      int
	panicOn int
}

func (e *mixedEmitter) Emit(string, map[string]any, any) {
	e.mu.Lock()
	e.calls++
	n := e.calls
	e.mu.Unlock()
	if n == e.panicOn {
		panic("induced emitter panic on line 1")
	}
	e.mu.Lock()
	e.ok++
	e.mu.Unlock()
}

func (e *mixedEmitter) callCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.calls
}

func (e *mixedEmitter) succeeded() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.ok
}
