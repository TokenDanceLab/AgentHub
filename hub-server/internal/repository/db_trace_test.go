package repository

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// TestSlogGormLoggerTraceMetrics verifies the G8 metric counters increment in
// the GORM Trace error and slow-query branches — including the key decision
// that the slow-query counter increments even when rows==0 (the slog Warn is
// silenced for rows==0, but the metric is not).
func TestSlogGormLoggerTraceMetrics(t *testing.T) {
	metrics.Register()

	logger := &slogGormLogger{
		SlowThreshold:             100 * time.Millisecond,
		LogLevel:                  gormlogger.Warn,
		IgnoreRecordNotFoundError: true,
	}
	ctx := context.Background()

	t.Run("error branch increments db_errors_total", func(t *testing.T) {
		before := testutil.ToFloat64(metrics.DBErrors)
		logger.Trace(ctx, time.Now(), func() (string, int64) {
			return "SELECT 1", 0
		}, errors.New("connection reset"))
		assert.Equal(t, before+1, testutil.ToFloat64(metrics.DBErrors))
	})

	t.Run("slow branch with rows>0 increments db_slow_queries_total", func(t *testing.T) {
		before := testutil.ToFloat64(metrics.DBSlowQueries)
		// begin 200ms ago → elapsed exceeds 100ms SlowThreshold
		logger.Trace(ctx, time.Now().Add(-200*time.Millisecond), func() (string, int64) {
			return "SELECT * FROM big_table", 42
		}, nil)
		assert.Equal(t, before+1, testutil.ToFloat64(metrics.DBSlowQueries))
	})

	t.Run("slow branch with rows==0 still increments db_slow_queries_total", func(t *testing.T) {
		// This is the core G8 decision: log is silenced when rows==0 (the
		// slog Warn is skipped to avoid flooding), but the metric MUST still
		// count — operators need to see slow-query rate for empty result sets.
		before := testutil.ToFloat64(metrics.DBSlowQueries)
		logger.Trace(ctx, time.Now().Add(-200*time.Millisecond), func() (string, int64) {
			return "SELECT * FROM big_table WHERE id = 'nonexistent'", 0
		}, nil)
		assert.Equal(t, before+1, testutil.ToFloat64(metrics.DBSlowQueries),
			"slow-query metric must increment even when rows==0 (log silenced, metric not)")
	})

	t.Run("non-slow query does not increment db_slow_queries_total", func(t *testing.T) {
		before := testutil.ToFloat64(metrics.DBSlowQueries)
		logger.Trace(ctx, time.Now(), func() (string, int64) {
			return "SELECT 1", 1
		}, nil)
		assert.Equal(t, before, testutil.ToFloat64(metrics.DBSlowQueries))
	})
}

// TestSlogGormLoggerTraceRecordNotFoundIgnored verifies that when
// IgnoreRecordNotFoundError=true and the error IS gorm.ErrRecordNotFound,
// the error branch (and thus db_errors_total) is NOT triggered.
func TestSlogGormLoggerTraceRecordNotFoundIgnored(t *testing.T) {
	metrics.Register()

	logger := &slogGormLogger{
		SlowThreshold:             100 * time.Millisecond,
		LogLevel:                  gormlogger.Warn,
		IgnoreRecordNotFoundError: true,
	}
	ctx := context.Background()

	before := testutil.ToFloat64(metrics.DBErrors)
	logger.Trace(ctx, time.Now(), func() (string, int64) {
		return "SELECT * FROM users WHERE id = 'missing'", 0
	}, gorm.ErrRecordNotFound)
	assert.Equal(t, before, testutil.ToFloat64(metrics.DBErrors),
		"record-not-found must not increment db_errors_total when IgnoreRecordNotFoundError=true")
}
