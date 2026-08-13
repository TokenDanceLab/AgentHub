// Package safego provides SafeGo, the panic-recovering goroutine
// launcher used by handlers and services. It lives in its own leaf package
// so the business layer never depends on the HTTP middleware package.
package safego

import (
	"log/slog"
	"runtime/debug"

	"github.com/agenthub/hub-server/internal/metrics"
)

// SafeGo launches fn on a new goroutine with a deferred recover. Panics are
// logged with the goroutine name and full stack trace, and the
// goroutine_panic_recoveries_total counter is incremented so operators can
// alert on a non-zero rate.
//
// Use this for every long-lived or spawned goroutine that is not already
// wrapped by the gin CustomRecovery middleware (which only covers the HTTP
// request goroutine) — e.g. WS readLoop / dispatch launch goroutines. A panic
// in an unguarded goroutine crashes the whole process; SafeGo turns it into a
// logged, counted, recoverable event.
//
// The name is a short, stable label for log/metric attribution
// (e.g. "ws.readLoop", "dispatch.launch"). It must not contain newlines.
func SafeGo(name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("goroutine panic recovered",
					"goroutine", name,
					"panic", r,
					"stack", string(debug.Stack()),
				)
				if metrics.GoroutinePanicRecoveries != nil {
					metrics.GoroutinePanicRecoveries.Inc()
				}
			}
		}()
		fn()
	}()
}
