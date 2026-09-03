// Package safego provides SafeGo, the panic-recovering goroutine launcher
// shared by the Hub and Edge servers. A panic in an unguarded goroutine
// crashes the whole process; SafeGo turns it into a logged, recoverable event
// so a single misbehaving readLoop / launch goroutine cannot take down the
// server.
//
// Both servers previously kept their own copies, and the copies had already
// diverged: hub internal/safego incremented a panic counter for alerting,
// edge internal/api.safeGo did not. This package is the single recovery path.
//
// Unification is a property of the call sites, not of this file, so it is worth
// recording what it took: edge internal/api.safeGo was replaced when this
// package landed, but edge internal/lifecycle kept a third private copy
// (safeGo/recoverPanickedGoroutine) guarding the ten goroutines that carry the
// run lifecycle — run, hubAck, hubStream, hubDoneEnqueue, hubFailEnqueue,
// hubCallbackQueue, resultAggregator, resultAggregatorTimeout,
// watchRunProcess, cancelGrace. It logged and returned, never dispatched to a
// PanicObserver, and Edge registered no observer at all, so those panics were
// invisible to every dashboard while Hub's equivalent ones were counted. That
// copy is gone (#2154).
//
// Deleting the launcher copies did not finish the job. Four recovery sites were
// still hand-written `recover()` inside closures that cannot use the launcher
// shape: hub internal/bus Publish's handler closure, hub internal/ws
// PushToSession, edge internal/events runWorker's per-job observer guard, and
// edge internal/adapters NDJSON Parse's per-line guard. Three of them wrote
// nothing but a slog line — no stack, no counter, no PanicObserver — which is
// the same "invisible to every dashboard" hole the lifecycle copy left,
// reintroduced one closure at a time; the fourth had its own private counter
// and its own debug.Stack(). All four are now `defer Recover(name)` (#2246).
//
// A fifth site had the same disease but not the same excuse: hub
// internal/handler/ws.go writeLoop, a per-connection goroutine started by a
// bare `go func(){}` five lines above a SafeGo("ws.readLoop", ...) call, and
// guarded by a log-only recover with no stack, no counter and no observer. The
// first slice left it allow-listed as a convergence candidate rather than an
// exemption; it is converged now (#2246 follow-up). writeLoop itself defers
// `RecoverInto("ws.writeLoop", &err)`, which keeps the stack, the counter and
// the observer dispatch while leaving a second defer free to log the panic with
// conn_id — a per-connection id has no business riding inside a metric label,
// and the error slot is what buys both. The goroutine is launched by SafeGo
// because writeLoop's first-registered `defer conn.W.Close(...)` runs last, so
// a panic raised by that close is not recoverable from inside writeLoop.
//
// So the accurate statement is: both servers recover through here, and both
// install an observer (hub internal/metrics.InstallPanicObserver, called from
// that package's init; edge EdgeMetrics.InstallPanicObserver, called from
// httpserver at startup).
//
// That claim is about every recovery site in two servers, which is exactly the
// kind of claim that silently rots, so it is machine-checked rather than
// asserted: scripts/verify/verify-safego-convergence.py fails on any bare
// `recover()` in non-test .go under hub-server/, edge-server/ or pkg/ that is
// not on its allow-list (negative self-test:
// scripts/verify/tests/verify-safego-convergence.Tests.py). The allow-list is
// keyed by file plus how many hits that file may have, never by line number, so
// it cannot go stale when code moves.
//
// What the allow-list actually holds, in honesty rather than as a slogan: five
// sites need something this package deliberately does not do — write an HTTP
// 500 onto the request's own ResponseWriter (Gin CustomRecovery and the admin
// net/http wrapper in hub internal/middleware/recovery.go, the Edge net/http
// wrapper in internal/httpserver/server_middleware.go, and the timeout
// middleware's handler goroutine in internal/middleware/timeout.go, which owns
// the buffered response), or assign named results so the caller gets a typed
// denial (hub internal/handler/ws.go canTypeInSession returns ok=false). Those
// five, plus this file's own Recover and RecoverInto, are the whole allow-list:
// nothing in either server recovers a goroutine panic by hand any more.
//
// The gate is two-sided on purpose. An extra bare `recover()` goes red, and so
// does an exemption the code no longer uses — which is how writeLoop's entry
// shrank from two permitted hits to one when it converged, instead of quietly
// becoming a licence for the next hand-written guard in that file.
//
// Servers register an optional PanicObserver to attach their own
// metrics/alerting without pkg/safego depending on either server. The hook is
// process-global and exactly one: installing it twice replaces the first.
//
// Two defer-able entry points: Recover for fire-and-forget goroutines and for
// closures that must keep running after a panic (log and move on), and
// RecoverInto for goroutines whose caller needs the panic as an error (see
// RecoverInto for why that distinction matters on request paths).
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
