package events

// #2246 slice 1: runWorker guarded each observer job with a private, bare
// recover() that only wrote slog.Error("event bus observer panic", ...) — no
// stack, no counter, no PanicObserver. That is exactly the failure mode the
// pkg/safego package doc describes: a recovered panic that is invisible to
// every dashboard. It now goes through pkg/safego.
//
// These tests pin the two things that matter: the panic is attributed to a
// stable safego name (so the Edge observer can label it), and the worker
// goroutine survives it — with a single worker, a panic that killed the worker
// would strand every later observer job forever.
//
// No time.Sleep in this file: the test-sleep ratchet budgets sleeps per file and
// a newly added file has no baseline entry.

import (
	"testing"
	"time"

	"github.com/agenthub/pkg/safego"
)

// installNameRecorder swaps the process-global safego hook for one that reports
// the recovered panic's name. This package never installs an observer itself
// (that is EdgeMetrics.InstallPanicObserver, called from httpserver at startup),
// so cleanup restores the nil hook the package started with.
func installNameRecorder(t *testing.T, buf int) <-chan string {
	t.Helper()
	recorded := make(chan string, buf)
	safego.SetPanicObserver(func(name string, _ any, _ string) {
		select {
		case recorded <- name:
		default:
		}
	})
	t.Cleanup(func() { safego.SetPanicObserver(nil) })
	return recorded
}

// awaitName waits for the next recovered-panic report, failing the test rather
// than hanging when nothing arrives.
func awaitName(t *testing.T, recorded <-chan string, what string) string {
	t.Helper()
	select {
	case name := <-recorded:
		return name
	case <-time.After(3 * time.Second):
		t.Fatalf("%s: no panic reached the safego PanicObserver within 3s — the observer job is not being recovered through pkg/safego", what)
		return ""
	}
}

func TestBus_ObserverPanicRecoveredUnderStableSafegoName(t *testing.T) {
	// One worker, so "the worker survived" is a real claim rather than "some
	// other worker picked it up".
	t.Setenv("AGENTHUB_EVENT_WORKERS", "1")
	recorded := installNameRecorder(t, 16)

	b := NewBus(16)
	t.Cleanup(func() { _ = b.Close() })

	const panics = 4
	b.AddObserver(func(evt EventEnvelope) {
		if evt.Type == "safego.boom" {
			panic("induced observer panic")
		}
	})
	// A second observer that only signals on the follow-up event: reaching it
	// proves the single worker goroutine is still alive after panics.
	after := make(chan string, 1)
	b.AddObserver(func(evt EventEnvelope) {
		if evt.Type == "safego.after" {
			select {
			case after <- evt.Type:
			default:
			}
		}
	})

	for i := 0; i < panics; i++ {
		b.Publish("safego.boom", nil, nil)
	}
	for i := 0; i < panics; i++ {
		if name := awaitName(t, recorded, "observer panic"); name != "events.bus_observer" {
			t.Fatalf("observer panic #%d recovered under safego name %q, want %q (#2246)",
				i+1, name, "events.bus_observer")
		}
	}

	b.Publish("safego.after", nil, nil)
	select {
	case <-after:
	case <-time.After(3 * time.Second):
		t.Fatal("the observer worker goroutine died on a recovered panic: the follow-up job was never processed. " +
			"A bare recover() that re-panics, or one placed outside the per-job closure, produces exactly this.")
	}
}

// TestBus_ObserverPanicDoesNotStopSubscriberDelivery pins that a panicking
// observer stays contained: observers are dispatched after the wire-order gate
// and before/alongside subscriber fanout, so an observer bug must not cost the
// subscribers their events.
func TestBus_ObserverPanicDoesNotStopSubscriberDelivery(t *testing.T) {
	t.Setenv("AGENTHUB_EVENT_WORKERS", "1")
	installNameRecorder(t, 8)

	b := NewBus(16)
	t.Cleanup(func() { _ = b.Close() })

	b.AddObserver(func(EventEnvelope) { panic("induced observer panic") })

	_, ch, _ := b.Subscribe(0)

	b.Publish("safego.sub1", nil, "v1")
	b.Publish("safego.sub2", nil, "v2")

	deadline := time.After(3 * time.Second)
	seen := make([]string, 0, 2)
	for len(seen) < 2 {
		select {
		case evt := <-ch:
			seen = append(seen, evt.Type)
		case <-deadline:
			t.Fatalf("delivered %v, want [safego.sub1 safego.sub2]: a panicking observer must not cost subscribers their events", seen)
		}
	}
	if seen[0] != "safego.sub1" || seen[1] != "safego.sub2" {
		t.Fatalf("delivery order = %v, want [safego.sub1 safego.sub2]", seen)
	}
}
