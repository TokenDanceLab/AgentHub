package middleware

import (
	"errors"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"syscall"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/metrics"
	sharederr "github.com/agenthub/pkg/errcode"
)

// CustomRecovery returns a Gin middleware that recovers from panics, logs the
// full stack trace to slog, and returns a safe JSON error response instead of
// the raw Go panic text.
//
// Unlike gin.Recovery() (which writes stack traces to stderr and returns raw
// panic text to the client), this middleware:
//   - Uses slog.ErrorContext so stack traces appear in structured logs.
//   - Returns a standard JSON error envelope: {"error": {"code": "...", "message": "...", "traceId": "..."}}.
//   - Includes the request ID as traceId when available.
//   - Suppresses stack-trace logging for broken-pipe errors (client disconnect).
//   - Increments http_panic_recoveries_total so operators can alert on a
//     non-zero panic rate (a handler bug that would otherwise crash the
//     process when paired with the Timeout middleware's goroutine, which is
//     recovered separately in timeout.go).
func CustomRecovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				// Check for broken pipe / connection reset — these are client-side
				// disconnects and should not be logged as server errors.
				if isBrokenPipe(err) {
					// The connection is gone; nothing useful to write to the client.
					c.Abort()
					return
				}

				if metrics.HTTPPanicRecoveries != nil {
					metrics.HTTPPanicRecoveries.Inc()
				}

				stack := debug.Stack()
				rid := GetRequestID(c)

				slog.ErrorContext(c.Request.Context(), "panic recovered",
					"error", err,
					"stack", string(stack),
					"method", c.Request.Method,
					"path", c.Request.URL.Path,
					"request_id", rid,
				)

				// Build a safe JSON error response using the standard error envelope.
				e := sharederr.ErrInternal
				if rid == "" {
					rid = sharederr.NewTraceID()
				}
				c.AbortWithStatusJSON(http.StatusInternalServerError, sharederr.EnvelopeForGinWithTrace(e.WithTrace(rid)))
			}
		}()
		c.Next()
	}
}

// RecoveryHTTPHandler wraps a standard library http.Handler with panic recovery.
// Panics are logged via slog and a 500 JSON error is written to the response.
// This is intended for the admin server (pprof/metrics/debug endpoints) which
// uses net/http mux, not Gin.
func RecoveryHTTPHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				if isBrokenPipe(err) {
					return
				}

				if metrics.HTTPPanicRecoveries != nil {
					metrics.HTTPPanicRecoveries.Inc()
				}

				stack := debug.Stack()

				slog.ErrorContext(r.Context(), "panic recovered (admin)",
					"error", err,
					"stack", string(stack),
					"method", r.Method,
					"path", r.URL.Path,
				)

				sharederr.WriteError(w, sharederr.ErrInternal)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// isBrokenPipe checks whether the recovered value is a client disconnect
// (EPIPE / ECONNRESET) that must not be logged as a server error and must not
// increment http_panic_recoveries_total — the peer is gone, so the panic is
// not the handler's fault and there is nobody left to write a 500 to.
//
// Two semantics are load-bearing and both are covered by
// recovery_brokenpipe_test.go:
//
//   - The parameter is `any`, not `error`, because it is the raw return value
//     of recover(): a handler may panic with a string, an int, a struct or
//     anything else. A non-error payload is by definition not a broken pipe,
//     must be reported false, and must never panic here — a panic inside the
//     recovery middleware is unrecoverable and takes the process down.
//   - Recognition is structural, not textual (#2244 slice 2). The kernel
//     already hands us the exact reason as a syscall.Errno; reading its
//     English rendering back out of a formatted string throws that signal away
//     and breaks on any wrapping, locale or Go version that renders it
//     differently.
//
// Tier 1 (errors.Is) is the fix. It unwraps *net.OpError -> *os.SyscallError ->
// syscall.Errno, so it recognises every nesting shape the net stack produces
// and, unlike the previous top-level err.(*net.OpError) type assertion, also
// reaches an OpError that a caller wrapped with %w. It additionally recognises
// a bare errno or a bare *os.SyscallError, which is correct: EPIPE and
// ECONNRESET mean the peer is gone whatever object carries them.
//
// Tier 2 is the old outer branch's coverage, deliberately retained and scoped
// to *net.OpError. An OpError whose Err is neither an errno nor an
// *os.SyscallError carries no structured signal at all — only a message — and
// the previous implementation recognised that shape by text. Dropping it here
// would be a straight regression (fewer disconnects suppressed means more
// spurious 500-logs and more panic-metric noise), so it stays as the last
// resort, behind the structural check and never applied to a non-OpError.
func isBrokenPipe(err any) bool {
	e, ok := err.(error)
	if !ok {
		return false
	}
	if errors.Is(e, syscall.EPIPE) || errors.Is(e, syscall.ECONNRESET) {
		return true
	}
	var ne *net.OpError
	if errors.As(e, &ne) {
		msg := strings.ToLower(ne.Error())
		return strings.Contains(msg, "broken pipe") || strings.Contains(msg, "connection reset by peer")
	}
	return false
}
