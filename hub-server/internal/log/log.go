package log

import (
	"context"
	"log/slog"
	"os"

	"go.uber.org/zap"
	"go.uber.org/zap/exp/zapslog"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/pkg/reqlog"
)

var logger *zap.Logger

func Init(cfg *config.ServerConfig) {
	var level zapcore.Level
	switch cfg.LogLevel {
	case "debug":
		level = zapcore.DebugLevel
	case "warn":
		level = zapcore.WarnLevel
	case "error":
		level = zapcore.ErrorLevel
	default:
		level = zapcore.InfoLevel
	}

	encCfg := zap.NewProductionEncoderConfig()
	encCfg.TimeKey = "time"
	encCfg.EncodeTime = zapcore.ISO8601TimeEncoder

	var writer zapcore.WriteSyncer
	if cfg.LogFile != "" {
		lumberjackLogger := &lumberjack.Logger{
			Filename:   cfg.LogFile,
			MaxSize:    100,
			MaxBackups: 10,
			MaxAge:     30,
			Compress:   true,
		}
		writer = zapcore.AddSync(lumberjackLogger)
	} else {
		writer = zapcore.AddSync(os.Stdout)
	}

	core := zapcore.NewCore(zapcore.NewJSONEncoder(encCfg), writer, level)
	logger = zap.New(core)

	handler := zapslog.NewHandler(core, zapslog.WithCaller(true))
	// Wrap the zap-backed slog handler with a context-aware decorator so
	// service-layer log calls (slog.InfoCtx / slog.ErrorCtx / …) that pass a
	// context carrying a request_id automatically get a request_id attribute
	// attached to the record. This closes the observability gap where only the
	// access log (pkg/reqlog) carried request_id and service logs could not be
	// correlated back to the originating request.
	slog.SetDefault(slog.New(newRequestIDHandler(handler)))
}

// Sync flushes the underlying zap logger.
func Sync() {
	if logger != nil {
		_ = logger.Sync()
	}
}

// requestIDAttrKey is the stable attribute name attached to every log record
// whose context carries a request_id. It matches the field name used by the
// access log so a single grep/log-query key correlates access + service logs.
const requestIDAttrKey = "request_id"

// requestIDHandler decorates an slog.Handler so that, when handling a record,
// it extracts the request_id from the record's context (set by
// reqlog.WithRequestID) and appends it as a top-level attribute. If the
// context has no request_id (e.g. background tasks, startup), no attribute
// is added and the record is forwarded unchanged. The decorator never
// overwrites a request_id attribute that the caller already attached
// explicitly (it only adds one when the record lacks it).
type requestIDHandler struct {
	inner slog.Handler
}

func newRequestIDHandler(inner slog.Handler) *requestIDHandler {
	if inner == nil {
		return nil
	}
	return &requestIDHandler{inner: inner}
}

// Enabled forwards to the inner handler so level filtering is unchanged.
func (h *requestIDHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

// Handle extracts the request_id from ctx and, when present and not already
// on the record, appends it as an attribute before forwarding to the inner
// handler. The record is never mutated in place; attributes are appended via
// r.AddAttrs which is safe for the single-pass handler contract.
func (h *requestIDHandler) Handle(ctx context.Context, r slog.Record) error {
	if rid := reqlog.GetRequestID(ctx); rid != "" {
		if !recordHasRequestID(r) {
			r.AddAttrs(slog.String(requestIDAttrKey, rid))
		}
	}
	return h.inner.Handle(ctx, r)
}

// WithAttrs forwards so loggers created via WithAttrs keep the decorator.
func (h *requestIDHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &requestIDHandler{inner: h.inner.WithAttrs(attrs)}
}

// WithGroup forwards so loggers created via WithGroup keep the decorator.
func (h *requestIDHandler) WithGroup(name string) slog.Handler {
	return &requestIDHandler{inner: h.inner.WithGroup(name)}
}

// recordHasRequestID reports whether the record already carries a
// request_id attribute (caller-set), so the decorator does not clobber an
// explicit value with the context-derived one.
func recordHasRequestID(r slog.Record) bool {
	found := false
	r.Attrs(func(a slog.Attr) bool {
		if a.Key == requestIDAttrKey {
			found = true
			return false
		}
		return true
	})
	return found
}
