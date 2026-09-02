package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/gin-gonic/gin"
)

// timeoutWriter buffers the response body and status so the handler goroutine
// never writes directly to the real http.ResponseWriter. When the handler
// completes before the deadline, the buffered response is flushed once,
// atomically. When the deadline fires first, the buffer is discarded and a
// 504 is written to the real writer — avoiding the concurrent-write panic
// (http: superfluous response.WriteHeader call).
type timeoutWriter struct {
	gin.ResponseWriter
	hdr         http.Header
	buf         bytes.Buffer
	code        int
	wrote       bool
	wroteHeader bool

	mu       sync.Mutex
	timedOut bool
}

func newTimeoutWriter(w gin.ResponseWriter) *timeoutWriter {
	return &timeoutWriter{
		ResponseWriter: w,
		hdr:            make(http.Header),
		code:           http.StatusOK,
	}
}

func (w *timeoutWriter) Write(b []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.timedOut {
		return len(b), nil // discard silently
	}
	w.wrote = true
	return w.buf.Write(b)
}

func (w *timeoutWriter) WriteHeader(code int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.timedOut {
		return
	}
	w.code = code
	w.wroteHeader = true
}

func (w *timeoutWriter) WriteHeaderNow() {
	// Headers are flushed atomically with the body in flush().
}

func (w *timeoutWriter) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}

func (w *timeoutWriter) Status() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.code
}

func (w *timeoutWriter) Size() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buf.Len()
}

func (w *timeoutWriter) Written() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.wrote
}

func (w *timeoutWriter) Header() http.Header {
	return w.hdr
}

// flush copies buffered headers and body to the real ResponseWriter.
// Must be called while NOT holding w.mu to avoid deadlock with Gin internals.
func (w *timeoutWriter) flush() {
	w.mu.Lock()
	if w.timedOut {
		w.mu.Unlock()
		return
	}
	code := w.code
	wrote := w.wrote
	wroteHeader := w.wroteHeader
	// Copy headers (must happen before WriteHeader)
	for k, vs := range w.hdr {
		for _, v := range vs {
			w.ResponseWriter.Header().Add(k, v)
		}
	}
	w.mu.Unlock()

	if wrote || wroteHeader {
		w.ResponseWriter.WriteHeader(code)
	}
	if wrote {
		// Safe to read buf without lock: after handler done and not timedOut,
		// no other goroutine writes to buf.
		_, _ = w.buf.WriteTo(w.ResponseWriter)
	}
}

func (w *timeoutWriter) markTimedOut() {
	w.mu.Lock()
	w.timedOut = true
	w.mu.Unlock()
}

// Timeout returns a middleware that sets a per-request deadline.  If the
// handler chain does not finish within d, the request is aborted with a
// 504 Gateway Timeout.  The handler runs in a goroutine whose output is
// buffered; therefore the real ResponseWriter is written to at most once,
// eliminating the concurrent-write race that would otherwise panic.
//
// WebSocket upgrade requests are passed through unwrapped: the handshake
// requires hijacking the raw connection (http.Hijacker), which the buffered
// timeoutWriter does not implement — wrapping it hangs the upgrade forever.
// WebSocket connections are long-lived by design and are not governed by a
// per-request deadline.
func Timeout(d time.Duration) gin.HandlerFunc {
	if d <= 0 {
		// No deadline — pass through unchanged.
		return func(c *gin.Context) { c.Next() }
	}
	return func(c *gin.Context) {
		if isWebSocketUpgrade(c) {
			c.Next()
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), d)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)

		tw := newTimeoutWriter(c.Writer)
		c.Writer = tw

		done := make(chan struct{})
		go func() {
			// defer LIFO order: recover runs BEFORE close(done) so the parent
			// (blocked on <-done) does not call flush() until the 500 has been
			// written to the buffer. Without this recover, a handler panic in
			// the goroutine would crash the process — CustomRecovery's
			// defer-recover lives in the request goroutine, not this spawned
			// one, so it cannot catch a panic that escapes the goroutine.
			defer close(done)
			defer func() {
				if r := recover(); r != nil {
					slog.ErrorContext(ctx, "handler panic recovered in timeout goroutine",
						"panic", r,
						"stack", string(debug.Stack()),
						"method", c.Request.Method,
						"path", c.Request.URL.Path,
					)
					if metrics.HTTPPanicRecoveries != nil {
						metrics.HTTPPanicRecoveries.Inc()
					}
					// If the handler wrote nothing yet, synthesize a 500 so
					// flush() delivers a proper error instead of an empty 200.
					// When the handler already wrote partial output, leave the
					// buffer as-is so flush() sends what was written.
					tw.mu.Lock()
					alreadyWritten := tw.wrote || tw.wroteHeader
					tw.mu.Unlock()
					if !alreadyWritten {
						if tw.hdr.Get("Content-Type") == "" {
							tw.hdr.Set("Content-Type", "application/json; charset=utf-8")
						}
						tw.WriteHeader(http.StatusInternalServerError)
						_, _ = tw.Write([]byte(`{"error":{"code":"internal_error","message":"internal server error"}}`))
					}
				}
			}()
			// Check context before starting the handler chain.
			// If the deadline passed between accepting the connection and
			// entering this middleware, bail immediately.
			if ctx.Err() != nil {
				return
			}
			c.Next()
			// After the chain, check again — the handler may have respected
			// the context and returned early on its own.
		}()

		select {
		case <-done:
			// Handler completed normally; flush buffered response.
			tw.flush()
		case <-ctx.Done():
			// Deadline fired — discard handler output and write 504.
			tw.markTimedOut()
			writeTimeout(tw.ResponseWriter)
			<-done
		}
	}
}

// TimeoutStream enforces a request deadline without buffering the response.
//
// The buffered Timeout middleware swaps c.Writer for a timeoutWriter that
// holds the entire response in memory until the handler returns. That is
// correct for small JSON responses but wrong for attachment downloads, where
// it would buffer the whole file (up to the upload max size) per concurrent
// request and delay the first byte until the read completes.
//
// TimeoutStream only derives a context deadline. If the deadline fires
// before anything has been written, the client receives the standard timeout
// error; once writing has started, the stream is left to finish naturally (a
// partially written response cannot be rewritten to a timeout error).
// Handlers are expected to respect c.Request.Context() so reads stop at the
// deadline. WebSocket upgrades pass through unchanged, mirroring Timeout.
func TimeoutStream(d time.Duration) gin.HandlerFunc {
	if d <= 0 {
		// No deadline — pass through unchanged.
		return func(c *gin.Context) { c.Next() }
	}
	return func(c *gin.Context) {
		if isWebSocketUpgrade(c) {
			c.Next()
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), d)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)

		c.Next()

		if ctx.Err() == context.DeadlineExceeded && !c.Writer.Written() {
			writeTimeout(c.Writer)
		}
	}
}

// isWebSocketUpgrade reports whether the request is a WebSocket upgrade.
func isWebSocketUpgrade(c *gin.Context) bool {
	if !strings.EqualFold(c.GetHeader("Upgrade"), "websocket") {
		return false
	}
	for _, token := range strings.Split(c.GetHeader("Connection"), ",") {
		if strings.EqualFold(strings.TrimSpace(token), "upgrade") {
			return true
		}
	}
	return false
}

func writeTimeout(w gin.ResponseWriter) {
	status := errcode.ErrTimeout.HTTPStatus
	if status == 0 {
		status = http.StatusGatewayTimeout
	}
	header := w.Header()
	if header.Get("Content-Type") == "" {
		header.Set("Content-Type", "application/json; charset=utf-8")
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"code":    errcode.ErrTimeout.Code,
			"message": errcode.ErrTimeout.Message,
		},
	})
}
