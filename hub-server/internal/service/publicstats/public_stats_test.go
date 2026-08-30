package publicstats

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// newMockDB returns a gorm.DB backed by sqlmock with substring SQL matching.
func newMockDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(
		func(expectedSQL, actualSQL string) error {
			if strings.Contains(actualSQL, expectedSQL) {
				return nil
			}
			return errors.New("SQL mismatch: expected substring [" + expectedSQL + "] in [" + actualSQL + "]")
		},
	)))
	require.NoError(t, err)
	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		SkipDefaultTransaction: true,
		PrepareStmt:            false,
	})
	require.NoError(t, err)
	t.Cleanup(func() { sqlDB.Close() })
	return gormDB, mock
}

// expectOneStatsRound sets up sqlmock expectations for one full GetStats compute
// (4 COUNT queries) using plain substring matching.
func expectOneStatsRound(mock sqlmock.Sqlmock, users, agents, online, msgs int64) {
	mock.ExpectQuery(`FROM "users"`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(users))
	mock.ExpectQuery(`FROM "agent_instances"`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(agents))
	mock.ExpectQuery(`FROM "pending_agent_tasks"`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(online))
	mock.ExpectQuery(`FROM "messages"`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(msgs))
}

func TestGetStats_FirstCallComputes(t *testing.T) {
	db, mock := newMockDB(t)
	expectOneStatsRound(mock, 10, 20, 3, 40)

	svc := NewPublicStatsService(db)
	got := svc.GetStats()

	require.Equal(t, PublicStats{TotalUsers: 10, TotalAgents: 20, OnlineAgents: 3, TotalMessages: 40}, got)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGetStats_CacheHitWithinTTL_NoSecondCompute(t *testing.T) {
	db, mock := newMockDB(t)
	// Only ONE round of DB expectations; a second GetStats must NOT trigger more.
	expectOneStatsRound(mock, 5, 6, 1, 7)

	svc := NewPublicStatsService(db)
	first := svc.GetStats()
	second := svc.GetStats()

	require.Equal(t, first, second)
	require.NoError(t, mock.ExpectationsWereMet(), "cache hit should not issue any DB query")
}

func TestGetStats_RecomputesAfterTTL(t *testing.T) {
	db, mock := newMockDB(t)
	expectOneStatsRound(mock, 1, 2, 0, 3)    // round 1
	expectOneStatsRound(mock, 10, 20, 5, 30) // round 2 after expiry

	svc := NewPublicStatsService(db)
	v1 := svc.GetStats()
	require.Equal(t, int64(1), v1.TotalUsers)

	// Force expiration without sleeping (same-package access to unexported fields).
	svc.mu.Lock()
	svc.expireAt = time.Now().Add(-time.Second)
	svc.mu.Unlock()

	v2 := svc.GetStats()
	require.Equal(t, int64(10), v2.TotalUsers)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGetStats_ConcurrentExpiry_SingleRecompute(t *testing.T) {
	db, mock := newMockDB(t)
	// Round 1 primes the cache.
	expectOneStatsRound(mock, 1, 1, 1, 1)
	// Round 2 is the ONLY recompute allowed when N goroutines race on expiry.
	expectOneStatsRound(mock, 99, 88, 77, 66)

	svc := NewPublicStatsService(db)
	svc.GetStats() // prime

	// Force expire.
	svc.mu.Lock()
	svc.expireAt = time.Now().Add(-time.Second)
	svc.mu.Unlock()

	const n = 16
	var wg sync.WaitGroup
	results := make([]PublicStats, n)
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(idx int) {
			defer wg.Done()
			results[idx] = svc.GetStats()
		}(i)
	}
	wg.Wait()

	for i := 1; i < n; i++ {
		require.Equal(t, results[0], results[i], "all concurrent callers must observe same value")
	}
	require.Equal(t, PublicStats{TotalUsers: 99, TotalAgents: 88, OnlineAgents: 77, TotalMessages: 66}, results[0])
	require.NoError(t, mock.ExpectationsWereMet(), "concurrent expired callers must share ONE recompute")
}
