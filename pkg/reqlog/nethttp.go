package reqlog

import (
	"bufio"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"
)

// responseWriter wraps http.ResponseWriter to capture the status code.
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hijacker, ok := rw.ResponseWriter.(http.Hijacker); ok {
		return hijacker.Hijack()
	}
	return nil, nil, fmt.Errorf("underlying ResponseWriter does not implement http.Hijacker")
}

func (rw *responseWriter) Flush() {
	if flusher, ok := rw.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// AccessLog returns a net/http middleware that logs every request with structured fields.
// It generates or propagates X-Request-ID, injects it into the request context,
// and sets the response header.
func AccessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		reqID := r.Header.Get("X-Request-ID")
		if reqID == "" {
			reqID = NewRequestID()
		}
		ctx := WithRequestID(r.Context(), reqID)
		r = r.WithContext(ctx)

		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		w.Header().Set("X-Request-ID", reqID)

		next.ServeHTTP(wrapped, r)

		slog.Info("access",
			"request_id", reqID,
			"method", r.Method,
			"path", r.URL.Path,
			"status", wrapped.statusCode,
			"duration_ms", time.Since(start).Milliseconds(),
			"client_ip", r.RemoteAddr,
		)
	})
}
