// Package safego provides SafeGo, the panic-recovering goroutine launcher
// shared by the Hub and Edge servers. A panic in an unguarded goroutine
// crashes the whole process; SafeGo turns it into a logged, recoverable event
// so a single misbehaving readLoop / launch goroutine cannot take down the
// server.
//
// Both servers previously kept near-identical copies (hub internal/safego,
// edge internal/api.safeGo) whose behavior had already diverged: only the Hub
// copy incremented a panic counter for alerting. This shared package unifies
// the recovery path; servers register an optional PanicObserver to attach
// their own metrics/alerting without pkg/safego depending on either server.
package safego

import (
	"log/slog"
	"runtime/debug"
	"sync/atomic"
)

// PanicObserver is invoked (synchronously, before the goroutine exits) on
// every recovered panic. A server registers a counter/alert hook here at
// startup. It must not panic; a panicking observer would re-panic the
// goroutine that SafeGo just saved.
type PanicObserver func(name string, panicValue any, stack string)

var observer atomic.Value // holds PanicObserver

// SetPanicObserver installs the process-wide panic hook. It is a startup-only
// API: call it once from main (or a metrics init) before any SafeGo launches.
// A nil observer clears the hook.
func SetPanicObserver(fn PanicObserver) {
	observer.Store(fn)
}

// SafeGo launches fn on a new goroutine with a deferred recover. Panics are
// logged with the goroutine name and full stack trace, then forwarded to the
// registered PanicObserver (if any).
//
// Use this for every long-lived or spawned goroutine that is not already
// wrapped by an HTTP middleware recover (which only covers the request
// goroutine) — e.g. WebSocket readLoop or dispatch launch goroutines.
//
// name is a short, stable label for log/metric attribution (e.g.
// "ws.readLoop", "dispatch.launch"). It must not contain newlines.
func SafeGo(name string, fn func()) {
	go func() {
		defer Recover(name)
		fn()
	}()
}

// Recover is the defer-able form of SafeGo's panic guard, for goroutine
// bodies that cannot use the launcher shape (existing `go func(){...}()`
// sites). It must be deferred inside the panicking goroutine; the stack
// report and PanicObserver dispatch are identical to SafeGo.
//
//	go func() {
//		defer safego.Recover("name")
//		...
//	}()
func Recover(name string) {
	if r := recover(); r != nil {
		stack := string(debug.Stack())
		slog.Error("goroutine panic recovered",
			"goroutine", name,
			"panic", r,
			"stack", stack,
		)
		if fn, ok := observer.Load().(PanicObserver); ok && fn != nil {
			fn(name, r, stack)
		}
	}
}
