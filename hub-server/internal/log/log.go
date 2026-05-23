package log

import (
	"log/slog"
	"os"

	"go.uber.org/zap"
	"go.uber.org/zap/exp/zapslog"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"

	"github.com/agenthub/hub-server/internal/config"
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
	slog.SetDefault(slog.New(handler))
}

func Sync() {
	if logger != nil {
		_ = logger.Sync()
	}
}
