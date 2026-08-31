// Package seqalloc owns message sequence allocation for Hub sessions. It is
// the single implementation of the Redis INCR → DB-mirror → DB-fallback chain
// that both the message service and the agent callback service previously
// duplicated, and whose behavior had already diverged (#1411 / #1533).
//
// Continuity contract (must hold across any Redis restart / FLUSH / expiry):
// a freshly recreated Redis key must recover from the DB mirror instead of
// restarting at 1, and a DB fallback must mirror back to Redis so a later Redis
// recovery never re-issues a sequence the DB already handed out.
package seqalloc

import (
	"context"
	"log/slog"
	"sync"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/repository"
)

// Cache is the subset of the cache client used for sequence allocation.
// *cache.Client and cache.NoOpCache both implement it.
type Cache interface {
	AllocateSeq(ctx context.Context, sessionID string) (int64, error)
	SetSeq(ctx context.Context, sessionID string, seq int64) error
}

// Allocator allocates monotonic message sequence numbers per session. It is
// safe for concurrent use.
type Allocator struct {
	cache Cache
	db    *gorm.DB

	mu    sync.Mutex
	locks map[string]*sessionLock // sessionID -> ref-counted mutex
}

type sessionLock struct {
	mu   sync.Mutex
	refs int
}

// New constructs an Allocator over the given cache port and DB.
func New(cache Cache, db *gorm.DB) *Allocator {
	return &Allocator{cache: cache, db: db, locks: make(map[string]*sessionLock)}
}

// lockFor returns the per-session mutex. Redis INCR is atomic, but the DB
// mirror (SyncSessionSeq) and the DB fallback (AllocateSeqID) both touch
// sessions.next_seq; without serialization the two sources can interleave and
// hand out duplicate sequences (#1533). Different sessions stay parallel.
//
// The lock table is ref-counted: acquire pins the entry so the release-side
// sweep can never delete a mutex another goroutine is still holding or about
// to lock. Entries are removed once the refcount drains, bounding the table
// by the number of concurrently allocating sessions instead of the total
// number of sessions ever seen.
func (a *Allocator) lockFor(sessionID string) *sync.Mutex {
	a.mu.Lock()
	defer a.mu.Unlock()
	sl, ok := a.locks[sessionID]
	if !ok {
		sl = &sessionLock{}
		a.locks[sessionID] = sl
	}
	sl.refs++
	return &sl.mu
}

// releaseSessionLock drops the acquired reference and deletes the entry once
// no goroutine holds one. Must be called exactly once per lockFor after the
// returned mutex is unlocked.
func (a *Allocator) releaseSessionLock(sessionID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	sl := a.locks[sessionID]
	if sl == nil {
		return
	}
	sl.refs--
	if sl.refs == 0 {
		delete(a.locks, sessionID)
	}
}

// Allocate returns the next sequence number for a session. It tries Redis INCR
// first; on a fresh Redis key it recovers from the DB mirror, then syncs the
// DB mirror forward. On Redis failure it falls back to the DB row lock and
// mirrors the fallback value back to Redis.
func (a *Allocator) Allocate(ctx context.Context, sessionID string) (int64, error) {
	mu := a.lockFor(sessionID)
	mu.Lock()
	defer func() {
		mu.Unlock()
		a.releaseSessionLock(sessionID)
	}()

	seq, err := a.cache.AllocateSeq(ctx, sessionID)
	if err == nil {
		if seq == 1 {
			// Fresh Redis key (restart / FLUSH / expiry): recover from the DB
			// mirror to prevent a seq regression or duplicate (#1533 / #1411).
			if recovered, ok := a.recoverFromDB(ctx, sessionID); ok {
				seq = recovered
			}
		}
		// Persist the mirror forward-only: Redis is the live allocation source,
		// the DB only advances and never regresses, for recovery use.
		if syncErr := repository.SyncSessionSeq(a.db, sessionID, seq); syncErr != nil {
			slog.Warn("failed to sync session seq mirror to db", "session_id", sessionID, "seq", seq, "error", syncErr)
		}
		return seq, nil
	}

	slog.Warn("redis seq allocation failed, falling back to DB", "session_id", sessionID, "error", err)
	var fallbackSeq int64
	err = a.db.Transaction(func(tx *gorm.DB) error {
		var txErr error
		fallbackSeq, txErr = repository.AllocateSeqID(tx, sessionID)
		return txErr
	})
	if err == nil {
		// Mirror the DB allocation back to Redis so a later Redis recovery
		// does not INCR from a stale value and re-issue a duplicate (best-effort
		// — Redis is still down, so failure is ignored).
		if setErr := a.cache.SetSeq(ctx, sessionID, fallbackSeq); setErr != nil {
			slog.Warn("failed to mirror fallback seq to redis", "session_id", sessionID, "seq", fallbackSeq, "error", setErr)
		}
	}
	return fallbackSeq, err
}

// recoverFromDB restores the Redis seq key from the sessions.next_seq mirror
// when the Redis key has been freshly recreated (INCR returned 1). It mirrors
// the message service's #1533 recovery so both allocation callers share one
// continuity contract.
func (a *Allocator) recoverFromDB(ctx context.Context, sessionID string) (int64, bool) {
	var dbSeq int64
	if err := a.db.Raw("SELECT next_seq FROM sessions WHERE id = ?", sessionID).Scan(&dbSeq).Error; err != nil || dbSeq <= 0 {
		return 0, false
	}
	if err := a.cache.SetSeq(ctx, sessionID, dbSeq); err != nil {
		return 0, false
	}
	recovered, err := a.cache.AllocateSeq(ctx, sessionID)
	if err != nil {
		return 0, false
	}
	return recovered, true
}
