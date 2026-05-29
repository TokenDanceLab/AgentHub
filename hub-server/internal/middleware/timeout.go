package middleware

import (
	"bytes"
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
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
		w.buf.WriteTo(w.ResponseWriter)
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
func Timeout(d time.Duration) gin.HandlerFunc {
	if d <= 0 {
		// No deadline — pass through unchanged.
		return func(c *gin.Context) { c.Next() }
	}
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), d)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)

		tw := newTimeoutWriter(c.Writer)
		c.Writer = tw

		done := make(chan struct{})
		go func() {
			defer close(done)
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
			// Restore original writer so handler.Fail writes directly.
			c.Writer = tw.ResponseWriter
			c.Abort()
			fail(c, errcode.ErrTimeout)
		}
	}
}
