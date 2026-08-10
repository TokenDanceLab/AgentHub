package log

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"github.com/agenthub/pkg/reqlog"
)

// newCapturingRequestIDHandler builds the production request_id decorator
// around a buffer-backed JSON handler so tests can assert on emitted log
// lines without depending on the zap-backed Init wiring (which writes to
// stdout / lumberjack). The decorator under test is the same
// newRequestIDHandler installed by Init.
func newCapturingRequestIDHandler(buf *bytes.Buffer) slog.Handler {
	inner := slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	return newRequestIDHandler(inner)
}

// TestRequestIDHandler_AttachesRequestIDFromContext verifies that the
// context-aware slog handler extracts the request_id from the record's
// context (set by reqlog.WithRequestID) and appends it as a top-level
// "request_id" attribute so service-layer logs can be correlated back to the
// originating request.
func TestRequestIDHandler_AttachesRequestIDFromContext(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(newCapturingRequestIDHandler(&buf))

	ctx := reqlog.WithRequestID(context.Background(), "req-test-123")
	logger.InfoContext(ctx, "service layer event", "action", "dispatch")

	out := buf.String()
	if !strings.Contains(out, "service layer event") {
		t.Fatalf("expected log message present, got: %s", out)
	}
	if !strings.Contains(out, `"request_id":"req-test-123"`) {
		t.Fatalf("expected request_id attribute attached from context, got: %s", out)
	}
}

// TestRequestIDHandler_NoRequestIDInContext verifies that when the context
// has no request_id (background tasks, startup), no request_id attribute is
// added and the record is forwarded unchanged.
func TestRequestIDHandler_NoRequestIDInContext(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(newCapturingRequestIDHandler(&buf))

	logger.Info("background task event", "task", "gc")

	out := buf.String()
	if !strings.Contains(out, "background task event") {
		t.Fatalf("expected log message present, got: %s", out)
	}
	if strings.Contains(out, "request_id") {
		t.Fatalf("expected no request_id attribute for context without one, got: %s", out)
	}
}

// TestRequestIDHandler_DoesNotClobberExplicitRequestID verifies the decorator
// does not overwrite a request_id attribute the caller already attached
// explicitly to the record (the context-derived one is suppressed when the
// record already carries one).
func TestRequestIDHandler_DoesNotClobberExplicitRequestID(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(newCapturingRequestIDHandler(&buf))

	// Caller attached an explicit request_id; context carries a DIFFERENT one.
	// The decorator must keep the explicit value, not overwrite with the
	// context-derived one.
	ctx := reqlog.WithRequestID(context.Background(), "ctx-rid")
	logger.InfoContext(ctx, "explicit rid", "request_id", "explicit-rid")

	out := buf.String()
	if !strings.Contains(out, `"request_id":"explicit-rid"`) {
		t.Fatalf("expected explicit request_id preserved, got: %s", out)
	}
	if strings.Contains(out, `"request_id":"ctx-rid"`) {
		t.Fatalf("expected context rid NOT to clobber explicit one, got: %s", out)
	}
}

// TestRequestIDHandler_JSONRoundTrip asserts the request_id attribute is a
// valid JSON string in the emitted log line (so log aggregators can parse it
// without quoting workarounds).
func TestRequestIDHandler_JSONRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(newCapturingRequestIDHandler(&buf))

	ctx := reqlog.WithRequestID(context.Background(), "req-json-1")
	logger.WarnContext(ctx, "warn event", "k", "v")

	var parsed map[string]any
	if err := json.Unmarshal(buf.Bytes(), &parsed); err != nil {
		t.Fatalf("log line is not valid JSON: %v\n%s", err, buf.String())
	}
	if got, _ := parsed["request_id"].(string); got != "req-json-1" {
		t.Fatalf("expected request_id=req-json-1, got %v in %s", parsed["request_id"], buf.String())
	}
}

// TestRequestIDHandler_WithAttrsPreservesDecorator verifies that a child
// logger created via WithAttrs still injects request_id from context (the
// decorator survives WithAttrs forwarding).
func TestRequestIDHandler_WithAttrsPreservesDecorator(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(newCapturingRequestIDHandler(&buf)).With(slog.String("component", "svc"))

	ctx := reqlog.WithRequestID(context.Background(), "req-withattrs")
	logger.InfoContext(ctx, "child log")

	out := buf.String()
	if !strings.Contains(out, `"component":"svc"`) {
		t.Fatalf("expected with-attrs preserved, got: %s", out)
	}
	if !strings.Contains(out, `"request_id":"req-withattrs"`) {
		t.Fatalf("expected request_id attached on child logger, got: %s", out)
	}
}
