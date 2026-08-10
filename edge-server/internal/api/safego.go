package api

import (
	"log/slog"
	"runtime/debug"
)

// safeGo runs fn in a new goroutine with deferred panic recovery. A panicking
// WebSocket read loop is logged with the supplied name and the Edge HTTP
// server keeps running instead of crashing the process.
//
// This is the recovery chokepoint for the events WebSocket read goroutine
// (P1: edge 裸 goroutine 无 recover). name is a short, stable label used
// only for log correlation; it is never used for control flow.
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
	slog.Error("edge api goroutine panicked and was recovered",
		"goroutine", name,
		"panic", r,
		"stack", string(debug.Stack()),
	)
}
