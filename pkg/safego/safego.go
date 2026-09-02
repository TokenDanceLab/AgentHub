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
//
// Two defer-able entry points: Recover for fire-and-forget goroutines (log and
// move on) and RecoverInto for goroutines whose caller needs the panic as an
// error (see RecoverInto for why that distinction matters on request paths).
package safego

import (
	"fmt"
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
	report(name, recover(), nil)
}

// RecoverInto is Recover for a goroutine whose panic must also reach its caller
// as an error. Logging and PanicObserver dispatch are identical to Recover; in
// addition the recovered panic is stored into *errSlot when — and only when —
// that slot is still nil, so a real error produced before the panic is never
// overwritten by the panic label.
//
// Use this wherever a goroutine is spawned on a request path that used to run
// inline: an HTTP middleware recover only covers the request goroutine, so a
// panic in a spawned reader that recovers nothing escalates from a 500 to a
// process crash. Recording it in the caller's error slot restores the 500.
//
//	name := "projection.members"
//	g.Go(func() error {
//		defer safego.RecoverInto(name, &membersErr)
//		members, membersErr = repository.ListTeamMembers(db, teamID)
//		return nil
//	})
//
// Like Recover it must be deferred directly (recover() only reports a panic to
// the function that was itself deferred), and errSlot must be the same variable
// the goroutine body writes its error to.
func RecoverInto(name string, errSlot *error) {
	report(name, recover(), errSlot)
}

// report is the shared recovery path. r is the value recover() returned in the
// deferred function (nil when there was no panic); it is passed in because
// recover() only reports to the function that was itself deferred.
func report(name string, r any, errSlot *error) {
	if r == nil {
		return
	}
	stack := string(debug.Stack())
	slog.Error("goroutine panic recovered",
		"goroutine", name,
		"panic", r,
		"stack", stack,
	)
	if fn, ok := observer.Load().(PanicObserver); ok && fn != nil {
		fn(name, r, stack)
	}
	if errSlot != nil && *errSlot == nil {
		*errSlot = fmt.Errorf("%s: recovered panic: %v", name, r)
	}
}
