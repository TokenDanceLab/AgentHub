package lifecycle

import (
	"log/slog"
	"runtime/debug"
)

// safeGo runs fn in a new goroutine with deferred panic recovery. A panicking
// callback (Hub ack/stream/done/fail) is logged with the supplied name and the
// current process keeps running instead of crashing the Edge server.
//
// This is the single recovery chokepoint for Edge→Hub callback goroutines;
// every `go func()` spawned by process_executor_hub_callback.go routes here
// so a misbehaving Hub client or callback implementation cannot take down the
// run lifecycle (P1: edge 5 处裸 goroutine 无 recover).
//
// name is a short, stable label (e.g. "hubAck", "hubStream") used only for
// log correlation; it is never used for control flow.
func safeGo(name string, fn func()) {
	go func() {
		defer recoverPanickedGoroutine(name)
		fn()
	}()
}

// recoverPanickedGoroutine is the shared recover handler for safeGo. It logs
// the panic value and a trimmed stack trace at Error level and returns, so the
// goroutine terminates cleanly without crashing the process.
func recoverPanickedGoroutine(name string) {
	r := recover()
	if r == nil {
		return
	}
	slog.Error("edge goroutine panicked and was recovered",
		"goroutine", name,
		"panic", r,
		"stack", string(debug.Stack()),
	)
}
