package middleware

import (
	"log/slog"
	"net"
	"net/http"
	"os"
	"runtime/debug"
	"strings"

	"github.com/gin-gonic/gin"

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

// isBrokenPipe checks whether the recovered error is a broken-pipe or
// connection-reset error that should not be logged as a server error.
func isBrokenPipe(err any) bool {
	if ne, ok := err.(*net.OpError); ok {
		if se, ok := ne.Err.(*os.SyscallError); ok {
			return strings.Contains(strings.ToLower(se.Error()), "broken pipe") ||
				strings.Contains(strings.ToLower(se.Error()), "connection reset by peer")
		}
		if strings.Contains(strings.ToLower(ne.Error()), "broken pipe") ||
			strings.Contains(strings.ToLower(ne.Error()), "connection reset by peer") {
			return true
		}
	}
	return false
}
