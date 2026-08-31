package seqalloc

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// mockCache is a scriptable Cache port.
type mockCache struct {
	mu          sync.Mutex
	seq         int64
	allocateErr error
	setErr      error
	setCalls    []int64
}

func (c *mockCache) AllocateSeq(_ context.Context, _ string) (int64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.allocateErr != nil {
		return 0, c.allocateErr
	}
	c.seq++
	return c.seq, nil
}

func (c *mockCache) SetSeq(_ context.Context, _ string, seq int64) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.setErr != nil {
		return c.setErr
	}
	c.seq = seq
	c.setCalls = append(c.setCalls, seq)
	return nil
}

func newMockDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, *sql.DB) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(
		func(expectedSQL, actualSQL string) error {
			if strings.Contains(actualSQL, expectedSQL) {
				return nil
			}
			return errors.New("SQL mismatch")
		},
	)))
	require.NoError(t, err)
	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		SkipDefaultTransaction: true,
		PrepareStmt:            false,
	})
	require.NoError(t, err)
	return gormDB, mock, sqlDB
}

// TestAllocateRedisSuccessSyncsMirror verifies the Redis success path returns
// the INCR value and syncs the DB mirror forward (single UPDATE, no tx).
func TestAllocateRedisSuccessSyncsMirror(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectExec(`UPDATE "sessions" SET "next_seq"`).
		WithArgs(int64(6), "sess-1", int64(6)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	cache := &mockCache{seq: 5}
	alloc := New(cache, db)

	seq, err := alloc.Allocate(context.Background(), "sess-1")
	require.NoError(t, err)
	require.Equal(t, int64(6), seq) // INCR returns 6 (5 stored + 1)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestAllocateFreshRedisKeyRecoversFromDB verifies a fresh Redis key (INCR=1)
// recovers from the DB mirror instead of returning a colliding 1.
func TestAllocateFreshRedisKeyRecoversFromDB(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	// recoverFromDB: read mirror (7), SetSeq(7), then INCR again (8).
	mock.ExpectQuery(`SELECT next_seq FROM sessions`).
		WithArgs("sess-1").
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(int64(7)))
	mock.ExpectExec(`UPDATE "sessions" SET "next_seq"`).
		WithArgs(int64(8), "sess-1", int64(8)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	cache := &mockCache{} // first AllocateSeq returns 1
	alloc := New(cache, db)

	seq, err := alloc.Allocate(context.Background(), "sess-1")
	require.NoError(t, err)
	require.Equal(t, int64(8), seq)
	require.Equal(t, []int64{7}, cache.setCalls)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestAllocateDBFallbackMirrorsBackToRedis verifies a Redis failure falls back
// to the DB row lock (inside a tx) and mirrors the value back to Redis.
func TestAllocateDBFallbackMirrorsBackToRedis(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(`UPDATE sessions SET next_seq`).
		WithArgs("sess-1").
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(int64(9)))
	mock.ExpectCommit()

	cache := &mockCache{allocateErr: errors.New("redis down")}
	alloc := New(cache, db)

	seq, err := alloc.Allocate(context.Background(), "sess-1")
	require.NoError(t, err)
	require.Equal(t, int64(9), seq)
	require.Equal(t, []int64{9}, cache.setCalls) // mirrored back to Redis
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestAllocateConcurrentSameSessionSerializes verifies per-session allocation
// is serialized so INCR + mirror never interleave on the same session.
func TestAllocateConcurrentSameSessionSerializes(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	const n = 50
	for i := 0; i < n; i++ {
		mock.ExpectExec(`UPDATE "sessions" SET "next_seq"`).
			WillReturnResult(sqlmock.NewResult(0, 1))
	}

	cache := &mockCache{}
	alloc := New(cache, db)

	var wg sync.WaitGroup
	seqs := make(chan int64, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			seq, err := alloc.Allocate(context.Background(), "sess-1")
			if err == nil {
				seqs <- seq
			}
		}()
	}
	wg.Wait()
	close(seqs)

	seen := map[int64]bool{}
	for seq := range seqs {
		require.False(t, seen[seq], "duplicate seq %d", seq)
		seen[seq] = true
	}
	require.Len(t, seen, n)
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestLockTableGarbageCollected verifies the per-session lock table is
// bounded: once an allocation completes, the entry is swept so the table
// tracks concurrent sessions instead of every session ever seen.
func TestLockTableGarbageCollected(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectExec(`UPDATE "sessions" SET "next_seq"`).
		WithArgs(int64(1), "sess-1", int64(1)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	alloc := New(&mockCache{}, db)
	_, err := alloc.Allocate(context.Background(), "sess-1")
	require.NoError(t, err)

	alloc.mu.Lock()
	require.Empty(t, alloc.locks, "lock entry should be swept after refcount drains")
	alloc.mu.Unlock()
}
