package repository

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// slogGormLogger implements gormlogger.Interface so GORM slow queries and
// errors are emitted as structured slog records instead of plain-text lines.
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
		slog.Info(fmt.Sprintf(msg, data...))
	}
}

func (l *slogGormLogger) Warn(_ context.Context, msg string, data ...any) {
	if l.LogLevel >= gormlogger.Warn {
		slog.Warn(fmt.Sprintf(msg, data...))
	}
}

func (l *slogGormLogger) Error(_ context.Context, msg string, data ...any) {
	if l.LogLevel >= gormlogger.Error {
		slog.Error(fmt.Sprintf(msg, data...))
	}
}

func (l *slogGormLogger) Trace(_ context.Context, begin time.Time, fc func() (sql string, rowsAffected int64), err error) {
	if l.LogLevel <= gormlogger.Silent {
		return
	}
	elapsed := time.Since(begin)

	switch {
	case err != nil && l.LogLevel >= gormlogger.Error && (!l.IgnoreRecordNotFoundError || !errors.Is(err, gorm.ErrRecordNotFound)):
		sql, rows := fc()
		slog.Error("gorm error",
			"elapsed", fmt.Sprintf("%.3fms", float64(elapsed.Nanoseconds())/1e6),
			"rows", rows,
			"sql", sql,
			"error", err,
		)
	case elapsed > l.SlowThreshold && l.SlowThreshold > 0 && l.LogLevel >= gormlogger.Warn:
		sql, rows := fc()
		slog.Warn("slow query",
			"elapsed", fmt.Sprintf("%.3fms", float64(elapsed.Nanoseconds())/1e6),
			"threshold", l.SlowThreshold.String(),
			"rows", rows,
			"sql", sql,
		)
	case l.LogLevel >= gormlogger.Info:
		sql, rows := fc()
		slog.Info("gorm trace",
			"elapsed", fmt.Sprintf("%.3fms", float64(elapsed.Nanoseconds())/1e6),
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

	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetMaxOpenConns(100)
	sqlDB.SetConnMaxLifetime(time.Hour)

	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	slog.Info("database connected", "host", cfg.Host, "port", cfg.Port, "name", cfg.Name)
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
