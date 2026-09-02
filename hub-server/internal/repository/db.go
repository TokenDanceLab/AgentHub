package repository

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// scrubSQLContent replaces JSON content field values in SQL log output to
// prevent sensitive message content from appearing in structured logs.
// It matches PostgreSQL/JSONB content patterns like:
//
//	content->>'text' = '{"text":"..."}' or $N = '{"text":"..."}'
//
// and replaces the JSON value body with "[REDACTED:content]".
//
// This is a best-effort lossy scrubber: it operates on the already-formatted
// SQL string. It does NOT guarantee perfect redaction for all edge cases.
// Do not rely on this scrubber alone to protect classified data in logs;
// it is a defense-in-depth measure for accidentally logged message bodies.
var scrubContentRE = regexp.MustCompile(`'\{("text"|"markdown"|"html"|"image_url"|"file_key"|"structured_data"|"thinking"):[^']*}'`)
var scrubParamRE = regexp.MustCompile(`\$(\d+)\s*=\s*'\{("text"|"markdown"|"html"|"image_url"|"file_key"|"structured_data"|"thinking"):[^}]*\}[^']*'`)

func scrubSQLContent(sql string) string {
	sql = scrubContentRE.ReplaceAllString(sql, "'[REDACTED:content]'")
	sql = scrubParamRE.ReplaceAllString(sql, "REDACTED:$1")
	return sql
}

// slogGormLogger implements gormlogger.Interface so GORM slow queries and
// errors are emitted as structured slog records instead of plain-text lines.
//
// SECURITY: Raw SQL may contain user data or secrets.  Every log site in
// Trace() passes the SQL through scrubSQLContent() before logging.  In
// production the LogLevel should additionally be held at gormlogger.Warn
// or higher so Info-level trace is never emitted.
type slogGormLogger struct {
	SlowThreshold             time.Duration
	LogLevel                  gormlogger.LogLevel
	IgnoreRecordNotFoundError bool
}

func (l *slogGormLogger) LogMode(level gormlogger.LogLevel) gormlogger.Interface {
	c := *l
	c.LogLevel = level
	return &c
}

func (l *slogGormLogger) Info(_ context.Context, msg string, data ...any) {
	if l.LogLevel >= gormlogger.Info {
		slog.Info(msg, "gorm_values", fmt.Sprint(data...))
	}
}

func (l *slogGormLogger) Warn(_ context.Context, msg string, data ...any) {
	if l.LogLevel >= gormlogger.Warn {
		slog.Warn(msg, "gorm_values", fmt.Sprint(data...))
	}
}

func (l *slogGormLogger) Error(_ context.Context, msg string, data ...any) {
	if l.LogLevel >= gormlogger.Error {
		slog.Error(msg, "gorm_values", fmt.Sprint(data...))
	}
}

func (l *slogGormLogger) Trace(_ context.Context, begin time.Time, fc func() (sql string, rowsAffected int64), err error) {
	if l.LogLevel <= gormlogger.Silent {
		return
	}
	elapsed := time.Since(begin)

	switch {
	case err != nil && l.LogLevel >= gormlogger.Error && (!l.IgnoreRecordNotFoundError || !errors.Is(err, gorm.ErrRecordNotFound)):
		if metrics.DBErrors != nil {
			metrics.DBErrors.Inc()
		}
		sql, rows := fc()
		sql = scrubSQLContent(sql)
		slog.Error("gorm error",
			"elapsed_ms", float64(elapsed.Nanoseconds())/1e6,
			"rows", rows,
			"sql", sql,
			"error", err,
		)
	case elapsed > l.SlowThreshold && l.SlowThreshold > 0 && l.LogLevel >= gormlogger.Warn:
		// G8: the slow-query metric counts EVERY slow query regardless of
		// rows-affected. The slog.Warn below is silenced when rows==0 (early
		// return) to avoid log flooding, but the metric is NOT silenced —
		// operators must see slow-query rate even for empty result sets.
		if metrics.DBSlowQueries != nil {
			metrics.DBSlowQueries.Inc()
		}
		sql, rows := fc()
		if rows == 0 {
			return // empty result set — slow is almost certainly steal, not a query problem (log silenced; metric already counted above)
		}
		sql = scrubSQLContent(sql)
		slog.Warn("slow query",
			"elapsed_ms", float64(elapsed.Nanoseconds())/1e6,
			"threshold", l.SlowThreshold.String(),
			"rows", rows,
			"sql", sql,
		)
	case l.LogLevel >= gormlogger.Info:
		sql, rows := fc()
		sql = scrubSQLContent(sql)
		slog.Info("gorm trace",
			"elapsed_ms", float64(elapsed.Nanoseconds())/1e6,
			"rows", rows,
			"sql", sql,
		)
	}
}

func InitDB(cfg *config.DBConfig) (*gorm.DB, error) {
	gormLog := &slogGormLogger{
		SlowThreshold:             100 * time.Millisecond,
		LogLevel:                  gormlogger.Warn,
		IgnoreRecordNotFoundError: true,
	}

	db, err := gorm.Open(postgres.Open(cfg.DSN()), &gorm.Config{
		Logger:                 gormLog,
		SkipDefaultTransaction: true,
		PrepareStmt:            true,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get underlying sql.DB: %w", err)
	}

	// Floor guard: a zeroed/absent pool config must not fall back to
	// database/sql's unlimited-open + 2-idle defaults nor to a starved
	// 2-connection pool; non-positive values get the documented defaults
	// and idle never exceeds open.
	maxOpen := cfg.MaxOpenConns
	if maxOpen <= 0 {
		maxOpen = config.DefaultDBMaxOpenConns
	}
	maxIdle := cfg.MaxIdleConns
	if maxIdle <= 0 {
		maxIdle = config.DefaultDBMaxIdleConns
	}
	if maxIdle > maxOpen {
		maxIdle = maxOpen
	}
	sqlDB.SetMaxIdleConns(maxIdle)
	sqlDB.SetMaxOpenConns(maxOpen)
	sqlDB.SetConnMaxLifetime(cfg.ConnMaxLifetime)
	sqlDB.SetConnMaxIdleTime(cfg.ConnMaxIdleTime)

	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	slog.Info("database connected",
		"host", cfg.Host,
		"port", cfg.Port,
		"name", cfg.Name,
		"application_name", cfg.ApplicationName,
		"max_open_conns", maxOpen,
		"max_idle_conns", maxIdle,
	)
	return db, nil
}

func WrapNotFound(err error, mappedErr error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return mappedErr
	}
	return err
}
